@echo off
REM =============================================================================
REM GMP App Security Setup Script (Windows)
REM =============================================================================
REM This script generates secure random secrets and sets up the .env file
REM Run this ONCE before first deployment
REM =============================================================================

echo ╔═══════════════════════════════════════════════════════════╗
echo ║        GMP App - Security Setup Script                    ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

setlocal enabledelayedexpansion

set BACKEND_DIR=%~dp0backend
set ENV_FILE=%BACKEND_DIR%\.env
set ENV_EXAMPLE=%BACKEND_DIR%\.env.example

REM Check if .env already exists
if exist "%ENV_FILE%" (
    echo ⚠️  WARNING: .env file already exists!
    echo    This will overwrite your existing secrets.
    set /p confirm="    Continue? (y/N): "
    if /i not "!confirm!"=="y" (
        echo Aborted.
        exit /b 0
    )
)

echo 🔐 Generating secure random secrets...
echo.

REM Generate random hex strings using PowerShell
for /f "delims=" %%a in ('powershell -Command "[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32) | ForEach-Object { $_.ToString('x2') } -join ''''"') do set JWT_ACCESS_SECRET=%%a
for /f "delims=" %%a in ('powershell -Command "[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32) | ForEach-Object { $_.ToString('x2') } -join ''''"') do set JWT_REFRESH_SECRET=%%a
for /f "delims=" %%a in ('powershell -Command "[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32) | ForEach-Object { $_.ToString('x2') } -join ''''"') do set SESSION_SECRET=%%a

echo    ✅ JWT Access Secret:    !JWT_ACCESS_SECRET:~0,16!...
echo    ✅ JWT Refresh Secret:   !JWT_REFRESH_SECRET:~0,16!...
echo    ✅ Session Secret:       !SESSION_SECRET:~0,16!...
echo.

REM Copy .env.example to .env
echo 📋 Creating .env file from template...
copy "%ENV_EXAMPLE%" "%ENV_FILE%" > nul

REM Replace placeholders with generated secrets
echo 🔧 Configuring secrets...

powershell -Command "(Get-Content '%ENV_FILE%') -replace '<GENERAR_CON_OPENSSL_RAND_HEX_32>', '%JWT_ACCESS_SECRET%' | Set-Content '%ENV_FILE%'"
powershell -Command "(Get-Content '%ENV_FILE%') -replace '<TU_USUARIO_IBM_I>', 'gmp_user' | Set-Content '%ENV_FILE%'"
powershell -Command "(Get-Content '%ENV_FILE%') -replace '<TU_PASSWORD_IBM_I>', 'CHANGE_ME_IN_PRODUCTION' | Set-Content '%ENV_FILE%'"
powershell -Command "(Get-Content '%ENV_FILE%') -replace '<REDIS_PASSWORD_SI_REQUERIDO>', 'redis_secure_password' | Set-Content '%ENV_FILE%'"
powershell -Command "(Get-Content '%ENV_FILE%') -replace '<SMTP_PASSWORD_SEGURO>', 'smtp_secure_password' | Set-Content '%ENV_FILE%'"
powershell -Command "(Get-Content '%ENV_FILE%') -replace '<TU_GOOGLE_MAPS_API_KEY>', 'your_google_maps_api_key' | Set-Content '%ENV_FILE%'"
powershell -Command "(Get-Content '%ENV_FILE%') -replace 'NODE_ENV=development', 'NODE_ENV=production' | Set-Content '%ENV_FILE%'"

echo    ✅ .env file created at: %ENV_FILE%
echo.

REM Create data directory
set DATA_DIR=%BACKEND_DIR%\data
if not exist "%DATA_DIR%" (
    mkdir "%DATA_DIR%"
    echo    ✅ Data directory created: %DATA_DIR%
)

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  ✅ Security Setup Complete!                              ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo 📝 NEXT STEPS:
echo.
echo 1. Review and update %ENV_FILE% with your actual credentials:
echo    - ODBC_UID / ODBC_PWD (IBM i database)
echo    - CORS_ORIGINS (your production domain)
echo    - SMTP credentials (if sending emails)
echo    - Google Maps API key
echo.
echo 2. Build TypeScript files:
echo    cd backend ^&^& npm run build:ts
echo.
echo 3. Start the server:
echo    npm run start:ts
echo.
echo 4. IMPORTANT: Store this .env file securely!
echo    - Never commit to version control
echo    - Backup to secure secret manager
echo    - Rotate secrets periodically
echo.
echo 📖 For more information, see SECURITY_REPORT.md
echo.

endlocal
