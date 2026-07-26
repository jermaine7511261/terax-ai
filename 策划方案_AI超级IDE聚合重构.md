# 基于 Terax AI 的超级 IDE 聚合重构 — 完整策划方案

> 项目代号: **Terax-Super** (暂定)
> 蓝本: Terax AI (crynta/terax-ai)
> 融合目标: Grok Build | OpenCode | Hermes Agent
> 2025 Q3-Q4

---

## 一、四项目核心能力总览

### 1.1 基础数据

| 维度 | Terax AI | Grok Build | OpenCode | Hermes Agent |
|------|:-------:|:---------:|:--------:|:----------:|
| **Stars** | 8.7k | 22.6k | 190k | **220.6k** |
| **语言** | Rust + TS | **纯 Rust** | TS (Bun) | **Python** |
| **桌面** | ✅ **Tauri 2** | ❌ | ⚠️ BETA | ❌ |
| **编辑器** | ✅ **CodeMirror 6** | ❌ | ❌ | ❌ |
| **许可证** | Apache-2.0 | Apache-2.0 | **MIT** | **MIT** |
| **包体积** | ~7-8MB | ~80MB | ~212MB | ~246MB |
| **协议** | — | **ACP+MCP** | MCP | MCP |

### 1.2 各项目独有价值清单

| # | 来源 | 独有能力 | 类别 | 重构复杂度 |
|---|------|---------|------|:---------:|
| **T1** | Terax | 原生桌面窗口 (Tauri 2) | 🖥️ 骨架 | — |
| **T2** | Terax | CodeMirror 6 代码编辑器 | 📝 编辑器 | — |
| **T3** | Terax | xterm.js + WebGL 终端 | 🖥️ 终端 | — |
| **T4** | Terax | 可视化 Git 提交图 | 🔧 工具 | — |
| **T5** | Terax | AI Diff 逐块审核 | 🤖 AI | — |
| **T6** | Terax | 外部代理检测与编排(Claude/Codex等) | 🤖 Agent | 高 |
| **T7** | Terax | 上下文压缩引擎(token预算渐进式) | 🤖 AI | 中 |
| **T8** | Terax | read-before-edit 不变式 | 🤖 AI | 低 |
| **T9** | Terax | Plan Mode (变更排队 + 审阅) | 🤖 AI | 中 |
| **T10** | Terax | 多层安全架构(路径/命令/网络) | 🔒 安全 | — |
| **T11** | Terax | OSC 777 Hook 协议 | 🔌 协议 | 高 |
| **T12** | Terax | WSL 完整支持 | 🖥️ 跨平台 | 中 |
| **T13** | Terax | Spaces 独立工作区 | 🖥️ 工作区 | 中 |
| **T14** | Terax | OS Keychain 密钥管理 | 🔒 安全 | — |
| **T15** | Terax | 13+ AI 提供商 | 🤖 AI | — |
| **T16** | Terax | 本地模型支持(Ollama/LM Studio/MLX) | 🤖 AI | — |
| **T17** | Terax | 语音输入(3种后端) | 🤖 AI | 低 |
| **G1** | Grok | ACP 协议 (编辑器嵌入) | 🔌 协议 | **极高** |
| **G2** | Grok | MCP 协议 | 🔌 协议 | 高 |
| **G3** | Grok | 沙箱执行 (Landlock/Seatbelt/bwrap) | 🔒 安全 | **极高** |
| **G4** | Grok | Checkpoint 系统 | 🔧 工具 | 高 |
| **G5** | Grok | 企业级构建配置(release-dist) | 🏗️ 工程 | 低 |
| **G6** | Grok | 单节点主架构(IPC Unix Socket) | 🏗️ 架构 | **极高** |
| **G7** | Grok | 每个工具行为版本控制 | 🤖 AI | 中 |
| **G8** | Grok | 双向工具版本控制并行 | 🤖 AI | 高 |
| **G9** | Grok | 工具包反向依赖注入(register_tool_pack) | 🔧 工具 | 中 |
| **O1** | OpenCode | Build/Plan 双 Agent 模式 | 🤖 Agent | 中 |
| **O2** | OpenCode | @mention 子代理系统 | 🤖 Agent | 中 |
| **O3** | OpenCode | LSP 自动发现 + 自动安装(61种) | 📝 LSP | 高 |
| **O4** | OpenCode | 粒度权限系统(allow/ask/deny + glob) | 🤖 AI | 中 |
| **O5** | OpenCode | 多会话并行管理 | 🤖 Agent | 中 |
| **O6** | OpenCode | 插件系统(20+生命周期钩子) | 🔌 扩展 | **极高** |
| **O7** | OpenCode | 快照系统(文件系统撤销) | 🔧 工具 | 中 |
| **O8** | OpenCode | Event Sourcing 持久化 | 🏗️ 架构 | **极高** |
| **O9** | OpenCode | 20+ AI SDK 提供商 | 🤖 AI | 低 |
| **O10** | OpenCode | Agent 配置(JSON/MD 格式) | 🤖 Agent | 低 |
| **O11** | OpenCode | Effect Schema 运行时验证 | 🏗️ 架构 | **极高** |
| **O12** | OpenCode | 会话分享/协作 | 🤝 协作 | 中 |
| **O13** | OpenCode | Slack 集成 | 🤝 协作 | 高 |
| **H1** | Hermes | **自进化学习循环** | 🧠 **核心** | **极高** |
| **H2** | Hermes | 技能创建/自改进 | 🧠 学习 | 极高 |
| **H3** | Hermes | FTS5 跨会话记忆系统 | 🧠 记忆 | 高 |
| **H4** | Hermes | Honcho 用户建模 | 🧠 记忆 | 高 |
| **H5** | Hermes | 6 种终端后端(Local/Docker/SSH/Modal等) | 🖥️ 部署 | 极高 |
| **H6** | Hermes | 消息网关(10+平台) | 🤝 协作 | **极高** |
| **H7** | Hermes | Cron 调度 + 建议系统 | 🔧 工具 | 高 |
| **H8** | Hermes | Skills Hub 市场 | 🔌 生态 | 极高 |
| **H9** | Hermes | 40+ 工具集 | 🤖 AI | 低 |
| **H10** | Hermes | 蓝图自动化(技能→cron) | 🔧 工具 | 高 |
| **H11** | Hermes | 惰性依赖加载(供应链安全) | 🏗️ 工程 | 中 |
| **H12** | Hermes | AST 驱动工具注册 | 🏗️ 工程 | 中 |
| **H13** | Hermes | 代理分叉(AIAgent fork) | 🤖 Agent | 极高 |

