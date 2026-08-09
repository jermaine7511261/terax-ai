//! Office document parsing (PDF / PPTX / DOCX / XLSX / DOC / XLS / PPT) for
//! `fs_read_file`.
//!
//! OOXML (PPTX/DOCX/XLSX) + legacy binary (DOC/XLS/PPT) text extraction is
//! powered by `office_oxide` (pure Rust, already in the dependency tree); PDF
//! extraction by `pdf_oxide`. All pure Rust — no external soffice/pandoc.
//!
//! `fs_read_file` (AI path) reads the file bytes, sniffs magic / extension,
//! dispatches to the right extractor, and returns the document's text so the
//! AI tool can read it like any text file. The editor/explorer path keeps
//! seeing Office files as binary (PDF iframe preview, no text-clobber saves).

use std::io::{Cursor, Read};

use tauri::Manager;

use crate::modules::fs::file::ReadResult;

/// Cap on the decompressed size of any single XML entry (zip-bomb guard).
const MAX_XML_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// Cap on a single PDF's bytes (mirrors ).
const MAX_PDF_BYTES: usize = 50 * 1024 * 1024;
/// Cap on any single Office document (zip) input.
const MAX_OFFICE_BYTES: usize = 50 * 1024 * 1024;
/// Cap on the total extracted text returned to callers. The per-entry cap
/// bounds one XML stream, but a document with thousands of slides/cells could
/// otherwise accumulate unbounded output; the AI read_file tool only wants the
/// first few KB anyway.
const MAX_EXTRACT_OUTPUT: usize = 8 * 1024 * 1024;

// ───────────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────────

/// Sniff the document type from magic bytes and extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocType {
    Pdf,
    Pptx,
    Docx,
    Xlsx,
    Doc,
    Xls,
    Ppt,
}

/// Legacy OLE2/CFB (Compound File Binary) magic: `D0 CF 11 E0 A1 B1 1A E1`.
const CFB_MAGIC: &[u8] = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1";

/// Detect the Office document type. Returns `None` for non-Office files.
pub fn sniff_doc_type(bytes: &[u8], path: &str) -> Option<DocType> {
    // PDF magic: %PDF-. This takes priority over the extension so a renamed
    // PDF (or a PDF with an odd extension) is still recognized.
    if bytes.starts_with(b"%PDF-") {
        return Some(DocType::Pdf);
    }
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    // Legacy binary formats carry the OLE2/CFB magic. The container takes
    // priority over the extension: a renamed .doc that is really a zip is
    // handled below by the OOXML extension path, and a .docx that is really a
    // CFB file (rare, but Word produces such files) is read as legacy.
    if bytes.starts_with(CFB_MAGIC) {
        return match ext {
            "xls" | "xla" | "xlsm" => Some(DocType::Xls),
            "ppt" | "pps" | "pot" => Some(DocType::Ppt),
            _ => Some(DocType::Doc),
        };
    }
    match ext {
        "pptx" => Some(DocType::Pptx),
        "docx" => Some(DocType::Docx),
        "xlsx" => Some(DocType::Xlsx),
        "doc" | "dot" => Some(DocType::Doc),
        "xls" => Some(DocType::Xls),
        "ppt" => Some(DocType::Ppt),
        _ => None,
    }
}

/// Extract text from an Office document given its bytes and detected type.
/// Returns `ReadResult::Text` with the document text (or Binary/TooLarge).
pub fn extract_document(bytes: &[u8], path: &str) -> Option<ReadResult> {
    let dtype = sniff_doc_type(bytes, path)?;
    if bytes.len() > MAX_OFFICE_BYTES {
        return Some(ReadResult::TooLarge {
            size: bytes.len() as u64,
            limit: MAX_OFFICE_BYTES as u64,
        });
    }
    let text = match dtype {
        DocType::Pdf => extract_pdf_text(bytes)?,
        DocType::Pptx => extract_pptx_text(bytes)?,
        DocType::Docx => extract_docx_text(bytes)?,
        DocType::Xlsx => extract_xlsx_text(bytes)?,
        DocType::Doc | DocType::Xls | DocType::Ppt => extract_legacy_text(bytes, dtype)?,
    };
    Some(ReadResult::Text {
        content: text,
        size: bytes.len() as u64,
        mtime: 0, // caller sets real mtime; keep cheap here
    })
}

/// Legacy binary formats (DOC / XLS / PPT) via `office_oxide`. Returns the
/// document's plain text; `None` on any parse failure so the normal text /
/// binary classification path runs.
fn extract_legacy_text(bytes: &[u8], dtype: DocType) -> Option<String> {
    use office_oxide::format::DocumentFormat;
    let format = match dtype {
        DocType::Doc => DocumentFormat::Doc,
        DocType::Xls => DocumentFormat::Xls,
        DocType::Ppt => DocumentFormat::Ppt,
        _ => return None,
    };
    let doc = office_oxide::Document::from_reader(Cursor::new(bytes.to_vec()), format).ok()?;
    let text = doc.plain_text();
    if text.trim().is_empty() {
        return None;
    }
    let mut out = String::from("--- legacy document ---\n");
    out.push_str(&text);
    if out.len() > MAX_EXTRACT_OUTPUT {
        out.truncate(MAX_EXTRACT_OUTPUT);
        out.push_str("\n...(truncated)");
    }
    Some(out)
}

// ───────────────────────────────────────────────────────────────────────────
// PPTX (via office_oxide / quick_xml)
// ───────────────────────────────────────────────────────────────────────────

/// Extract plain text from PPTX bytes: slide texts with `--- Slide N ---`
/// headers and `Speaker Notes:` sections. Ported from .
pub fn extract_pptx_text(bytes: &[u8]) -> Option<String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;

    let mut slide_numbers: Vec<u32> = archive
        .file_names()
        .filter_map(|name| {
            name.strip_prefix("ppt/slides/slide")?
                .strip_suffix(".xml")?
                .parse()
                .ok()
        })
        .collect();
    slide_numbers.sort_unstable();
    if slide_numbers.is_empty() {
        return Some("(empty PPTX: no slides found)".to_string());
    }

    let mut all_text = String::new();
    for number in slide_numbers {
        if all_text.len() >= MAX_EXTRACT_OUTPUT {
            break;
        }
        let slide_xml = read_zip_entry(&mut archive, &format!("ppt/slides/slide{number}.xml"))?;
        let slide_text = extract_drawingml_text(&slide_xml).unwrap_or_default();
        let notes_text = read_zip_entry(
            &mut archive,
            &format!("ppt/notesSlides/notesSlide{number}.xml"),
        )
        .map(|xml| extract_drawingml_text(&xml).unwrap_or_default())
        .unwrap_or_default();

        if !all_text.is_empty() {
            all_text.push_str("\n\n");
        }
        all_text.push_str(&format!("--- Slide {number} ---\n"));
        all_text.push_str(&slide_text);
        if !notes_text.is_empty() {
            all_text.push_str("\n\nSpeaker Notes:\n");
            all_text.push_str(&notes_text);
        }
    }
    Some(all_text)
}

/// Read a zip entry to a string, `None` if missing/oversized.
fn read_zip_entry<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let file = archive.by_name(name).ok()?;
    let mut content = String::new();
    file.take(MAX_XML_ENTRY_BYTES)
        .read_to_string(&mut content)
        .ok()?;
    if content.len() as u64 == MAX_XML_ENTRY_BYTES {
        return None;
    }
    Some(content)
}

