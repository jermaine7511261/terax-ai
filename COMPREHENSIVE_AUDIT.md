# 四项目全方位审计报告

> 逐项核对 Terax AI / Grok Build / OpenCode / Hermes Agent 全部功能

---

## Terax AI 骨架（22 模块 — 100% 保留）

| # | 模块 | 路径 | 状态 |
|:-:|------|------|:----:|
| 1 | PTY 会话管理 | `src-tauri/src/modules/pty/` | ✅ 原生 |
| 2 | Shell 命令执行 | `src-tauri/src/modules/shell/` | ✅ 原生 |
| 3 | 文件系统 | `src-tauri/src/modules/fs/` | ✅ 原生 |
| 4 | Git 操作 | `src-tauri/src/modules/git/` | ✅ 原生 |
| 5 | LSP JSON-RPC 引擎 | `src-tauri/src/modules/lsp/` | ✅ 原生 |
| 6 | HTTP 安全代理 | `src-tauri/src/modules/net.rs` | ✅ 原生 |
| 7 | OS Keychain | `src-tauri/src/modules/secrets.rs` | ✅ 原生 |
| 8 | 工作区授权/WSL | `src-tauri/src/modules/workspace.rs` | ✅ 原生 |
| 9 | 外部代理检测 | `src-tauri/src/modules/agent.rs` | ✅ 原生 |
| 10 | Shell 历史 | `src-tauri/src/modules/history/` | ✅ 原生 |
| 11 | 进程管理 | `src-tauri/src/modules/proc/` | ✅ 原生 |

## Grok Build（3 项采用 — 15 项排除）

### ✅ 已实现
| 模块 | 路径 | 说明 |
|------|------|------|
| MCP 协议 | `src-tauri/src/modules/mcp/` | rmcp crate 管理器 |
| 沙箱 (4 级) | `src-tauri/src/modules/sandbox/` | Off/Workspace/Strict/ReadOnly |
| Checkpoint | `src-tauri/src/modules/checkpoint/` | 文件快照/回滚 |

### ❌ 明确排除（TUI 代理实现细节，桌面 IDE 不适用）
| 模块 | 原因 |
|------|------|
| codebase-graph | 代码图谱 — LSP 已覆盖 |
| crash-handler | 崩溃处理 — 桌面非核心 |
| fast-worktree | 快速文件检测 — 低优先级 |
| hunk-tracker | 变更追踪 — Checkpoint 已覆盖 |
| grok-sampler | LLM 采样 — Vercel AI SDK 已覆盖 |
| grok-pager | TUI 渲染 — 桌面 GUI 不适用 |
| grok-voice | 语音 — Terax 已有 STT |
| grok-auth | 认证 — 桌面无此需求 |
| grok-telemetry | 遥测 — 隐私优先不采纳 |
| computer-hub | 屏幕控制 — 桌面不适用 |
| circuit-breaker | 熔断器 — 低优先级 |
| tool-runtime | 工具运行时 — Vercel AI SDK 已覆盖 |
| mermaid | 图表渲染 — 桌面非核心 |
| update | 自动更新 — Terax 已有 |
| workflow | 工作流引擎 — 未采纳 |

## OpenCode Agent（6 项采用 — 14 项排除）

### ✅ 已实现
| 模块 | 路径 | 说明 |
|------|------|------|
| 双 Agent + @mention | `src/modules/ai/agents/registry.ts` | Build/Plan + 5 个子代理 |
| 三级权限系统 | `src/modules/ai/lib/permissions.ts` | allow/ask/deny + glob |
| Agent 配置格式 | `src/modules/ai/lib/agentConfig.ts` | JSON/Markdown frontmatter |
| LSP 60+ 预设 | `src/modules/lsp/lib/presets.ts` | 全部语言覆盖 |
| LSP 自动安装 | `src/modules/lsp/lib/autoInstall.ts` | 检测 + 安装逻辑 |
| LSP→AI 诊断桥接 | `src/modules/ai/lib/lsp-bridge.ts` | 错误注入 Agent 上下文 |