---

## 二、相似功能分析与融合策略

### 2.1 AI 提供商系统 — 三路融合

| 项目 | 实现方式 | 提供商数量 | 本地模型 | 特点 |
|------|---------|:---------:|:-------:|------|
| Terax | config.ts + buildLanguageModel | **13** | ✅ Ollama/LM Studio/MLX | 模型能力评分 + 定价 |
| OpenCode | LLM 抽象层 + AI SDK | **20+** | ❌ | 协议适配器模式 |
| Hermes | 动态提供者插件 | 300+(Portal) | ❌ | Nous Portal 一站式订阅 |

**融合策略**:
```
以 Terax 为基础，注入 OpenCode 的 SDK 路由，可选接入 Hermes Portal
```
- **基底**: Terax 的 `config.ts` 模型注册表 + 能力评分 + `buildLanguageModel`
- **扩展**: 合并 OpenCode 的 20+ AI SDK 提供商 (共 33+) 
- **Portal 选装**: Hermes Nous Portal 作为可选的"一站式订阅"入口
- **本地模型**: 保留 Terax 的 Ollama/LM Studio/MLX，增加 Hermes 的 vLLM 支持
- **实现方式**: `ProviderRouter` 服务 — 先匹配 Portal，再 SDK 路由，再本地，再自定义端点

### 2.2 Agent 系统 — OpenCode 架构 + Hermes 学习 + Terax 编排

| 项目 | Primary Agent | Subagent | 学习能力 | 外部代理 |
|------|:-----------:|:--------:|:--------:|:--------:|
| Terax | 1 (内置) | 4 (explore/review/security/general) | ❌ | ✅ 编排6种 |
| OpenCode | **2** (Build+Plan) | **3+3隐藏** (General/Explore/Scout) | ❌ | ❌ |
| Hermes | 1 (内置) | RPC生成 | ✅ **自进化** | ❌ |

**融合策略**:
```
Terax 编排层 + OpenCode 双Agent + @mention + Hermes 学习循环
```
- **Primary Agents**: OpenCode 的 **Build + Plan** 双模式，Tab 切换
- **Subagents**: OpenCode 的 @mention 系统 + Terax 的代码审查/安全审计
  - `@explore` / `@review` / `@security` / `@scout` / `@general`
  - Agent 配置继承 OpenCode 的 JSON/MD 格式
- **外部代理**: 保留 Terax 的 Claude/Codex/Gemini/OpenCode/Grok 检测 + OSC 777
- **学习循环**: 在每个轮次后注入 Hermes 的 `spawn_background_review()`
  - 分叉代理 → 创建/优化技能 → 更新记忆 → 写入 FTS5
- **Managed Agent**: Terax 的 Claude Code 编排 + 自动审阅循环

### 2.3 工具系统 — 四路合并

| 域 | Terax | Grok | OpenCode | Hermes |
|----|:----:|:----:|::-------:|:------:|
| 文件操作 | ✅ r/w/edit | ✅ r/w/edit | ✅ r/w/patch | ✅ r/w/patch |
| 搜索 | ✅ grep/glob | ✅ grep | ✅ grep/glob | ✅ search_files |
| Shell | ✅ bash/background | ✅ bash | ✅ bash | ✅ terminal/process |
| Web | ❌ | ✅ search/fetch | ✅ search/fetch | ✅ search/extract |
| Git | ✅ 可视化 | ✅ git status | ❌ | ❌ |
| LSP | ⚠️ 骨架 | ✅ lsp | ✅ lsp | ❌ |
| 记忆 | ❌ | ✅ memory | ❌ | ✅ memory/session_search |
| 技能 | ❌ | ❌ | ✅ skill | ✅ skills 全套 |
| 图像 | ❌ | ✅ gen/edit | ❌ | ✅ gen/analyze |
| 视频 | ❌ | ✅ gen/edit | ❌ | ✅ gen |
| Cron | ❌ | ❌ | ❌ | ✅ cronjob |
| 浏览器 | ❌ | ❌ | ❌ | ✅ 完整浏览器控制 |
| 委派 | ❌ | ✅ task | ❌ | ✅ delegate_task |
| 协作 | ❌ | ❌ | ❌ | ✅ send_message |

