# 为 Yamet 贡献

Yamet 是单人维护、产品方向清晰的项目。欢迎贡献，但**方向一致比数量更重要**。

本文帮你判断*是否*以及*如何*贡献更容易被合并，让我们双方都不浪费精力。

## 项目如何运作

- Yamet 只有一名活跃维护者。
- 评审带宽有限。
- 不是每个贡献都能被接受，即使技术上正确。与项目方向的一致性和代码质量同样重要。
- 范围与方向见 [ROADMAP.md](ROADMAP.md)。动手任何非平凡改动前先读它。

这是单人项目的常态。PR 被拒不是针对个人。

## 快速开始

```bash
pnpm install
pnpm tauri dev
```

前置依赖：Rust（stable）、Node 20+、pnpm，以及你所在平台的 [Tauri 前置依赖](https://tauri.app/start/prerequisites/)。

架构与如何安全贡献见 [YAMET.md](YAMET.md) 与 [docs/ 索引](docs/README.md)。

## 在哪里讨论

设计讨论、范围疑问、"我该不该做 X"、快速反馈以及具体的 bug/功能跟踪，用 GitHub Issues。

## 什么算好贡献

这些会快速合并：

- **bug 修复**，附清晰的复现步骤。
- **文档 / 错别字 / 小 UX 修复**：直接开 PR。
- **事先讨论过的功能**：先在 issue 里对齐。
- **小而聚焦的改动**：易评审、风险低。

改动小且明显（错别字、窄 bug 修复、小文档改动）时直接开 PR，无需先开 issue。

## 保持改动聚焦

**只改达成你既定目标所需的东西。**

如果你在修 `terminal.tsx` 的 bug，不要顺便：

- 重排其他文件
- 清理无关代码
- 修你没碰过的文件里的 lint 问题
- 在同一个 PR 里混入多个无关修复

即便这些算"改进"，它们也让评审变难、拖慢一切。想清理就讨论后单独开 PR。

**一个 PR = 一个逻辑改动。** 多主题 PR 会被要求拆分。

## 先讨论（较大改动必做）

超出小修复的任何改动，**开 PR 前必须先讨论**。包括：

- 新功能
- UI/UX 改动或默认行为变更
- 重构或"清理"
- 性能重写
- 架构改动
- 任何触碰多个文件或系统的东西
- 新 AI 提供商

未经讨论就提交的大改动 PR 会在无详细评审的情况下被关闭。这不是要打击贡献，而是确保投入大量工作前先对齐方向。

10 分钟对话，胜过 500 行不符合路线图的 PR。

## 质量门槛

Yamet 自我定位为**轻量、快速、生产级**。每个 PR 都按以下标准评审：

- `pnpm lint` 干净
- `pnpm check-types` 干净
- `pnpm test` 干净
- `cargo clippy --all-targets --locked -- -D warnings` 干净
- `cargo nextest run --locked` 干净（或 `cargo test --locked`）
- 推送前 `cargo fmt`
- 已知热路径无性能回退：终端渲染、PTY 流、AI 流式、源码管理、文件浏览器
- 无未经论证的重型新依赖（客户端 bundle >50KB gzip、Rust 侧 >5MB 编译产物）
- 保持平台对等（macOS / Linux / Windows / WSL 仍然可用）
- AI 工具面、文件系统访问、网络路径、IPC 命令的改动需安全评审

不确定怎么量性能、什么算热路径，就在 issue 里问。确认比被打回强。

## 核心子系统改动必须带测试

PR 最常见的翻车方式是**局部修复 + 全局爆炸半径**：diff 解决了一个案例、读起来没问题、过了类型检查与 clippy，却在其他所有情况下悄悄弄坏同一子系统。评审发现不了，测试能。

所以，如果你的改动触碰以下任何承重路径的行为，PR 必须新增或扩展一条锁定你依赖的不变量的测试：

- **Shell/终端启动**：启动哪个 shell、用什么 cwd/env/登录标志。这里的"修复"可能让终端彻底起不来。
- **工作区授权**：spawn、git 与 AI 工具可操作的目录。允许侧与拒绝侧都要。
- **git 命令层**：仓库根解析、pathspec/参数守卫、status 解析。
- **文件系统变更**：原子写、符号链接处理、部分失败不丢数据。
- **IPC 命令面与 AI 工具面**：webview 或 agent 可调用的任何东西。
- **波及面广的纯逻辑**：cwd 继承、标签/分屏树变换、OSC/提示符解析、命令守卫。

测试的标准是真正覆盖契约，不是占位。测真正会坏的情况：边界、拒绝路径、"home 上一层会怎样"。不知道怎么写测试，就在开 PR 前先问。那场对话通常比 revert 短。

UI 渲染、主题、语法高亮表以及类型检查器已保证的东西，不需要测试。

## Yamet 不是什么

设定预期：

- Yamet 不打算成为完整 IDE 替代品（VS Code、Cursor、Zed）。
- 不构建：完整 LSP 支持、Jupyter notebook、集成调试器 UI、包管理器 UI、完整网页浏览器。
- 这不是精挑细选的"首个开源贡献"项目。欢迎新手，但按正常标准评审。
- 机械重构、大范围风格改动、路过式重写没有帮助。
- 欢迎 AI 辅助贡献，但 PR 必须体现对既有模式的理解。作者自己都没读过的低质量 AI 生成代码会被关闭。

## 分支

从 `main` 切分支。前缀用 kebab-case：

| 前缀       | 用途                                    |
| ---------- | --------------------------------------- |
| `feat/`    | 新功能                                  |
| `fix/`     | bug 修复                                |
| `chore/`   | 重构、工具、配置、依赖                  |
| `docs/`    | 仅文档改动                              |
| `perf/`    | 性能工作                                |
| `security/`| 安全修复或加固                          |

示例：`feat/split-panes`、`fix/explorer-focus`、`security/path-guard`。

不要从 fork 的 `main` 分支开 PR。在功能分支上工作。

## 提交与 PR

多数 PR 的**PR 标题会成为 squash 提交**。提交打磨良好、可分原子提交的多提交 PR 可由维护者酌情用 merge commit 合并（安全审计、多步重构）。标题必须遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(terminal): add split panes
fix(explorer): prevent input from disappearing on create
chore(deps): bump tauri to 2.x
security(ai): tighten path guard
```

类型：`feat`、`fix`、`chore`、`docs`、`perf`、`refactor`、`test`、`build`、`ci`、`security`。

常用 scope：`terminal`、`editor`、`explorer`、`pty`、`ai`、`agents`、`settings`、`tabs`、`shortcuts`、`ui`、`git`、`preview`、`windows`、`linux`、`macos`、`wsl`。

PR 内部各提交信息可自由写（会被 squash 或分组）。

**填 PR 模板。** 包括：改了什么、为什么、怎么测的。UI 改动附截图/GIF。"已手动测试……"是最低限度。

**早点开 draft PR**，想中途要反馈就开。完成后再标"Ready for review"。

### 什么更容易被合并

- 清晰的问题陈述
- 小、聚焦的 diff
- 遵循既有模式（动笔前先读 2-3 个邻近文件）
- 全部类型检查 / lint / 测试通过
- 描述你操作步骤的手动测试记录

### 什么会被打回

- 多主题 PR
- 未经讨论的大架构 PR
- 无论证的新依赖
- 无迁移说明的破坏性变更
- 与改动无关的顺手重排
- 明显没被作者读过的 AI 生成代码

## 代码风格

- 遵循既有模式。新增前先读 2-3 个邻近文件。
- TypeScript：不写 `any`，除非你确实要。严格模式已开。
- Rust：`cargo fmt` + `clippy` 干净。
- 注释：只写"为什么"，不写"是什么"。代码应自解释。不要多段 docstring。
- 代码与提交信息中无 emoji。
- 用户可见文案用简体中文（项目以中文为母语）。

## 项目布局

```text
src-tauri/                  Rust 后端
  src/
    lib.rs                  Tauri 命令注册
    modules/
      agent.rs              终端编码 agent 的 hook 安装/状态
      fs/                   文件系统命令（读/写/搜索/grep）
      git/                  源码管理命令
      history/              shell 历史集成
      mod.rs                模块导出
      net.rs                带 SSRF 守卫的 AI HTTP 代理
      proc.rs               进程工具
      pty/                  终端会话、shell 集成、DA 过滤器
      secrets.rs            系统钥匙串访问
      shell/                one-shot/会话/后台 shell 命令
      workspace.rs          WSL 桥、工作区环境、授权注册表

src/                        React 前端
  App.tsx                   顶层协调者
  components/               shadcn/ui + AI Elements
  modules/
    agents/                 agent 通知与管理
    ai/                     agent、会话、工具、提供商、composer
    command-palette/        模态命令面板与动作
    editor/                 CodeMirror 栈、AI 自动补全
    explorer/               文件树
    git-history/            git 图与历史面板
    header/                 顶栏、搜索、窗口控件
    markdown/               Markdown 预览渲染器
    preview/                开发服务器、图片、网页预览
    settings/               设置 UI 与偏好 store
    shortcuts/              按键映射注册表
    sidebar/                活动栏与侧面板
    source-control/         源码控制面板
    spaces/                 带按 space 标签持久化的工作区 spaces/项目
    statusbar/              底栏与 cwd 面包屑
    tabs/                   标签/分屏模型
    terminal/               xterm.js 会话、OSC 处理器、渲染池
    theme/                  自定义主题引擎与预设
    updater/                自动更新 UI
    workspace/              工作区环境切换
```

## 常见问题

**问：修错别字或明显 bug 前要先问吗？**
答：不用，直接开 PR。

**问：我有个新功能想法。**
答：开 GitHub issue。未经讨论不要开 PR。

**问：我的 PR 被无详细反馈关闭了。**
答：通常意味着方向不符，或范围大到无法负责任地评审。单人项目这是常态。想以更小范围再试一轮的话欢迎重开。

**问：我可以做某个开放 issue 吗？**
答：先评论确认它仍相关且没人在做。任何非平凡改动都先讨论方案再动手。

**问：改修复时发现了可以写得更干净的代码。**
答：聚焦你的既定目标。真重要就讨论后单独开 PR 做清理。

**问：评审要多久？**
答：看情况。小 bug 修复或文档通常几天内。大功能可能一两周。事先讨论过的更快。

**问：为什么我加新 AI 提供商的 PR 被关了？**
答：多数提供商需求已被 `openai-compatible` 提供商覆盖（指向任意 OpenAI 兼容 base URL）或 OpenRouter 覆盖。新增内置提供商必须论证超出这些的独特价值。

**问：main 前进后我的 PR 冲突了，要 rebase 吗？**
答：改动仍相关且不算太大就 rebase。若是大而陈旧 PR，预期会被关闭并邀请 rebase 后重开。腐烂速度是真实的，与个人无关。

## 安全问题

不要作为公开 issue 提交。见 [SECURITY.md](SECURITY.md)。

## 许可证

贡献即表示同意你的工作按 [MIT](LICENSE) 许可。无需 CLA。
