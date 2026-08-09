use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use serde::Serialize;
use tauri::{Emitter, Manager};
use tempfile::NamedTempFile;

use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
/// Ceiling for explicit "open anyway"; mirrored as FORCE_READ_LIMIT in useDocument.ts.
const FORCE_MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
/// Ceiling for a single write. The editor writes whole files, and the AI
/// tool layer writes source/text, so 64 MiB is generous while still
/// bounding an abnormal caller from writing multi-GB garbage to disk.
const MAX_WRITE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
        mtime: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

fn mtime_millis(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Optimistic concurrency check (edit-tool CAS): when `expected` is provided
/// (>0) and the on-disk mtime differs, refuse the write so a concurrent edit
/// to the same file isn't silently clobbered (last-writer-wins data loss).
pub fn check_mtime_cas(target: &std::path::Path, expected: Option<u64>) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if expected == 0 {
        return Ok(());
    }
    let current = fs::metadata(target)
        .ok()
        .map(|m| mtime_millis(&m))
        .unwrap_or(0);
    if current != expected {
        return Err(format!(
            "fs_write_file: concurrent modification detected (mtime changed {expected} -> {current}); re-read the file and retry"
        ));
    }
    Ok(())
}

/// Defense-in-depth for the AI write path: the frontend `security.ts` denylist
/// is the first gate; this is the second, authoritative one. AI-sourced writes
/// (`source == "ai"`) must resolve to a path under an authorized workspace
/// root. The user's own editor/explorer writes pass `source == "editor"`/null
/// and are not gated here (they carry their own trust), so this must not break
/// normal editing.
#[tauri::command]
pub async fn fs_read_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    force: Option<bool>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<ReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        fs_read_file_impl(path, workspace, force, source, Some(&registry))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pure core of `fs_read_file`, testable without a Tauri app context. The
/// registry is optional: AI reads get the denylist + workspace authorization;
/// editor/explorer reads (no `source`) pass through. Unit/integration tests
/// pass `None` for the registry and rely on the denylist alone.
pub fn fs_read_file_impl(
    path: String,
    workspace: Option<WorkspaceEnv>,
    force: Option<bool>,
    source: Option<String>,
    registry: Option<&WorkspaceRegistry>,
) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    // Defense-in-depth for AI reads: the frontend `security.ts` denylist is the
    // first gate; this authoritative backend gate applies the same policy plus
    // workspace authorization. Editor/explorer reads (no `source`) are trusted
    // user actions and pass through, matching the write-path contract.
    if source.as_deref() == Some("ai") {
        super::policy::check_read_path_authorized(&target, &source, registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
    }
    read_file_sync(&target, force.unwrap_or(false), source.as_deref() == Some("ai"))
}

