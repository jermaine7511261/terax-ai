# 第十轮需求提案(0.1.11)

本文是基于 2026-08-05 深度调研的第十轮迭代需求提案。目标版本 0.1.11(功能性构建递增补丁号,同步 `package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`)。

## 调研摘要

### 项目状态

- 第九轮(0.1.10)收尾中,功能面完整:AgentSwitcher 合并 agent/model 选择器、设置页技能与 MCP 拆标签、工作区配置持久化、批准弹窗自动批准、汉化收官(34 显示文本 + 57 属性)、锁中毒自愈(152 处 `unwrap` 改 `unwrap_or_else`)、后台进程树杀、崩溃恢复「继续」、消息编辑重发、微信自动重连 QR。
- ROADMAP「下一批」几乎全部勾选:完整 PTY 进程/历史恢复(I1c)原刻意推迟,本轮以轻量版(快照回放)纳入;SSH 后续(SFTP 与端口转发)仍待做。
- 「更远期」三项均未启动:发布自动化、打包体积优化、AI 工具/片段 bundle。
- 基础设施已成熟:`scripts/verify.ps1` 全量门禁(check-types/lint/test/size/cargo check+test/tauri build)、`scripts/version-bump.mjs` 四文件同步、`scripts/eager-graph.mjs` eager 预算检查、CI/release/signpath workflows 存在、前端 108 个测试文件 + 5 个 Rust 集成测试。
- 仓库 `.git` 存在但**无任何提交历史**(发布自动化的前置基线缺失)。
- updater 端点已指向 `https://api.github.com/repos/{owner}/{repo}/releases/latest` 模板,等待真实仓库。
- 规模:Rust 约 20k LOC,前端 dist 5.0 MB;size-limit 基线 eager 540 KB / total 1500 KB(gzip)。
- 全库无实质 TODO/FIXME 残留。

### 参考项目(E:/Agent)

- **hermes-agent**:node-pty + `@xterm/addon-serialize`(终端 buffer 序列化,会话恢复素材);LSP 集成思路最有价值:git 工作区门控、分层检查(语法先行 + LSP 语义第二层)、诊断 freshness 门控(只报当前编辑引入的错误)、写文件后给 agent 注入 LSP 诊断、崩溃进 broken-set 不重试、25 种服务器注册表 + 私有目录自动安装 + `lsp status/list/install/restart` CLI。
- **oh-my-pi**:`portable-pty`(与 yamet 同栈)+ `@xterm/headless`(无头终端回放);ConPTY 细节(openpty 超时、`ESC[6n` 光标查询、输入关闭顺序)与 yamet 现有处理互为验证。
- **claude-code-haha**:tmux worktree 集成(`exec into tmux`),佐证 attach 语义在 Unix 可行;Windows 无原生 tmux,故 PTY 重连主方案选 helper 常驻进程。
- **grok-build**:`ptyctl` crate + pty-harness 测试矩阵(PTY 边界测试参考)。

### 结论

产品功能已到「可用但不发版」状态。第十轮应聚焦:解锁首个正式发布(发布自动化)+ 实现完整 PTY 会话恢复(进程级重连,参考 E:/Agent 项目)+ 补齐 LSP 能力缺口 + 兑现 ROADMAP 已承诺的后续项(SSH 后续、体积优化、skill 分享)。

## P0 发布自动化(更远期 #1)

**背景**:`version-bump.mjs` 已同步四文件,但缺 git 基线、tag 流程、CHANGELOG 门禁与一键发布入口。无发布流程则 0.1.10 无法成为正式版本,updater 模板也落不了地。

**需求**:

1. `scripts/release.mjs` 一键发布:build → `version-bump` → CHANGELOG 校验 → `git commit` + `git tag v0.1.11` → 提示运行 `pnpm tauri build` 与 release workflow。
2. CHANGELOG 门禁:`verify.ps1` 检查 `[未发布]` 段存在且非空,缺失即失败(发布产物必须带变更记录)。
3. tag 规范固定为 `v<semver>`,release workflow 按 tag 触发(已有 `release.yml` 需核对与 tag 命名一致)。
4. 发布后 `0.1.10`(第九轮)作为首个正式版本出包,updater 端点替换 `{owner}/{repo}` 后可用。

**验收**:

- 一条命令完成「递增 → 提交 → 打 tag」,CHANGELOG 空则拒绝。
- tag 触发 CI 产出各平台安装包,updater 从该 release 拉取成功(配真实仓库后)。
- 文档更新:`README.md` 安装段与 `ROADMAP.md` 发布自动化勾选。

