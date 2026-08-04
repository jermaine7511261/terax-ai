# 更新日志

Yamet 的所有重要变更都记录于此。版本遵循项目规则：**功能性构建递增版本**（默认递增补丁号），同步四个文件（`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）；bug 修复不递增。用 `pnpm version-bump <x.y.z>` 递增。

## [未发布]

### 新增
- AI 工具 `update_project_memory`：两级项目记忆（会话内 store + YAMET.md 落盘），完成 P2-9 写路径。
- `scripts/version-bump.mjs`：同步四个文件的版本号（四处同步）。
- `scripts/verify.ps1`：一次性前后端验证门禁（`pnpm verify`：check-types、lint、测试、size、cargo check+test、tauri build）。
- `modelCache` LRU 上限（24），避免长会话累积模型实例。
- 终端粘贴大于 32KiB 时改为分块写入，保持 UI 线程响应。
- 网关连接重入守卫（每平台不产生重复入站循环）。
- 钉钉 / 飞书出站调用复用共享 HTTP client。
- 主题导入遇到 id 冲突时明确提示，而非静默覆盖。
- 图片/PDF 文件预览支持缩放。
- LSP code action（客户端能力声明 + `textDocument/codeAction`）。
- git stash 管理（`git_stash_save/list/pop/apply/drop`）。
- git 冲突解决（`git_merge_abort`，`--ours`/`--theirs` checkout）。
- git 分支管理（创建/删除/重命名），无上游分支的 `push --set-upstream`，pull 策略（`--ff-only` / `--rebase` / `--no-rebase`）。
- git 子模块 status/update 命令。
- AI 工具 `apply_patch`：多文件 unified diff，原子化逐块应用。
- 审批决定可被记住（本会话 / 本项目），以及按工具的拒绝黑名单。
- 会话重命名 UI（会话选择器中的行内重命名）。
- 斜杠命令 `/review`、`/commit`、`/test`、`/fix`（send-prompt 配方）。
- 工作区「打开文件夹」入口：命令面板选目录，授权后将工作区重置到该目录。
- AI 会话历史面板：完整会话列表，支持搜索、按天分组、行内重命名与删除。

### 变更
- 移除 6 个未使用的 `@ai-sdk/{anthropic,cerebras,google,groq,openai,xai}` 依赖（knip 确认为死依赖，应用只使用 `@ai-sdk/openai-compatible`）。

## [0.1.5] — 2026-08-04

### 新增
- 第四轮迭代：git 分支状态栏徽标、编辑器右键菜单、文件浏览器多选、图片/PDF 文件预览、补全失败反馈 + 自动降级、终端路径补全的 `~` 展开、终端历史持久化到 `~/.yamet/history`、项目记忆写入工具。

## [0.1.4] — 2026-08-03

### 新增
- 第三轮迭代：AI 工具三件套（终端驱动、文件管理、git）、网关可用性（回调地址、白名单持久化、iLink 重新登录二维码）、Rust FS 工作区授权、扩展 shell 拒绝名单、stash / 冲突解决 / 分支管理 / 子模块、编辑器 code action、quick fix、斜杠命令、会话重命名、多选、历史持久化。
