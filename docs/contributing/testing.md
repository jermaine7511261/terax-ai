# 测试

本指南展开说明 `YaMet.md` 与 `CONTRIBUTING.md`。如有冲突，以它们为准。

## 本地跑检查

规范命令就是 CI 跑的命令（`.github/workflows/ci.yml`）：

```bash
pnpm lint
pnpm check-types
pnpm test

cd src-tauri
cargo clippy --all-targets --locked -- -D warnings
cargo nextest run --locked        # CI 用 nextest
```

没装 `cargo-nextest` 时，本地回退是 `cargo test --locked`。用 `cargo install cargo-nextest` 安装 nextest。

## 覆盖率契约（第十二轮起）

- 前端 coverage 由 `pnpm test:coverage` 产出（v8 provider，配置在 `vite.config.ts` test.coverage），**CI 强制阈值**：statements ≥ 45%、branches ≥ 35%、functions ≥ 30%、lines ≥ 45%（渐进式，下一轮上调）。
- `src/components/ui/`（shadcn 原语）、`src/components/ai-elements/`（生成代码）、`src/styles/` 不在覆盖范围：UI 渲染/主题不需要测试（见下）。
- 新增模块（如 dap/mcp/remote/search/source-control）必须带测试；纯逻辑（状态机、解析、参数组装）必须覆盖主要状态迁移与错误分支。
- Rust 侧 `cargo llvm-cov nextest --lcov` 已在 CI 生成 lcov.info（暂无阈值）；DAP 会话/传输层必须用真实子进程 fake 适配器测试（对齐 grok test-support 思路，不 mock 传输层）。

## 什么必须有测试

`CONTRIBUTING.md` 要求，任何触碰以下承重路径行为的改动都要测试：

- Shell / 终端 spawn（启动哪个 shell、用什么 cwd、env 与登录标志）
- 工作区授权（允许与拒绝两侧）
- git 命令层（仓库根解析、pathspec/参数守卫、status 解析）
- 文件系统变更（原子写、符号链接处理、部分失败不丢数据）
- IPC 命令面与 AI 工具面
- 波及面广的纯逻辑（cwd 继承、标签/分屏树变换、OSC/提示符解析、命令守卫）

标准是真正覆盖契约，而非占位。测边界、拒绝路径、"home 上一层会怎样"。

## 什么不需要测试

UI 渲染、主题、语法高亮表，以及类型检查器已保证的东西，不需要测试。

## 写一条好测试

好测试锁定你依赖的不变量。代码库示例：

- `src-tauri/src/modules/workspace.rs` 的 `auth_tests` 验证授权路径、授权根的子目录、未授权路径、缺失路径与符号链接逃逸都行为正确。
- `src-tauri/src/modules/pty/job.rs` 的测试验证 Windows 上释放作业对象会杀掉指派进程树。
- `src-tauri/src/modules/pty/session.rs` 的测试验证释放 `Session` 会杀子进程。
- `src-tauri/src/modules/pty/shell_init.rs` 的测试验证 shell 分类与 WSL fish 启动规格。
- `src/modules/ai/lib/security.ts` 由断言特定路径被拒、以及规范化能抓住符号链接穿越的测试覆盖。

## 跨平台 PTY 测试

平台专属行为必须门控：

```rust
#[cfg(unix)]
fn shell_has_children(shell_pid: u32) -> bool { ... }

#[cfg(windows)]
fn shell_has_children(shell_pid: u32) -> bool { ... }
```

ConPTY/作业对象的测试放 `#[cfg(windows)]` 后；Unix PTY 生命周期的测试放 `#[cfg(unix)]` 后。不要假设一个平台上可用的 helper 在另一个平台也能用。

## 安全函数测试

测试 `src/modules/ai/lib/security.ts` 或 Rust 对应物时，覆盖：

1. 字面路径被拒。
2. 规范化路径被再次拒绝（符号链接情形）。
3. 大小写变体在不区分大小写的文件系统上匹配。
4. NTFS 备用数据流与尾点/空格变体被归一化。
5. 只写拒绝前缀在合适场景下拦写但放读。

## 不变量

- 局部修复 + 全局爆炸半径必须被测试抓住；仅靠评审不够。
- 测拒绝路径与边界，不只测快乐路径。
- 平台专属测试放在正确的 `#[cfg(...)]` 门控后。

## 参见

- [`YaMet.md`](../../YaMet.md)：架构事实来源
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md)：质量门槛、项目布局、如何贡献
- [`docs/README.md`](../README.md)：贡献者指南索引