## P1 PTY 完整会话恢复:进程级重连(helper 常驻进程)

**背景**:I1c 的完整目标(重连实时 shell、保留前台进程)本轮实现。业界两种路径:tmux 后端(attachable)与常驻 helper 进程持有 PTY。**选 helper 进程方案**:Windows 无原生 tmux,引入外部依赖违背「跨平台对等 + 无外部依赖」原则;helper 在全部平台一致(Windows ConPTY 在 helper 内创建,不绑定主进程)。claude-code-haha 的 tmux 集成佐证了 attach 语义可行,但平台受限。

**方案**(Rust 侧为主):

1. **helper 进程**:新增独立常驻进程(同二进制 `--pty-helper` 模式或独立 binary),持有全部 PTY 会话(`portable-pty`),参考 oh-my-pi `PtySession` 的 control/reader 双通道结构(control_tx + reader 事件 + drain 超时)。
2. **控制通道**:主进程与 helper 经本地 IPC(unix socket / Windows 命名管道),JSON-RPC 风格控制(open/write/resize/attach/detach/kill/list)+ 二进制输出流;仅当前用户可访问。
3. **生命周期**:启动时探测既有 helper(socket + pid 文件),有则重连,无则 spawn;所有标签关闭且无残留会话才退出 helper;主进程崩溃/被强杀时 helper 继续持有会话。
4. **会话重连**:恢复标签时不再新起 shell,而是按会话 id attach 既有 PTY;helper 内环形缓冲保留会话期间输出,重连时回放。
5. **兜底**:helper 缺失/版本不匹配时降级为原行为(按原 cwd 新起 shell + buffer 快照回放),绝不阻塞启动。

**验收**:

- 重启应用后前台任务(vim、TUI、npm run dev)继续运行,输出连续,不丢不重。
- macOS / Linux / Windows 三平台一致;Windows ConPTY 会话跨主进程重启存活。
- 双开实例不串会话;helper 孤儿有清理机制(超时无连接自动退出)。
- 降级路径:无 helper 时回退快照回放 + 新 shell,启动不被阻塞。

## P1 PTY 会话恢复:buffer 快照回放(辅助)

**背景**:进程级重连的兜底层,同时覆盖 helper 不可用场景。布局 + cwd 恢复已交付(cold tab 激活时按原 cwd 新起 shell)。

**方案**(参考 hermes 的 `@xterm/addon-serialize`,yamet 已有该依赖与 DormantRing 序列化经验):

1. 每终端标签在后台定期(或命令边界)把 xterm buffer 序列化为紧凑文本快照,按标签 id 写入 `~/.yamet/sessions/<tab-id>.snap`。
2. 激活时先回放快照到 xterm,再以原 cwd 新起 shell,顶部标注「会话已重连,前台进程未保留」。
3. 快照写入限频、限制条数/大小(复用 DormantRing 溢出语义)。
4. 前台任务运行中不落快照(命令中途序列化会损坏 TUI,沿用现有不变量)。

**验收**:

- 重启后激活终端标签,能看到上次会话的可见输出(含滚动缓冲),shell 按原 cwd 新起。
- 前台任务运行中退出应用,该标签恢复后显示「未保存前台会话」标注。

## P1 LSP 能力补齐

**背景**:编辑器内嵌 LSP(诊断、F12 定义、Shift-F12 引用、F2 重命名、Shift-Alt-f 格式化、Shift-Alt-a code action、hover)已交付;三个明确缺口:AI 工具无语义诊断反馈、WSL 工作区被拒、跨文件 workspace edits 只应用当前文档。

**需求**:

1. **AI 工具语义诊断反馈**(参考 hermes 模式):`write_file` / `edit` / `multi_edit` 执行后,若当前工作区有活动 LSP 会话,查询该文件诊断,把「本次编辑引入的新诊断」注入 agent 上下文(freshness 门控:只报编辑后新出现的,不报基线已有)。git 仓库门控:非 git 工作区跳过,避免 home 目录起服务器。LSP 失败静默降级,绝不阻塞写。
2. **WSL 工作区支持**:移除 `lsp_spawn` 的 WSL 拒绝,经 WSL 桥在发行版内 spawn 服务器;文件 URI 做 `\\wsl$` 与发行版内路径的双向映射。
3. **跨文件 workspace edits**:F2 重命名 / code action 返回的跨文件 edits,对非当前文档目标自动打开 → 应用 → 保存(或聚合成 diff 供审阅),不再静默丢弃。

**验收**:

- agent 编辑引入类型错误/未定义名后,下一条消息能看到对应语义诊断;编辑前后无新增诊断时零噪音。
- WSL 工作区编辑器可启用 LSP 并收到诊断。
- 跨文件重命名实际改动所有引用文件,且逐文件可审阅/回退。

