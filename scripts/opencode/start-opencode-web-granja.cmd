@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project granja
endlocal
