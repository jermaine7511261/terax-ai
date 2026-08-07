# 发布验证清单（Release Verification）

目的：把"发布链路说明"变成可执行的验证流程。每次打 tag 发版前按此清单走。

## 1. 本地验证（开发者机器）

```bash
# 前置：Node 22+ / pnpm / Rust stable
pnpm install --frozen-lockfile

# 质量门禁（与 CI 一致）
pnpm lint && pnpm check-types && pnpm test
pnpm test:coverage            # 阈值 29/25/23/29
pnpm check-drift              # 命令面/模块/原生铁律 + 前端 invoke 契约
pnpm i18n-scan                # 硬编码中文门禁
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cargo test --locked           # 含 tests/cli_entry.rs 进程级冒烟

# 产物构建
pnpm build                    # → dist/（vite 12s+，本机已验证 exit 0）
pnpm size                     # 预算：eager 540KB / total 1550KB（gzip）
cargo build --release --locked  # → target/release/yamet（含 LTO，耗时较长）
```

## 2. 打包验证（CI 或本地真机）

```bash
pnpm tauri build              # 三平台 bundle（CI 矩阵：mac aarch64/x64、linux、windows）
```

- Windows：确认 NSIS 安装包生成 + 未签名提示文案正确（docs/troubleshooting.md 有指引）
- updater：`tauri.conf.json` 的 `{owner}/{repo}` 由 release.yml 运行时替换为 `$GITHUB_REPOSITORY`；
  release.yml 的 patch-updater-manifest job 会修补签名 manifest（已确认存在）
- 签名：SignPath 工作流（signpath-test.yml）只对 upstream 仓库生效；fork 需自带签名密钥

## 3. 发布（GitHub）

```bash
pnpm version-bump <x.y.z>     # CHANGELOG 门禁 → 版本文件同步 → commit → tag
git push origin main --tags
```

- release.yml 监听 `v*` tag：三平台构建 + 上传 + 修补 updater manifest
- 发布后检查：`https://github.com/<owner>/<repo>/releases/latest` 的资产完整
  （.deb/.rpm/AppImage/NSIS/dmg + .sig + latest.json）

## 4. 发布后冒烟（真机）

1. 下载安装包，全新安装（Windows 走"仍要运行"提示）
2. 打开终端 → 敲 `echo hi` 出输出（PTY 链路）
3. 设置 → 模型 → 配一个 provider key（keyring 写入）
4. 打开一个 git 仓库 → 源码控制面板出状态
5. AI 面板发一条消息（BYOK 或本地模型）
6. 检查自动更新：设置里触发检查，确认命中最新 release

## 本机已确认项（2026-08-07）

- [x] `pnpm build`（vite）exit 0，dist 完整产出
- [x] `cargo test --locked` 全绿（含新增 cli_entry 冒烟）
- [x] tsc --noEmit 0 错误；drift 含前端 invoke 契约检查通过
- [ ] `cargo build --release`（本机受限 shell 未跑，需真机/CI）
- [ ] `pnpm tauri build` 三平台打包（需真机/CI）
