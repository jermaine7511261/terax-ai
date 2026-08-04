# Yamet one-shot verification gate. Run from the repo root on a machine with
# the toolchain installed (node>=22, pnpm, cargo 1.97+, git). Mirrors the
# CI contract described in docs/contributing/testing.md. Exits non-zero on the
# first failing step.
#
#   powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
#
# Optional: pass -SkipBuild to skip the full tauri build (slow).

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  Write-Host "`n==> pnpm check-types (tsc --noEmit)" -ForegroundColor Cyan
  pnpm check-types
  if ($LASTEXITCODE -ne 0) { throw "check-types failed" }

  Write-Host "`n==> pnpm lint (biome lint ./src)" -ForegroundColor Cyan
  pnpm lint
  if ($LASTEXITCODE -ne 0) { throw "lint failed" }

  Write-Host "`n==> pnpm test (vitest run)" -ForegroundColor Cyan
  pnpm test
  if ($LASTEXITCODE -ne 0) { throw "frontend tests failed" }

  Write-Host "`n==> pnpm size (size-limit)" -ForegroundColor Cyan
  pnpm size
  if ($LASTEXITCODE -ne 0) { Write-Host "size-limit warnings (bundle may exceed budget)" -ForegroundColor Yellow }

  Write-Host "`n==> cargo check (backend)" -ForegroundColor Cyan
  Push-Location src-tauri
  try {
    cargo check
    if ($LASTEXITCODE -ne 0) { throw "cargo check failed" }
  } finally { Pop-Location }

  Write-Host "`n==> cargo test (backend)" -ForegroundColor Cyan
  Push-Location src-tauri
  try {
    cargo test
    if ($LASTEXITCODE -ne 0) { throw "cargo test failed" }
  } finally { Pop-Location }

  if (-not $SkipBuild) {
    Write-Host "`n==> npx tauri build (full desktop bundles)" -ForegroundColor Cyan
    npx tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
  }

  Write-Host "`n==> git working tree" -ForegroundColor Cyan
  git status --short

  Write-Host "`nVERIFY PASSED" -ForegroundColor Green
}
finally {
  Pop-Location
}
