# WebUI 演进路线（MVP 边界）

> 定位：WebUI 是 Yamet 的**渐进式原生功能**，桌面端永远最优先。本文界定 Web 版首批能力（MVP）、架构现状与后端依赖，避免平台抽象层无限膨胀或空转。

## 1. 现状（更新至 2026-08-09，v0.1.26）

- **前端抽象层已就绪**：`src/platform/` 定义了 `IPlatformAdapter`（16 组 API），tauri/ 全实现，web/ 部分实现：
  - ✅ 有真实实现：`ipc`（WebSocket → Node 后端）、`storage`（localStorage）、`events`、`path`、`window`、`os`、`clipboard`、`dialog`（File System Access）、`watch`
  - ⛔ noop 占位：`webview`、`opener`、`notification`、`autostart`、`process`、`updater`
- **后端命令面**：`lib.rs` 命令全部绑定 Tauri `AppHandle`/`State`，Web 端无法直接复用；Web 走**独立 Node 服务端** `src/platform/web/server/`（WS :31219），已实现命令域：workspace / fs / shell / **git（只读 status/log/diff/branches）** / **history**。
- **入口**：`src/main.tsx` 已按 `detectPlatform()` 条件启动（web 模式 window.show 经适配器 noop、pty_close_all 静默降级）；`src/settings/main.tsx` 同。

## 2. MVP 范围（第一期，纯前端工作为主）

Web 版第一期**只做"能跑"**，目标是让抽象层与模块代码在浏览器里真实可测，不做原生能力：

| 能力 | MVP 含 | 说明 |
|---|---|---|
| 工作区/文件树 | ✅ 只读浏览 | `web/ipc` 走 WS 后端 `fs_read_dir`/`fs_read_file` |
| 代码编辑器 | ✅ | CodeMirror 全前端，无后端依赖 |
| Markdown 预览 | ✅ | 纯前端 |
| 主题/设置 | ✅ | `web/storage` localStorage 版 |
| AI 聊天 | ✅（无工具） | 直连提供商 API（CORS 由 provider 决定），禁 bash/fs 工具 |
| 终端/PTY | ❌ | 需要 WebSocket PTY 后端，**二期** |
| git / DAP / LSP / MCP / gateway / ssh | ⚠️ git 只读已补 | **git 只读 + history 已在 web 服务端落地（round 25 补齐）**；DAP/LSP/MCP/gateway/ssh 仍 **三期** |

**MVP 验收标准**：`pnpm dev:web`（**已交付**，vite :1420 + 后端 WS :31219 一起拉起）+ 浏览器打开 → 文件树浏览、编辑器打开/编辑、主题切换、AI 纯聊天，全部可用；vitest 在 web 平台模式下全绿（`src/platform/web/server/smoke.test.ts` 已锁定命令面）。

## 2. MVP 范围（第一期，纯前端工作为主）

Web 版第一期**只做"能跑"**，目标是让抽象层与模块代码在浏览器里真实可测，不做原生能力：

| 能力 | MVP 含 | 说明 |
|---|---|---|
| 工作区/文件树 | ✅ 只读浏览 | `web/path` + `web/ipc` 走内存 fixture 文件系统 |
| 代码编辑器 | ✅ | CodeMirror 全前端，无后端依赖 |
| Markdown 预览 | ✅ | 纯前端 |
| 主题/设置 | ✅ | `web/storage` 内存版 |
| AI 聊天 | ✅（无工具） | 直连提供商 API（CORS 由 provider 决定），禁 bash/fs 工具 |
| 终端/PTY | ❌ | 需要 WebSocket PTY 后端，**二期** |
| git / DAP / LSP / MCP / gateway / ssh | ❌ | 全部需要原生后端，**三期** |

**MVP 验收标准**：`pnpm dev:web`（新增脚本，vite 指向 web 入口）+ 浏览器打开 → 文件树浏览、编辑器打开/编辑、主题切换、AI 纯聊天，全部可用；vitest 在 web 平台模式下全绿。

## 3. 二期：终端只读流

- 后端新增 `pty_ws_listen(port)`（复用 `pty_helper` 的 loopback TCP 协议，加一层 WS 包装）或直接用 Tauri 2 的 `remote` 能力。
- 前端 `platform/web/pty.ts`：WebSocket 连接，映射 `IPlatformAdapter.pty` 接口。
- 安全：WS 必须带 token 鉴权（复用 helper token 机制）+ 仅 loopback + CORS 白名单。

## 4. 三期：完整原生桥

- 需要独立的 web 服务端进程（Rust，复用现有 modules 逻辑，把 `tauri::State` 换成普通 struct 注入）。
- 命令面按域分组（见 lib.rs 域分组改造）后，逐域导出 HTTP/WS 契约。
- 鉴权：仅本机 + token，禁止公网暴露。

## 5. 反模式（不要做）

- 不要在浏览器里直接暴露 147 个 Tauri 命令的 HTTP 映射——这是把 IPC 面放大成攻击面。
- 不要让 web/ 适配器先于后端存在而空转（现状 webview/dialog 等 noop 已足够，二期只补 pty）。
- 不要为了 WebUI 降低桌面端安全门禁（SSRF 防护、workspace 授权必须两侧一致）。

## 6. 里程碑

- M1（MVP，纯前端）：web/ 适配器补齐 + `pnpm dev:web` + 文件树/编辑器/主题/AI 纯聊天 —— 0.5-1 人周
- M2（终端只读流）：pty WS 桥 + 鉴权 —— 1 人周
- M3（原生桥）：命令面按域 HTTP/WS 导出 + web 服务端进程 —— 2-3 人周

## 7. 当前代码锚点

- 适配器接口：`src/platform/types.ts`
- web 实现：`src/platform/web/`
- 入口条件启动：`src/main.tsx`
- 命令面：`src-tauri/src/lib.rs`
- PTY helper 协议：`src-tauri/src/modules/pty_helper/protocol.rs`（二期复用）
