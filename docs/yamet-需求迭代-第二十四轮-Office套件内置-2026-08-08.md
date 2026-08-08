# 第二十四轮迭代需求：Office 套件全部内置功能

> 目标版本 **0.1.25**（功能性构建）。
> 用户命题：「office套件全部内置功能」+「E:\Agent，有没有哪个项目已实现，深度调研」。
> 含义：让 yamet 的 AI agent 原生支持 Word/Excel/PowerPoint/PDF 文档的**读取、创建、编辑**，像 Grok 内置 PDF/PPTX 读取那样成为内置能力，而非依赖外部工具。
> 范围：**概念模型 + E:\Agent 参考盘点 + 需求规划 + 实施方案**。

---

## 调研更新（2026-08-08 深度调研后）

> **状态总览**：本轮已交付**全功能**。读取（六格式：DOCX/XLSX/PPTX + 旧二进制 DOC/XLS/PPT）、创建（四格式：DOCX/XLSX/PPTX/PDF，富格式）、编辑（DOCX/XLSX/PPTX 就地保真写回）全部落地并接线。核心引擎 **office_oxide**（纯 Rust，本就在 yamet 依赖树中，零新增编译成本）+ pdf_oxide + lopdf。`cargo check`/`cargo clippy -D warnings`/`cargo test` 全绿。

### 已交付清单

1. **读取（AI 工具路径，六格式）**：`fs_read_file` 在 `source=="ai"` 时按 magic/扩展名解析。OOXML + 旧二进制（DOC/XLS/PPT，OLE2/CFB 魔数 `D0 CF 11 E0` 嗅探 + 扩展名）由 office_oxide `Document::plain_text()`；PDF 由 pdf_oxide。编辑器/资源管理器路径保持 binary（PDF iframe 预览不回归、保存不会用文本覆盖二进制）。
2. **创建（富格式，四格式）**：
   - `create_docx`：markdown 风格行 → office_oxide markdown 引擎 → 正确 styles.xml/numbering.xml 的 Word（标题/粗斜体/项目符号/管道表格）
   - `create_xlsx`：二维数组，单元格自动识别数字/公式（`=` 前缀）→ 数值单元格 + 公式 + 粗体表头
   - `create_pptx`：每字符串一页，首行作标题、`- ` 作项目符号、其余作正文 → PptxWriter 富文本
   - `create_pdf`：lopdf 文本渲染（A4、`# ` 标题字号阶梯、自动换行/分页、Helvetica 基础字体、每行独立 `BT…ET` 绝对 `Td`；资源经 `/Font` 包装使提取器可读）
3. **编辑（就地保真写回）**：`edit_docx`/`edit_pptx`（`EditableDocument::replace_text`，未改动 part 逐字节保留）、`edit_xlsx`（`set_cell`，保留原单元格样式），均返回替换/设置次数。
4. **PDF 处理**：`merge_pdf`（按序合并）、`encrypt_pdf`（AES-256 V5）、`fs_pdf_page_count`。
5. **安全/稳健**：所有写命令经 `checkWritableCanonical` 拒绝名单 + Rust `enforce_ai_workspace_authorization` 双门禁 + 原子写；编辑命令额外读门禁 + ≤50MB 上限；读取 zip-bomb/输出上限（单条目 ≤64MB、总输出 ≤8MB）。
6. **修复**：`build_docx` 合法 XML + 连续表格行合并；PDF 创建踩坑修复（资源需 `/Font` 包装；`Td` 是相对移动需每行 `BT…ET` 绝对定位）；删除死文件 `modules/framing.rs` 与未使用依赖 `docx-rs`；前端 biome lint 0 警告。
7. **参考项目**：E:\Agent 下载 `office_oxide-main`、`betteroffice-main`、`ppt-rs-main`、`markdown2pdf-main`、`opendocswork-mcp-main`、`openxml-office-release` 供后续参考（betteroffice 的 xlsx-ops/docx-edit 在 xlsx 深层编辑上更强，但 yrs CRDT + 185 包较重、PPTX 保存未投影编辑，故本轮选用 office_oxide）。
8. **范围外保留**：内置 Office 编辑器 UI；外部 soffice/pandoc；公式计算引擎（betteroffice xlsx-calc，可后续按需接入）。

