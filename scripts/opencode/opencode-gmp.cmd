@echo off
setlocal
title GMP Chief Engineer - Terminal

set "TERM=xterm-256color"
set "COLORTERM=truecolor"
set "XDG_CONFIG_HOME=%USERPROFILE%\.opencode-runtime"
set "OPENCODE_AGENT=chief-engineer-assistant"
set "MOBILE_TRIGGER_KEYWORD=Equipo"

cd /d "%USERPROFILE%\Desktop\Repositorios\gmp_app_mobilidad"
opencode --pure --config ".\opencode.json" --agent chief-engineer-assistant %*

endlocal
