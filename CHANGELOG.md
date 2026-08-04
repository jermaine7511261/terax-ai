# Changelog

All notable changes to Yamet are recorded here. Versioning follows the project
rule: **functional builds increment the version** (patch by default) across
four files (`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`);
bug fixes do not increment. Bump with `pnpm version-bump <x.y.z>`.

## [Unreleased]

### Added
- AI tool `update_project_memory`: two-level project memory (in-session store +
  YAMET.md persist) — completes the P2-9 write path.
- `scripts/version-bump.mjs` — sync the version across the four files (四处同步).
- `scripts/verify.ps1` — one-shot frontend+backend verification gate
  (`pnpm verify`: check-types, lint, tests, size, cargo check+test, tauri build).
- `modelCache` LRU cap (24) so long sessions don't accumulate model instances.
- Terminal paste now chunks writes >32KiB to keep the UI thread responsive.
- Gateway connect re-entry guard (no duplicate inbound loops per platform).
- Shared HTTP client reuse across DingTalk / Feishu outbound calls.
- Theme import now surfaces id conflicts instead of silently overwriting.
- Preview pane zoom for image/PDF file previews.

### Changed
- Removed 6 unused `@ai-sdk/{anthropic,cerebras,google,groq,openai,xai}` deps
  (knip-confirmed dead — the app only uses `@ai-sdk/openai-compatible`).

## [0.1.5] — 2026-08-04

### Added
- Fourth-round iteration: Git branch status bar pill, editor context menu,
  file-explorer multi-select, image/PDF file preview, completion-failure
  feedback + auto-degrade, `~` expansion in terminal path completion, terminal
  history persistence to `~/.yamet/history`, project memory write tool.

## [0.1.4] — 2026-08-03

### Added
- Third-round iteration: AI tool trio (terminal drive, file mgmt, git),
  gateway availability (callback URLs, whitelist persistence, iLink re-login
  QR), Rust FS workspace authorization, extended shell denylist, stash /
  conflict resolution / branch mgmt / submodules, editor code actions, quick
  fix, slash commands, session rename, multi-select, history persistence.