### 调研结论（E:\Agent 五项目 + 参考库）

| 项目 | Office 能力 | 可移植性 | 结论 |
|---|---|---|---|
| **grok-build** | `read_file/pdf.rs`（pdf_oxide 文本提取+渲染，50MB/60s/10页阈值/150DPI/JPEG85）+ `read_file/pptx.rs`（zip+quick_xml 流式 DrawingML，slide 数值排序、notes 匹配、64MB zip-bomb 防护，5 测试） | **纯 Rust，完整测试** | ✅ 已移植（document.rs 即其产物） |
| **hermes-agent** | `skills/productivity/` 全套：xlsx（openpyxl+soffice）、docx/pdf/powerpoint（python-pptx + XSD + soffice）、nano-pdf | **Python + soffice + 外部库**，非 Rust | ❌ 不可移植（违反「原生优先」），仅功能参考 |
| **oh-my-pi** | `packages/coding-agent/src/markit/converters/`：docx.ts（mammoth）、pptx.ts（fast-xml-parser 手写接口树，10KB）、xlsx.ts（5KB）——markitdown 移植 | **TS + Bun + mammoth**，全量 XML 解析偏重 | ⚠️ 仅 pptx 纯逻辑参考（Grok 流式方案更轻，已采用） |
| **opencode-dev** | `bedrock-media.ts` 仅 MIME 路由（docx/pdf 转 Bedrock document block），**不本地解析** | — | ❌ 无内置能力 |
| **claude-code-haha** | 零 Office（grep 无 openpyxl/docx/pdf 库命中） | — | ❌ 无内置能力 |

### 需求修订

1. **读取（原 P0）→ 已实现**：PDF/PPTX/DOCX/XLSX 文本提取已在 `document.rs` 落地，`fs_read_file` 自动分发（magic + 扩展名）。剩余动作：提交入库 + 修 2 个 `unused_mut` 警告 + 前端 read_file 确认（tools/fs.ts 无需改，走 Rust 后端）。
2. **创建/编辑（原 P2）→ 本轮实施主体**：`create_docx`（docx-rs Document builder）、`create_xlsx`（rust_xlsxwriter Workbook）、`create_pptx`（quick_xml 写文本幻灯片）、`pdf_merge`/`pdf_encrypt`（lopdf）。依赖已全部就绪。
3. **参考取舍**：Grok 流式 quick_xml 方案胜出（轻量、纯 Rust、已移植）；hermes/oh-my-pi 的脚本方案不采纳；opencode-dev/claude-code-haha 无参考价值。

### 参考库 API 调研（ref-* 四库，2026-08-08）

> 四库源码均在 E:\Agent 且与 yamet Cargo.toml 版本一致（docx-rs 0.4.22 / calamine 0.36.1 / lopdf 0.44.0 / rust_xlsxwriter 0.97.1）。全部纯 Rust、跨平台、edition 2021/2024、与 yamet（tokio/tauri2/serde）兼容。

| 库 | 版本 | 关键 API（yamet 集成点） | 依赖注意 |
|---|---|---|---|
| **docx-rs** | 0.4.22（crates.io，非 ref-docx 的 0.1.11） | 写：`Docx::new()` → `docx.document = Document::new()`（children: `Paragraph::new().add_run(Run::new().add_text(t))` / `Table::new()`+`add_row`）→ `docx.pack(Write+Seek)`（zip 归档，无 write_file）。读：`Docx::from_reader`+`parse`（document.rs 已用） | 写 API 与 0.1.11 的 `write_file` 不同，以 0.4.22 的 `pack` 为准；读 API 两版一致 |
| **calamine** | 0.36.1 | 读：`open_workbook_from_rs` → `Reader::sheet_names/worksheet_range`（document.rs 已用）。**只读库**，写用 xlsxwriter | zip 8.6 + quick-xml 0.41 与 yamet 版本一致；纯 Rust |
| **lopdf** | 0.44.0 | `Document::load(path)` + `doc.merge(&mut other)`（xref 级）→ `doc.save/save_to`；加密：`doc.encrypt(&EncryptionState{ version: EncryptionVersion::V1/V2/AES-128/256, owner_password, user_password, permissions })` | 依赖 `rand`（yamet 已有 0.8）；default features 含 chrono-clock+rayon（直接可用）；edition 2024 需 rustc ≥1.88（yamet 1.97 ✅） |
| **rust_xlsxwriter** | 0.97.1 | 写：`Workbook::new()` → `add_worksheet()` → `worksheet.write(row, col, value)`（支持 str/num/date）→ `workbook.save(path)` / `save_to_buffer()` / `save_to_writer()` | 纯 Rust（zip 8.3），无 C 绑定；可选 feature（chrono/polars）不启用 |