**融合策略**: **分层合并，按需加载**

| 层 | 内容 | 来源 | 加载策略 |
|----|------|------|---------|
| **Core** | read_file, edit, write, grep, glob, bash | 全部 | 始终加载 |
| **VCS** | git status/diff/stage/commit/log | Terax | 仅 Git 项目 |
| **LSP** | lsp_diagnostics/definition/references | OpenCode | 有 LSP 时 |
| **Web** | web_search, web_fetch | OpenCode+Grok | 按需 |
| **Memory** | memory_add, session_search | Hermes | 始终加载 |
| **Skills** | skill_list, skill_view, skill_manage | Hermes | 始终加载 |
| **Image** | image_gen, image_edit | Grok+Hermes | 有 Provider 时 |
| **Cron** | cron_create, cron_list, cron_delete | Hermes | 始终加载 |
| **Browser** | browser_navigate/click/type/scroll | Hermes | 按需 |
| **Delegation** | delegate_task, execute_code | Hermes | 始终加载 |

### 2.4 权限与安全 — 三层合一

| 层 | Terax | OpenCode | Grok | 融合方案 |
|---|:-----:|:--------:|:----:|---------|
| **路径安全** | 50+正则+两阶段+规范化 | — | — | ✅ 保留 Terax |
| **Shell 安全** | 控制字符+双向覆盖+rm -rf | — | bash splitting | ✅ 合并 |
| **工具审批** | needsApproval true/false | allow/ask/deny | Decision enum | ✅ 采用 OpenCode 三级模型 |
| **粒度权限** | — | per-agent + glob 模式 | per-tool + per-client | ✅ 采用 OpenCode |
| **沙箱** | — | — | Landlock/Seatbelt/bwrap | ✅ 保留 Grok |
| **密钥** | OS Keychain | — | 配置文件 | ✅ 保留 Terax |
| **网络代理** | DNS分类+IP固定+CRLF防护 | — | — | ✅ 保留 Terax |

**融合后的权限体系**:
```
用户请求
  ↓
[1] 网络层安全 (Terax net.rs)
    - DNS 分类 + IP 固定防 rebinding + CRLF 注入防护
  ↓
[2] Agent 权限 (OpenCode 三级 + glob)
    - per-agent: read/edit/bash/task/memory/cron
    - allow/ask/deny
    - glob 模式匹配: "git *": "ask"
  ↓
[3] 工具安全 (Terax security.ts)
    - 路径安全守卫 (50+ 模式)
    - Shell 命令守卫 (rm/curl|sh/unicode)
    - read-before-edit 不变式
  ↓
[4] 沙箱执行 (Grok sandbox)
    - Off/Workspace/Devbox/ReadOnly/Strict
    - Linux Landlock + macOS Seatbelt + bwrap 回退
  ↓
[5] 审批 UI
    - 卡片显示详细信息
    - 记忆选择 (always/once/reject)
```

### 2.5 会话与记忆 — Hermes + Terax 融合

| 特性 | Terax | Hermes | 融合方案 |
|------|:-----:|:------:|---------|
| 持久化 | tauri-plugin-store | SQLite | ✅ Terax + Hermes SQLite |
| 压缩 | token 预算渐进式 | 上下文压缩 | ✅ 合并两种算法 |
| 跨会话搜索 | ❌ | **FTS5** | ✅ 注入 Hermes FTS5 |
| 记忆系统 | ❌ | **MEMORY.md + USER.md** | ✅ 冻结快照模式 |
| 用户建模 | ❌ | **Honcho** | ✅ 可选 |
| 技能创建 | ❌ | **后台回顾** | ✅ 核心差异化 |
| 会话分享 | ❌ | ❌ | ❌ (OpenCode 特性) |
| 多会话并行 | ❌ | ❌ | ✅ 采用 OpenCode |

