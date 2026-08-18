@echo off
REM Iniciar_Equipo.cmd - Arranca el equipo OpenCode completo en el repo actual.
REM Si el repo no tiene harness, lo bootstrapea desde gmp_app_mobilidad.
setlocal
set SOURCE=C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad
set DEST=%CD%

echo [Equipo] Repo actual: %DEST%

if exist "%DEST%\.opencode\config\chief-protocol.yaml" (
  echo [Equipo] Harness detectado. Arrancando...
) else (
  echo [Equipo] No hay harness. Bootstrapeando desde %SOURCE%...
  node "%SOURCE%\scripts\opencode\bootstrap-team.mjs" "%DEST%"
  if errorlevel 1 (
    echo [Equipo] Bootstrap fallo. Revisa que node este instalado y que la fuente exista.
    pause
    exit /b 1
  )
)

REM Arrancar OpenCode Web en el repo actual
start "" cmd /c "%SOURCE%\scripts\opencode\start-opencode-project.ps1"
echo [Equipo] OpenCode Web arrancando en http://127.0.0.1:3090
echo [Equipo] Habla con el Chief en lenguaje natural: Equipo, ...
pause
endlocal
