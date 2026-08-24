@echo off
echo ============================================
echo  Fix Cursor ACP OAuth Token
echo ============================================
echo.
echo This script re-authenticates the Cursor ACP
echo connection to fix "invalidated oauth token" errors.
echo.
echo Prerequisites:
echo   - Cursor IDE must be installed and open
echo   - cursor-agent CLI must be in PATH
echo.

echo Step 1: Checking cursor-agent CLI...
where cursor-agent >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] cursor-agent not found in PATH
    echo.
    echo To fix:
    echo   1. Install/Update Cursor from https://www.cursor.com/downloads
    echo   2. Ensure cursor-agent is in your PATH
    echo   3. Or add manually: C:\Users\Javier\AppData\Local\Programs\cursor\resources\bin
    echo.
    pause
    exit /b 1
)
echo [OK] cursor-agent found.
echo.

echo Step 2: Logging out old session...
cursor-agent auth logout 2>nul
echo.

echo Step 3: Logging in fresh...
echo A browser window will open. Sign in with your Cursor account.
cursor-agent auth login
if %errorlevel% neq 0 (
    echo [ERROR] Login failed.
    echo.
    echo Manual steps:
    echo   1. Open Cursor IDE
    echo   2. Click your profile icon (top right)
    echo   3. Sign out, then sign back in
    echo   4. Run this script again
    echo.
    pause
    exit /b 1
)
echo.

echo Step 4: Verifying authentication...
cursor-agent auth status
echo.

echo Step 5: Testing ACP server connection...
curl -s -o nul -w "HTTP Status: %%{http_code}\n" http://127.0.0.1:32124/v1/models 2>nul
if %errorlevel% equ 0 (
    echo [OK] ACP server is responding.
) else (
    echo [WARNING] ACP server not responding.
    echo Make sure Cursor IDE is open and running.
)
echo.

echo ============================================
echo  Done! Try running OpenCode again.
echo ============================================
pause