**融合架构**:
```
┌─────────────────────────────────────────────┐
│                 Memory Layer                  │
│                                               │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 会话存储       │  │ 技能存储              │  │
│  │ (SQLite + FTS5)│  │ (FTS5 + filesystem)  │  │
│  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 用户画像       │  │ 记忆文件              │  │
│  │ (Honcho)      │  │ (MEMORY.md+USER.md)  │  │
│  └──────────────┘  └──────────────────────┘  │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │        学习引擎 (Background Review)       │ │
│  │ 每轮次后分叉代理 → 创建/优化技能→更新记忆  │ │
│  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 2.6 LSP 系统 — OpenCode + Terax 骨架

| 特性 | Terax | OpenCode | 融合方案 |
|------|:-----:|:--------:|---------|
| LSP 预设 | `LSP_PRESETS` | 61种定义 | ✅ 合并 |
| 自动安装 | ❌ | **自动下载** | ✅ 核心特性 |
| 自动匹配 | 基础 | 按扩展名 | ✅ OpenCode 逻辑 |
| 注入 AI | ❌ | 诊断→AI | ✅ |
| Rust 实现 | ✅ JSON-RPC framing | — | ✅ 保留 Terax |
| 前端面板 | ❌ | ❌ | ✅ 新增 (Terax 风格) |

**融合**: 将 OpenCode 的 LSP 自动发现/安装逻辑用 TypeScript 移植到 Terax 前端层，通过 Terax 已有的 `src/modules/lsp/` 路径。Rust 层的 `src-tauri/src/modules/lsp/` 作为 JSON-RPC 传输层。

### 2.7 协议层 — Grok 为主

| 协议 | 用途 | 来源 | 实施 |
|------|------|:----:|------|
| **ACP** | 编辑器嵌入 | Grok | Rust 实现，作为可选特性 |
| **MCP** | 工具扩展 | Grok+OpenCode+Hermes | Rust MCP Client |
| **OSC 777** | 代理检测 | Terax | Rust PTY filter |
| **Hermes Gateway** | 消息平台 | Hermes | 独立进程 (可选) |

### 2.8 工程与部署

| 特性 | Terax | Grok | OpenCode | Hermes | 融合 |
|------|:-----:|:----:|:--------:|:------:|------|
| 构建工具 | Vite 8 | Cargo | Turborepo | setuptools | **保留 Vite + Cargo** |
| 包管理器 | pnpm | Cargo | Bun | uv | **保留 pnpm + Cargo** |
| 惰性依赖 | ❌ | — | — | ✅ 精确锁定 | **采用 Hermes 策略** |
| 企业配置 | ❌ | ✅ release-dist | ✅ enterprise | ❌ | **Grok + OpenCode** |
| 死代码检测 | knip | — | — | — | **保留 knip** |
| 性能分析 | react-scan | dhat-heap | — | — | **保留** |

---

## 三、架构蓝图

### 3.1 总体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Terax-Super Application                           │
│                    (Tauri 2 + Rust + TypeScript + React 19)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Presentation Layer (React 19)                   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │  │
│  │  │ Terminal  │ │  Editor  │ │   Git    │ │  Web     │ │  Memory  │  │  │
│  │  │ (xterm.js│ │(CodeMirror│ │ (Commit   │ │ Preview  │ │  Panel   │  │  │
│  │  │ +WebGL)  │ │ 6 + LSP) │ │  Graph)   │ │(WebView) │ │ (FTS5)   │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │  │
│  │  │ Composer │ │  Sidebar  ││ StatusBar │ │  Skills Hub /       │  │  │
│  │  │ (AI Bar) │ │  (Explore│ │ + Agent   │ │  Plugin Manager UI  │  │  │
│  │  │          │ │  /SCM/   │ │  Indicator│ │                      │  │  │
│  │  │          │ │  Memory) │ │           │ │                      │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Agent Orchestration Layer (TS)                    │  │
│  │                                                                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │  │
│  │  │  Build Agent  │  │   Plan Agent │  │  Subagent Dispatcher    │   │  │
│  │  │  (full access)│  │  (read-only) │  │  @mention → Agent       │   │  │
│  │  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘   │  │
│  │         │                 │                       │                   │  │
│  │  ┌──────┴─────────────────┴───────────────────────┴──────────────┐  │  │
│  │  │                    Agent Runtime (TS/Rust)                     │  │  │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────────┐   │  │  │
│  │  │  │Context  │ │Tool    │ │Memory  │ │Learning│ │Permission │   │  │  │
│  │  │  │Manager  │ │Engine  │ │System  │ │Engine  │ │System     │   │  │  │
│  │  │  └────────┘ └────────┘ └────────┘ └────────┘ └───────────┘   │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    AI Abstraction Layer (TS)                          │  │
│  │  ┌────────────────────────────────────────────────────────────┐      │  │
│  │  │  ProviderRouter: Terax(13) + OpenCode(20+) + Portal(300+)  │      │  │
│  │  │  → Cloud SDKs → Local Models → Custom Endpoints → Portal   │      │  │
│  │  └────────────────────────────────────────────────────────────┘      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Backend Layer (Rust + Tauri 2)                   │  │
│  │                                                                       │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │  │
│  │  │ PTY    │ │ Git    │ │ LSP    │ │ FS     │ │ Net    │ │Secret  │ │  │
│  │  │ Engine │ │ Engine │ │ Engine │ │ Engine │ │ Proxy  │ │ Store  │ │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────────────┐ │  │
│  │  │Memory  │ │ Skills │ │ Sandbox│ │Check-  │ │ Remote Backends   │ │  │
│  │  │(FTS5)  │ │ Engine │ │ Engine │ │point   │ │(Docker/SSH/Modal) │ │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Optional Extensions (Plugin)                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │  │
│  │  │ ACP      │ │ MCP      │ │ Gateway  │ │ Cron     │ │ Skills   │  │  │
│  │  │ Server   │ │ Client   │ │ (Telegram│ │ Engine   │ │ Hub      │  │  │
│  │  │          │ │          │ │ /Discord)│ │          │ │          │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 模块关系图

```
src/ (TypeScript/React)
├── modules/
│   ├── ai/               ← AI 核心 (大幅重构)
│   │   ├── agents/       ← Build/Plan/Subagent (+Terax原有+OpenCode @mention)
│   │   ├── tools/        ← 合并四项目的工具集 (+lsp/memory/skill/cron/browser)
│   │   ├── lib/          ← 核心逻辑 (大幅扩展)
│   │   │   ├── security.ts    ← Terax原有多层安全 (+OpenCode权限)
│   │   │   ├── memory.ts      ← 新增: FTS5记忆系统 (Hermes)
│   │   │   ├── skills.ts      ← 新增: 技能系统 (Hermes)
│   │   │   ├── learning.ts    ← 新增: 后台回顾/学习循环 (Hermes)
│   │   │   ├── lsp-bridge.ts  ← 新增: LSP→AI桥接 (OpenCode)
│   │   │   ├── provider.ts    ← 扩展: ProviderRouter (Terax+OpenCode)
│   │   │   └── permissions.ts ← 新增: 三级权限+glob (OpenCode)
│   │   ├── store/        ← 状态管理 (扩展)
│   │   │   ├── chatStore.ts   ← Terax原有 + PlanAgent状态
│   │   │   ├── planStore.ts   ← Terax原有
│   │   │   ├── memoryStore.ts ← 新增: 记忆面板状态
│   │   │   └── skillsStore.ts ← 新增: 技能中心状态
│   │   └── components/   ← UI组件 (扩展)
│   │       ├── AiChat.tsx            ← 扩展: 双Agent切换
│   │       ├── AgentSwitcher.tsx     ← 新增: Build/Plan/Subagent选择器
│   │       ├── PlanDiffReview.tsx    ← Terax原有
│   │       ├── MemoryPanel.tsx       ← 新增: 记忆浏览+FTS5搜索
│   │       ├── SkillsHub.tsx         ← 新增: 技能市场
│   │       └── LearningGraph.tsx     ← 新增: 学习可视化
│   ├── agents/           ← 外部代理管理 (增强)
│   │   ├── lib/          ← 扩展: +OpenCode/Grok检测
│   │   ├── store/        ← 扩展: +Managed Agent状态
│   │   └── components/   ← 扩展: +Agent仪表盘
│   ├── terminal/         ← Terax原有 (增强)
│   │   ├── panes/        ← 分栏系统 (扩展: +远程后端选择)
│   │   └── block/        ← 块模式 (增强)
│   ├── editor/           ← Terax原有 (增强)
│   │   └── lsp/          ← 扩展: +LSP诊断面板 (OpenCode)
│   ├── lsp/              ← 新增: LSP管理面板 (OpenCode移植)
│   ├── memory/           ← 新增: 记忆UI面板 (Hermes移植)
│   ├── skills/           ← 新增: 技能管理UI (Hermes移植)
│   ├── git-history/      ← Terax原有
│   ├── source-control/   ← Terax原有
│   ├── settings/         ← 扩展: +ProviderRouter/权限/LSP/远程后端/沙箱
│   ├── theme/            ← Terax原有
│   ├── workspace/        ← Terax原有 (扩展: +远程工作区)
│   └── collaboration/    ← 新增: 会话分享/Slack (OpenCode+Hermes)
├── components/           ← 共享组件 (扩展)
│   ├── ui/               ← Radix UI 原语
│   └── agent/            ← Agent相关组件

