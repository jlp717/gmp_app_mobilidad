@echo off
setlocal
title GMP Chief Engineer - OpenCode Web

set "PROJECT_DIR=%USERPROFILE%\Desktop\Repositorios\gmp_app_mobilidad"
set "STARTER=%PROJECT_DIR%\scripts\opencode\start-opencode-project.ps1"
set "LOCAL_URL=http://127.0.0.1:3090"
set "MOBILE_URL=http://100.107.11.80:3090"

set "XDG_CONFIG_HOME=%USERPROFILE%\.opencode-runtime"
set "OPENCODE_CLIENT_TYPE=mobile"
set "OPENCODE_MOBILE_MODE=true"
set "OPENCODE_AGENT=chief-engineer-assistant"
set "MOBILE_TRIGGER_KEYWORD=Equipo"

if not exist "%PROJECT_DIR%" (
  echo ERROR: no existe el proyecto: %PROJECT_DIR%
  pause
  exit /b 1
)

if not exist "%STARTER%" (
  echo ERROR: no existe el launcher: %STARTER%
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%STARTER%" -Project gmp -RestartWeb
set "START_EXIT=%ERRORLEVEL%"

if not "%START_EXIT%"=="0" (
  echo.
  echo ERROR: OpenCode Web no ha arrancado correctamente.
  echo Revisa los logs en %PROJECT_DIR%\.opencode\logs
  pause
  exit /b %START_EXIT%
)

echo.
echo OpenCode Web listo.
echo Local: %LOCAL_URL%
echo Movil: %MOBILE_URL%
start "" "%LOCAL_URL%"
ping -n 6 127.0.0.1 >nul

endlocal
exit /b 0
