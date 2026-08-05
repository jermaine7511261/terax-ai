# 路线图

Yamet 的方向、已交付内容、待办事项，以及刻意不做的事。

本文随方向演进持续更新。日常开发见 GitHub Issues 与 Projects 看板。

## Yamet 是什么

Yamet 是一个快速、轻量的 AI 原生终端（ADE，agentic development environment）。它将原生 PTY 后端与现代 UI 结合：多标签终端、内置代码编辑器、文件浏览器、源码管理，以及一等公民的 AI agent 系统（可用自有 API 密钥或完全本地模型）。磁盘占用低于 10 MB，无遥测，密钥存于系统钥匙串。

产品取向明确：终端优先、AI 作为原生能力（而非侧边栏）、始终轻量、跨平台不打折。

## Yamet 不是什么

- 不是完整 IDE 的替代品。与 VS Code / Cursor / Zed 重叠的重型 IDE 功能不在范围内。
- 不是浏览器。网页预览仅面向本地开发服务器与轻量文档查看。
- 不是通用工作区。任何把产品拖离终端优先形态的工具与格式都不在范围内。
- 不是大而全的 CLI 替代品。目标是"最好的 AI 原生终端"，而非"带附加功能的 shell"。

## 主题

以下主题框定每个范围决策。

1. **AI 作为原生能力。** agent、工具、自动补全、语音都是一等公民，而非硬加在普通终端上的面板。
2. **始终轻量。** 二进制 7-8 MB。每个依赖都要有理由。按标签执行内存预算。
3. **终端优先。** xterm.js 正确性、PTY 保真、TUI 应用兼容性不可妥协。
4. **跨平台对等。** macOS、Linux、Windows、WSL，无平台专属特权功能。
5. **默认安全。** 路径守卫、SSRF 防护、OSC 信任、IPC 沙箱。开箱即用即安全。

## 已交付

### 终端

- [x] 块终端（基于块的终端界面，带行内建议）
- [x] 终端行内建议（历史 + AI 驱动）
- [x] WebGL 渲染的多标签终端
- [x] 原生 PTY 后端（zsh、bash、pwsh、fish、cmd）
- [x] 分屏面板
- [x] Shell 集成（cwd、提示符标记）
- [x] 行内搜索、链接识别、真彩色
- [x] 带 AI 上下文脱敏的私有终端标签
- [x] 作为工作区环境的 WSL 桥

### 编辑器

- [x] 多语言支持（TypeScript / JavaScript、Rust、Python、HTML / CSS、JSON、Markdown、Go、C / C++ / Java / C#、PHP）
- [x] 行内 AI 自动补全
- [x] AI 编辑 diff
- [x] Vim 模式
- [x] 预置主题
- [x] DAP 调试器（Debug Adapter Protocol）：断点、单步、变量/调用栈、Debug 输出；debugpy/node-inspect/lldb-dap/gdb/dlv 适配器（第十一轮）

### 文件浏览器

- [x] 完整文件类型覆盖的图标主题
- [x] 模糊搜索、键盘导航、行内重命名、右键动作
- [x] 经 fs watch 的实时文件系统更新

### Git / 源码管理

- [x] 源码控制面板（暂存、提交、分支）
- [x] 带提交图的历史视图
- [x] 单文件 diff

### AI

- [x] 多家云端与本地提供商（BYOK）
- [x] 多 agent 与子 agent
- [x] 语音输入
- [x] 斜杠命令与片段
- [x] 项目记忆与按项目配置
- [x] 带审批流的工具（文件读写/编辑、bash、搜索、计划）
- [x] 工作区文件选择器
- [x] 长上下文自动压缩
- [x] 会话内首次批准后的自动批准
- [x] IM 网关：钉钉 / 飞书 / 企微 / QQ / 微信（iLink）/ 公众号适配器，认证门禁驱动 agent
- [x] MCP client：外部 MCP server（stdio / HTTP）工具接入，全部默认审批 + 脱敏
- [x] Skill 升级：snippet 工具白名单（技能限定工具回合）+ 内置 `skills/` 目录约定
- [x] 记忆增强：`list`/`delete` 工具、来源分组（tool/auto）、收尾 nudge、设置页浏览/编辑

### 网页预览

- [x] 自动识别的本地开发服务器预览
- [x] 图片与 PDF 查看器
- [x] 沙箱 iframe

### 平台集成

