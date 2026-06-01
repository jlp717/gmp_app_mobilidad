@echo off
setlocal
title GMP Chief Engineer - OpenCode Web

set "XDG_CONFIG_HOME=%USERPROFILE%\.opencode-runtime"
set "OPENCODE_CLIENT_TYPE=mobile"
set "OPENCODE_MOBILE_MODE=true"
set "OPENCODE_AGENT=chief-engineer-assistant"
set "MOBILE_TRIGGER_KEYWORD=Equipo"

cd /d "%USERPROFILE%\Desktop\Repositorios\gmp_app_mobilidad"
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project gmp

endlocal