**集成建议**：
1. `create_docx` → docx-rs 0.4.22：构造 `Document` children（段落/标题/表格）→ `Docx::new().document(doc).pack(&mut Cursor)` → 写盘。标题用 `Paragraph::new()` + run 的 `run_property(style)` 或段落 style；列表可用 `numbering`。
2. `create_xlsx` → rust_xlsxwriter：`Workbook::new` → `add_worksheet` → 逐行 `write` → `save_to_buffer` 拿 `Vec<u8>` 写盘（工具层不落临时文件）。
3. `pdf_merge` → lopdf：`Document::load` 各文件 → 依次 `merge` → `save_to`；`pdf_encrypt` → `load` + `encrypt` + `save`。
4. `create_pptx` → 无现成写库，用 quick_xml 手写文本幻灯片 OOXML（参考 oh-my-pi pptx.ts 结构，反向生成）。

---

## §0 概念模型（先把现状和可移植参考搞清楚）

### 0.1 一句话总纲

Office 套件 = 四类文档：**Word(.docx)、Excel(.xlsx)、PowerPoint(.pptx)、PDF**。yamet 当前**零 Office 能力**（无依赖、无工具）。E:\Agent 里 **grok-build 已用 Rust 原生实现了 PDF/PPTX 读取**（`read_file` 工具内置解析），hermes-agent 以 skills+脚本形式提供 Excel 编写。移植 = **把 Grok 的文档解析搬进 yamet 的 read_file 工具 + 补 docx/xlsx 读取 + 补创建/编辑能力**。