src-tauri/src/ (Rust)
├── modules/
│   ├── pty/              ← Terax原有 (+远程后端抽象)
│   ├── git/              ← Terax原有
│   ├── fs/               ← Terax原有
│   ├── shell/            ← Terax原有 (+沙箱集成)
│   ├── lsp/              ← 增强: JSON-RPC + 自动安装 (OpenCode)
│   ├── memory/           ← 新增: FTS5引擎 (Hermes/Rust重写)
│   ├── skills/           ← 新增: 技能存储/检索 (Hermes移植)
│   ├── sandbox/          ← 新增: 沙箱 (Grok移植)
│   ├── checkpoint/       ← 新增: 检查点 (Grok移植)
│   ├── cron/             ← 新增: 定时任务 (Hermes移植)
│   ├── backend/          ← 新增: 远程后端连接器 (Hermes)
│   ├── agent_learn.rs    ← 新增: 后台回顾/学习循环 (Hermes移植)
│   ├── secret.rs         ← Terax原有 (扩展: +多Provider)
│   ├── acp.rs            ← 新增: ACP Server (Grok移植)
│   ├── mcp.rs            ← 新增: MCP Client (Grok移植)
│   └── gateway_bridge.rs ← 新增: 消息网关桥接 (Hermes)
├── lib.rs
└── main.rs
```

### 3.3 数据流架构

```
用户输入 → Composer → [Agent Runtime]
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
              [Build Agent]       [Plan Agent]         [External Agent]
                    │                    │                    │
                    ▼                    ▼                    ▼
              [Permission Check]   [Deny Write]        [OSC 777 Hook]
                    │                                        │
                    ▼                                        ▼
              [Tool Engine]           ┌───────────────────────┘
                    │                  │
        ┌───────────┼───────────┐     │
        ▼           ▼           ▼     │
    [Local FS]  [Remote Backend] [Memory]  ← [Background Review]
        │           │           │     │         │
        ▼           ▼           ▼     ▼         ▼
    [Sandbox]   [SSH/Docker]  [FTS5]     [Skill Creation]
        │           │           │              │
        ▼           ▼           ▼              ▼
    [File System]  [Docker]  [SQLite]     [Skills Hub]