/// Extract text from DrawingML: the character content of `<a:t>` runs,
/// one line per `<a:p>` paragraph.
fn extract_drawingml_text(xml: &str) -> Result<String, String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut text = String::new();
    let mut in_text_run = false;
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Start(ref e))
                if e.local_name().as_ref() == b"t" =>
            {
                in_text_run = true;
            }
            Ok(quick_xml::events::Event::Text(e)) if in_text_run => {
                if let Ok(content) = e.decode() {
                    text.push_str(&content);
                }
            }
            Ok(quick_xml::events::Event::GeneralRef(e)) if in_text_run => {
                if let Ok(Some(ch)) = e.resolve_char_ref() {
                    text.push(ch);
                }
            }
            Ok(quick_xml::events::Event::End(ref e)) => match e.local_name().as_ref() {
                b"t" => in_text_run = false,
                b"p" if !text.is_empty() && !text.ends_with('\n') => text.push('\n'),
                _ => {}
            },
            Ok(quick_xml::events::Event::Eof) => break,
            Err(_) => return Err("xml parse error".to_string()),
            _ => {}
        }
    }
    Ok(text.trim().to_string())
}

// ───────────────────────────────────────────────────────────────────────────
// PDF (ported from  pdf.rs — text extraction only, no rendering)
// ───────────────────────────────────────────────────────────────────────────

/// Extract text from a PDF using pdf_oxide.
pub fn extract_pdf_text(bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_PDF_BYTES {
        return None;
    }
    let doc = pdf_oxide::PdfDocument::from_bytes(bytes.to_vec()).ok()?;
    let page_count = doc.page_count().ok()?;
    let mut out = String::new();
    for i in 0..page_count {
        if out.len() >= MAX_EXTRACT_OUTPUT {
            break;
        }
        if let Ok(lines) = doc.extract_text_lines(i) {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&format!("--- Page {} ---\n", i + 1));
            for line in lines {
                out.push_str(line.text.trim());
                out.push('\n');
            }
        }
    }
    if out.is_empty() {
        return Some("(PDF: no extractable text — scanned or image-only)".to_string());
    }
    Some(out)
}

// ───────────────────────────────────────────────────────────────────────────
// DOCX (hand-written quick_xml over word/document.xml — same pattern as PPTX)
// ───────────────────────────────────────────────────────────────────────────

