# Terax-Super Windows Build Script
# Requirements: Rust (GNU toolchain), Node.js 20+, pnpm
# This script handles the MSYS2/MinGW dependency for building Windows import libraries

param(
    [switch]$Setup,
    [switch]$Build,
    [switch]$Release,
    [switch]$InstallMingw
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host "=== Terax-Super Windows Build ===" -ForegroundColor Cyan

# ── Phase 1: Setup Environment ──────────────────────────────────────────
if ($Setup -or (!$Build -and !$Release)) {
    Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

    # Check pnpm
    $pnpmVersion = pnpm --version 2>$null
    if (-not $pnpmVersion) {
        Write-Host "ERROR: pnpm not found. Install: npm install -g pnpm" -ForegroundColor Red
        return
    }
    Write-Host "  pnpm: v$pnpmVersion"

    # Check rustc
    $rustVersion = rustc --version 2>$null
    if (-not $rustVersion) {
        Write-Host "ERROR: rustc not found. Install from https://rustup.rs" -ForegroundColor Red
        return
    }
    Write-Host "  rust: $rustVersion"

    # Check dlltool
    $dlltoolPath = (Get-Command dlltool -ErrorAction SilentlyContinue).Source
    if (-not $dlltoolPath) {
        Write-Host "WARNING: dlltool.exe not found in PATH." -ForegroundColor Yellow
        Write-Host "  Trying rustup self-contained binutils..." -ForegroundColor Yellow
        
        $selfContained = "$env:USERPROFILE\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained"
        if (Test-Path "$selfContained\dlltool.exe") {
            Write-Host "  Found rustup self-contained dlltool at: $selfContained" -ForegroundColor Green
            Write-Host "  NOTE: This dlltool needs MinGW runtime. Install MSYS2 for proper support." -ForegroundColor Yellow
            Write-Host "  Download from: https://www.msys2.org/" -ForegroundColor Yellow
            
            # Attempt to use it
            $env:PATH = "$selfContained;$env:PATH"
        } else {
            Write-Host "ERROR: dlltool.exe not found. Install MSYS2 (https://www.msys2.org/)" -ForegroundColor Red
            Write-Host "  and add <msys2>/mingw64/bin to your PATH." -ForegroundColor Red
            return
        }
    } else {
        Write-Host "  dlltool: $dlltoolPath" -ForegroundColor Green
    }

    # Check as.exe (needed by dlltool)
    $asPath = (Get-Command as -ErrorAction SilentlyContinue).Source
    if (-not $asPath) {
        Write-Host "WARNING: as.exe not found. dlltool may fail on some crates." -ForegroundColor Yellow
        Write-Host "  Install MSYS2 with mingw-w64-x86_64-binutils package." -ForegroundColor Yellow
    } else {
        Write-Host "  as: $asPath" -ForegroundColor Green
    }

    Write-Host "[2/4] Installing Node dependencies..." -ForegroundColor Yellow
    Set-Location $ROOT
    pnpm install --no-frozen-lockfile
    Write-Host "  Done" -ForegroundColor Green
}

# ── Phase 2: Lint & Type Check ──────────────────────────────────────────
if ($Build -or $Release) {
    Write-Host "[3/4] Type checking..." -ForegroundColor Yellow
    Set-Location $ROOT
    pnpm check-types
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Type check failed" -ForegroundColor Red
        return
    }
    Write-Host "  OK" -ForegroundColor Green
}

# ── Phase 3: Build ──────────────────────────────────────────────────────
if ($Build) {
    Write-Host "[4/4] Building (frontend only)..." -ForegroundColor Yellow
    pnpm build
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Frontend built successfully!" -ForegroundColor Green
        Write-Host "  Output: dist/" -ForegroundColor Green
    }
}

if ($Release) {
    Write-Host "[4/4] Building release EXE..." -ForegroundColor Yellow
    
    # Build frontend first
    Write-Host "  Building frontend..." -ForegroundColor Yellow
    pnpm build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Frontend build failed" -ForegroundColor Red
        return
    }
    
    # Build Tauri app
    Write-Host "  Building Tauri app (this may take a while)..." -ForegroundColor Yellow
    pnpm tauri build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "=== BUILD SUCCESSFUL ===" -ForegroundColor Green
        Write-Host "Installer: src-tauri/target/release/bundle/nsis/" -ForegroundColor Green
        Write-Host "Portable:  src-tauri/target/release/terax.exe" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Build failed. See above for details." -ForegroundColor Red
    }
}

# ── Help ────────────────────────────────────────────────────────────────
if (-not $Setup -and -not $Build -and -not $Release) {
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Cyan
    Write-Host "  .\scripts\build-windows.ps1 -Setup      Install dependencies" -ForegroundColor White
    Write-Host "  .\scripts\build-windows.ps1 -Build      Build frontend only" -ForegroundColor White
    Write-Host "  .\scripts\build-windows.ps1 -Release    Build EXE installer" -ForegroundColor White
    Write-Host ""
    Write-Host "Prerequisites:" -ForegroundColor Cyan
    Write-Host "  1. Rust (x86_64-pc-windows-gnu): https://rustup.rs" -ForegroundColor White
    Write-Host "  2. Node.js 20+: https://nodejs.org" -ForegroundColor White
    Write-Host "  3. pnpm: npm install -g pnpm" -ForegroundColor White
    Write-Host "  4. MSYS2 (for MinGW dlltool): https://www.msys2.org/" -ForegroundColor White
    Write-Host "     - After install, run: pacman -S mingw-w64-x86_64-binutils" -ForegroundColor White
    Write-Host "     - Add to PATH: C:\msys64\mingw64\bin" -ForegroundColor White
}