- [x] macOS、Linux（.deb / .rpm / AppImage）、Windows（NSIS）、WSL
- [x] AUR（Arch）
- [x] Windows 资源管理器右键集成
- [x] 自动更新
- [x] API 密钥的系统钥匙串
- [x] 无遥测

### 安全

- [x] 加固的 AI 工具面（文件系统、网络、IPC）
- [x] 出站 HTTP 的 SSRF 与 DNS 重绑定防御
- [x] 终端转义序列处理的信任门控
- [x] 沙箱化预览面
- [x] IM 网关认证门禁（默认拒绝 + 会话批准白名单）

## 规划中

### 下一批

- [x] SSH 支持（先做 PTY 认证与 known_hosts；SFTP 与端口转发后续）
- [x] 主题与个性化（UI 强调色；终端/编辑器主题 + 用户自定义快捷键已交付）
- [x] 编辑器 AI 补全改进（项目感知上下文、更低延迟）
- [x] 终端拖放（文件作为带引号路径、AI 面板作为上下文）
- [x] AI agent 元编排（Yamet agent 派发与管理外部编码 agent，如 Claude Code / OpenCode）
- [x] 更多斜杠命令与片段（`/review` `/commit` `/test` `/fix` + `#handle` 片段）
- [x] 审批流改进（会话/项目记住 + 按工具拒绝黑名单；自动批准已交付）
- [x] 持久化终端会话与布局恢复（标签/面板/spaces 布局 + 重启后恢复每标签 cwd）
- [x] PTY 会话恢复（第十轮 I1c）：前台进程级重连（helper 常驻进程持有 PTY，重启后 attach 既有会话；Windows ConPTY 在 helper 内）+ buffer 快照回放兜底
- [x] 预览面扩展（图片 / PDF / Markdown 处理）
- [x] 测试覆盖扩展（PTY 边界、安全函数、AI 工具守卫、IM 网关加密/状态机）
- [x] IM 网关：各平台接入/二维码打磨、公众号/企微回调隧道指南、onebot 配置助手

### 更远期

- [ ] 发布自动化（CHANGELOG、版本递增；tag 流程待办）
- [ ] 打包体积优化（语言包懒加载、UI 原语按需导入、tree-shake）
- [ ] AI 工具 / 片段作为可安装 bundle（`skills/` 目录约定 + 工具白名单已交付子集；bundle 分享留后续）

## 欢迎贡献

欢迎在这些战略方向提供帮助。先提一个方案（issue 或 Discord），再动手。

- **测试覆盖。** 各平台 PTY 边界、安全函数、AI 工具守卫。
- **打包体积优化。** 分析并提议具体依赖替换或 tree-shake 修复。
- **平台相关 bug。** 小众发行版的渲染问题、shell 怪癖、WSL 边界情况。
- **文档。** 改进、截图、示例、非英文 README 章节。（UI 已双语：简中为主 + 英文回退；欢迎非英文 README。）
- **主题。** 契合轻量美学的终端与编辑器主题、UI 强调色调色板。
- **提供商集成。** 仅在超出既有覆盖、能带来独特价值时。先论证再实现。

具体任务见 GitHub Issues 上的 `good-first-issue` 与 `help-wanted` 标签。

## 范围外

以下类别不会内置到 Yamet。此类功能请求将被关闭。

- **Notebook 与文档工作区。** 任何让 Yamet 变成文档宿主而非终端的东西。
- **包管理器与工具链 UI。** 直接在终端里用 `npm`、`pip`、`cargo` 等即可。
- **IDE 规模的扩展市场。** 未来可能做窄范围的 AI 工具/片段 bundle。任意 UI 或行为扩展不会做。
- **第三方订阅会话桥接。** 对第三方客户端而言，转发云端订阅认证（厂商管理的登录会话）在技术上不可行。

曾列为范围外的三项（超出 LSP 的重型 IDE 功能、完整浏览器功能、遥测）经维护者决定纳入第十轮，见 `docs/iteration-10-requirements.md`。其中 DAP 调试器在第十一轮交付，见 `docs/yamet-需求迭代-第十一轮-LSP-PTY-DAP-2026-08-05.md`。

## 决策权

方向与范围决策由维护者作出。受信任的审阅者（非正式，尚无固定角色）在安全、性能与平台特定领域提供意见。

若你的 PR 被关闭且有异议，请在 issue 中提出。欢迎讨论，但不接受在 PR 评论区突袭。

未来这一块会随项目成长逐步规范化。