fn read_file_sync(p: &Path, force: bool, extract_docs: bool) -> Result<ReadResult, String> {
    let meta = std::fs::metadata(p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    let limit = if force {
        FORCE_MAX_READ_BYTES
    } else {
        MAX_READ_BYTES
    };
    if size > limit {
        return Ok(ReadResult::TooLarge { size, limit });
    }

    let bytes = std::fs::read(p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Office documents (PDF / PPTX / DOCX / XLSX): sniff magic + extension and
    // extract text so the AI tool can read them like a text file. Scoped to the
    // AI read path: the editor/explorer must keep seeing these as binary so the
    // PDF iframe preview keeps working and a save can never clobber the binary
    // document with extracted text.
    if extract_docs {
        let path_str = p.to_string_lossy().into_owned();
        if let Some(result) = super::document::extract_document(&bytes, &path_str) {
            let mtime = mtime_millis(&meta);
            return Ok(match result {
                ReadResult::Text { content, .. } => ReadResult::Text {
                    content,
                    size,
                    mtime,
                },
                other => other,
            });
        }
    }

    // UTF-16 (LE/BE) BOM takes priority over the null-byte sniff: Windows
    // tools routinely write UTF-16 text files, which the NUL sniff would
    // misclassify as binary. Decode lossy so the editor shows the text.
    if let Some(content) = decode_utf16(&bytes) {
        return Ok(ReadResult::Text {
            content,
            size,
            mtime: mtime_millis(&meta),
        });
    }

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text {
            content,
            size,
            mtime: mtime_millis(&meta),
        }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

/// Decode a UTF-16 file when it carries a BOM (`FF FE` LE / `FE FF` BE).
/// Returns `None` for anything else so the normal UTF-8 / binary path runs.
fn decode_utf16(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return Some(String::from_utf16_lossy(&units));
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return Some(String::from_utf16_lossy(&units));
    }
    None
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
pub(super) fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

/// Returns the new mtime so the editor can track disk state for conflict
/// detection without a follow-up stat.
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    expected_mtime: Option<u64>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = WorkspaceEnv::from_option(workspace);
        if content.len() > MAX_WRITE_BYTES {
            return Err(format!(
                "fs_write_file: content is {} bytes, exceeds {} MiB cap",
                content.len(),
                MAX_WRITE_BYTES / (1024 * 1024)
            ));
        }
        let target = resolve_path(&path, &workspace);
        // Defense-in-depth: AI writes must land inside an authorized workspace root.
        if source.as_deref() == Some("ai") {
            let registry = app.state::<WorkspaceRegistry>();
            super::enforce_ai_workspace_authorization(&target, &source, &registry).map_err(|e| {
                log::warn!("{e}");
                e
            })?;
        }
        // Optimistic concurrency (edit-tool CAS): if the caller read the file
        // earlier and passes that mtime, refuse to overwrite when the disk has
        // since changed. This prevents "same file concurrently edited → the
        // later write silently clobbers the earlier one" (last-writer-wins
        // data loss). A mismatch is returned as a conflict, not an overwrite.
        if let Err(e) = check_mtime_cas(&target, expected_mtime) {
            log::warn!("fs_write_file({}) CAS failed: {e}", target.display());
            return Err(e);
        }
        let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
        write_atomic(&target, content.as_bytes()).map_err(|e| {
            log::warn!("fs_write_file({}) failed: {e}", target.display());
            e.to_string()
        })?;

        if let Some(perms) = original_permissions {
            let _ = fs::set_permissions(&target, perms);
        }
        let mtime = fs::metadata(&target)
            .map(|m| mtime_millis(&m))
            .unwrap_or(0);
        let _ = app.emit(
            "fs:file-written",
            FileWrittenEvent {
                path: path.clone(),
                source,
            },
        );
        Ok(mtime)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_canonicalize(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        fs_canonicalize_impl(path, workspace, source, Some(&registry))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn fs_canonicalize_impl(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    registry: Option<&WorkspaceRegistry>,
) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if source.as_deref() == Some("ai") {
        super::policy::check_read_path_authorized(&p, &source, registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
    }
    let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    Ok(super::to_canon(&canon))
}

#[tauri::command]
pub async fn fs_stat(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<FileStat, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        fs_stat_impl(path, workspace, source, Some(&registry))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn fs_stat_impl(
    path: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    registry: Option<&WorkspaceRegistry>,
) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if source.as_deref() == Some("ai") {
        super::policy::check_read_path_authorized(&p, &source, registry).map_err(|e| {
            log::warn!("{e}");
            e
        })?;
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    // fs::metadata follows symlinks, so the link check needs symlink_metadata.
    let kind = if std::fs::symlink_metadata(&p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        StatKind::Symlink
    } else if meta.is_dir() {
        StatKind::Dir
    } else {
        StatKind::File
    };
    Ok(FileStat {
        size: meta.len(),
        mtime: mtime_millis(&meta),
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cas_allows_when_mtime_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"v1").unwrap();
        let mtime = fs::metadata(&f).map(|m| mtime_millis(&m)).unwrap();
        assert!(check_mtime_cas(&f, Some(mtime)).is_ok());
        // None / 0 expected = no check.
        assert!(check_mtime_cas(&f, None).is_ok());
        assert!(check_mtime_cas(&f, Some(0)).is_ok());
    }

    #[test]
    fn cas_rejects_when_mtime_changed() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"v1").unwrap();
        let mtime = fs::metadata(&f).map(|m| mtime_millis(&m)).unwrap();
        // Simulate a concurrent writer touching the file (mtime changes).
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(&f, b"v2").unwrap();
        // A stale expected mtime (the value read before the concurrent write)
        // must be rejected.
        let err = check_mtime_cas(&f, Some(mtime)).unwrap_err();
        assert!(err.contains("concurrent modification"));
    }

    #[test]
    fn cas_rejects_when_file_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"v1").unwrap();
        let mtime = fs::metadata(&f).map(|m| mtime_millis(&m)).unwrap();
        std::fs::remove_file(&f).unwrap();
        assert!(check_mtime_cas(&f, Some(mtime)).is_err());
    }

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
            match read_file_sync(&f, false, false).unwrap() {
                 ReadResult::Text {
                content,
                size,
                mtime,
            } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
                assert!(mtime > 0);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            read_file_sync(&f, false, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 (overlong/truncated sequence) with no null byte and no
        // UTF-16 BOM prefix: must still classify as binary.
        std::fs::write(&f, [0xc3, 0x28, 0xf0, 0x28]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_decodes_utf16le_bom_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("utf16le.txt");
        let mut bytes = vec![0xff, 0xfe]; // UTF-16 LE BOM
        for unit in "你好，世界".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        std::fs::write(&f, &bytes).unwrap();
        match read_file_sync(&f, false, false).unwrap() {
            ReadResult::Text {
                content,
                size,
                mtime,
            } => {
                assert_eq!(content, "你好，世界");
                assert_eq!(size as usize, bytes.len());
                assert!(mtime > 0);
            }
            _ => panic!("expected utf-16le text"),
        }
    }

    #[test]
    fn read_file_decodes_utf16be_bom_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("utf16be.txt");
        let mut bytes = vec![0xfe, 0xff]; // UTF-16 BE BOM
        for unit in "Hello, 世界".encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        std::fs::write(&f, &bytes).unwrap();
        match read_file_sync(&f, false, false).unwrap() {
            ReadResult::Text {
                content,
                size,
                mtime,
            } => {
                assert_eq!(content, "Hello, 世界");
                assert_eq!(size as usize, bytes.len());
                assert!(mtime > 0);
            }
            _ => panic!("expected utf-16be text"),
        }
    }

    #[test]
    fn decode_utf16_rejects_non_bom_bytes() {
        assert_eq!(decode_utf16(b"plain utf-8"), None);
        assert_eq!(decode_utf16(b"\xff\xfe"), Some(String::new()));
        assert_eq!(decode_utf16(&[0xfe, 0xff, 0x00, 0x41]), Some("A".into()));
    }

    #[test]
    fn office_document_extraction_is_ai_path_only() {
        // Build a real docx (zip with text content). On the editor path the
        // null-byte sniff classifies it as binary (so the PDF/office preview
        // path in the UI still works and a save can't clobber the binary); on
        // the AI path it is parsed to text.
        let bytes = super::super::document::build_docx(&["# Title", "Hello body"]).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("doc.docx");
        std::fs::write(&f, &bytes).unwrap();

        assert!(
            matches!(
                read_file_sync(&f, false, false).unwrap(),
                ReadResult::Binary { .. }
            ),
            "editor-path read of an office doc must stay binary"
        );

        match read_file_sync(&f, false, true).unwrap() {
            ReadResult::Text { content, .. } => {
                assert!(content.contains("Title"), "got: {content}");
                assert!(content.contains("Hello body"), "got: {content}");
            }
            other => panic!("expected extracted text, got {other:?}"),
        }
    }

    #[test]
    fn force_lifts_the_default_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("big.txt");
        std::fs::write(&f, vec![b'a'; (MAX_READ_BYTES + 1) as usize]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false, false).unwrap(),
            ReadResult::TooLarge { .. }
        ));
        assert!(matches!(
            read_file_sync(&f, true, false).unwrap(),
            ReadResult::Text { .. }
        ));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.yamet.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }

    #[test]
    fn ai_write_authorization_allows_inside_workspace_and_blocks_outside() {
        use crate::modules::workspace::WorkspaceRegistry;
        let registry = WorkspaceRegistry::default();
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        registry.authorize(ws.path()).unwrap();

        // A write inside the authorized workspace root passes.
        let inside = ws.path().join("sub/new.txt");
        std::fs::create_dir(ws.path().join("sub")).unwrap();
        assert!(
            super::super::enforce_ai_workspace_authorization(
                &inside,
                &Some("ai".into()),
                &registry,
            )
            .is_ok(),
            "write inside workspace must be allowed"
        );

        // A write outside the workspace root is refused.
        let out = outside.path().join("pwn.txt");
        let err =
            super::super::enforce_ai_workspace_authorization(&out, &Some("ai".into()), &registry)
                .unwrap_err();
        assert!(err.contains("outside the authorized workspace"), "got: {err}");
    }

    #[test]
    fn non_ai_writes_are_not_gated() {
        use crate::modules::workspace::WorkspaceRegistry;
        let registry = WorkspaceRegistry::default();
        let dir = tempfile::tempdir().unwrap();
        // editor/explorer writes (non-"ai" source) pass without a registry root.
        let target = dir.path().join("x.txt");
        assert!(
            super::super::enforce_ai_workspace_authorization(&target, &None, &registry).is_ok(),
            "non-AI writes must not be gated"
        );
        assert!(
            super::super::enforce_ai_workspace_authorization(
                &target,
                &Some("editor".into()),
                &registry,
            )
            .is_ok(),
            "editor writes must not be gated"
        );
    }
}