```
┌────────────────────────── Office 套件内置 ──────────────────────────┐
│                                                                      │
│  读取（把文档变成文本/结构喂给 LLM）        创建/编辑（生成文档）      │
│  ├─ PDF    (pdf_oxide) ── Grok 已实现 ✅   ├─ docx  创建/编辑         │
│  ├─ PPTX   (zip+quick_xml) ── Grok ✅     ├─ xlsx  创建/编辑         │
│  ├─ DOCX   (openxml) ── 需补               ├─ pptx  创建/编辑         │
│  ├─ XLSX   (openxml) ── 需补               └─ PDF   合并/加密          │
│  └─ 文本/CSV/ipynb ── Grok 部分 ✅                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 0.2 深度调研：E:\Agent 已实现的 Office 能力（代码级）

#### 0.2.1 grok-build（Rust，最可移植）— `read_file` 工具内置文档解析

**`crates/codegen/xai-grok-tools/src/implementations/read_file/`：**

| 文件 | 能力 | 实现 | 规模 |
|---|---|---|---|
| `pdf.rs` | **PDF 文本提取 + 分页渲染** | `pdf_oxide::PdfDocument::from_bytes`，50MB 上限、`PDF_AUTO_READ_THRESHOLD=10` 页自动读、`PDF_RENDER_DPI=150` 渲染 JPEG(85)、`PDF_MAX_PAGES_PER_READ=20`、60s 超时、`run_document_extraction` 通用 async 包装（大小预检+超时+格式标签） | 18KB |
| `pptx.rs` | **PPTX 文本提取** | `zip` + `quick_xml` 解析 DrawingML `<a:t>` runs；slide **数值排序**（slide2<slide10）、notes 按 slide 号匹配、`MAX_XML_ENTRY_BYTES=64MB` zip-bomb 防护、`&amp;` 实体解析、空 `<a:t/>` 不误启 in-run 标志；5 个完整测试 | 9.5KB |
| `image.rs` | 图片读取/压缩 | 20KB |
| `metadata.rs` | magic bytes 识别（`is_pdf_magic` 等） | 2.4KB |
| `mod.rs`(grok_build) | 主 read_file 分发 | 按扩展名/mime 选解析器：**PDF/.pptx/.ipynb/图片**；101KB |

**支持格式**：PDF、PPTX、Jupyter .ipynb、图片。**无 docx/xlsx**。
**依赖**：`pdf_oxide`、`zip`(deflate-flate2)、`quick-xml`、`base64`。

**结论**：Grok 的 PDF/PPTX 解析是**纯 Rust、可移植、带完整测试**的现成实现，是 yamet 移植的第一优先级。

#### 0.2.2 hermes-agent（Python）— skills + 脚本形式

- `optional-skills/finance/excel-author/scripts/recalc.py`：Excel 重算脚本
- Office 能力以 **skills + 外部库**（docx-js/xlsx/pandoc/soffice）形式提供，非内置工具

#### 0.2.3 其余项目

- claude-code-haha / opencode-dev / oh-my-pi：**无内置 Office**（仅图标/UI 层识别扩展名）

### 0.3 深度调研：yamet 现状（已核实代码）

| 项 | 现状 |
|---|---|
| Office 依赖 | **无**（package.json/Cargo.toml 零 docx/xlsx/pptx/pdf 库） |
| 文档工具 | **无**（tools/ 无 doc/office/pdf/sheet 工具） |
| read_file 工具 | `tools/fs.ts` 的 read_file 仅读 **UTF-8 文本**（拒绝 binary/oversized），无 PDF/PPTX/docx/xlsx 解析 |
| fileIcons | 已识别 ms-word/docx、ms-excel/xlsx、pptx、pdf 图标（UI 层） |
| 系统 soffice/pandoc | **无**（渲染验证不可用，需纯 Rust 解析） |
| 定位 | ROADMAP「不是浏览器」「文档宿主而非终端」在范围外 — 但**文档读取/生成作为 agent 工具**是 AI 原生能力，不违背终端定位 |

### 0.4 关键辨析

1. **读取 vs 创建/编辑**：读取是"把文档变文本喂 LLM"（LLM 不可读二进制，必须解析）；创建/编辑是"LLM 生成文档"。Grok 只做了读取（PDF/PPTX）。yamet "全部内置"需**读取 + 创建 + 编辑**四类全覆盖。
2. **纯 Rust vs 外部库**：yamet 无 soffice/pandoc（Windows 环境难装），且架构铁律"原生优先"。所以文档解析必须**纯 Rust crate**（pdf_oxide/quick-xml/zip），不依赖外部二进制。
3. **前端渲染 vs 工具能力**：Office 套件内置 = **AI 工具能力**（read/write office 文档），不是"内置 Word/Excel 编辑器 UI"。工具让 LLM 能读能写文档，用户在文件管理器/终端即可用。

### 参考库 API 调研（ref-* 四库，2026-08-08）

> 四库源码均在 E:\Agent 且与 yamet Cargo.toml 版本一致（docx-rs 0.4.22 / calamine 0.36.1 / lopdf 0.44.0 / rust_xlsxwriter 0.97.1）。全部纯 Rust、跨平台、edition 2021/2024、与 yamet（tokio/tauri2/serde）兼容。

| 库 | 版本 | 关键 API（yamet 集成点） | 依赖注意 |
|---|---|---|---|
| **docx-rs** | 0.4.22（crates.io，非 ref-docx 的 0.1.11） | 写：`Docx::new()` → `docx.document = Document::new()`（children: `Paragraph::new().add_run(Run::new().add_text(t))` / `Table::new()`+`add_row`）→ `docx.pack(Write+Seek)`（zip 归档，无 write_file）。读：`Docx::from_reader`+`parse`（document.rs 已用） | 写 API 与 0.1.11 的 `write_file` 不同，以 0.4.22 的 `pack` 为准；读 API 两版一致 |
| **calamine** | 0.36.1 | 读：`open_workbook_from_rs` → `Reader::sheet_names/worksheet_range`（document.rs 已用）。**只读库**，写用 xlsxwriter | zip 8.6 + quick-xml 0.41 与 yamet 版本一致；纯 Rust |
| **lopdf** | 0.44.0 | `Document::load(path)` + `doc.merge(&mut other)`（xref 级）→ `doc.save/save_to`；加密：`doc.encrypt(&EncryptionState{ version: EncryptionVersion::V1/V2/AES-128/256, owner_password, user_password, permissions })` | 依赖 `rand`（yamet 已有 0.8）；default features 含 chrono-clock+rayon（直接可用）；edition 2024 需 rustc ≥1.88（yamet 1.97 ✅） |
| **rust_xlsxwriter** | 0.97.1 | 写：`Workbook::new()` → `add_worksheet()` → `worksheet.write(row, col, value)`（支持 str/num/date）→ `workbook.save(path)` / `save_to_buffer()` / `save_to_writer()` | 纯 Rust（zip 8.3），无 C 绑定；可选 feature（chrono/polars）不启用 |

**集成建议**：
1. `create_docx` → docx-rs 0.4.22：构造 `Document` children（段落/标题/表格）→ `Docx::new().document(doc).pack(&mut Cursor)` → 写盘。标题用 `Paragraph::new()` + run 的 `run_property(style)` 或段落 style；列表可用 `numbering`。
2. `create_xlsx` → rust_xlsxwriter：`Workbook::new` → `add_worksheet` → 逐行 `write` → `save_to_buffer` 拿 `Vec<u8>` 写盘（工具层不落临时文件）。
3. `pdf_merge` → lopdf：`Document::load` 各文件 → 依次 `merge` → `save_to`；`pdf_encrypt` → `load` + `encrypt` + `save`。
4. `create_pptx` → 无现成写库，用 quick_xml 手写文本幻灯片 OOXML（参考 oh-my-pi pptx.ts 结构，反向生成）。

---

## 需求规划（Office 套件内置四件套）

### 融合矩阵

| 能力 | Grok 参考 | yamet 动作 | 依赖（E:\Agent\ref-* 已下载） | 优先级 |
|---|---|---|---|---|
| PDF 读取 | `pdf.rs`（pdf_oxide） | 移植到 `read_file` | `pdf_oxide` | **P0** |
| PPTX 读取 | `pptx.rs`（zip+quick_xml） | 移植到 `read_file` | `zip`+`quick-xml` | **P0** |
| DOCX 读取 | 无（Grok 未实现） | **集成 `docx-rs`**（`from_file`+`parse`） | `ref-docx` | **P1** |
| XLSX 读取 | 无 | **集成 `calamine`**（`open_workbook`+`Reader`） | `ref-calamine` | **P1** |
| DOCX 创建/编辑 | 无 | **集成 `docx-rs`**（`write_file`）→ `create_docx` | `ref-docx` | **P2** |
| XLSX 创建/编辑 | hermes skill | **集成 `xlsxwriter`**（`Workbook`+`Worksheet::write`）→ `create_xlsx` | `ref-xlsxwriter` | **P2** |
| PPTX 创建 | 无 | 新增 `create_pptx`（quick_xml 写文本幻灯片） | — | **P2** |
| PDF 创建/合并 | hermes pdf skill | **集成 `lopdf`**（`pdf_merge`/`pdf_encrypt`） | `ref-lopdf` | **P2** |

### P0-1【Rust】移植 Grok read_file 的 PDF/PPTX 解析

- **目标**：`read_file` 工具（前端 tools/fs.ts 调 Rust `fs_read_file`）支持 PDF/PPTX 文本提取。
- **Rust**：`src-tauri/src/modules/fs/` 新增 `document.rs`，移植 Grok `pdf.rs`（pdf_oxide 文本提取，50MB 上限、10 页阈值、超时）+ `pptx.rs`（zip+quick_xml 文本提取、slide 排序、notes、zip-bomb 防护、测试）。
- **识别**：`metadata.rs` magic bytes（`%PDF-`、PPTX 的 `PK\x03\x04` + `[Content_Types]`）+ 扩展名。
- **Cargo 依赖**：`pdf_oxide`、`zip`(deflate)、`quick-xml`。
- **接线**：`fs_read_file` 读文件字节 → 按 magic/扩展名分发 → 文本返回；binary/非 Office 走原拒绝。
- **验证**：cargo test（移植 Grok 的 pptx 测试 + pdf 测试）+ 真实读取一个 PPTX/PDF 回显。

### P0-2【Rust】read_file 支持 DOCX/XLSX 读取

- **目标**：补 docx/xlsx 文本提取（Grok 未实现，需新增）。
- **DOCX**：集成 `docx-rs`（`Docx::from_reader`/`from_file` + `parse` 提取段落/表格文本）。参考 `ref-docx`。
- **XLSX**：集成 `calamine`（`open_workbook_from_rs`/`Reader` 遍历 sheet 单元格，处理 sharedStrings/公式/类型）。参考 `ref-calamine`。
- **验证**：cargo test + 真实读取回显。

### P1-0【前端】read_file 工具支持 Office 格式

- `tools/fs.ts` read_file：不再拒绝这些 Office 扩展名；Rust 侧解析后返回文本（走文本分支）。
- **验证**：vitest（mock Rust 返回）+ 端到端读取。

### P1-1【文档】Office 文档处理 skill/脚本

- 系统无 soffice/pandoc，**不引入外部二进制**。解析全走纯 Rust。
- 文档（YAMET.md）注明支持格式与大小上限。

### P2-0【Rust】DOCX 创建/编辑工具

- **目标**：`create_docx` 工具——LLM 生成 .docx（段落/标题/表格/列表）。
- **Rust**：集成 `docx-rs`（`Document` builder + `write_file`，段落/Heading/Table/List）。参考 `ref-docx` examples。
- **工具**：`create_docx`（markdown 结构 → docx）→ 写盘。
- **验证**：真实生成 + 回读验证。

### P2-1【Rust】XLSX 创建工具

- `create_xlsx`：集成 `xlsxwriter`（`Workbook::new` + `add_worksheet` + `write`/`write_row`）。参考 `ref-xlsxwriter` examples。
- **验证**：生成 + 回读。

### P2-2【Rust】PPTX/PDF 创建

- `create_pptx`（文本型幻灯片，quick_xml 写 OOXML）。
- `pdf_merge`/`pdf_encrypt`：集成 `lopdf`（`Document::load_mut` + merge/encrypt）。参考 `ref-lopdf` examples。
- **验证**：生成 + 回读。

### 范围外

- 内置 Office 编辑器 UI（Word/Excel/PPT 可视化编辑——超出 ADE 定位，工具级读写即可）
- 外部二进制（soffice/pandoc——Windows 难装，且违反原生优先）
- 复杂样式/宏/公式（读取聚焦文本/结构；创建聚焦常用格式）

### 参考库 API 调研（ref-* 四库，2026-08-08）

> 四库源码均在 E:\Agent 且与 yamet Cargo.toml 版本一致（docx-rs 0.4.22 / calamine 0.36.1 / lopdf 0.44.0 / rust_xlsxwriter 0.97.1）。全部纯 Rust、跨平台、edition 2021/2024、与 yamet（tokio/tauri2/serde）兼容。

| 库 | 版本 | 关键 API（yamet 集成点） | 依赖注意 |
|---|---|---|---|
| **docx-rs** | 0.4.22（crates.io，非 ref-docx 的 0.1.11） | 写：`Docx::new()` → `docx.document = Document::new()`（children: `Paragraph::new().add_run(Run::new().add_text(t))` / `Table::new()`+`add_row`）→ `docx.pack(Write+Seek)`（zip 归档，无 write_file）。读：`Docx::from_reader`+`parse`（document.rs 已用） | 写 API 与 0.1.11 的 `write_file` 不同，以 0.4.22 的 `pack` 为准；读 API 两版一致 |
| **calamine** | 0.36.1 | 读：`open_workbook_from_rs` → `Reader::sheet_names/worksheet_range`（document.rs 已用）。**只读库**，写用 xlsxwriter | zip 8.6 + quick-xml 0.41 与 yamet 版本一致；纯 Rust |
| **lopdf** | 0.44.0 | `Document::load(path)` + `doc.merge(&mut other)`（xref 级）→ `doc.save/save_to`；加密：`doc.encrypt(&EncryptionState{ version: EncryptionVersion::V1/V2/AES-128/256, owner_password, user_password, permissions })` | 依赖 `rand`（yamet 已有 0.8）；default features 含 chrono-clock+rayon（直接可用）；edition 2024 需 rustc ≥1.88（yamet 1.97 ✅） |
| **rust_xlsxwriter** | 0.97.1 | 写：`Workbook::new()` → `add_worksheet()` → `worksheet.write(row, col, value)`（支持 str/num/date）→ `workbook.save(path)` / `save_to_buffer()` / `save_to_writer()` | 纯 Rust（zip 8.3），无 C 绑定；可选 feature（chrono/polars）不启用 |

**集成建议**：
1. `create_docx` → docx-rs 0.4.22：构造 `Document` children（段落/标题/表格）→ `Docx::new().document(doc).pack(&mut Cursor)` → 写盘。标题用 `Paragraph::new()` + run 的 `run_property(style)` 或段落 style；列表可用 `numbering`。
2. `create_xlsx` → rust_xlsxwriter：`Workbook::new` → `add_worksheet` → 逐行 `write` → `save_to_buffer` 拿 `Vec<u8>` 写盘（工具层不落临时文件）。
3. `pdf_merge` → lopdf：`Document::load` 各文件 → 依次 `merge` → `save_to`；`pdf_encrypt` → `load` + `encrypt` + `save`。
4. `create_pptx` → 无现成写库，用 quick_xml 手写文本幻灯片 OOXML（参考 oh-my-pi pptx.ts 结构，反向生成）。

---

## 实施方案

### 依赖序

```
P0-1 移植 PDF/PPTX 读取 → P0-2 补 DOCX/XLSX 读取
→ P1-0 前端 read_file 接线 → P1-1 文档
→ P2-0 create_docx → P2-1 create_xlsx → P2-2 create_pptx/pdf_merge
→ 构建
```

### P0-1 移植 PDF/PPTX 读取（中任务 → 2 批）

**批次 A（PDF）**
1. `fs/document.rs` 移植 Grok `pdf.rs`（pdf_oxide 文本提取 + 大小/页数上限 + 超时 + `run_document_extraction` 包装）。
2. Cargo 加 `pdf_oxide`。
3. 门禁：cargo test（pdf 提取测试）。

**批次 B（PPTX）**
4. 移植 Grok `pptx.rs`（zip+quick_xml `<a:t>` 提取、slide 排序、notes、zip-bomb 防护、测试）。
5. `metadata.rs` magic 识别 + `fs_read_file` 分发。
6. 门禁：cargo test + 真实读取回显。

### P0-2 补 DOCX/XLSX 读取（中任务 → 2 批）

**批次 A（DOCX）**
1. 集成 `docx-rs`（`Docx::from_reader` + `parse` 提取段落/表格文本）。Cargo 加 `docx-rs`。
2. 测试：构造 docx → 提取文本。
3. 门禁：cargo test。

**批次 B（XLSX）**
4. 集成 `calamine`（`open_workbook_from_rs` 遍历 sheet 单元格）。Cargo 加 `calamine`。
5. 测试 + 真实读取。
6. 门禁：cargo test + 回显。

### P1-0 前端 read_file 接线（小任务）

1. `tools/fs.ts`：Office 扩展名不再拒 binary，走解析文本分支。
2. vitest + 端到端。
3. 门禁：tsc + vitest。

### P1-1 文档

1. YAMET.md 注明 Office 支持格式/上限/纯 Rust。

### P2-0 create_docx（中任务 → 2 批）

**批次 A（docx-rs 生成）**
1. Rust `fs/document.rs` 加 `build_docx(markdown_structure)` → 用 `docx-rs` 的 `Document` builder + `write_file`。
2. Cargo 加 `docx-rs`（写特性）。

**批次 B（工具）**
3. `tools/fs.ts` 加 `create_docx` 工具（段落/标题/表格/列表 schema）。
4. 门禁：cargo test + vitest + 真实生成回读。

### P2-1 create_xlsx（小任务）

1. `build_xlsx(rows)` → `xlsxwriter`（`Workbook::new` + `add_worksheet` + `write_row`）。
2. `create_xlsx` 工具 + 测试。
3. 门禁：cargo test + vitest。

### P2-2 create_pptx / pdf_merge（小任务）

1. `build_pptx(slides)` 文本型幻灯片；`pdf_merge(files)` 用 `lopdf` 合并。
2. 工具 + 测试。
3. 门禁：cargo test + vitest。

### 构建

- 版本 0.1.24 → 0.1.25，四文件同步。
- CHANGELOG / ROADMAP / YAMET 三文档同步。
- 验证：tsc 0、vitest 全绿、cargo test（含移植的 pptx/pdf 测试）、clippy -D warnings、pnpm build、size budget。