### ❌ 明确排除（SaaS/云端/架构不兼容）
| 模块 | 原因 |
|------|------|
| server | HTTP API 服务 — SaaS 不采纳 |
| console | 管理控制台 — SaaS 不采纳 |
| enterprise (SSO/审计) | 已实现后移除 — 桌面 IDE 非核心 |
| slack | SaaS 集成 — 不采纳 |
| containers | 容器部署 — 不采纳 |
| sdk | 发布 SDK — 桌面产品无此需求 |
| protocol | HTTP API 协议 — 不采纳 |
| identity | 身份认证 — 桌面无此需求 |
| stats | 使用统计 — SaaS 不采纳 |
| http-recorder | HTTP 录制 — 测试工具 |
| function | Cloudflare Workers — SaaS |
| script | 构建脚本 — 自建 |
| session-ui | SolidJS UI — 架构不兼容 |
| sst | 基础设施部署 — SaaS |

## Hermes Agent（15 项 Rust 重写 — 5 项排除）

### ✅ 已实现（Rust 重写）
| # | 模块 | 路径 | 说明 |
|:-:|------|------|------|
| 1 | FTS5 记忆引擎 | `memory/` | SQLite 全文搜索 + 会话持久化 |
| 2 | 技能系统 | `skills/` | CRUD + Markdown 索引 |
| 3 | 学习循环 | `agent_learn.rs` | 后台回顾 + Curator 养护 |
| 4 | MOA 多模型聚合 | `moa/` | RoundRobin/Race/Aggregate/Cascade/Cheapest |
| 5 | 凭证池 | `credential_pool/` | Keychain/Env/File/InMemory/HTTP |
| 6 | 计费追踪 | `billing/` | 19 组定价 + 预算告警 |
| 7 | 会话压缩 | `compress.rs` | Drop/Summarize/ToolsOnly/Truncate |
| 8 | WebSocket 网关 | `gateway_ws.rs` | 长连接监听 + 消息收发 |
| 9 | Web 搜索 | `web_search.rs` | DuckDuckGo/Google/Bing/SearXNG |
| 10 | 工具守卫 | `tool_guard.rs` | 7 条规则 + Block/Flag/Approval |
| 11 | Shell 钩子 | `shell_hooks.rs` | Pre/Post/Pattern/Start/Exit |
| 12 | 错误分类 | `errors.rs` | 10 种类别 + 自动修复建议 |
| 13 | Cron 调度 | `cron/` | 自然语言 + 持久化 |
| 14 | Docker/SSH 后端 | `backend/` | Local/Docker/SSH 连接器 |
| 15 | i18n 国际化 | `src/i18n/` | 23 种语言框架 |

### ❌ 明确排除
| 模块 | 原因 |
|------|------|
| TTS 语音合成 | 低优先级 — 已有 STT 输入 |
| 图片/视频生成 | 桌面 IDE 非核心功能 |
| 轨迹压缩 | Hermes 训练专用场景 |
| Honcho 用户建模 | 高复杂度 ML 系统 |
| 完整消息推送 (15平台) | gateway_ws.rs 提供框架，具体平台适配器按需添加 |

---

## 真实未实现清单（需要决策的 Gap）

以下为通过审计识别出的、有桌面 IDE 价值的 **真正未实现** 功能：

### P1 — 高价值、中低成本
| 功能 | 来源 | 价值 | 估算工作量 |
|------|------|:----:|:----------:|
| **Agent 多会话并行管理** | OpenCode O5 | 多个独立 Agent 同时运行 | 2-3 天 |
| **持久化技能养护 (Curator 磁盘)** | Hermes | 当前只在内存运行 | 1 天 |

### P2 — 中价值、中成本
| 功能 | 来源 | 价值 | 估算工作量 |
|------|------|:----:|:----------:|
| **circuit-breaker 熔断** | Grok | API 故障自动切换 | 2 天 |
| **Hunk-level diff 追踪** | Grok | 更细粒度的变更管理 | 3 天 |
| **代码图谱 (轻量版)** | Grok | 符号索引增强 | 3-5 天 |

### P3 — 低优先级
| 功能 | 来源 | 价值 | 估算工作量 |
|------|------|:----:|:----------:|
| Telegram/Discord 实际 WebSocket Bot | Hermes | 消息推送闭环 | 3-5 天/平台 |
| TTS 语音合成 | Hermes | 无障碍体验 | 2 天 |
| 图片生成 (DALL-E/Stable Diffusion) | Hermes | 设计辅助 | 2 天 |

---

## 当前项目规模

```
Rust 模块:  29 个  (Terax 11 + Grok 3 + Hermes 15)
TS 模块:    24 个
IPC 命令:   110+ 个
测试:       39 个 (全部通过)
包体积:     ~15 MB (frontend ~1 MB gzip)
```

