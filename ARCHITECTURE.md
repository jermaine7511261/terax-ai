# Terax-Super 架构文档

> 基于 Terax AI 的桌面原生 AI IDE 聚合 — 仅保留桌面 IDE 核心

---

## 设计原则

1. **桌面原生** — Tauri 2 + Rust 后端 + React 前端，无云依赖
2. **本地优先** — 所有数据存储在本地 (SQLite FTS5 / OS Keychain / IndexedDB)
3. **模块化** — 核心功能为 Rust module + TS UI，可选功能作为独立插件
4. **隐私保护** — 无遥测、无账户、无 SaaS

---

## 纳入范围 (IN)

### 来自 Terax AI (基础骨架)
| 模块 | Rust | TS | 说明 |
|------|:----:|:--:|------|
| Tauri 2 桌面窗口 | ✅ | ✅ | 原生窗口 + WebView |
| xterm.js 终端 | ✅ | ✅ | WebGL 硬件加速 |
| CodeMirror 6 编辑器 | ✅ | ✅ | 多语言 + Vim + 语法高亮 |
| 可视化 Git 提交图 | ✅ | ✅ | 分支/提交/暂存/推送 |
| AI Diff 逐块审核 | — | ✅ | 变更审阅 UI |
| 多层路径安全守卫 | — | ✅ | 50+ 正则模式 |
| OS Keychain 密钥管理 | ✅ | — | Apple/Windows/Linux |
| 20 AI 提供商路由 | — | ✅ | OpenAI/Anthropic/Google/Grok 等 |
| 本地模型支持 | — | ✅ | Ollama/LM Studio/MLX |
| WSL 集成 | ✅ | — | Windows WSL2 支持 |
| 语音输入 | — | ✅ | 3 种 STT 后端 |
| LSP JSON-RPC 引擎 | ✅ | ✅ | 60+ 预设 |

### 来自 OpenCode (Agent 架构)
| 模块 | Rust | TS | 说明 |
|------|:----:|:--:|------|
| Build/Plan 双 Agent | — | ✅ | Tab 切换全权限/只读 |
| @mention 子代理 | — | ✅ | explore/review/security/scout |
| 三级权限系统 | — | ✅ | allow/ask/deny + glob |
| Agent 配置格式 | — | ✅ | JSON/MD frontmatter |
| LSP 自动发现 | — | ✅ | 61 种预设 |

### 来自 Hermes Agent (学习 + 多平台)
| 模块 | Rust | TS | 说明 |
|------|:----:|:--:|------|
| FTS5 跨会话记忆 | ✅ | ✅ | SQLite 全文搜索 |
| 技能创建/管理 | ✅ | ✅ | Markdown frontmatter |
| 自进化学习循环 | ✅ | ✅ | 后台回顾 → 技能创建 → Curator |
| Dokcer/SSH 远程后端 | ✅ | — | Local/Docker/SSH 连接器 |
| Cron 调度引擎 | ✅ | ✅ | 自然语言调度 + 持久化 |
| i18n 国际化 | — | ✅ | 23 种语言 |

### 来自 Grok Build (基础设施)
| 模块 | Rust | TS | 说明 |
|------|:----:|:--:|------|
| MCP 协议客户端 | ✅ | — | 标准协议 (rmcp crate) |
| 4 级沙箱 | ✅ | ✅ | Off/Workspace/Strict/ReadOnly |
| Checkpoint 快照 | ✅ | ✅ | 文件状态保存/回滚 |

### 新增模块
| 模块 | Rust | TS | 说明 |
|------|:----:|:--:|------|
| 技能市场 Skills Hub | ✅ | ✅ | 远程索引 + 本地安装管理 |
| Plugin SDK 插件系统 | ✅ | ✅ | 钩子系统 + 工具注册 |
| 团队工作区 | — | ✅ | 本地工作区 + 会话分享 |
| 消息网关配置 | ✅ | — | Telegram/Discord/Slack 配置存储 |
| Web 浏览器版 | — | ✅ | 独立 Vite SPA，IndexedDB 后端 |

---

## 排除范围 (OUT)