## P1 SSH 后续:SFTP 与端口转发(下一批残留)

**背景**:ssh 模块(170 LOC)复用系统 `ssh` 客户端作为 PTY 子进程,known_hosts 校验、密码/密钥/agent 认证、forward agent 全部原生支持。ROADMAP 明确「SFTP 与端口转发后续」。

**需求**:

1. **SFTP 远程文件浏览**:远程路径以独立视图接入,复用 explorer 的目录树、模糊搜索与行内重命名;经 `sftp` 子进程(批命令模式)读写,禁止目录遍历越界。
2. **端口转发**:`ssh -L/-R` 隧道的创建/列表/关闭,状态栏指示活动隧道。

**验收**:

- 从已连接的远程会话可浏览远程目录、读文件内容。
- 隧道可创建、可见、可关闭,异常断开时状态归位。
- 远程文件操作遵循现有工作区授权与拒绝名单语义(读为主,写需审批)。

## P1 打包体积优化第一刀(更远期 #2)

**背景**:dist 5.0 MB;eager 启动预算 540 KB、total 1500 KB(gzip)。已有大量懒加载(CM 语言模式、markdown 块、dotenv 语法、LSP client),但 `analyze:bundle` / `analyze:eager` 脚本自建后未跑过基线。「始终轻量」是产品主题。

**需求**:

1. 跑 `pnpm analyze:bundle` 建立 chunk 基线,识别 top 依赖。
2. 针对最大项做第一刀优化,候选(按预期收益排序):
   - **i18n 双语字典**:`translations.ts` 约 1800 行、zh+en 双份,评估按分区懒加载或压缩形态。
   - **编辑器主题**:`@uiw` 主题包 + 本地构建主题,按启用项拆包。
   - **图标**:hugeicons / iconify 子集化。
   - **CM legacy-modes / svelte / vue 语言**:确认按需加载而非 eager。
3. 优化后更新 size-limit 基线,守住不反弹。

**验收**:

- eager 或 total gzip 数字相比基线下降 ≥ 10%,或经测量证明某项为不可减瓶颈并记录结论。
- `pnpm size` 与 `pnpm analyze:eager` 全部通过。

## P2 skill bundle 分享(更远期 #4)

**背景**:`skills/` 目录约定、工具白名单(`toolAllowlist`)、`create_skill` 工具、设置页技能管理已交付;缺的是「可分享 bundle」。

**需求**:

1. **导出**:内置/自建 skill 导出为单个 `skill.json`(含 prompt、allowlist、元数据)。
2. **导入**:设置页粘贴 JSON 或拖入文件导入,校验结构后入 `skills/`。
3. (可选)从 git URL 一键安装。

**验收**:

- 导出的 skill 可在另一台机器导入并立即使用(含工具白名单生效)。
- 非法 JSON / 缺字段给出明确错误,不产生半成品文件。

## P2 IDE 能力扩展(原范围外:超出 LSP 的重型 IDE 功能)

**背景**:ROADMAP 原把调试器、重构引擎、IDE 级全项目搜索列为范围外;维护者决定纳入本轮。

**需求**:

1. **IDE 级全项目搜索**:跨文件全文搜索 + 批量替换。后端 `fs_grep` / `fs_glob` 已存在;做搜索结果面板(分组、排序、跳转)、替换预览与确认。
2. **集成调试器(DAP)**:Debug Adapter Protocol 客户端,断点管理、单步、变量查看、调用栈。与 LSP 同构(Rust 侧进程宿主 + JSON-RPC framing 可复用 `lsp/framing.rs`),前端接入编辑器。工作量最大,拆子里程碑(先 DAP 客户端 + 断点,后单步/变量)。
3. **重构引擎**:依赖语义分析的重构(提取变量/函数、内联等)逐项评估,以 LSP `workspace/executeCommand` 与 code action 为主力,不重复造轮子。

**验收**:

- 全项目搜索排除 `.git`,结果可跳转,替换前有预览。
- DAP 会话可启动、断点命中、单步、查看变量(macOS/Linux/Windows)。
- 重构能力列表经评估后确定,仅做 LSP 能支撑的。

## P2 浏览器功能(原范围外:完整浏览器功能)

**背景**:预览面板原仅限本地开发服务器与轻量文档查看;维护者决定纳入本轮。

**需求**:

1. **导航历史**:预览标签前进/后退/刷新(地址栏 + 快捷键)。
2. **书签**:收藏常用本地 URL,跨会话保存,侧栏/菜单访问。
3. **开发者工具**:WebView2(Windows)/WebKit(macOS/Linux)devtools 开关,用于调试 Yamet 自身前端与预览页面。

**验收**:

- 预览标签可前进/后退/刷新,历史按标签独立。
- 书签增删与跨重启持久化。
- devtools 可开可关,不默认开启。

## P3 遥测(方向待维护者确认)

**背景**:README/ROADMAP 现声明「无遥测、无账号」为产品卖点;维护者指示此项纳入本轮。与既有定位直接冲突,方向需先确认,再谈实现。

**需求**(方向确认后):

1. 匿名使用统计(功能使用频次、崩溃上报,不含路径/内容/密钥),或
2. 本地诊断日志(不上传,仅本机可查),或
3. 维持现状(无遥测)

**验收**:方向确认后按所选形态落地;若选匿名统计,需显式开关 + 隐私说明,默认行为由维护者定。

## 范围外(维持)

- Notebook 与文档工作区、包管理器与工具链 UI、IDE 规模的扩展市场、第三方订阅会话桥接:维持范围外。

## 实施规划

### 执行顺序与依赖

| 批次 | 项 | 依赖 | 理由 |
|---|---|---|---|
| A | P0 发布自动化 | 无 | 解锁发版流程,后续轮次复用 |
| B | P1 PTY 进程级重连(helper)+ 快照回放 | 无 | 最大工程,尽早启动,避免卡尾 |
| C | P1 LSP 补齐、P1 SSH 后续 | LSP 复用既有会话/命令面 | 中等工程,复用面多 |
| D | P1 体积优化、P2 skill bundle、P2 浏览器 | 体积先跑 `analyze:bundle` 基线 | 低风险,可穿插 |
| E | P2 IDE 扩展、P3 遥测 | 全项目搜索复用 `fs_grep`;DAP 复用 `lsp/framing.rs`;遥测等方向确认 | 重项收尾 |

无跨批次硬依赖;PTY helper 与 DAP 拆子里程碑,其余项独立可并行。

### 批次 A · P0 发布自动化

**步骤**:

1. `scripts/release.mjs`:复用 `version-bump.mjs` 的四文件同步,增加 CHANGELOG `[未发布]` 段非空校验 → `git add` + `git commit` + `git tag v0.1.11`(tag 前失败即中止,不产生半成品提交)。
2. `verify.ps1` 加 CHANGELOG 门禁(缺 `[未发布]` 或为空 → 失败)。
3. 核对 `.github/workflows/release.yml` 触发条件与 tag 命名一致(`v*`)。
4. 首次发布:0.1.10(第九轮)作为首个正式版本;`tauri.conf.json` updater 端点替换 `{owner}/{repo}` 为真实仓库。

**涉及**:`scripts/release.mjs`(新)、`scripts/verify.ps1`、`scripts/version-bump.mjs`、`.github/workflows/release.yml`、`tauri.conf.json`、README 安装段。

**风险**:仓库无提交历史(当前),首次 commit/tag 需确认基线;release workflow 未实测过,首次发布走一次演练。

### 批次 B · P1 PTY 进程级重连(helper)

**里程碑**(每步可独立验收):

- **M1 helper 骨架**:新增 `src-tauri/src/modules/pty_helper/`(同二进制 `--pty-helper` 模式或独立 binary),会话持有从主进程迁入 helper(portable-pty + 现有 session 基建);helper 内输出环形缓冲。参考 oh-my-pi `PtySession` 的 control/reader 双通道。
- **M2 IPC 通道**:unix socket / Windows 命名管道,JSON-RPC 控制(open/write/resize/attach/detach/kill/list)+ 二进制输出流;仅当前用户可访问(socket 权限 / 命名管道 ACL)。
- **M3 重连与生命周期**:主进程启动探测既有 helper(socket + pid 文件),有则 attach,无则 spawn;所有标签关闭且无残留会话才退出 helper;孤儿清理(超时无连接自动退出);双开实例互不串会话(每实例独立 socket 名)。
- **M4 前端接线**:恢复标签按会话 id attach 而非新 spawn;降级路径(无 helper / 版本不匹配 → 快照回放 + 新 shell,不阻塞启动);三平台(macOS/Linux/Windows)实测,Windows 验证 ConPTY 跨主进程重启存活。

**涉及**:`src-tauri/src/modules/pty_helper/`(新)、`pty/session.rs`(会话逻辑抽取)、`pty/mod.rs`(命令路由)、前端 `pty-bridge.ts` / `useTerminalSession.ts` / `useSpacesBoot.ts`。