← → [Checkpoints] 实时快照/回滚
← → [LSP Engine]  符号/诊断/引用
← → [Provider Router]  33+ AI 模型
```

---

## 四、实施路线图

### Phase 1: 基础融合 (8-10周) — 核心骨架

**目标**: 以 Terax 为基底，注入 OpenCode 的 Agent 架构 + 权限系统

| 周次 | 模块 | 工作内容 | 产出 |
|:---:|------|---------|------|
| 1-2 | **Agent 系统重构** | 实现 Build/Plan 双 Agent 模式 | `src/modules/ai/agents/` |
| | | 添加 @mention 子代理调用 | `runSubagent.ts` 增强 |
| | | Plan Agent 只读权限实现 | `permissions.ts` |
| | | Tab 键切换 Build/Plan | `AgentSwitcher.tsx` |
| 3-4 | **权限系统** | 实现 allow/ask/deny 三级 | `permissions.ts` |
| | | glob 模式匹配 + findLast | `wildcard.ts` |
| | | 权限持久化记忆 | 集成 `tauri-plugin-store` |
| | | Agent 配置 JSON/MD 格式 | `config.ts` 扩展 |
| 5-6 | **LSP 集成** | OpenCode LSP 定义移植 | `lsp/presets.ts` |
| | | LSP 自动发现/安装逻辑 | TS 层实现 |
| | | LSP→AI 诊断注入 | `lsp-bridge.ts` |
| | | LSP 状态面板 | `editor/lsp/` |
| 7-8 | **Provider 扩展** | 合并 OpenCode 20+ SDK | `provider.ts` |
| | | ProviderRouter 服务 | 统一路由 + 优先级 |
| | | 模型能力评分更新 | `config.ts` |
| 9-10 | **集成测试** | 全流程测试 + Bug 修复 | 稳定 Phase 1 |
| | | 性能调优 | |

**Phase 1 交付物**: 可切换 Build/Plan 模式的桌面 IDE，@mention 子代理，LSP 感知，33+ AI 提供商路由

---

### Phase 2: 记忆与学习 (10-12周) — 核心差异化

**目标**: 注入 Hermes Agent 的自进化学习循环

| 周次 | 模块 | 工作内容 | 来源 |
|:---:|------|---------|:----:|
| 1-3 | **FTS5 记忆引擎** | Rust 实现 FTS5 全文搜索 + CJK 分词 | Hermes → Rust |
| | | SQLite 会话存储 (合并 Terax 的 LazyStore) | Terax + Hermes |
| | | 跨会话 recall API | Hermes |
| | | 记忆面板 UI (搜索/浏览) | 新增 |
| 4-6 | **技能系统** | 技能格式设计 (MD + frontmatter) | Hermes |
| | | skill_manage 工具 (CRUD) | Hermes → TS |
| | | 技能自动创建 (后台回顾核心) | Hermes |
| | | 技能自改进 (使用统计 + 优化提示) | Hermes |
| | | Skills Hub 市场 UI | 新增 |
| 7-8 | **后台回顾** | spawn_background_review 分叉代理 | Hermes → Rust/TS |
| | | 轮次后触发逻辑 | Agent Runtime |
| | | 压缩摘要传递 | Hermes |
| | | Curator 技能养护 (周期7天) | Hermes |
| 9-10 | **用户建模** | Honcho 集成 (可选) | Hermes |
| | | 用户画像文件 (USER.md) | Hermes |
| | | 记忆冻结快照模式 | Hermes |
| | | Periodic Nudge 提醒 | Hermes |
| 11-12 | **集成测试** | 端到端学习循环测试 | |
| | | 性能测试 (FTS5 查询延迟) | |
| | | 记忆/技能 UI 完善 | |

**Phase 2 交付物**: 能从经验中学习的 Agent — 自动创建技能、跨会话记忆、越用越聪明

---

### Phase 3: 协议与安全 (8-10周) — 企业级能力

**目标**: 注入 Grok Build 的 ACP/MCP + 沙箱 + Checkpoint

| 周次 | 模块 | 工作内容 | 来源 |
|:---:|------|---------|:----:|
| 1-2 | **MCP Client** | Rust 实现 MCP 传输层 (stdio/HTTP/SSE) | Grok → Rust |
| | | 工具注册桥接 (MCP→ToolEngine) | Grok |
| | | MCP 配置 UI | 新增 |
| 3-4 | **ACP Server** | Rust ACP 实现 (嵌入编辑器) | Grok → Rust |
| | | ACP ↔ Agent Runtime 桥接 | |
| | | 编辑器扩展 (VS Code 等) | |
| 5-6 | **沙箱系统** | 移植 Grok sandbox crate | Grok → Rust |
| | | Landlock (Linux) + Seatbelt (macOS) | Grok |
| | | bwrap 回退 + Windows 隔离 | 新增 |
| | | 沙箱配置 UI (Off/Workspace/Strict) | 新增 |
| 7-8 | **Checkpoint** | 快照/回滚机制移植 | Grok → Rust |
| | | 文件系统重难点 + 差异计算 | Grok |
| | | Checkpoint 管理 UI | 新增 |
| 9-10 | **安全整合** | 三层安全体系联调 | |
| | | 渗透测试 | |
| | | 企业编译配置 | Grok |

**Phase 3 交付物**: 企业级安全沙箱、可嵌入编辑器、标准化协议

---

### Phase 4: 多平台与协作 (8-10周) — 生态扩张

**目标**: 注入 Hermes 多后端 + 消息网关 + Cron

| 周次 | 模块 | 工作内容 | 来源 |
|:---:|------|---------|:----:|
| 1-2 | **远程后端** | BackendConnector trait 设计 | Hermes |
| | | Docker 后端集成 | Hermes |
| | | SSH 后端 (ControlMaster) | Hermes |
| 3-4 | **云后端** | Modal 无服务器集成 | Hermes |
| | | Daytona 集成 | Hermes |
| | | 文件同步 (FileSyncManager) | Hermes |
| 5-6 | **Cron 引擎** | Rust cron 调度器实现 | Hermes → Rust |
| | | 蓝图自动化 (技能→cron) | Hermes |
| | | 跨平台投递 (桌面/邮件) | 新增 |
| | | Cron UI (任务管理面板) | 新增 |
| 7-8 | **网关** | 消息网关核心 (独立进程) | Hermes |
| | | Telegram/Discord Bridge | Hermes |
| | | Slack 集成 | Hermes + OpenCode |
| 9-10 | **协作** | 会话分享 (链接/快照) | OpenCode |
| | | 团队工作区 | 新增 |
| | | 集成测试 + 文档 | |

**Phase 4 交付物**: 可在本地/SSH/Docker/云端运行的分布式 AI 助手

---

### Phase 5: 生态平台 (持续)

**目标**: Skills Hub + Plugin 市场 + Enterprise

| 特性 | 工作内容 | 来源 |
|------|---------|------|
| **Skills Hub** | 社区技能市场 + 安装/管理 | Hermes |
| **Plugin SDK** | 第三方插件开发套件 (Effect+Promise双API) | OpenCode |
| **Web App** | 浏览器版 (SolidJS) | OpenCode |
| **Enterprise** | SSO/审计日志/合规 | OpenCode+Grok |
| **LSP 自动安装** | 61种 LSP 零配置体验 | OpenCode |
| **多语言文档** | 翻译 22+ 语言 | OpenCode |

---

## 五、技术选型详解

### 5.1 为什么以 Terax 为蓝本？

| 原因 | 说明 |
|------|------|
| **桌面原生体验** | Tauri 2 是唯一提供原生桌面窗口的方案，其他三项目无桌面/仅 BETA |
| **编辑器** | CodeMirror 6 是唯一真正的内置代码编辑器 |
| **模块化架构** | Rust 后端模块化良好，`modules/` 目录清晰 |
| **隐私第一** | 无遥测 + OS Keychain + 路径安全 = 企业合规基础 |
| **轻量** | 7-8MB 的起点，有扩展空间 |
| **Terminal + GUI 融合** | xterm.js WebGL + React UI = 最佳终端体验 |

### 5.2 融合取舍原则

| 原则 | 说明 |
|------|------|
| **按需加载** | 重量级功能插件化 (ACP/Gateway/Sandbox)，不拖累核心 |
| **Rust 重写 Python** | Hermes 的 Python 核心逻辑 → Rust 重写 (安全/性能) |
| **TS 桥接非重写** | OpenCode 的 TS 逻辑直接移植/桥接 (同语言) |
| **避免过度抽象** | 不复制 OpenCode 的 30+ 包 monorepo，保持单包 + 插件 |
| **渐进式交付** | 5 个 Phase 独立可发布，每个都是可用的 |

### 5.3 不引入的架构决策

| 放弃特性 | 原因 | 替代方案 |
|---------|------|---------|
| OpenCode Effect-ts | 全栈 Effect Schema 改造成本极高 | 仅在插件系统使用 |
| OpenCode Event Sourcing | 与现有 tauri-plugin-store 冲突 | 保留现有存储 + FTS5 |
| Grok 单进程主架构 | 与 Tauri 桌面架构不兼容 | 保留 Tauri 进程模型 |
| Hermes AST 注册 | Python 特有的动态特性 | 使用 TS 装饰器 + 静态注册 |
| Hermes 全量消息网关 | 桌面应用场景有限 | 作为可选插件发布 |

---

## 六、风险矩阵

| 风险 | 影响 | 概率 | 缓解 |
|------|:----:|:----:|------|
| FTS5 移植失败 | 记忆系统不可用 | 中 | 先用 SQLite LIKE 过渡 |
| 学习循环延迟高 | 用户体验下降 | 高 | 分叉代理走辅助模型，后台执行 |
| 沙箱兼容性 | Linux/macOS/Windows 不一致 | 高 | 平台分级支持，Windows 降级 |
| 包体积膨胀 | 从 7MB 到 50MB+ | 中 | 惰性加载 + 插件化 |
| 社区贡献冲突 | 与上游 Terax 分支分歧 | 中 | 保持 API 兼容性，贡献补丁回上游 |
| ACP 协议依赖 | xAI 可能变更协议 | 低 | 协议适配层隔离 |
| 技能 Hub 冷启动 | 发布时无内容 | 中 | 预制 20+ 官方技能 |

---

## 七、竞争定位

### 7.1 市场定位矩阵

```
                桌面 IDE
                   │
                   │
        Terax      │  Terax-Super (目标)
        (8.7k)     │  [这将是唯一一个同时具备五维能力的工具]
                   │
   ────────────────┼────────────────▶  Agent 能力
                   │
        OpenCode   │
        (190k)     │  Grok Build (22.6k)
                   │
                   │  Hermes Agent (220k)
                   │
                终端 TUI
