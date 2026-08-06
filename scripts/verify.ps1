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
  Write-Host "`n==> CHANGELOG gate ([未发布] section must be non-empty)" -ForegroundColor Cyan
  $changelog = Get-Content "$root\CHANGELOG.md" -Raw -Encoding UTF8
  $unreleased = ($changelog -split "## " | Where-Object { $_ -like "[未发布]*" }) -join ""
  if (-not $unreleased) { throw "CHANGELOG gate failed: no [未发布] section" }
  $changelogBody = ($unreleased -replace "\[未发布\]", "" -replace "^\s*[-*]\s*$", "" -replace "\s+", "").Trim()
  if ([string]::IsNullOrEmpty($changelogBody)) { throw "CHANGELOG gate failed: [未发布] section is empty" }
  Write-Host "    OK"

  Write-Host "`n==> pnpm check-types (tsc --noEmit)" -ForegroundColor Cyan
  pnpm check-types
  if ($LASTEXITCODE -ne 0) { throw "check-types failed" }

  Write-Host "`n==> pnpm lint (biome lint ./src)" -ForegroundColor Cyan
  pnpm lint
  if ($LASTEXITCODE -ne 0) { throw "lint failed" }

  Write-Host "`n==> pnpm test (vitest run)" -ForegroundColor Cyan
  pnpm test
  if ($LASTEXITCODE -ne 0) { throw "frontend tests failed" }

  Write-Host "`n==> pnpm test:coverage (coverage thresholds)" -ForegroundColor Cyan
  pnpm test:coverage
  if ($LASTEXITCODE -ne 0) { throw "coverage thresholds not met" }

  Write-Host "`n==> pnpm check-drift (doc-code drift gate)" -ForegroundColor Cyan
  pnpm check-drift
  if ($LASTEXITCODE -ne 0) { throw "doc-drift gate failed" }

  Write-Host "`n==> pnpm i18n-scan (hardcoded-CJK gate)" -ForegroundColor Cyan
  pnpm i18n-scan
  if ($LASTEXITCODE -ne 0) { throw "i18n-scan gate failed" }

  Write-Host "`n==> pnpm size (size-limit)" -ForegroundColor Cyan
  pnpm size
  if ($LASTEXITCODE -ne 0) { Write-Host "size-limit warnings (bundle may exceed budget)" -ForegroundColor Yellow }

  Write-Host "`n==> lock poison gate (Mutex/RwLock unwrap/expect must be 0)" -ForegroundColor Cyan
  $poison = (Get-ChildItem src-tauri\src -Recurse -Filter *.rs | Select-String -Pattern '\.(lock|read|write)\(\)\.(unwrap|expect)\(').Matches.Count
  if ($poison -ne 0) { throw "lock poison gate failed: $poison unwrap/expect on locks remain" }

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