**风险**:helper 进程版本与主进程不匹配(降级路径兜底);Windows 命名管道 ACL;helper 残留孤儿进程(超时退出兜底);IPC 安全(仅本地 + 当前用户)。

### 批次 C · P1 LSP 补齐 + P1 SSH 后续

**LSP 三项**:

1. **AI 工具语义诊断反馈**:`write_file`/`edit`/`multi_edit` 执行后经 `sessionManager` 查活动会话,`textDocument/diagnostic` 拉取,对比编辑前基线只报新增;git 仓库门控;失败静默降级。涉及 `src/modules/ai/tools/`、`src/modules/lsp/lib/sessionManager.ts`。
2. **WSL 支持**:移除 `lsp_spawn` 的 WSL 拒绝,经 WSL 桥 spawn 服务器;URI 双向映射(`\\wsl$` ↔ 发行版内路径)。涉及 `src-tauri/src/modules/lsp/mod.rs`、`workspace.rs`、`src/modules/lsp/lib/uri.ts`。风险:WSL 内进程生命周期与路径映射,先做读路径。
3. **跨文件 workspace edits**:`client.ts` 的 `applyWorkspaceEdit` 对非当前文档目标自动打开 → 应用 → 保存(或聚合 diff)。涉及 `src/modules/lsp/lib/client.ts`、tabs/editor 打开逻辑。

**SSH 两项**:

1. **SFTP 浏览**:`sftp` 子进程批命令模式(ls/get/put/rm),复用 explorer 交互;路径沙箱防越界。涉及 `src-tauri/src/modules/ssh/`(新 sftp.rs)、`src/modules/explorer/`。
2. **端口转发**:`ssh -L/-R` 隧道创建/列表/关闭,状态栏指示。涉及 `src-tauri/src/modules/ssh/`、`src/modules/statusbar/`。

### 批次 D · P1 体积优化 + P2 skill bundle + P2 浏览器

1. **体积**:先跑 `pnpm analyze:bundle` 建基线;候选按序:i18n 双语字典(懒加载/压缩)、`@uiw` 主题按启用拆包、图标子集、CM legacy-modes 确认按需。更新 size-limit 基线。
2. **skill bundle**:导出 `skill.json`(prompt/allowlist/元数据)→ 设置页粘贴/拖入导入校验。涉及 `src/modules/ai/`、`src/settings/sections/SkillsSection.tsx`。
3. **浏览器**:预览导航历史(地址栏 + 快捷键)、书签持久化、devtools 开关。涉及 `src/modules/preview/`、Rust webview 配置。

### 批次 E · P2 IDE 扩展 + P3 遥测

1. **全项目搜索**:搜索面板复用 `fs_grep`/`fs_glob`,结果分组/排序/跳转 + 替换预览。涉及 `src/modules/`(新 search 面板)、`src-tauri/src/modules/fs/search.rs`。小工程,先做。
2. **DAP 调试器**(最大):Rust 侧 DAP 进程宿主复用 `lsp/framing.rs`(Content-Length 帧);前端断点管理、单步、变量、调用栈。子里程碑:M1 DAP 客户端 + 断点命中 → M2 单步/变量 → M3 栈帧/多会话。
3. **重构引擎**:评估后仅做 LSP 支撑的(executeCommand / code action 扩展),不重复造轮子。
4. **遥测**:等维护者方向确认(匿名统计 / 本地日志 / 维持现状)后按所选形态落地。

### 版本节奏

- 全部功能性变更随 **0.1.11**(四文件同步);bug 修复不递增。
- 批次 B/D 中不影响行为的工程改动(体积优化、helper 重构)可在同一版本内穿插,不单独递增。
- 每项交付时更新 CHANGELOG `[未发布]` 段,标注「第十轮(0.1.11)」。

### 风险与依赖汇总

- **helper 重连**:IPC 安全、孤儿进程、版本漂移、Windows ConPTY 跨进程,均有降级路径兜底;不阻塞启动。
- **DAP**:工程量最大,拆子里程碑;跨平台调试器行为差异大,先支持常见运行时(Node/Python)。
- **遥测**:与「无遥测」卖点冲突,方向待确认后再实现。
- **首次发布**:仓库无提交历史,release workflow 未实测,首次发布前演练。
- 所有批次交付前过 `pnpm verify`(check-types/lint/test/size/cargo check+test/tauri build)。

## 版本与发布

- 本轮版本 `0.1.11`,四文件同步。
- 每项需求交付时更新 CHANGELOG `[未发布]` 段,标注「第十轮(0.1.11)」。
- 交付前跑 `pnpm verify` 全量门禁。
