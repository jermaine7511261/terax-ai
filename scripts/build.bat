@echo off
REM ============================================================================
REM OpenAgent — one-click build script for Windows
REM Produces: src-tauri\target\release\openagent.exe + NSIS installer
REM ============================================================================
setlocal enabledelayedexpansion

set PROJECT_DIR=%~dp0
cd /d "%PROJECT_DIR%"

echo ============================================================================
echo  OpenAgent Build Script
echo  Step 1/5: Installing frontend dependencies...
echo ============================================================================
call pnpm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: pnpm install failed
    exit /b 1
)

echo ============================================================================
echo  Step 2/5: TypeScript type checking...
echo ============================================================================
call pnpm check-types
if %ERRORLEVEL% neq 0 (
    echo ERROR: TypeScript type checking failed
    exit /b 1
)

echo ============================================================================
echo  Step 3/5: Building frontend...
echo ============================================================================
call pnpm build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Frontend build failed
    exit /b 1
)

echo ============================================================================
echo  Step 4/5: Building Rust binary (release)...
echo ============================================================================
cd /d "%PROJECT_DIR%src-tauri"
set PATH=C:\Users\Admin\mingw64\bin;%PATH%
cargo build --release --bin openagent
if %ERRORLEVEL% neq 0 (
    echo ERROR: Rust build failed
    exit /b 1
)

echo ============================================================================
echo  Step 5/5: Packaging NSIS installer...
echo ============================================================================
cd /d "%PROJECT_DIR%"
"C:\Program Files\Inno Setup 7\ISCC.exe" scripts\installer.iss
if %ERRORLEVEL% neq 0 (
    echo ERROR: Installer packaging failed
    exit /b 1
)

echo ============================================================================
echo  Build complete!
echo.
echo  Binary:       src-tauri\target\release\openagent.exe
echo  Installer:    dist\OpenAgent-*-Setup.exe
echo ============================================================================