/// Extract text from a DOCX: read `word/document.xml`, collect `<w:t>` runs.
pub fn extract_docx_text(bytes: &[u8]) -> Option<String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let xml = read_zip_entry(&mut archive, "word/document.xml")?;
    // Collect text per `<w:p>` paragraph (one line each), plus table cell breaks.
    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut out = String::new();
    let mut in_text = false;
    loop {
        if out.len() >= MAX_EXTRACT_OUTPUT {
            break;
        }
        match reader.read_event() {
            Ok(quick_xml::events::Event::Start(ref e)) => match e.local_name().as_ref() {
                b"t" => in_text = true,
                b"tab" => out.push('\t'),
                b"br" => out.push('\n'),
                _ => {}
            },
            Ok(quick_xml::events::Event::Text(e)) if in_text => {
                if let Ok(content) = e.decode() {
                    out.push_str(&content);
                }
            }
            Ok(quick_xml::events::Event::GeneralRef(e)) if in_text => {
                if let Ok(Some(ch)) = e.resolve_char_ref() {
                    out.push(ch);
                }
            }
            Ok(quick_xml::events::Event::End(ref e)) => match e.local_name().as_ref() {
                b"t" => in_text = false,
                b"p" if !out.is_empty() && !out.ends_with('\n') => out.push('\n'),
                _ => {}
            },
            Ok(quick_xml::events::Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
    }
    Some(if out.trim().is_empty() {
        "(empty DOCX)".to_string()
    } else {
        out.trim().to_string()
    })
}

// ───────────────────────────────────────────────────────────────────────────
// XLSX (via calamine)
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// Creation (XLSX via rust_xlsxwriter)
// ───────────────────────────────────────────────────────────────────────────

/// Build an XLSX from a 2D array of cell values (via `office_oxide`). Cells
/// that parse as numbers become numeric, strings starting with `=` become
/// formulas, everything else is a string. The first row is styled bold.
/// Returns the file bytes.
pub fn build_xlsx(rows: &[Vec<String>]) -> Result<Vec<u8>, String> {
    use office_oxide::xlsx::write::{CellStyle, XlsxWriter};
    let mut writer = XlsxWriter::new();
    {
        let mut sheet = writer.add_sheet("Sheet1");
        for (r, row) in rows.iter().enumerate() {
            for (c, val) in row.iter().enumerate() {
                let data = parse_cell(val);
                if r == 0 {
                    sheet.set_cell_styled(r, c, data, CellStyle::new().bold());
                } else {
                    sheet.set_cell(r, c, data);
                }
            }
        }
    }
    let mut buf = std::io::Cursor::new(Vec::new());
    writer.write_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

/// Interpret a string cell value as number / formula / string.
fn parse_cell(val: &str) -> office_oxide::xlsx::write::CellData {
    use office_oxide::xlsx::write::CellData;
    let trimmed = val.trim();
    if let Some(formula) = trimmed.strip_prefix('=') {
        CellData::Formula(formula.to_string())
    } else if let Ok(n) = trimmed.parse::<f64>() {
        CellData::Number(n)
    } else {
        CellData::String(val.to_string())
    }
}

/// Extract cell text from an XLSX via calamine.
pub fn extract_xlsx_text(bytes: &[u8]) -> Option<String> {
    use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
    let mut workbook: Xlsx<Cursor<Vec<u8>>> =
        open_workbook_from_rs(Cursor::new(bytes.to_vec())).ok()?;
    let mut out = String::new();
    let sheet_names = workbook.sheet_names().to_vec();
    for name in &sheet_names {
        if out.len() >= MAX_EXTRACT_OUTPUT {
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("--- Sheet: {name} ---\n"));
        if let Ok(range) = workbook.worksheet_range(name) {
            for row in range.rows() {
                if out.len() >= MAX_EXTRACT_OUTPUT {
                    break;
                }
                let cells: Vec<String> = row
                    .iter()
                    .map(|c| match c {
                        Data::Empty => String::new(),
                        other => other.to_string(),
                    })
                    .collect();
                out.push_str(&cells.join("\t"));
                out.push('\n');
            }
        }
    }
    Some(if out.is_empty() {
        "(empty XLSX)".to_string()
    } else {
        out.trim().to_string()
    })
}

// ───────────────────────────────────────────────────────────────────────────
// Creation: DOCX / PPTX (via office_oxide)
// ───────────────────────────────────────────────────────────────────────────

/// Build a DOCX from a markdown-ish line list (via `office_oxide`). Lines are
/// joined and rendered through the markdown engine, so `# ` headings, bold /
/// italic, `- ` bullets, and `| a | b |` pipe tables produce proper Word
/// structures (styles.xml + numbering.xml included).
pub fn build_docx(lines: &[&str]) -> Result<Vec<u8>, String> {
    use office_oxide::format::DocumentFormat;
    let markdown = lines.join("\n");
    let mut buf = std::io::Cursor::new(Vec::new());
    office_oxide::create::create_from_markdown_to_writer(
        &markdown,
        DocumentFormat::Docx,
        &mut buf,
    )
    .map_err(|e| format!("build_docx failed: {e}"))?;
    Ok(buf.into_inner())
}

/// Build a PPTX from slide strings (via `office_oxide`). Each string is one
/// slide: the first non-empty line becomes the slide title, lines starting
/// with `- ` become a bullet list, and the remaining lines become body
/// paragraphs.
pub fn build_pptx(slides: &[&str]) -> Result<Vec<u8>, String> {
    use office_oxide::pptx::write::PptxWriter;
    if slides.is_empty() {
        return Err("no slides".to_string());
    }
    let mut writer = PptxWriter::new();
    for raw in slides {
        {
            let slide = writer.add_slide();
            let mut lines = raw.lines();
            let first = lines.next();
            if let Some(first) = first {
                if !first.trim().is_empty() {
                    slide.set_title(first.trim());
                }
            }
            let mut bullets: Vec<&str> = Vec::new();
            for line in lines {
                if let Some(item) = line.strip_prefix("- ") {
                    bullets.push(item);
                } else if !line.trim().is_empty() {
                    slide.add_text(line.trim_end());
                }
            }
            if !bullets.is_empty() {
                slide.add_bullet_list(&bullets);
            }
        }
    }
    let mut buf = std::io::Cursor::new(Vec::new());
    writer.write_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

// ───────────────────────────────────────────────────────────────────────────
// PDF validation / page count (via pdf_oxide)
// ───────────────────────────────────────────────────────────────────────────

/// Validate a PDF and report its page count. Used as a lightweight sanity
/// check before/after PDF operations.
pub fn pdf_page_count(bytes: &[u8]) -> Result<usize, String> {
    let doc = pdf_oxide::PdfDocument::from_bytes(bytes.to_vec())
        .map_err(|e| format!("not a valid PDF: {e}"))?;
    doc.page_count().map_err(|e| e.to_string())
}

// ───────────────────────────────────────────────────────────────────────────
// PDF merge / encrypt (via lopdf)
// ───────────────────────────────────────────────────────────────────────────

/// Merge multiple PDFs into one, preserving document order. `inputs` are the
/// raw PDF byte buffers; the first page of the second document follows the last
/// page of the first, and so on. All pure Rust (lopdf).
pub fn merge_pdfs_bytes(inputs: &[&[u8]]) -> Result<Vec<u8>, String> {
    use lopdf::{Document, Object, ObjectId};

    let mut merged = Document::with_version("1.7");
    // Start renumbering each input at 1; after inserting all of them every id
    // below `max_id` is taken, so the synthetic Pages/Catalog nodes we add
    // afterward get the next free ids with no collision.
    let mut max_id = 1u32;
    let mut kids: Vec<Object> = Vec::new();
    let mut count = 0u32;

    for bytes in inputs {
        if bytes.len() > MAX_PDF_BYTES {
            return Err(format!(
                "PDF exceeds {} MiB cap",
                MAX_PDF_BYTES / (1024 * 1024)
            ));
        }
        let mut doc = Document::load_mem(bytes)
            .map_err(|e| format!("PDF parse failed: {e}"))?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        // Pages first, in document order. They keep their renumbered ids; the
        // Parent reference is rewritten to the merged Pages root afterwards.
        for page_id in doc.get_pages().into_values() {
            let page = doc
                .get_object(page_id)
                .map_err(|e| format!("PDF page read failed: {e}"))?
                .clone();
            merged.objects.insert(page_id, page);
            kids.push(Object::Reference(page_id));
            count += 1;
        }
        // Everything else (fonts, streams, resources...) except the structural
        // roots, which are rebuilt below.
        for (id, obj) in doc.objects.into_iter() {
            match obj.type_name().unwrap_or(b"") {
                b"Page" | b"Pages" | b"Catalog" | b"Outlines" | b"Outline" => {}
                _ => {
                    merged.objects.insert(id, obj);
                }
            }
        }
    }

    if count == 0 {
        return Err("no pages to merge".to_string());
    }

    let pages_id: ObjectId = merged.new_object_id();
    for kid in &kids {
        let id = if let Object::Reference(id) = kid {
            *id
        } else {
            continue;
        };
        let obj = merged.get_object_mut(id);
        let dict = obj.and_then(|o| o.as_dict_mut());
        if let Ok(dict) = dict {
            dict.set("Parent", pages_id);
        }
    }
    let mut pages_dict = lopdf::Dictionary::new();
    pages_dict.set("Type", "Pages");
    pages_dict.set("Kids", kids);
    pages_dict.set("Count", count);
    merged.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let mut catalog_dict = lopdf::Dictionary::new();
    catalog_dict.set("Type", "Catalog");
    catalog_dict.set("Pages", pages_id);
    let catalog_id = merged.add_object(Object::Dictionary(catalog_dict));
    merged.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    merged.save_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Encrypt a PDF with AES-256 (PDF 2.0 / ISO 32000-2 V5). `owner_password`
/// controls permission-restriction changes; `user_password` is what a reader
/// types to open the document. Returns the encrypted bytes.
pub fn encrypt_pdf_bytes(
    bytes: &[u8],
    user_password: &str,
    owner_password: &str,
) -> Result<Vec<u8>, String> {
    use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
    use lopdf::{Document, EncryptionState, EncryptionVersion, Permissions};
    use rand::RngCore;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    if bytes.len() > MAX_PDF_BYTES {
        return Err(format!(
            "PDF exceeds {} MiB cap",
            MAX_PDF_BYTES / (1024 * 1024)
        ));
    }
    let mut doc = Document::load_mem(bytes).map_err(|e| format!("PDF parse failed: {e}"))?;
    if doc.is_encrypted() {
        return Err("input PDF is already encrypted".to_string());
    }
    if user_password.is_empty() && owner_password.is_empty() {
        return Err("at least one of user/owner password is required".to_string());
    }

    let permissions = Permissions::PRINTABLE
        | Permissions::COPYABLE
        | Permissions::COPYABLE_FOR_ACCESSIBILITY
        | Permissions::PRINTABLE_IN_HIGH_QUALITY;
    let mut file_encryption_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut file_encryption_key);

    let version = EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(
            b"StdCF".to_vec(),
            Arc::new(Aes256CryptFilter) as Arc<dyn CryptFilter>,
        )]),
        file_encryption_key: &file_encryption_key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password,
        user_password,
        permissions,
    };
    let state = EncryptionState::try_from(version)
        .map_err(|e| format!("encryption setup failed: {e}"))?;
    doc.encrypt(&state).map_err(|e| e.to_string())?;

    let mut buf = Vec::new();
    doc.save_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

// ───────────────────────────────────────────────────────────────────────────
// PDF creation (text renderer, via lopdf)
// ───────────────────────────────────────────────────────────────────────────

/// Build a text PDF (A4) from markdown-ish lines using the PDF base-14 fonts
/// (no embedding, no rasterizer). `# `/`## `/`### ` become bold headings,
/// `- ` becomes a bullet, everything else a body paragraph. Words wrap to the
/// page width and pages break automatically. Pure Rust (lopdf).
pub fn build_pdf(lines: &[&str]) -> Result<Vec<u8>, String> {
    use lopdf::content::{Content, Operation};
    use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

    const PAGE_W: f64 = 595.276; // A4 portrait, pt
    const PAGE_H: f64 = 841.89;
    const MARGIN: f64 = 72.0;
    const BODY: &str = "F1";
    const BOLD: &str = "F2";
    const BODY_SIZE: f64 = 11.0;
    const MAX_TEXT_W: f64 = PAGE_W - 2.0 * MARGIN;

    let mut doc = Document::with_version("1.7");
    let mut font_map = Dictionary::new();
    for (id, base) in [(BODY, "Helvetica"), (BOLD, "Helvetica-Bold")] {
        let mut f = Dictionary::new();
        f.set("Type", "Font");
        f.set("Subtype", "Type1");
        f.set("BaseFont", base);
        // WinAnsi lets text extractors map char codes to unicode.
        f.set("Encoding", "WinAnsiEncoding");
        let oid = doc.add_object(Object::Dictionary(f));
        font_map.set(id, oid);
    }
    let mut resources = Dictionary::new();
    resources.set("Font", font_map);
    let resources_id = doc.add_object(Object::Dictionary(resources.clone()));

    let mut page_ids: Vec<ObjectId> = Vec::new();
    let mut ops: Vec<Operation> = Vec::new();
    let mut y = PAGE_H - MARGIN;

    macro_rules! flush_page {
        () => {{
            if !ops.is_empty() {
                let content = Content {
                    operations: ops.clone(),
                };
                let content_id = doc
                    .add_object(Stream::new(Dictionary::new(), content.encode().unwrap()));
                let mut page = Dictionary::new();
                page.set("Type", "Page");
                page.set(
                    "MediaBox",
                    vec![
                        Object::Integer(0), Object::Integer(0), Object::Integer(PAGE_W as i64), Object::Integer(PAGE_H as i64),
                    ],
                );
                page.set("Resources", Object::Dictionary(resources.clone()));
                page.set("Contents", content_id);
                let page_id = doc.add_object(Object::Dictionary(page));
                page_ids.push(page_id);
                ops.clear();
            }
        }};
    }

    for raw in lines {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            y -= BODY_SIZE * 0.6;
            continue;
        }
        let (font, size) = if line.starts_with("### ") {
            (BOLD, 12.0)
        } else if line.starts_with("## ") {
            (BOLD, 14.0)
        } else if line.starts_with("# ") {
            (BOLD, 18.0)
        } else {
            (BODY, BODY_SIZE)
        };
        let text = if let Some(t) = line.strip_prefix("# ") {
            t.to_string()
        } else if let Some(t) = line.strip_prefix("## ") {
            t.to_string()
        } else if let Some(t) = line.strip_prefix("### ") {
            t.to_string()
        } else if let Some(t) = line.strip_prefix("- ") {
            format!("- {t}")
        } else {
            line.to_string()
        };
        // Each rendered line gets its own `BT ... ET` block so the `Td`
        // coordinates are absolute (a fresh text object resets the line
        // matrix; `Td` inside one block is a relative move).
        for wrapped in wrap_text_lines(&text, size, MAX_TEXT_W) {
            if y < MARGIN {
                flush_page!();
                y = PAGE_H - MARGIN;
            }
            ops.push(Operation::new("BT", vec![]));
            ops.push(Operation::new(
                "Tf",
                vec![Object::Name(font.as_bytes().to_vec()), Object::Integer(size as i64)],
            ));
            ops.push(Operation::new(
                "Td",
                vec![Object::Integer(MARGIN as i64), Object::Integer(y as i64)],
            ));
            ops.push(Operation::new("Tj", vec![Object::string_literal(wrapped.as_str())]));
            ops.push(Operation::new("ET", vec![]));
            y -= size * 1.3;
        }
    }
    flush_page!();
    if page_ids.is_empty() {
        // Always emit at least one page so the output is a valid PDF.
        let content_id = doc.add_object(Stream::new(Dictionary::new(), Vec::new()));
        let mut page = Dictionary::new();
        page.set("Type", "Page");
        page.set(
            "MediaBox",
            vec![
                Object::Integer(0), Object::Integer(0), Object::Integer(PAGE_W as i64), Object::Integer(PAGE_H as i64),
            ],
        );
        page.set("Resources", resources_id);
        page.set("Contents", content_id);
        page_ids.push(doc.add_object(Object::Dictionary(page)));
    }

    let pages_id: ObjectId = doc.new_object_id();
    for id in &page_ids {
        let obj = doc.get_object_mut(*id);
        let dict = obj.and_then(|o| o.as_dict_mut());
        if let Ok(dict) = dict {
            dict.set("Parent", pages_id);
        }
    }
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", "Pages");
    pages_dict.set(
        "Kids",
        page_ids.iter().map(|id| Object::Reference(*id)).collect::<Vec<_>>(),
    );
    pages_dict.set("Count", page_ids.len() as u32);
    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let mut catalog = Dictionary::new();
    catalog.set("Type", "Catalog");
    catalog.set("Pages", pages_id);
    let catalog_id = doc.add_object(Object::Dictionary(catalog));
    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Approximate ASCII/CJK glyph width and wrap `text` to `max_width` points.
/// Breaks at word boundaries for ASCII and anywhere for full-width chars.
fn wrap_text_lines(text: &str, size: f64, max_width: f64) -> Vec<String> {
    let mut out = Vec::new();
    let mut line = String::new();
    let mut line_w = 0.0;
    for word in text.split(' ') {
        let mut word_w = 0.0;
        for ch in word.chars() {
            word_w += if ch.is_ascii() { size * 0.5 } else { size };
        }
        if !line.is_empty() && line_w + word_w + size * 0.5 > max_width {
            out.push(line);
            line = String::new();
            line_w = 0.0;
        }
        if !line.is_empty() {
            line.push(' ');
            line_w += size * 0.5;
        }
        line.push_str(word);
        line_w += word_w;
    }
    if !line.is_empty() || text.is_empty() {
        out.push(line);
    }
    out
}

// ───────────────────────────────────────────────────────────────────────────
// Tauri commands
// ───────────────────────────────────────────────────────────────────────────

use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

/// Pure core of `fs_create_docx`, testable without a Tauri context.
fn create_docx_sync(path: &std::path::Path, lines: &[String]) -> Result<u64, String> {
    let refs: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let bytes = build_docx(&refs)?;
    super::file::write_atomic(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Pure core of `fs_create_xlsx`, testable without a Tauri context.
fn create_xlsx_sync(path: &std::path::Path, rows: &[Vec<String>]) -> Result<u64, String> {
    let bytes = build_xlsx(rows)?;
    super::file::write_atomic(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Pure core of `fs_create_pptx`, testable without a Tauri context.
fn create_pptx_sync(path: &std::path::Path, slides: &[String]) -> Result<u64, String> {
    let refs: Vec<&str> = slides.iter().map(|s| s.as_str()).collect();
    let bytes = build_pptx(&refs)?;
    super::file::write_atomic(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Create a .docx from markdown-ish lines and write it to `path`.
/// Returns the byte count written.
#[tauri::command]
pub async fn fs_create_docx(
    path: String,
    lines: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        super::enforce_ai_workspace_authorization(&target, &source, &registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
        create_docx_sync(&target, &lines)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a .xlsx from a 2D array and write it to `path`.
#[tauri::command]
pub async fn fs_create_xlsx(
    path: String,
    rows: Vec<Vec<String>>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        super::enforce_ai_workspace_authorization(&target, &source, &registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
        create_xlsx_sync(&target, &rows)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a .pptx from slide strings and write it to `path`.
#[tauri::command]
pub async fn fs_create_pptx(
    path: String,
    slides: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        super::enforce_ai_workspace_authorization(&target, &source, &registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
        create_pptx_sync(&target, &slides)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a PDF file and return its page count. Size-capped so an adversarial
/// huge file can't be read fully into memory just to be rejected.
#[tauri::command]
pub async fn fs_pdf_page_count(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        super::policy::check_read_path_authorized(&target, &source, Some(&registry)).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
        let meta = std::fs::metadata(&target).map_err(|e| e.to_string())?;
        if meta.len() > MAX_PDF_BYTES as u64 {
            return Err(format!(
                "PDF exceeds {} MiB cap",
                MAX_PDF_BYTES / (1024 * 1024)
            ));
        }
        let bytes = std::fs::read(&target).map_err(|e| e.to_string())?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("not a PDF file".to_string());
        }
        pdf_page_count(&bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Size-bounded read of a single PDF, so an adversarial file can't be pulled
/// fully into memory just to be rejected by the parser.
fn read_pdf_bounded(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_PDF_BYTES as u64 {
        return Err(format!(
            "PDF exceeds {} MiB cap",
            MAX_PDF_BYTES / (1024 * 1024)
        ));
    }
    std::fs::read(path).map_err(|e| e.to_string())
}

/// Merge several PDFs into `output`, in the order listed. `files` may be
/// absolute or relative to the workspace root. Returns bytes written.
#[tauri::command]
pub async fn fs_pdf_merge(
    files: Vec<String>,
    output: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let registry = app.state::<WorkspaceRegistry>();
        let output_path = resolve_path(&output, &workspace);
        super::enforce_ai_workspace_authorization(&output_path, &source, &registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;

        let mut buffers: Vec<Vec<u8>> = Vec::with_capacity(files.len());
        for f in &files {
            let p = resolve_path(f, &workspace);
            super::policy::check_read_path_authorized(&p, &source, Some(&registry)).map_err(|e| {
                log::warn!("{e}");
                e
            })?;
            buffers.push(read_pdf_bounded(&p)?);
        }
        if buffers.is_empty() {
            return Err("pdf_merge: at least one input file is required".to_string());
        }
        let refs: Vec<&[u8]> = buffers.iter().map(|b| b.as_slice()).collect();
        let merged = merge_pdfs_bytes(&refs)?;
        super::file::write_atomic(&output_path, &merged).map_err(|e| e.to_string())?;
        Ok(merged.len() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Encrypt a PDF with AES-256. `output` may equal `input` (atomic replace).
/// Returns bytes written.
#[tauri::command]
pub async fn fs_pdf_encrypt(
    input: String,
    output: String,
    user_password: Option<String>,
    owner_password: Option<String>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let registry = app.state::<WorkspaceRegistry>();
        let input_path = resolve_path(&input, &workspace);
        let output_path = resolve_path(&output, &workspace);
        super::policy::check_read_path_authorized(&input_path, &source, Some(&registry)).map_err(
            |e| {
                log::warn!("{e}");
                e
            },
        )?;
        super::enforce_ai_workspace_authorization(&output_path, &source, &registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;

        let bytes = read_pdf_bounded(&input_path)?;
        let user = user_password.unwrap_or_default();
        let owner = owner_password.unwrap_or_else(|| user.clone());
        let encrypted = encrypt_pdf_bytes(&bytes, &user, &owner)?;
        super::file::write_atomic(&output_path, &encrypted).map_err(|e| e.to_string())?;
        Ok(encrypted.len() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pure core of `fs_create_pdf`, testable without a Tauri context.
fn create_pdf_sync(path: &std::path::Path, lines: &[String]) -> Result<u64, String> {
    let refs: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let bytes = build_pdf(&refs)?;
    super::file::write_atomic(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Create a text PDF from markdown-ish lines and write it to `path`.
#[tauri::command]
pub async fn fs_create_pdf(
    path: String,
    lines: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        super::enforce_ai_workspace_authorization(&target, &source, &registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
        create_pdf_sync(&target, &lines)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One in-place text replacement (find / replace pair).
type TextReplacement = Vec<String>;

/// Pure core of `fs_edit_docx` / `fs_edit_pptx`. Applies find/replace pairs in
/// place via `office_oxide::edit::EditableDocument` (untouched parts preserved
/// byte-for-byte). Returns the total number of replacements made.
fn edit_text_doc_sync(
    path: &std::path::Path,
    replacements: &[TextReplacement],
) -> Result<usize, String> {
    use office_oxide::edit::EditableDocument;
    let mut ed = EditableDocument::open(path).map_err(|e| format!("open failed: {e}"))?;
    let mut total = 0usize;
    for pair in replacements {
        if pair.len() != 2 {
            return Err("replacements must be [find, replace] pairs".to_string());
        }
        total += ed.replace_text(&pair[0], &pair[1]);
    }
    ed.save(path).map_err(|e| format!("save failed: {e}"))?;
    Ok(total)
}

/// A single cell edit for `fs_edit_xlsx`.
#[derive(serde::Deserialize)]
pub struct XlsxCellEdit {
    /// 0-based sheet index.
    pub sheet: usize,
    /// Cell reference, e.g. "A1".
    pub cell: String,
    /// "string" | "number" | "boolean" (defaults to "string").
    #[serde(default)]
    pub kind: String,
    pub value: String,
}

/// Pure core of `fs_edit_xlsx`. Sets the given cells in place via
/// `office_oxide::edit::EditableDocument`, preserving everything else.
/// Returns the number of cells set.
fn edit_xlsx_sync(path: &std::path::Path, cells: &[XlsxCellEdit]) -> Result<usize, String> {
    use office_oxide::edit::EditableDocument;
    use office_oxide::xlsx::edit::CellValue;
    let mut ed = EditableDocument::open(path).map_err(|e| format!("open failed: {e}"))?;
    for c in cells {
        let value = match c.kind.as_str() {
            "number" => c
                .value
                .trim()
                .parse::<f64>()
                .map(CellValue::Number)
                .map_err(|_| format!("invalid number for {}: {}", c.cell, c.value))?,
            "boolean" => match c.value.trim().to_ascii_lowercase().as_str() {
                "true" | "1" => CellValue::Boolean(true),
                "false" | "0" => CellValue::Boolean(false),
                _ => return Err(format!("invalid boolean for {}: {}", c.cell, c.value)),
            },
            _ => CellValue::String(c.value.clone()),
        };
        ed.set_cell(c.sheet, &c.cell, value)
            .map_err(|e| format!("set_cell {} failed: {e}", c.cell))?;
    }
    ed.save(path).map_err(|e| format!("save failed: {e}"))?;
    Ok(cells.len())
}

/// Gate for an in-place document edit: read auth (deny-list), write auth
/// (workspace), and a size cap so an oversized file can't be pulled fully into
/// memory by `EditableDocument::open`.
fn gate_edit_path(
    target: &std::path::Path,
    source: &Option<String>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let meta = std::fs::metadata(target).map_err(|e| e.to_string())?;
    if meta.len() > MAX_OFFICE_BYTES as u64 {
        return Err(format!(
            "document exceeds {} MiB cap",
            MAX_OFFICE_BYTES / (1024 * 1024)
        ));
    }
    super::policy::check_read_path_authorized(target, source, Some(registry)).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    super::enforce_ai_workspace_authorization(target, source, registry).map_err(|e| {
        log::warn!("{e}");
        e
    })?;
    Ok(())
}

/// Replace text in an existing DOCX in place. Returns the number of
/// replacements applied.
#[tauri::command]
pub async fn fs_edit_docx(
    path: String,
    replacements: Vec<TextReplacement>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        gate_edit_path(&target, &source, &registry)?;
        edit_text_doc_sync(&target, &replacements)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Replace text in an existing PPTX in place. Returns the number of
/// replacements applied.
#[tauri::command]
pub async fn fs_edit_pptx(
    path: String,
    replacements: Vec<TextReplacement>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        gate_edit_path(&target, &source, &registry)?;
        edit_text_doc_sync(&target, &replacements)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Set cells in an existing XLSX in place. Returns the number of cells set.
#[tauri::command]
pub async fn fs_edit_xlsx(
    path: String,
    cells: Vec<XlsxCellEdit>,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        let target = resolve_path(&path, &workspace);
        let registry = app.state::<WorkspaceRegistry>();
        gate_edit_path(&target, &source, &registry)?;
        edit_xlsx_sync(&target, &cells)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn build_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn sniff_pdf() {
        assert_eq!(sniff_doc_type(b"%PDF-1.7 ...", "x.pdf"), Some(DocType::Pdf));
    }

    #[test]
    fn sniff_pptx_by_extension() {
        let zip = build_zip(&[("[Content_Types].xml", "<Types/>")]);
        assert_eq!(sniff_doc_type(&zip, "deck.pptx"), Some(DocType::Pptx));
    }

    #[test]
    fn sniff_docx_by_extension() {
        let zip = build_zip(&[("[Content_Types].xml", "<Types/>")]);
        assert_eq!(sniff_doc_type(&zip, "doc.docx"), Some(DocType::Docx));
    }

    #[test]
    fn sniff_non_office_is_none() {
        assert_eq!(sniff_doc_type(b"hello world", "a.txt"), None);
        assert_eq!(sniff_doc_type(b"\x89PNG", "img.png"), None);
    }

    fn slide_xml(paragraphs: &[&str]) -> String {
        let body: String = paragraphs
            .iter()
            .map(|p| format!("<a:p><a:r><a:t>{p}</a:t></a:r></a:p>"))
            .collect();
        format!(
            r#"<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>{body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#
        )
    }

    #[test]
    fn pptx_extracts_slides_in_numeric_order_with_notes() {
        let s1 = slide_xml(&["Title", "Body"]);
        let s2 = slide_xml(&["Second"]);
        let s10 = slide_xml(&["Tenth"]);
        let notes2 = slide_xml(&["A note"]);
        let bytes = build_zip(&[
            ("[Content_Types].xml", "<Types/>"),
            ("ppt/slides/slide10.xml", &s10),
            ("ppt/slides/slide1.xml", &s1),
            ("ppt/slides/slide2.xml", &s2),
            ("ppt/notesSlides/notesSlide2.xml", &notes2),
        ]);
        let text = extract_pptx_text(&bytes).unwrap();
        assert!(text.contains("--- Slide 1 ---"));
        assert!(text.contains("--- Slide 2 ---"));
        assert!(text.contains("Speaker Notes:"));
        assert!(text.contains("A note"));
        assert!(text.contains("--- Slide 10 ---"));
        // Slide 2 before slide 10 (numeric, not lexical).
        assert!(text.find("Slide 2").unwrap() < text.find("Slide 10").unwrap());
    }

    #[test]
    fn pptx_split_runs_concatenate() {
        let slide =
            r#"<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Hel</a:t></a:r><a:r><a:t>lo</a:t></a:r></a:p></p:sld>"#;
        let bytes = build_zip(&[("ppt/slides/slide1.xml", slide)]);
        let text = extract_pptx_text(&bytes).unwrap();
        assert!(text.contains("Hello"));
    }

    #[test]
    fn pptx_not_a_zip_is_error() {
        assert!(extract_pptx_text(b"not a zip").is_none());
    }

    #[test]
    fn pptx_no_slides_is_empty() {
        let bytes = build_zip(&[("[Content_Types].xml", "<Types/>")]);
        let text = extract_pptx_text(&bytes).unwrap();
        assert!(text.contains("no slides"));
    }

    /// Dispatch-level end-to-end: generate .docx / .xlsx via the writers, then
    /// run the full sniff + extract path exactly as `fs_read_file` would. No
    /// machine-specific fixtures (replaces the C:/Users/Admin one).
    #[test]
    fn extract_document_dispatches_generated_files() {
        let xlsx = build_xlsx(&[
            vec!["Name".to_string(), "Age".to_string()],
            vec!["Alice".to_string(), "30".to_string()],
        ])
        .unwrap();
        let xt = match extract_document(&xlsx, "report.xlsx").unwrap() {
            ReadResult::Text { content, .. } => content,
            _ => panic!("xlsx should extract to Text"),
        };
        assert!(xt.contains("Alice"), "xlsx should contain Alice, got: {xt}");
        assert!(xt.contains("Sheet1"), "xlsx should have sheet name");

        let docx = build_docx(&["# Title", "Hello world", "Second line"]).unwrap();
        let dt = match extract_document(&docx, "note.docx").unwrap() {
            ReadResult::Text { content, .. } => content,
            _ => panic!("docx should extract to Text"),
        };
        assert!(
            dt.contains("Hello world"),
            "docx should contain text, got: {dt}"
        );
        assert!(dt.contains("Second line"));
    }

    #[test]
    fn build_xlsx_roundtrip() {
        let rows = vec![
            vec!["Name".to_string(), "Age".to_string()],
            vec!["Alice".to_string(), "30".to_string()],
        ];
        let bytes = build_xlsx(&rows).unwrap();
        // Sniff + extract back.
        assert_eq!(sniff_doc_type(&bytes, "t.xlsx"), Some(DocType::Xlsx));
        let text = extract_xlsx_text(&bytes).unwrap();
        assert!(text.contains("Alice"), "roundtrip should read Alice, got: {text}");
        assert!(text.contains("Name"));
    }

    #[test]
    fn build_docx_roundtrip() {
        let bytes = build_docx(&["# Title", "Hello paragraph", "- item", "| a | b |"]).unwrap();
        assert_eq!(sniff_doc_type(&bytes, "t.docx"), Some(DocType::Docx));
        let text = extract_docx_text(&bytes).unwrap();
        assert!(text.contains("Title"), "docx should contain heading, got: {text}");
        assert!(text.contains("Hello paragraph"));
        assert!(text.contains("item"));
    }

    #[test]
    fn build_pptx_roundtrip() {
        let bytes = build_pptx(&["Slide One\nLine two", "Slide Two"]).unwrap();
        assert_eq!(sniff_doc_type(&bytes, "t.pptx"), Some(DocType::Pptx));
        let text = extract_pptx_text(&bytes).unwrap();
        assert!(text.contains("Slide One"), "pptx should contain slide, got: {text}");
        assert!(text.contains("Slide Two"));
        // Numeric slide ordering
        assert!(text.find("Slide One").unwrap() < text.find("Slide Two").unwrap());
    }

    #[test]
    fn build_pptx_empty_is_error() {
        assert!(build_pptx(&[]).is_err());
    }

    #[test]
    fn pdf_page_count_rejects_non_pdf() {
        assert!(pdf_page_count(b"not a pdf").is_err());
    }

    #[test]
    fn create_docx_sync_writes_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("out.docx");
        let lines: Vec<String> = vec![
            "# Title".to_string(),
            "Paragraph".to_string(),
            "- item".to_string(),
            "| a | b |".to_string(),
            "| c | d |".to_string(),
        ];
        let written = create_docx_sync(&f, &lines).unwrap();
        assert!(written > 0);
        let bytes = std::fs::read(&f).unwrap();
        let text = extract_docx_text(&bytes).unwrap();
        assert!(text.contains("Title"));
        assert!(text.contains("Paragraph"));
        assert!(text.contains("item"));
        // Two table rows must land in ONE table (2 `<w:tr>`), not one per row.
        let xml = {
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
            read_zip_entry(&mut archive, "word/document.xml").unwrap()
        };
        assert_eq!(xml.matches("<w:tbl>").count(), 1, "got: {xml}");
        assert_eq!(xml.matches("<w:tr>").count(), 2, "got: {xml}");
        // The body must be well-formed XML (the old list-state code emitted
        // stray `</w:numPr></w:pPr>` closings with no matching open).
        let mut reader = quick_xml::Reader::from_str(&xml);
        let mut balance = 0i32;
        loop {
            match reader.read_event() {
                Ok(quick_xml::events::Event::Start(ref e))
                    if e.local_name().as_ref() == b"numPr" =>
                {
                    balance += 1;
                }
                Ok(quick_xml::events::Event::End(ref e))
                    if e.local_name().as_ref() == b"numPr" =>
                {
                    balance -= 1;
                }
                Ok(quick_xml::events::Event::Eof) => break,
                Ok(_) => {}
                Err(e) => panic!("malformed XML: {e}\n{xml}"),
            }
        }
        assert_eq!(balance, 0, "unbalanced <w:numPr> in {xml}");
    }

    #[test]
    fn create_xlsx_sync_writes_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("out.xlsx");
        let rows = vec![
            vec!["Name".to_string(), "Age".to_string()],
            vec!["Alice".to_string(), "30".to_string()],
        ];
        let written = create_xlsx_sync(&f, &rows).unwrap();
        assert!(written > 0);
        let text = extract_xlsx_text(&std::fs::read(&f).unwrap()).unwrap();
        assert!(text.contains("Alice"), "got: {text}");
    }

    #[test]
    fn create_pptx_sync_writes_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("out.pptx");
        let slides: Vec<String> = vec!["Slide One\nLine two".to_string(), "Slide Two".to_string()];
        let written = create_pptx_sync(&f, &slides).unwrap();
        assert!(written > 0);
        let text = extract_pptx_text(&std::fs::read(&f).unwrap()).unwrap();
        assert!(text.contains("Slide One"), "got: {text}");
        assert!(text.contains("Slide Two"), "got: {text}");
    }

    /// Build a valid one-page PDF via lopdf (Courier text page).
    fn test_pdf_bytes(label: &str) -> Vec<u8> {
        use lopdf::content::{Content, Operation};
        use lopdf::{Document, Object, ObjectId, Stream};
        let mut doc = Document::with_version("1.7");
        let pages_id: ObjectId = doc.new_object_id();

        let mut font = lopdf::Dictionary::new();
        font.set("Type", "Font");
        font.set("Subtype", "Type1");
        font.set("BaseFont", "Courier");
        let font_id = doc.add_object(Object::Dictionary(font));

        let mut resources = lopdf::Dictionary::new();
        let mut font_map = lopdf::Dictionary::new();
        font_map.set("F1", font_id);
        resources.set("Font", font_map);
        let resources_id = doc.add_object(Object::Dictionary(resources));

        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 24.into()]),
                Operation::new("Td", vec![50.into(), 700.into()]),
                Operation::new("Tj", vec![Object::string_literal(label)]),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id =
            doc.add_object(Stream::new(lopdf::Dictionary::new(), content.encode().unwrap()));

        let mut page = lopdf::Dictionary::new();
        page.set("Type", "Page");
        page.set("Parent", pages_id);
        page.set("Contents", content_id);
        page.set("Resources", resources_id);
        page.set("MediaBox", vec![0.into(), 0.into(), 595.into(), 842.into()]);
        let page_id = doc.add_object(Object::Dictionary(page));

        let mut pages = lopdf::Dictionary::new();
        pages.set("Type", "Pages");
        pages.set("Kids", vec![Object::Reference(page_id)]);
        pages.set("Count", 1);
        doc.objects.insert(pages_id, Object::Dictionary(pages));

        let mut catalog = lopdf::Dictionary::new();
        catalog.set("Type", "Catalog");
        catalog.set("Pages", pages_id);
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", catalog_id);

        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    fn page_count_of(bytes: &[u8]) -> usize {
        use lopdf::Document;
        Document::load_mem(bytes).unwrap().get_pages().len()
    }

    #[test]
    fn merge_pdfs_concatenates_pages_in_order() {
        let a = test_pdf_bytes("first");
        let b = test_pdf_bytes("second");
        let c = test_pdf_bytes("third");
        assert_eq!(page_count_of(&a), 1);
        assert_eq!(page_count_of(&b), 1);

        let merged = merge_pdfs_bytes(&[&a, &b, &c]).unwrap();
        assert!(merged.starts_with(b"%PDF-"));
        assert_eq!(page_count_of(&merged), 3, "merged page count");
    }

    #[test]
    fn merge_pdfs_single_input_is_a_copy() {
        let a = test_pdf_bytes("solo");
        let merged = merge_pdfs_bytes(&[&a]).unwrap();
        assert_eq!(page_count_of(&merged), 1);
    }

    #[test]
    fn merge_pdfs_empty_input_errors() {
        assert!(merge_pdfs_bytes(&[]).is_err());
    }

    #[test]
    fn merge_pdfs_rejects_garbage_input() {
        let a = test_pdf_bytes("ok");
        assert!(merge_pdfs_bytes(&[&a, b"not a pdf"]).is_err());
    }

    #[test]
    fn encrypt_pdfs_roundtrips_with_aes256() {
        let pdf = test_pdf_bytes("secret");
        let encrypted = encrypt_pdf_bytes(&pdf, "user-pass", "owner-pass").unwrap();
        assert!(encrypted.starts_with(b"%PDF-"));
        let doc = lopdf::Document::load_mem(&encrypted).unwrap();
        assert!(doc.is_encrypted(), "output must be encrypted");
        // The same bytes without a password must not load as plaintext.
        assert!(doc.authenticate_password("user-pass").is_ok());
        assert!(doc.authenticate_password("wrong").is_err());
    }

    #[test]
    fn encrypt_pdfs_rejects_already_encrypted_input() {
        let pdf = test_pdf_bytes("x");
        let encrypted = encrypt_pdf_bytes(&pdf, "u", "o").unwrap();
        assert!(encrypt_pdf_bytes(&encrypted, "u2", "o2").is_err());
    }

    #[test]
    fn encrypt_pdfs_requires_a_password() {
        let pdf = test_pdf_bytes("x");
        assert!(encrypt_pdf_bytes(&pdf, "", "").is_err());
    }

    /// Build a minimal valid PDF by hand (exact xref offsets) to probe
    /// pdf_oxide's extraction requirements independently of `build_pdf`.
    fn hand_minimal_pdf() -> Vec<u8> {
        let content = b"BT\n/F1 24 Tf\n100 700 Td\n(Hello World) Tj\nET\n";
        let objs: Vec<String> = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
            ),
            format!(
                "<< /Length {} >>\nstream\n{}endstream",
                content.len(),
                String::from_utf8_lossy(content)
            ),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .to_string(),
        ];
        let mut out = Vec::new();
        out.extend_from_slice(b"%PDF-1.4\n");
        let mut offsets = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{}\n{} 0 obj\n{}\nendobj\n", i + 1, i + 1, o).as_bytes());
        }
        let xref_pos = out.len();
        out.extend_from_slice(b"xref\n");
        out.extend_from_slice(format!("0 {}\n", objs.len() + 1).as_bytes());
        out.extend_from_slice(b"0000000000 65535 f \n");
        for off in &offsets {
            out.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
        }
        out.extend_from_slice(b"trailer\n");
        out.extend_from_slice(
            format!(
                "<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
                objs.len() + 1,
                xref_pos
            )
            .as_bytes(),
        );
        out
    }

    #[test]
    fn pdf_oxide_extracts_hand_built_minimal_pdf() {
        let pdf = hand_minimal_pdf();
        let doc = pdf_oxide::PdfDocument::from_bytes(pdf).unwrap();
        let text = doc.extract_text(0).unwrap_or_else(|e| format!("ERR {e}"));
        assert!(text.contains("Hello World"), "got: {text:?}");
    }

    #[test]
    fn pdf_oxide_extracts_lopdf_built_pdf() {
        // The read path must work on lopdf-serialized PDFs (xref stream writer).
        let pdf = test_pdf_bytes("Lopdf Hello");
        let doc = pdf_oxide::PdfDocument::from_bytes(pdf).unwrap();
        let text = doc.extract_text(0).unwrap_or_else(|e| format!("ERR {e}"));
        assert!(text.contains("Lopdf"), "got: {text:?}");
    }

    #[test]
    fn build_pdf_creates_valid_multiline_document() {
        let pdf = build_pdf(&[
            "# Title",
            "Body paragraph one.",
            "- bullet one",
            "- bullet two",
            "## Section",
            "Wrapped text with some longer words to exercise wrapping.",
        ])
        .unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf_page_count(&pdf).unwrap() >= 1, "must be a valid PDF");
        let text = extract_pdf_text(&pdf).unwrap();
        assert!(text.contains("Title"), "heading missing: {text}");
        assert!(text.contains("bullet one"), "bullet missing: {text}");
        assert!(text.contains("Section"), "section missing: {text}");
    }

    #[test]
    fn build_pdf_empty_input_still_produces_one_page() {
        let pdf = build_pdf(&[]).unwrap();
        assert_eq!(pdf_page_count(&pdf).unwrap(), 1);
    }

    #[test]
    fn wrap_text_lines_never_exceeds_max_width() {
        let wrapped = wrap_text_lines(
            "aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa aaaaaaaaaa",
            11.0,
            120.0,
        );
        for line in &wrapped {
            assert!(
                (line.chars().count() as f64) * 11.0 * 0.5 <= 120.0,
                "line too wide: {line:?}"
            );
        }
        assert!(wrapped.len() > 1, "should wrap into multiple lines");
    }

    #[test]
    fn sniff_legacy_formats() {
        // CFB magic wins for legacy binaries regardless of (or matching) ext.
        assert_eq!(
            sniff_doc_type(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest", "old.doc"),
            Some(DocType::Doc)
        );
        assert_eq!(
            sniff_doc_type(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest", "book.xls"),
            Some(DocType::Xls)
        );
        assert_eq!(
            sniff_doc_type(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest", "deck.ppt"),
            Some(DocType::Ppt)
        );
        // Extension-only legacy sniff (content not a CFB).
        assert_eq!(
            sniff_doc_type(b"hello", "notes.doc"),
            Some(DocType::Doc)
        );
        assert_eq!(
            sniff_doc_type(b"hello", "table.xls"),
            Some(DocType::Xls)
        );
        assert_eq!(
            sniff_doc_type(b"hello", "slides.ppt"),
            Some(DocType::Ppt)
        );
    }

    #[test]
    fn legacy_extraction_degrades_gracefully_on_garbage() {
        // Not a real CFB file: office_oxide parse fails, so we fall through to
        // the normal text/binary classification instead of panicking.
        let bytes = b"D0CF11E0A1B11AE1 not a real compound file";
        assert!(extract_document(bytes, "notes.doc").is_none());
    }

    #[test]
    fn edit_docx_replaces_placeholder_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("t.docx");
        let lines: Vec<String> = vec!["# Greeting".to_string(), "Hello {{NAME}}".to_string()];
        create_docx_sync(&f, &lines).unwrap();

        let replacements: Vec<Vec<String>> = vec![
            vec!["{{NAME}}".to_string(), "World".to_string()],
            vec!["Hello".to_string(), "Hi".to_string()],
        ];
        let n = edit_text_doc_sync(&f, &replacements).unwrap();
        assert_eq!(n, 2);

        let bytes = std::fs::read(&f).unwrap();
        let text = extract_docx_text(&bytes).unwrap();
        assert!(text.contains("Hi World"), "got: {text}");
        assert!(!text.contains("{{NAME}}"), "placeholder remained");
    }

    #[test]
    fn edit_pptx_replaces_text_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("t.pptx");
        let slides: Vec<String> = vec!["Deck {{N}}".to_string(), "Slide two".to_string()];
        create_pptx_sync(&f, &slides).unwrap();

        let replacements: Vec<Vec<String>> =
            vec![vec!["{{N}}".to_string(), "42".to_string()]];
        let n = edit_text_doc_sync(&f, &replacements).unwrap();
        assert!(n >= 1);

        let bytes = std::fs::read(&f).unwrap();
        let text = extract_pptx_text(&bytes).unwrap();
        assert!(text.contains("Deck 42"), "got: {text}");
    }

    #[test]
    fn edit_xlsx_sets_cells_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("t.xlsx");
        let rows = vec![
            vec!["Name".to_string(), "Age".to_string()],
            vec!["Alice".to_string(), "30".to_string()],
        ];
        create_xlsx_sync(&f, &rows).unwrap();

        let cells = vec![
            XlsxCellEdit {
                sheet: 0,
                cell: "B2".to_string(),
                kind: "number".to_string(),
                value: "31".to_string(),
            },
            XlsxCellEdit {
                sheet: 0,
                cell: "C2".to_string(),
                kind: "string".to_string(),
                value: "new".to_string(),
            },
        ];
        let n = edit_xlsx_sync(&f, &cells).unwrap();
        assert_eq!(n, 2);

        let bytes = std::fs::read(&f).unwrap();
        let text = extract_xlsx_text(&bytes).unwrap();
        assert!(text.contains("31"), "got: {text}");
        assert!(text.contains("new"), "got: {text}");
    }

    #[test]
    fn create_pdf_sync_writes_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("out.pdf");
        let lines: Vec<String> = vec!["# Report".to_string(), "Line".to_string()];
        let written = create_pdf_sync(&f, &lines).unwrap();
        assert!(written > 0);
        let bytes = std::fs::read(&f).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(pdf_page_count(&bytes).unwrap() >= 1);
    }
}