| 项目 | 排除模块 | 原因 |
|------|---------|------|
| **Grok** | codebase-graph, crash-handler, fast-worktree, hunk-tracker, sampler, pager, voice, auth, telemetry, computer-hub, circuit-breaker, tool-runtime, mermaid, update, workflow | TUI 代理实现细节，桌面 IDE 不适用 |
| **Hermes** | MOA, 计费, 凭证池, 图片/视频生成, web搜索, 轨迹压缩, 工具守卫, 错误分类, shell钩子, Honcho, 完整消息推送(15项) | Python 生态，Rust 重写成本高，桌面非核心 |
| **OpenCode** | server, console, enterprise, slack, containers, sdk, protocol, identity, stats, http-recorder, function, session-ui, sst | SaaS/云端服务，桌面 IDE 不适用 |

---

## 模块总览 (22 Rust + 22 TS)

```
Rust Backend Modules (src-tauri/src/modules/)
├── pty/           # PTY 会话管理 (Terax)
├── shell/         # 命令执行 + 后台进程 (Terax)
├── fs/            # 文件树/读写/搜索/监听 (Terax)
├── git/           # Git 操作/提交图 (Terax)
├── lsp/           # LSP JSON-RPC 引擎 (Terax)
├── net.rs         # AI HTTP 代理 + 安全守卫 (Terax)
├── secrets.rs     # OS Keychain 桥接 (Terax)
├── workspace.rs   # 工作区授权/WSL (Terax)
├── agent.rs       # 外部代理检测 OSC 777 (Terax)
├── history/       # Shell 历史 (Terax)
├── proc/          # Windows Job Objects (Terax)
├── memory/        # FTS5 记忆引擎 ★ Hermes
├── skills/        # 技能存储/索引 ★ Hermes
├── agent_learn.rs # 学习循环/Curator ★ Hermes
├── backend/       # Docker/SSH 远程连接器 ★ Hermes
├── cron/          # Cron 调度引擎 ★ Hermes
├── gateway_bridge.rs # 消息网关配置存储 ★ Hermes
├── sandbox/       # 4 级沙箱 ★ Grok
├── checkpoint/    # 文件快照/回滚 ★ Grok
├── mcp/           # MCP 协议管理器 ★ Grok
├── hub/           # 技能市场引擎 ★ 新增
└── plugin/        # 插件注册/钩子系统 ★ 新增

TypeScript Frontend Modules (src/modules/)
├── terminal/      # xterm.js 终端 (Terax)
├── editor/        # CodeMirror 6 (Terax)
├── ai/            # Agent/工具/权限/提供商 ★ OpenCode
├── agents/        # 外部代理编排 (Terax)
├── lsp/           # LSP 面板/预设 ★ OpenCode
├── memory/        # 记忆面板 ★ Hermes
├── skills/        # 技能中心 ★ Hermes
├── learning/      # 学习洞察 UI ★ Hermes
├── backend/       # 远程后端管理 ★ Hermes
├── cron/          # 定时任务 UI ★ Hermes
├── gateway/       # 消息网关 UI ★ Hermes
├── sandbox/       # 沙箱配置 UI ★ Grok
├── checkpoint/    # 快照管理 UI ★ Grok
├── mcp/           # MCP 服务器管理 ★ Grok
├── hub/           # 技能市场 UI ★ 新增
├── plugin/        # 插件管理 UI ★ 新增
├── collaboration/ # 团队工作区 ★ 新增
├── sidebar/       # 侧边栏导航 (Terax)
├── git-history/   # Git 提交图 (Terax)
├── source-control/# 源码管理 (Terax)
├── theme/         # 主题引擎 (Terax)
└── settings/      # 设置面板 (Terax)
```

---

## 数据流

```
用户输入 → Composer
  → [Agent Runtime] → Permission Check → Sandbox Check
    → Tool Engine → [Local FS | Docker | SSH | Memory | MCP]
      → 每轮次后 → Learning Engine → 技能创建/改进
```

---

## 关键数据存储

| 数据 | 位置 | 技术 | 持久化 |
|------|------|------|--------|
| 会话历史 | 本地 | SQLite FTS5 | ✅ |
| 记忆 | 本地 | SQLite FTS5 | ✅ |
| 技能 | 本地文件 | Markdown + JSON | ✅ |
| API 密钥 | OS Keychain | keyring crate | ✅ |
| 用户配置 | 本地 | tauri-plugin-store | ✅ |
| 设置偏好 | 本地 | JSON + IndexedDB (Web) | ✅ |
