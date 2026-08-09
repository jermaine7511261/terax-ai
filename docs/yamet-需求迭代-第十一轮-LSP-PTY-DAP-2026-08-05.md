# 第十一轮迭代需求：LSP / PTY / DAP —— 参考 E:\Agent 所有项目最优方案对比

> 目标版本 **0.1.12**（功能性构建，四文件同步：`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）。
> 本文是**只读调研 + 需求定稿（含规划方案）**（未改任何源码）。参考项目全部位于 `E:\Agent`，逐一源码级调研其 LSP/PTY/DAP 实现。
> 铁律：本文每个「差距」必须引用 YaMet 与参考项目双方的源码位置作证据；每个需求必须含**规划方案（§3 架构/数据结构/命令签名/状态机/接缝/测试）** 与 **实施计划（§4 改动文件→步骤→验证）**。

---

## 0. 调研方法

对 `E:\Agent` 下所有相关项目做了源码级（非文档级）调研，子代理逐个读源码、逐文件 grep 复核：

| 参考项目 | 性质 | 本次调研产出 |
|---|---|---|
| `oh-my-pi-main` | Rust+TS 终端 agent | **PTY 与 DAP 的最优范本**（`oh-my-pi-pty-lsp-dap-report.md`）|
| `hermes-agent-main` | Python agent 框架 | **LSP 诊断 freshness 的最优范本**（`hermes-lsp-pty-edit-research.md`）|
| `grok-build-main` | Rust | **PTY 跨重启长驻 server + pty-harness 测试矩阵**（`grok_pty_lsp_dap_report.md`）|
| `xora-code-main` | Theia 桌面 IDE | **DAP 架构参照**（`@theia/debug` 的会话/配置/断点模型）（`xora-dap-lsp-report.md`）|
| `terax-ai-main` | Tauri 终端（YaMet 早期形态）| 差异复核（`LSP_PTY_DAP_调研.md`）|

**YaMet 现状（源码为权威，round-10 未提交代码已含部分能力）：**
- PTY：`src-tauri/src/modules/pty/`，portable-pty 会话 + reader/flusher/waiter 三线程、ConPTY 生命周期锁、Job 对象树杀、4MiB backpressure、agent-detect、da_filter、SSH、WSL；**round-10 未提交已含 `pty_helper`（跨重启常驻 helper，`--pty-helper` 模式 + `pty_helper_open/attach/write/resize/close/list` 命令）**。
- LSP：`src-tauri/src/modules/lsp/` + `src/modules/lsp/`，会话/崩溃守卫/跨文件 edits/WSL；round-10 未提交已含 `diagnose.ts` AI 工具诊断桥（`newDiagnosticsAfterWrite`/`captureBaseline`/`withLspDiagnostics`）。
- DAP：**完全没有**（全仓 grep `dap|debug_adapter|breakpoint|DebugSession` 零命中，唯一 `adapter.rs` 是网关适配器，与调试无关）。

---

## 1. 差距矩阵（证据引用的对比结论）

### 1.1 DAP：YaMet 缺失，参考项目有成熟范本 —— 本轮最大工程

| 能力 | YaMet | oh-my-pi | xora(@theia/debug) | 结论 |
|---|---|---|---|---|
| DAP 客户端 | ❌ 无 | ✅ `dap/client.ts`(1043行,`DapClient` JSON-RPC stdio/tcp + MessageFramer) | ✅ 由 `@theia/debug` 提供 | **YaMet 从零建** |
| 会话管理 | ❌ | ✅ `dap/session.ts`(1841行,`DapSessionManager`: launch/attach/断点/线程/栈帧/变量/作用域/反汇编/内存/reverse requests) | ✅ `DebugSessionManager` | **YaMet 从零建** |
| 适配器注册表 | ❌ | ✅ `dap/defaults.json` ~14 适配器(gdb/lldb-dap/codelldb/debugpy/dlv/js-debug/netcoredbg/kotlin/rdbg/php/bash-debug/flutter) + `config.ts` 自动选择 | ✅ `DebugAdapterContribution` 注册点 | **YaMet 从零建** |
| launch.json 配置 | ❌ | ✅ `dap/config.ts` launch/attachDefaults merge | ✅ `DebugConfigurationManager` + schema | **YaMet 从零建** |
| 传输/分帧 | 已有 LSP `framing.rs`(Content-Length)可复用 | `MessageFramer`(与 LSP 同构) | `DebugAdapterSession` stdio | **复用 `lsp/framing.rs`** |

**关键结论**：DAP 与 LSP 同构（JSON-RPC + Content-Length 分帧 + 子进程宿主 + 会话管理）。YaMet 的 `lsp/framing.rs`（`FrameDecoder`/`encode_frame`）和 `lsp/session.rs`（子进程 stdin/stdout/stderr + 内存看门狗 + 崩溃 tail）可 90% 复用。oh-my-pi 的 `dap/` 是直接范本，`@theia/debug` 是架构参照（会话/配置/断点模型分离）。

### 1.2 PTY：YaMet 已成熟，但 Windows ConPTY 健壮性差 oh-my-pi

| 能力 | YaMet | oh-my-pi | 结论 |
|---|---|---|---|
| ConPTY 生命周期锁 | ✅ `pty/session.rs:113` `CONPTY_LIFECYCLE_LOCK` | ✅ | 对齐 |
| ESC[6n 光标查询应答 | ✅ `pty/da_filter.rs` 拦截回答 | ✅ `pty.rs:366-373` 写 `\x1b[1;1R` | 对齐 |
| **openpty 超时兜底** | ❌ `session.rs:183` 同步 `openpty()` 无超时 | ✅ `pty.rs:280-313` 独立线程 + `recv_timeout(5s)`，超时 reject「ConPTY may be unavailable」 | **YaMet 缺口**：ConPTY openpty 可能无限挂起 |
| **child.wait() 挂死兜底** | ❌ `session.rs:339` 阻塞 `child.wait()` | ✅ `pty.rs:538-560` Windows 5s 轮询 `try_wait()` | **YaMet 缺口**：ConPTY wait 可无限挂 |
| **teardown 顺序 + 超时 drain** | ⚠️ 有 drop 顺序(注释)但无显式分阶段超时 | ✅ `pty.rs:563-625` drop(writer)→drain reader(超时)→drop(master)后台线程+2s 超时→reader_done 才 join | **YaMet 缺口**：ClosePseudoConsole 死锁无 2s 后台线程兜底 |
| 跨重启重连 | ✅ round-10 未提交 `pty_helper`(常驻 helper) | ✅ `launch/broker.ts` per-project 守护 + `meta.json` 原子持久化 + pid 重连 | 方向一致 |

**关键结论**：YaMet 的 round-10 `pty_helper` 已解决「跨重启进程级重连」这个最大工程（与 grok `ptyctl`、oh-my-pi `broker` 同构：长驻 server 进程持有 PTY + 命名注册表 + 客户端重连）。**剩余缺口集中在 Windows ConPTY 的 3 个健壮性点**：openpty 超时、wait 挂死兜底、teardown 分阶段超时。参考 grok `ptyctl` 的命名会话注册表「非 PID 判活（端口+响应体形状校验）」和事件驱动 wait（`watch` generation，绝不轮询）可进一步强化 helper。

### 1.3 LSP：YaMet 已成熟，诊断 freshness 缺 line-shift

| 能力 | YaMet | hermes | 结论 |
|---|---|---|---|
| 写后诊断反馈 | ✅ `diagnose.ts` `newDiagnosticsAfterWrite` | ✅ `_maybe_lsp_diagnostics` | 对齐 |
| freshness 只报新错 | ✅ `captureBaseline` + `sameDiagnostic`(行/列/消息/source 五元组 diff) | ✅ `client.py` 版本号模型 + `manager.py` delta baseline(`_diag_key` 五元组) | 对齐 |
| **行偏移映射(line-shift)** | ❌ `diagnose.ts:159` 直接 `baselineByPath.get` 比较，**无行偏移** | ✅ `range_shift.py` difflib `SequenceMatcher` `build_line_shift`，把基线诊断映射到编辑后坐标 | **YaMet 缺口**：中间插行会让编辑点下方所有基线诊断错位 → 误报"本次编辑引入的新错误" |
| git 仓库门控 | ⚠️ 靠 `lsp_resolve_root` marker(含 .git)隐含门控 | ✅ `workspace.py` 显式 `find_git_worktree`，非 git 不触发 | 对齐（YaMet 用 sessionsForPath 的 root 前缀覆盖当 gate）|
| broken-set 崩溃 | ✅ crashTimes/crashedOut/退避 | ✅ `manager.py _broken` | 对齐 |

**关键结论**：hermes 的 `range_shift.py` 是 YaMet 唯一明确的 LSP 缺口——编辑在文件中段增删行后，`diagnose.ts` 拿编辑前的基线（旧行号）与编辑后的诊断（新行号）直接比行号，会把基线里「位于编辑点下方、但行号已偏移」的诊断误判成新增。移植 hermes 的行偏移映射即可消除假新错。

### 1.4 参考项目共性可借鉴项

| 借鉴点 | 来源 | 应用到 YaMet |
|---|---|---|
| `@theia/debug` 断点/线程/栈帧/变量**模型分离** | xora | DAP UI 层用可观察模型对象映射 DAP 状态 |
| `DebugAdapterContribution` 适配器**贡献点注入** | xora | DAP 适配器按需注册，非硬编码 |
| `dap/client.ts` **reverse requests**(runInTerminal/startDebugging) | oh-my-pi | DAP client 需独立 handler |
| `ptyctl` **事件驱动 wait**(watch generation,绝不轮询) | grok | 若 helper 加 wait/expect 原语 |
| `broker.ts` **meta.json 原子持久化 + 非 PID 判活** | oh-my-pi/grok | 增强 helper 会话注册表 |
| `dap/session.ts` **断点变更串行队列 + 输出环形缓冲(128KB) + 空闲超时(10min)** | oh-my-pi | DAP session 生命周期 |

---

## 2. 需求定稿

### P1 · DAP 调试器（最大工程，参考 oh-my-pi `dap/` + `@theia/debug`）

**背景**：YaMet 是完整 ADE（AI 原生终端 + 编辑器 + 文件浏览 + 源码管理），但**无任何调试能力**。参考项目证明：DAP 与既有 LSP 基础设施同构，可复用 `lsp/framing.rs` 与 `lsp/session.rs` 的子进程宿主，工程量可控。

**需求**：

1. **DAP Rust 后端**：新建 `src-tauri/src/modules/dap/`，复用 `lsp/framing.rs`（Content-Length 分帧）做 DAP 传输。`DapSession` 起调试适配器子进程（stdio），管理 launch/attach、请求/响应 id 配对、reverse requests 分发、超时（请求 30s / 写 30s）、崩溃 tail。命令面：`dap_launch` / `dap_attach` / `dap_send` / `dap_kill` / `dap_list`。
2. **适配器注册表**：参考 oh-my-pi `dap/defaults.json` + `config.ts` 自动选择（按扩展名 + rootMarkers 祖先匹配），内置常见运行时：**debugpy(Python)、node/ts(js-debug-adapter 或 node-inspect)、lldb-dap/gdb(原生)、dlv(Go)**。非硬编码，贡献点式按需注入（对齐 xora `DebugAdapterContribution`）。
3. **配置解析**：`.yamet/launch.json`（或设置页）读取 launch/attach 配置，变量替换，校验。
4. **DAP 前端**：编辑器左槽/侧栏调试面板 —— 断点管理（行内点断点 + 面板列表）、启动/停止/重启、单步（继续/暂停/步过/步入/步出）、线程/调用栈/变量/作用域树、输出/Debug Console。模型层分离（`DebugSessionModel`/`DebugThreadModel`/`DebugStackFrameModel`/`DebugVariableModel`），映射 DAP 状态到可观察 UI。
5. **断点同步**：断点变更串行队列（对齐 `dap/session.ts:80`），编辑器断点 ↔ DAP `setBreakpoints` 双向同步。

**验收**：
- 对 Python(`debugpy`)与 Node/TS(`node --inspect`)各起一个调试会话：断点命中、单步、查看变量、调用栈正确。
- 断点在编辑器点选即设置，删除即取消，与 DAP 会话同步。
- 请求超时/适配器崩溃不冻结主线程，有错误提示与 stderr tail。
- 三平台（macOS/Linux/Windows）至少一个运行时可跑通。
- `dap_send` 的请求-响应 id 配对正确；reverse request（`runInTerminal`）有处理。

### P1 · PTY Windows ConPTY 健壮性（参考 oh-my-pi `pty.rs`）

**背景**：YaMet 的 PTY 已成熟（round-10 已含跨重启 helper），但 Windows ConPTY 有三个参考项目已解决的挂死风险：openpty 无限挂、wait 无限挂、ClosePseudoConsole 死锁。

**需求**：

1. **openpty 超时兜底**：`pty/session.rs` 把 `openpty` 移到独立线程 + 5s 超时（对齐 `pty.rs:280-313`），超时返回错误「ConPTY unavailable」而非挂死。
2. **child.wait() 挂死兜底**：Windows 下用 5s 轮询 `try_wait()`（对齐 `pty.rs:538-560`），Unix 保持阻塞 `wait()`。
3. **teardown 分阶段超时**：close 时按 `drop(writer) → drain reader(带超时) → drop(master)后台线程+2s 超时 → reader_done 才 join` 顺序（对齐 `pty.rs:563-625` + microsoft/terminal#1810），主线程永不阻塞。

**验收**：
- 上述三处均有单元测试覆盖（Unix 可跑；Windows 用 `#[cfg(windows)]` 注释测试或依赖现有 CI）。
- ConPTY 环境（若 CI 有 Windows）openpty/wait 不再挂死；无 ConPTY 时超时优雅报错。

### P1 · LSP 诊断 freshness 行偏移（参考 hermes `range_shift.py`）

**背景**：`diagnose.ts` 基线 diff 无行偏移，编辑在文件中段增删行会误报假新错误。

**需求**：

1. 移植 hermes `range_shift.py` 逻辑到前端 `diagnose.ts`：编辑前用 difflib `SequenceMatcher`（或对齐的轻量 diff）`build_line_shift` 生成旧行号→新行号映射。
2. `newDiagnosticsAfterWrite` 比较时，先把基线诊断的行号按映射平移，再与写后诊断做五元组 diff —— 只有真正新增的错误上报，编辑点下方的基线错误不再误判为新增。
3. 保持 silent-degrade：无 LSP/无基线/超时 → 空串，绝不阻塞写。

**验收**：
- 单测：构造「在中部插入 N 行」的编辑，编辑点下方原有的一个 error 不应出现在 `newDiagnosticsAfterWrite` 结果里；真正新增的 error 应出现。
- 既有 `diagnose` 相关测试全绿。

### P2 · PTY helper 强化（参考 grok `ptyctl` 命名注册表 + 事件驱动 wait）

**背景**：round-10 `pty_helper` 已解决跨重启重连；grok `ptyctl` 的命名会话注册表（非 PID 判活）与事件驱动 wait（绝不轮询）可进一步强化其可靠性。

**需求**：

1. **非 PID 判活**：helper 会话注册表判活不靠 PID，用端口/socket 探测 + 响应体形状校验（对齐 `registry.rs:71-96`），避免端口复用误判。
2. **事件驱动 wait/expect 原语**（可选，若有需要）：helper 内用 `watch` generation + `select!` 而非轮询（对齐 `wait.rs`），超时自动携带 screen/raw_tail/modes 诊断。

**验收**：
- helper 会话注册表对「进程已退出但端口仍占用」不误判为存活。
- （若做 wait）wait 不轮询，resize 也 bump generation。

### P0 · 根目录三文档同步（CHANGELOG / ROADMAP / YaMet，每轮必做）

**背景**：根目录 `CHANGELOG.md`、`ROADMAP.md`、`YaMet.md` 三个文件是迭代交付的一部分，**每轮必须随功能同步**，否则出现「功能已实现但文档停滞」的 doc debt（跨轮遗留审计反复踩的坑）。三者职责不同：
- **CHANGELOG.md**：每轮交付逐条记录，顶部 `[未发布]` 段按「第十N轮（0.1.x）」标注；`release.mjs` 发布时把 `[未发布]` 固化并做非空门禁，`verify.ps1` 也校验 `[未发布]` 段非空。
- **ROADMAP.md**：战略方向 + 已交付/规划中/范围外勾选。轮次交付把对应 `[ ]` 勾为 `[x]`；若把原「范围外」项纳入（如第十轮 DAP），须像 ROADMAP.md:148 那样在「范围外」末尾加一句「…经维护者决定纳入第十一轮，见 docs/…」。
- **YaMet.md**：活架构文档（agent 记忆），改动前先读。新 Rust 命令面、新前端模块、新架构不变量必须补进对应段落（`## 架构` 的 `lsp::*` 那段、`src/modules/` 布局、`## 已知坑`）。

**本轮（第十一轮）三文件具体同步内容**：

1. **CHANGELOG.md**：在 `[未发布]` 段新增「第十一轮（0.1.12）」条目：
   - DAP 调试器（debugpy/node-inspect/lldb-dap/gdb/dlv 适配器、断点/单步/变量/调用栈、`.yamet/launch.json`）
   - PTY Windows ConPTY 健壮性（openpty 5s 超时 / child.wait 兜底 / teardown 分阶段超时）
   - LSP 诊断行偏移（编辑中部插行不再误报假新错误）
   - PTY helper 强化（非 PID 判活）
2. **ROADMAP.md**：
   - 若本轮把原「范围外」的 DAP 纳入：在「范围外」末尾补「…经维护者决定纳入第十一轮，见 docs/yamet-需求迭代-第十一轮-LSP-PTY-DAP-2026-08-05.md」。
   - 「下一批」若有 DAP/调试器相关项则勾 `[x]`。
3. **YaMet.md**：
   - `## 架构` 的 `lsp::*` 段旁新增 `dap::*` 命令面段（`dap_launch/attach/send/kill/list`，复用 `lsp/framing.rs`，DAP 与 LSP 同构 JSON-RPC）。
   - `src/modules/` 布局新增 `debug/`（DebugPanel + DebugSessionModel + breakpoints + launch）。
   - 若引入新不变量（如 DAP 请求 30s 超时、断点变更串行队列），补进对应段落或 `## 已知坑`。

**验收**：三文件的本轮同步项全部落地；`verify.ps1` 的 CHANGELOG 门禁通过；跨轮遗留审计不再把 DAP/ConPTY/行偏移标为「文档缺失」。

---

## 3. 规划方案（技术设计）

> 本节给出每项需求的**架构 / 数据结构 / 命令签名 / 状态机 / 前端组件树 / 与现有代码接缝 / 测试策略 / 风险**。实现细节在 §4 实施计划落为步骤。所有 Rust 端复用 YaMet 既有 `lsp/framing.rs` 与 `lsp/session.rs` 的子进程宿主模式；前端复用 `invoke` + 事件订阅。

---

### 3.1 DAP 调试器整体架构

**设计原则**：DAP 与 LSP 同构（JSON-RPC + Content-Length 分帧 + 子进程宿主 + 会话管理）。因此**不新建传输层**，直接复用 `lsp/framing.rs`；只新增「调试适配器」这一个特殊子进程形态与「会话/断点/线程/栈帧/变量」模型。

```
┌────────────────────────────────────────────────────────────────┐
│ 前端 (src/modules/debug/)                                       │
│  DebugPanel.tsx(面板 UI)                                       │
│    └─ DebugSessionModel(会话)                                  │
│         ├─ DebugThreadModel   (线程树)                         │
│         ├─ DebugStackFrameModel(栈帧)                          │
│         └─ DebugVariableModel  (变量/作用域)                   │
│    └─ breakpoints.ts(断点: 编辑器 gutter ↔ 会话)              │
│    └─ launch.ts(.yamet/launch.json 解析)                      │
│         │  invoke("dap_launch"|"dap_attach"|"dap_send"|"dap_kill"|"dap_list")
│         ▼                                                        │
│ Rust (src-tauri/src/modules/dap/)                               │
│  mod.rs    DapState 注册表 + #[tauri::command] 命令面           │
│  session.rs DapSession: 子进程宿主(复用 lsp/session.rs 风格)   │
│             ├─ FrameDecoder/encode_frame(复用 lsp::framing)    │
│             ├─ 请求-响应 id 配对 + 超时(30s/写30s)             │
│             ├─ reverse-request 分发(runInTerminal/startDebugging)
│             └─ stderr tail + 崩溃 reason                        │
│  adapter.rs DapAdapterDef{id,extensions,rootMarkers,command,args,env}
│  registry.rs 适配器选择(按扩展名+祖先 marker)                  │
└────────────────────────────────────────────────────────────────┘
```

**与 LSP 的接缝（复用点）**：
- `lsp/framing.rs` 的 `FrameDecoder`/`encode_frame`：DAP 也是 `Content-Length` 分帧，**零改动复用**（LSP 版本已带 64MiB 上限、错误 poisoned、测试齐全）。
- `lsp/session.rs` 的子进程模式（stdin 写 / stdout 读 / stderr tail 8 行 / 内存看门狗 / 树杀）：DAP 适配器同为 stdio 子进程，按需裁剪（DAP 不需要 RSS 看门狗，但要 30s 请求超时）。
- `lsp/mod.rs` 的 `DapState` 注册表结构与 `lsp_spawn` 的「spawn 后再查 exited 兜底」竞态处理：照搬。

**新增层（DAP 特有）**：适配器注册表 + 断点/线程/栈帧/变量模型 + reverse request（LSP 的 server→client 请求 transport.ts 已补答过，DAP 复用该思路但协议不同）。

### 3.1.1 DAP 后端数据结构（`src-tauri/src/modules/dap/`）

```rust
// adapter.rs —— 适配器定义与选择
pub struct DapAdapterDef {
    pub id: &'static str,          // "debugpy" | "node-inspect" | "lldb-dap" | "gdb" | "dlv"
    pub extensions: &'static [&'static str], // ["py"] | ["rs","c","cpp"] ...
    pub root_markers: &'static [&'static str], // ["pyproject.toml","requirements.txt"]...
    pub command: &'static str,
    pub args: &'static [&'static str],
}
pub fn select_adapter(ext: &str, root: &Path, markers: &[&str]) -> Option<&'static DapAdapterDef>;

// session.rs —— 会话
pub struct DapSession {
    pub id: u32,
    pub proc: Child,                       // 适配器子进程
    pub stdin: Mutex<ChildStdin>,
    pub stderr_tail: Arc<Mutex<Vec<String>>>, // 最近 N 行
    pub pending: Mutex<HashMap<i64, DapPending>>, // 请求 id → 等待者
    pub next_req_id: AtomicI64,
    pub reverse_handlers: Mutex<HashMap<&'static str, Box<dyn Fn(Value) + Send + Sync>>>,
    pub exited: AtomicBool,
}
enum DapPending { Response(Channel<Response>), /* 或 oneshot */ }

// mod.rs —— 命令面
#[tauri::command] async fn dap_launch(config: DapLaunchConfig, on_event: Channel<Response>, on_exit: Channel<DapExit>) -> Result<u32, String>;
#[tauri::command] async fn dap_attach(config: DapAttachConfig, ...) -> Result<u32, String>;
#[tauri::command] async fn dap_send(state, id: u32, message: String) -> Result<(), String>;
#[tauri::command] fn dap_kill(state, id: u32);
#[tauri::command] fn dap_list(state) -> Vec<DapSessionInfo>;
```

**命令语义**：
- `dap_launch`：`registry.select_adapter` 选适配器 → `session::spawn` 起子进程 → 自动发 `initialize` + `launch` 请求（launch 参数来自 config）→ 注册进 `DapState`。
- `dap_attach`：同 launch，但发 `attach` 请求（config 含 host/port/pid）。
- `dap_send`：任意 JSON-RPC 消息透传给适配器（前端经它发 `setBreakpoints`/`continue`/`next`/`variables` 等）；带 30s 请求超时。
- `dap_kill`：杀适配器子进程 + 从注册表移除。
- **reverse request**：适配器主动发的请求（`runInTerminal`/`startDebugging`）由 reader 线程捕获，交 `reverse_handlers` 分发；前端经 `dap_send` 的 `on_event` 通道收到后处理。

### 3.1.2 DAP 前端设计（`src/modules/debug/`）

**模型分离**（对齐 `@theia/debug`）：
```
DebugSessionModel      // 会话状态(started/running/stopped/exited) + 事件订阅
├─ threads: DebugThreadModel[]        // DAP thread → 可观察
│   └─ frames: DebugStackFrameModel[] // stackFrame → 行/源
│       └─ scopes: DebugVariableModel[] // scope/variable 树
└─ breakpoints: Map<path, DebugBreakpoint[]>
```

- **断点 gutter**（编辑器）：CodeMirror `Decoration` 行内点击 toggle；持久化到 `usePreferencesStore` 或 localStorage；变更 → `dap_send("setBreakpoints")` 串行队列（对齐 oh-my-pi `session.ts:80`）。
- **DebugPanel**：顶部工具栏（启动/停止/重启 + 配置下拉），左区线程+栈帧树，中区变量/作用域，底部 Debug Console（输出 + 表达式求值 `evaluate`）。
- **配置解析** `launch.ts`：读 `<workspaceRoot>/.yamet/launch.json`（JSON，字段对齐 DAP launch），变量替换 `$workspaceFolder`/`${env:VAR}`；设置页可编辑（对齐 `DebugConfigurationManager`）。
- **事件流**：DAP 事件（`stopped`/`continued`/`thread`/`output`/`breakpoint`/`terminated`）经 `on_event` Channel 到前端，`DebugSessionModel` 更新模型并驱动面板重渲染。

**接缝**：编辑器行号 gutter（`src/modules/editor/`）、tabs 打开逻辑（跨文件跳转 `getLspNavigator().openFile`）、设置页新增 Debug 配置入口（`src/settings/`）。

### 3.1.3 DAP 测试策略

- **后端单测**：framing round-trip（复用 lsp framing 已有）；`registry.select_adapter`（py→debugpy、rs→lldb-dap、无匹配→None）；`DapSession` 对 **fake 适配器进程**（一个按 DAP 协议应答 initialize/launch 的临时脚本）验证 launch + reverse-request 分发 + 30s 超时。
- **前端组件**：`debug/breakpoints.test.ts`（断点模型 toggle/持久化）、`launch.test.ts`（launch.json 解析 + 变量替换）、`DebugSessionModel.test.ts`（mock 事件 → 状态迁移）。
- **E2E（人工/可选）**：真实 debugpy 与 node-inspect 各一次断点命中/单步/变量。

**风险**：不同调试器协议差异大（尤其 reverse `runInTerminal`），先只支持「不依赖终端内嵌」的运行时（Python/Node）；适配器二进制缺失时 `dap_launch` 返回清晰错误 + 自动安装提示（复用 LSP `install` 思路）。**

---

### 3.2 PTY Windows ConPTY 健壮性方案

**改动全部集中在 `src-tauri/src/modules/pty/session.rs`，不新增模块。** 三处，均 `#[cfg(windows)]` 分支，Unix 行为不变。

| # | 现状 | 方案（对齐 oh-my-pi `pty.rs`） |
|---|---|---|
| 1 | `openpty` 同步调用，ConPTY 可无限挂 | 独立线程 `std::thread::scope` 执行 `openpty`，`mpsc::recv_timeout(5s)` 收结果；超时返回错误「ConPTY unavailable」。|
| 2 | `child.wait()` 阻塞，ConPTY 可无限挂 | Windows 用 5s 轮询 `try_wait()`（50ms 步进）；Unix 保持阻塞 `wait()`。|
| 3 | close 直接 drop，ClosePseudoConsole 可能死锁 | close 流程拆为：`drop(writer)` → drain reader(超时 300ms/500ms) → **后台线程 drop(master) + 2s 超时**（死锁则放弃线程）→ `reader_done` 才 join reader。|

**状态机（close 流程）**：`Idle → Closing(writer 已关) → Draining(reader drain 带超时) → ClosingMaster(后台线程) → Joined(reader join 完成) → Dropped`。任一阶段超时不阻塞主线程。

**测试**：Unix 路径可跑逻辑单测（超时分支用 `#[cfg(windows)]` 注释或依赖 CI Windows runner）；断言「openpty 超时返回 Err」「wait 轮询不阻塞」。风险：Windows 单测需 ConPTY 环境，CI 未必有 → 单测覆盖 Unix 逻辑 + 代码审查保证 Windows 分支。

---

### 3.3 LSP 诊断 freshness 行偏移方案

**改动集中在 `src/modules/lsp/lib/diagnose.ts`（前端纯函数）。**

- `buildLineShift(before: string[], after: string[]): Map<number, number>`：用轻量 difflib 风格 diff（`@codemirror` 的 `compare` 或自写 LCS）生成「旧行号 → 新行号」映射。算法对齐 hermes `range_shift.py`：对每个旧行找到它在编辑后文件中的对应行；删除行映射到最近下一行；插入行不影响其上方旧行。
- `captureBaseline(path)` 额外把编辑前全文存进 `baselineByPath`（当前只存诊断数组）。
- `newDiagnosticsAfterWrite(path, text)`：比较前先把 `baseline` 里每条诊断的 `line` 经 `buildLineShift` 平移，再与 `after` 五元组 diff —— 编辑点下方的基线错误行号已对齐，不再误判为新增。
- 保持 silent-degrade：无 LSP / 无基线 / 超时 → 空串。

**接缝**：`diagnose.ts` 已被 `edit.ts`/`fs.ts` 的 `applyEdits`/`apply_patch` 调用（`withLspDiagnostics`），改动不涉及调用方签名。

**测试**：`diagnose.test.ts` 构造「在文件中部插入 N 行」的编辑：编辑点下方原有的一个 error 不应出现在结果里；真正新增的 error 应出现。

**风险**：行偏移本身有误差边界（如多行编辑交错），对齐 hermes 用 difflib 可接受；极端文件仅作 best-effort，绝不影响写入。

---

### 3.4 PTY helper 强化方案

**改动集中在 `src-tauri/src/modules/pty_helper/`（round-10 已建，本轮增强）。**

1. **非 PID 判活**：`server.rs` 的会话注册表判活改为「socket/named-pipe 连接探测 + 响应体形状校验」（握手返回 `{type:"pong",version}` 且字段齐全才判存活），不靠 PID —— 端口被复用但进程已换时不会被误判（对齐 grok `registry.rs:71-96`）。
2. **事件驱动 wait/expect**（可选）：helper 的 wait 原语用 `tokio::sync::watch` generation + `select!`（对齐 grok `wait.rs`），resize/输出都 bump generation，绝不轮询；超时自动携带 screen/raw_tail/modes 快照。

**接缝**：helper 的 IPC 协议在 `protocol.rs` 定义，新增 `list`/`probe` 命令即可，client.rs 同步加对应 invoke 封装。

**测试**：`cargo test pty_helper::`；新增「会话注册表对已退出但端口占用不误判存活」的协议级单测。

**风险**：helper 跨进程，单测难覆盖真实端口场景 → 协议编解码层单测 + 探活函数用注入 socket 的 fake 对象测。

---

## 4. 实施计划

> 本节是**可执行的计划**：里程碑总览 → 每里程碑的 todo 级任务清单（每项标注改动文件 / 验证命令 / 依赖）→ 依赖有序的执行顺序链 → 全局任务清单。实现细节（架构/命令签名/数据结构）见 §3。

### 4.0 里程碑总览

| 里程碑 | 内容 | 依赖 | 涉及 | 验证 |
|---|---|---|---|---|
| **A-M1** | DAP Rust 后端 + 传输 + 适配器注册表 | 无 | `src-tauri/src/modules/dap/`(新) + `mod.rs`/`lib.rs` | `cargo check` + `cargo test dap::` |
| **B** | PTY ConPTY 健壮性（3 处超时兜底） | 无 | `pty/session.rs` | `cargo test pty::` |
| **C** | LSP 诊断行偏移 | 无 | `lsp/lib/diagnose.ts`(新测试) | `npx tsc` + `vitest lsp` |
| **D** | PTY helper 强化（非 PID 判活） | 无 | `pty_helper/` | `cargo test pty_helper::` |
| **A-M2** | DAP 前端：断点 + 启动/停止 + Debug Console | A-M1 | `src/modules/debug/`(新) + `editor/` + tabs | `npx tsc` + `vitest debug` |
| **A-M3** | DAP 单步 + 变量/调用栈 + 真实验证 | A-M2 | `debug/` + `editor/` | `npx tsc` + 手动 debugpy/node-inspect |
| **E** | 根目录三文档同步 + i18n + 构建 | 全部功能交付 | CHANGELOG/ROADMAP/YaMet + i18n 键 + 四文件版本 | `pnpm verify` + `npx tauri build` |

**执行顺序链**：`A-M1 → {B, C, D}（并行）→ A-M2 → A-M3 → E → 构建`。
Rust 后端先行（A-M1/B/D），前端消费在后（A-M2/A-M3/C）；无跨里程碑硬依赖的 B/C/D 可并行。

### 批次 A · DAP 调试器（拆 3 个子里程碑）

#### A-M1 · DAP Rust 后端 + 传输 + 适配器注册表

| # | 任务 | 改动文件 | 验证 |
|---|---|---|---|
| 1 | 建 `modules/dap/`；`session.rs` 复用 `lsp/framing.rs` 的 `FrameDecoder`/`encode_frame` 做 DAP 分帧；`DapSession` 起适配器子进程（stdout 解码 / stdin 编码 / 请求-响应 id 配对 / reverse-request handler / 30s 请求超时 / stderr tail 8 行） | `dap/session.rs`(新) | `cargo check` |
| 2 | `adapter.rs` 建 `DapAdapterDef{id,extensions,rootMarkers,command,args,env}` + 内置列表（debugpy/node-inspect/lldb-dap/gdb/dlv） | `dap/adapter.rs`(新) | `cargo check` |
| 3 | `registry.rs` 实现 `select_adapter(ext, root, markers)`（按扩展名 + 祖先 marker 匹配，无匹配→None） | `dap/registry.rs`(新) | `cargo test dap::` |
| 4 | `mod.rs`：`DapState` 注册表（同 LspState）+ 命令 `dap_launch(config)`/`dap_attach(config)`/`dap_send(id,message)`/`dap_kill(id)`/`dap_list` | `dap/mod.rs`(新) | `cargo check` |
| 5 | 注册链路：`modules/mod.rs` 加 `pub mod dap;`；`lib.rs` `use modules::{... dap ...}` + `generate_handler![... dap::dap_launch, ...]` | `modules/mod.rs`、`lib.rs` | `cargo check` |
| 6 | 单测：framing round-trip、`registry.select_adapter`（py→debugpy、rs→lldb/gdb、无匹配→None）、`DapSession` 对 fake 适配器进程的 launch + reverse-request + 30s 超时 | `dap/` 各测试 | `cargo test dap::` |

- **验收**：`cd src-tauri && cargo check` 0 error；`cargo test dap::` 全绿。

#### A-M2 · DAP 前端：断点 + 启动/停止 + Debug Console

| # | 任务 | 改动文件 | 验证 |
|---|---|---|---|
| 1 | `lib/client.ts`：`invoke` 封装 `dap_launch/attach/send/kill/list`；`DebugSessionModel`（状态机 started/running/stopped/exited + 事件订阅） | `src/modules/debug/lib/client.ts`(新) | `npx tsc` |
| 2 | 编辑器断点 gutter（行内点击 toggle，`Decoration` + localStorage 持久化）；断点变更 → `dap_send setBreakpoints`（串行队列，对齐 oh-my-pi `session.ts:80`） | `src/modules/editor/`、`debug/lib/breakpoints.ts` | `npx tsc` + `vitest breakpoints` |
| 3 | `components/DebugPanel.tsx`：启动/停止/重启 + 配置下拉（读 `.yamet/launch.json`）+ Debug Console（输出区 + `evaluate` 表达式求值） | `debug/components/DebugPanel.tsx`(新)、`debug/lib/launch.ts` | `npx tsc` + `vitest launch` |
| 4 | 模型分离：`DebugSessionModel`→`DebugThreadModel`→`DebugStackFrameModel`→`DebugVariableModel`（对齐 `@theia/debug`），面板树状渲染线程→栈帧→变量/作用域 | `debug/lib/sessionModel.ts`、`DebugPanel.tsx` | `npx tsc` + `vitest sessionModel` |
| 5 | 接线：DebugPanel 挂到编辑器侧栏/标签；设置页加 Debug 配置入口 | `src/modules/editor/`、`src/settings/` | `npx tsc` |

- **验收**：`npx tsc --noEmit` 0 error；`npx vitest run src/modules/debug` 全绿。

#### A-M3 · 单步 + 变量/调用栈 + 三平台真实验证

| # | 任务 | 改动文件 | 验证 |
|---|---|---|---|
| 1 | 单步命令（continue/pause/next/stepIn/stepOut）接线到 UI 按钮 + 快捷键 | `debug/DebugPanel.tsx`、`debug/lib/sessionModel.ts` | `npx tsc` |
| 2 | 断点命中高亮当前栈帧/行，展示变量/作用域树 | `debug/`、`editor/` | `npx tsc` |
| 3 | 真实 debugpy 与 node-inspect 各端到端验证一次（断点命中/单步/变量/调用栈） | 手动 | 记录结果 |

- **验收**：Python(debugpy) 与 Node(node-inspect) 各跑通；`npx tsc` + `npx tauri build`（或 `cargo check`）。

### 批次 B · PTY ConPTY 健壮性（改动文件：`src-tauri/src/modules/pty/session.rs`）

| # | 任务 | 验证 |
|---|---|---|
| 1 | `openpty` 超时：`#[cfg(windows)]` 移到 `std::thread::scope` 独立线程 + `mpsc::recv_timeout(5s)`；Unix 保持同步 | `cargo check` |
| 2 | `child.wait()` 兜底：`#[cfg(windows)]` 5s 轮询 `try_wait()`（50ms 步进）；Unix 阻塞 `wait()` | `cargo check` |
| 3 | teardown 分阶段：close 抽为「drop writer → drain reader(超时) → 后台线程 drop master + 2s 超时 → join reader」 | `cargo check` |
| 4 | 新增 `openpty_timeout`/`wait_loop` 单测（Unix 覆盖逻辑，Windows `#[cfg]` 编译过） | `cargo test pty::` |

### 批次 C · LSP 行偏移（改动文件：`src/modules/lsp/lib/diagnose.ts` + 新建测试）

| # | 任务 | 验证 |
|---|---|---|
| 1 | `diagnose.ts` 加 `buildLineShift(beforeLines, afterLines)`（difflib 风格 diff → 行号映射）；`captureBaseline` 额外存编辑前全文 | `npx tsc` |
| 2 | `newDiagnosticsAfterWrite` 比较前先把基线诊断行号按映射平移，再五元组 diff | `npx tsc` |
| 3 | 新增 `diagnose.test.ts`：中部插行场景断言基线错误不再误报 | `npx vitest run src/modules/lsp` |

### 批次 D · PTY helper 强化（改动文件：`src-tauri/src/modules/pty_helper/`）

| # | 任务 | 验证 |
|---|---|---|
| 1 | 会话注册表判活改为「socket 探测 + 响应体形状校验」而非 PID | `cargo check` |
| 2 | （可选）`wait/expect` 用 `watch` generation 事件驱动 | `cargo check` |
| 3 | 新增协议级单测：对「已退出但端口占用」不误判存活 | `cargo test pty_helper::` |

### 批次 E · 收尾：i18n + 根目录三文档同步 + 构建

| # | 任务 | 改动文件 | 验证 |
|---|---|---|---|
| 1 | DAP/debug 全部 UI 文案走 i18n（zh-CN 主 + en 回退），新增键双语 | `src/lib/i18n/translations.ts` | `npx tsc` |
| 2 | CHANGELOG.md `[未发布]` 段新增「第十一轮（0.1.12）」条目 | `CHANGELOG.md` | — |
| 3 | ROADMAP.md 勾选/纳入标注（DAP 纳入 + 下一批勾选） | `ROADMAP.md` | — |
| 4 | YaMet.md 补 `dap::*` 命令面 + `debug/` 模块布局 | `YaMet.md` | — |
| 5 | 版本 0.1.12 四文件同步（`node scripts/version-bump.mjs`） | package.json/tauri.conf.json/Cargo.toml/Cargo.lock | — |
| 6 | 全量门禁 + 构建 | — | `pnpm verify` + `npx tauri build` |

### 执行顺序（依赖有序）

```
A-M1 → ┌ B ┐ → A-M2 → A-M3 → E(收尾/构建)
        ├ C ┤        (B/C/D 并行)
        └ D ┘
```

- Rust 后端先行（A-M1, B, D），前端消费在后（A-M2, A-M3, C）。
- B/C/D 无相互依赖，可并行派发（delegate_task 分 3 子代理）。
- 每批交付前 `npx tsc --noEmit`（前端）或 `cd src-tauri && cargo check`（后端）；发布前 `pnpm build` + `pnpm verify` 全量门禁。

### 全局任务清单（todo）

- [x] **A-M1** DAP Rust 后端 + 传输 + 适配器注册表（6 任务）
- [x] **B** PTY ConPTY 健壮性（4 任务）
- [x] **C** LSP 行偏移（3 任务）
- [x] **D** PTY helper 强化（3 任务）
- [x] **A-M2** DAP 前端：断点 + 启动/停止 + Debug Console（5 任务）
- [x] **A-M3** DAP 单步 + 变量/调用栈 + 真实验证（3 任务）
- [x] **E** i18n + 三文档同步 + 版本 + 构建（6 任务）

### 质量门禁（每项功能交付前必过）

> 对应 YaMet.md 的质量门槛与 YaMet 既有验证链。四维门禁，缺一不可。

#### 前端对齐（四级链路，防死代码）

> 铁律：有后端无前端 = 死代码。每个新 Rust 命令必须走完整条链路，任何一环缺失即功能不可用。

| 级 | 检查 | 命令 |
|---|---|---|
| 1 后端实现 | DAP 命令存在且测试通过 | `cargo test dap::` |
| 2 后端桥接 | `#[tauri::command]` 已注册进 `lib.rs` `generate_handler!` + `.manage(DapState)` | `grep -n "dap::dap_" src-tauri/src/lib.rs` |
| 3 前端封装 | `src/modules/debug/lib/client.ts` 有对应 `invoke("dap_*")` | `grep -rn "dap_launch\|dap_send\|dap_kill" src/modules/debug/lib/client.ts` |
| 4 前端使用 | 封装函数被 React 组件实际 import/调用（非仅存在） | `grep -rn "client.\(launch\|send\|kill\)\|from.*client" src/modules/debug` |

判定：级 4 为空的封装 = 死代码，必须接线或删除。

#### 汉化（i18n）

> 铁律：UI 文案绝不硬编码，简体中文(zh-CN)为主 + en 回退；键名/URL/模型名保留英文；数据字段用 `tStatic` + 英文回退在渲染处本地化，不动原始数据。

| 检查 | 命令 |
|---|---|
| DAP/debug 面板全部文案走 `t()`/`useI18n()`，新增键双语（zh + en） | `grep -rhoE '>[A-Za-z][A-Za-z ]{2,}<|(title\|placeholder\|aria-label)=\"[A-Z]' src/modules/debug` |
| 新增翻译键在 `translations.ts` 双语包都存在 | `grep -n '"debug\.' src/lib/i18n/translations.ts`（zh + en 各命中） |
| 无残留硬编码英文（仅白名单：品牌名/协议名/示例值） | `npx tsc --noEmit` + 手工核对 |

#### 编译

| 检查 | 命令 |
|---|---|
| 后端 0 error 0 warning | `cd src-tauri && cargo check`；`cargo clippy --all-targets -- -D warnings` |
| 前端 0 error | `npx tsc --noEmit` |
| 全量测试绿（Rust + 前端） | `cargo test --workspace`；`npx vitest run` |

#### 构建

| 检查 | 命令 |
|---|---|
| 生产构建通过（tsc + vite，含子代理测试类型错误清零） | `pnpm build` |
| 桌面包构建成功出 NSIS exe | `npx tauri build` |
| 版本 0.1.12 四文件同步；size-limit 不反弹 | `pnpm size`；`node scripts/version-bump.mjs` 后核对四文件 |

---

## 5. 验收总门禁

> 每项功能交付前先过 §4「质量门禁」四维（前端对齐 / 汉化 / 编译 / 构建）；以下为本轮整体验收。

**前端对齐**
- [ ] 四级链路完整：每个 `dap_*` 命令在 lib.rs 注册 + `client.ts` 封装 + 组件调用（级 1-4 全通，无死封装）。

**汉化**
- [ ] 所有 UI 文案走 i18n（zh-CN 主 + en 回退），不硬编码；新增键双语存在。

**编译**
- [ ] `cargo test --workspace` 0 failed 0 warning；`cd src-tauri && cargo check` + `clippy -D warnings` 0 error。
- [ ] `npx tsc --noEmit` 0 error；`npx vitest run` 全绿。

**构建**
- [ ] `pnpm build` 通过（含子代理测试类型错误清零）。
- [ ] `npx tauri build` 出 NSIS exe；版本 0.1.12 四文件同步。

**功能验收**
- [ ] DAP：debugpy 与 node-inspect 各端到端跑通（断点/单步/变量/调用栈）。
- [ ] PTY：openpty/wait/teardown 三处超时兜底有单测；Windows 无挂死。
- [ ] LSP：中部插行不误报假新错误。
- [ ] **根目录三文档同步**：CHANGELOG.md 新增「第十一轮」条目、ROADMAP.md 勾选/纳入标注、YaMet.md 补 `dap::*` 命令面 + `debug/` 模块（见 §2 P0）。

## 6. 范围外（维持）

- Notebook/文档工作区、包管理器/工具链 UI、IDE 规模扩展市场、第三方订阅会话桥接：维持范围外。
- 重构引擎：仅用 LSP `executeCommand`/code action 支撑的，不重复造轮子（本轮不单独立项）。
- 遥测：维持无遥测卖点。