```

### 7.2 竞争对手能力覆盖

| 能力 | Terax | Grok | Open | Hermes | **Terax-Super** |
|------|:----:|:----:|:----:|:------:|:--------------:|
| 桌面原生 | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| 代码编辑器 | ✅ | ❌ | ❌ | ❌ | ✅ |
| 多 AI 提供商 | 13 | 1 | 20+ | 300+ | **33+ Core** |
| 本地模型 | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| 双 Agent | ❌ | ❌ | ✅ | ❌ | ✅ |
| 子代理 @mention | ❌ | ❌ | ✅ | ✅ | ✅ |
| 自进化学习 | ❌ | ❌ | ❌ | ✅ | ✅ |
| FTS5 记忆 | ❌ | ❌ | ❌ | ✅ | ✅ |
| LSP 感知 | ⚠️ | ❌ | ✅ | ❌ | ✅ |
| 沙箱 | ❌ | ✅ | ❌ | ❌ | ✅ |
| ACP/MCP | ❌ | ✅ | ⚠️ | ⚠️ | ✅ |
| 多终端后端 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 消息网关 | ❌ | ❌ | ✅ | ✅ | ✅ |
| Cron 调度 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 隐私/无遥测 | ✅ | ❌ | ❌ | ❌ | ✅ |
| Skills Hub | ❌ | ❌ | ❌ | ✅ | ✅ |
| 企业版 | ❌ | ✅ | ✅ | ❌ | ✅ |
| Git 提交图 | ✅ | ❌ | ❌ | ❌ | ✅ |

### 7.3 核心竞争壁垒

1. **学习循环** (Hermes 独有) — 首个内置"从经验中学习"能力的桌面 IDE
2. **隐私 + AI** (Terax 独有) — 唯一在企业合规环境中能使用的 AI 编码工具
3. **桌面 + 终端 + 编辑器** — 唯一三位一体的产品形态
4. **生态兼容** — 同时兼容 ACP/MCP/Hermes 三种生态

---

## 八、关键指标 (OKR)

| 指标 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|:-------:|:-------:|:-------:|:-------:|:-------:|
| 代码行数 (Rust) | 25k | 40k | 60k | 80k | 100k |
| 代码行数 (TS) | 120k | 180k | 220k | 280k | 350k |
| 磁盘体积 | ~15MB | ~25MB | ~35MB | ~40MB | ~50MB |
| AI 提供商 | 33+ | 33+ | 33+ | 33+ | 33+ |
| Agent 数量 | 2+4 | 2+6 | 2+6 | 2+6 | 2+6+S |
| 工具数量 | 25 | 35 | 40 | 50+ | 60+ |
| 操作系统 | Win/Mac/Linux | +WSL | +Docker | +SSH/Cloud | 全 |
| 外部贡献 | 0 | 5+ | 20+ | 50+ | 100+ |
| GitHub Stars | →15k | →30k | →50k | →80k | →120k |

---

## 九、总结

**Terax-Super** 项目的核心价值主张:

> **唯一的桌面原生 AI IDE，融合了 OpenCode 的 Agent 架构、Hermes 的进化学习、Grok 的企业安全**

它不是四个项目的简单拼凑，而是以 Terax 的"桌面原生 + 终端 + 编辑器 + 隐私安全"为骨架，注入：

1. **OpenCode 的灵魂** — Build/Plan 双 Agent + 粒度权限 + LSP 感知 + @mention 生态
2. **Hermes 的大脑** — 自进化学习 + 跨会话记忆 + 技能系统 + 多平台连接
3. **Grok 的铠甲** — 沙箱 + Checkpoint + ACP/MCP 协议 + 企业配置

5 个 Phase 独立可交付，每个 Phase 都是一个可用的产品。从 Phase 1 的"更好的 Terax"开始，逐步演进到 Phase 5 的"AI 超级平台"。
