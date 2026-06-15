@echo off
setlocal EnableExtensions EnableDelayedExpansion

title GMP Chief Engineer - OpenCode Web (Supervisor)

set "PROJECT_DIR=%USERPROFILE%\Desktop\Repositorios\gmp_app_mobilidad"
set "STARTER=%PROJECT_DIR%\scripts\opencode\start-opencode-project.ps1"
set "RESTARTER=%PROJECT_DIR%\scripts\opencode\restart-opencode-web-gmp.ps1"
set "PORT=3090"
set "CREDENTIAL_FILE=%PROJECT_DIR%\.opencode-runtime\opencode-web-gmp.credentials"
set "SUPERVISOR_LOCK=%PROJECT_DIR%\.opencode-runtime\opencode-web-gmp-supervisor.lock"
set "LOCAL_URL=http://127.0.0.1:%PORT%"
set "MOBILE_URL=http://100.107.11.80:%PORT%"
set "HISTORY_DB_SOURCE=%USERPROFILE%\.local\share\opencode\opencode.db"
set "HISTORY_DB_TARGET=%PROJECT_DIR%\.opencode-runtime\opencode\opencode.db"

set "OPENCODE_CLIENT_TYPE=mobile"
set "OPENCODE_MOBILE_MODE=true"
set "OPENCODE_AGENT=chief-engineer-assistant"
set "MOBILE_TRIGGER_KEYWORD=Equipo"
if not defined OPENCODE_SERVER_USERNAME set "OPENCODE_SERVER_USERNAME=Javier"

set "CHECK_INTERVAL_SECONDS=8"
set "DETECTED_DOWN_THRESHOLD=4"
set "LOG_DIR=%PROJECT_DIR%\.opencode\logs"
set "SUPERVISOR_LOG=%LOG_DIR%\opencode-web-gmp-supervisor.log"
set "CONSECUTIVE_FAILURES=0"
set "DETECTED_DOWN_COUNT=0"

if not exist "%PROJECT_DIR%" (
  echo ERROR: no existe el proyecto: %PROJECT_DIR%
  exit /b 1
)

if not exist "%STARTER%" (
  echo ERROR: no existe el launcher de arranque: %STARTER%
  exit /b 1
)

if not exist "%RESTARTER%" (
  echo ERROR: no existe el restart script: %RESTARTER%
  exit /b 1
)

if not exist "%PROJECT_DIR%\.opencode-runtime" mkdir "%PROJECT_DIR%\.opencode-runtime"

if exist "%CREDENTIAL_FILE%" (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "if (Test-Path '%CREDENTIAL_FILE%') { $pw = Get-Content -LiteralPath '%CREDENTIAL_FILE%' -Raw; if ($pw) { Write-Output $pw.Trim() } }"` ) do set "OPENCODE_SERVER_PASSWORD=%%P"
)

if not defined OPENCODE_SERVER_PASSWORD (
  for /f %%P in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString(\"N\")"') do set "OPENCODE_SERVER_PASSWORD=%%P"
  powershell -NoProfile -Command "[System.IO.File]::WriteAllText('%CREDENTIAL_FILE%', $env:OPENCODE_SERVER_PASSWORD)"
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%PROJECT_DIR%\.opencode-runtime\opencode" mkdir "%PROJECT_DIR%\.opencode-runtime\opencode"
call :restore_legacy_history

call :acquire_lock
if errorlevel 1 (
  exit /b 1
)

call :log "supervisor iniciado (PID=%~n0, PORT=%PORT%)"
call :start_web

echo.
echo OpenCode Web (monitoreo activo) listo.
echo Local: %LOCAL_URL%
echo Movil: %MOBILE_URL%
start "" "%LOCAL_URL%"
echo Presiona CTRL+C para detener. El script quedara esperando y reiniciando si el puerto cae.

:monitor_loop
call :refresh_password
call :is_web_alive
if errorlevel 1 (
  set /a "DETECTED_DOWN_COUNT+=1"
  call :log "detected_down count=!DETECTED_DOWN_COUNT!"
  if !DETECTED_DOWN_COUNT! GEQ %DETECTED_DOWN_THRESHOLD% (
    call :is_port_alive
    if errorlevel 1 (
      set /a "CONSECUTIVE_FAILURES+=1"
      call :log "puerto no responde -> intentando reinicio (intentos=%CONSECUTIVE_FAILURES%)"
      call :restart_web
      if errorlevel 1 (
        call :retry_delay
        call :log "reinicio fallido; reintento en !DELAY!s"
        timeout /t !DELAY! /nobreak >nul
      ) else (
        set "CONSECUTIVE_FAILURES=0"
        set "DETECTED_DOWN_COUNT=0"
        call :log "reinicio correcto"
      )
    ) else (
      set "DETECTED_DOWN_COUNT=0"
      set "CONSECUTIVE_FAILURES=0"
      call :log "puerto activo pero auth falla con credenciales actuales; se mantiene sin reiniciar para evitar bucle"
    )
    set "DETECTED_DOWN_COUNT=0"
  )
) else (
  set "DETECTED_DOWN_COUNT=0"
  set "CONSECUTIVE_FAILURES=0"
)
call :touch_lock
timeout /t %CHECK_INTERVAL_SECONDS% /nobreak >nul
goto :monitor_loop

:start_web
set "INITIAL_ATTEMPT=0"
:start_web_attempt
set /a "INITIAL_ATTEMPT+=1"
call :log "inicio inicial intento=%INITIAL_ATTEMPT%"
cd /d "%PROJECT_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%STARTER%" -Project gmp -RestartWeb -SkipFallbackRuntime
if errorlevel 1 (
  set "DELAY=10"
  if !INITIAL_ATTEMPT! gtr 4 set "DELAY=20"
  if !INITIAL_ATTEMPT! gtr 7 set "DELAY=30"
  call :log "fallo inicial, esperando !DELAY!s antes de reintentar"
  timeout /t !DELAY! /nobreak >nul
  goto :start_web_attempt
)
call :log "inicio inicial correcto"
exit /b 0

:is_web_alive
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(12); $pair = '{0}:{1}' -f $env:OPENCODE_SERVER_USERNAME, $env:OPENCODE_SERVER_PASSWORD; $encoded = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair)); $ok = $false; while ((Get-Date) -lt $deadline) { try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%' -Headers @{ Authorization = \"Basic $encoded\" } -UseBasicParsing -TimeoutSec 3; if (($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) -or $response.StatusCode -eq 401 -or $response.StatusCode -eq 403) { $ok = $true; break } } catch { if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode; if (($statusCode -ge 200 -and $statusCode -lt 400) -or $statusCode -eq 401 -or $statusCode -eq 403) { $ok = $true; break } } } Start-Sleep -Seconds 1 }; if ($ok) { exit 0 }; exit 1"
endlocal
exit /b %errorlevel%

:is_port_alive
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $task = $client.BeginConnect('127.0.0.1',%PORT%, $null, $null); if (-not $task.AsyncWaitHandle.WaitOne(1000)) { exit 1 }; $client.EndConnect($task); exit 0 } catch { exit 1 } finally { $client.Close() }"
endlocal
exit /b %errorlevel%

:refresh_password
if exist "%CREDENTIAL_FILE%" (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "if (Test-Path '%CREDENTIAL_FILE%') { $pw = Get-Content -LiteralPath '%CREDENTIAL_FILE%' -Raw; if ($pw) { Write-Output $pw.Trim() } }"` ) do set "OPENCODE_SERVER_PASSWORD=%%P"
)
exit /b 0

:restart_web
call :log "reiniciando OpenCode Web"
set "RESTART_OK=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%RESTARTER%"
if errorlevel 1 (
  set "RESTART_OK=1"
) else (
  set "RESTART_OK=0"
)
exit /b %RESTART_OK%

:retry_delay
set "DELAY=5"
if !CONSECUTIVE_FAILURES! geq 2 set "DELAY=8"
if !CONSECUTIVE_FAILURES! geq 3 set "DELAY=12"
if !CONSECUTIVE_FAILURES! geq 4 set "DELAY=20"
if !CONSECUTIVE_FAILURES! geq 6 set "DELAY=30"
exit /b 0

:log
echo [%date% %time%] %*>> "%SUPERVISOR_LOG%"
echo [%date% %time%] %*
exit /b 0

:touch_lock
if not defined LOCK_HELD exit /b 0
powershell -NoProfile -Command "$lock = '%SUPERVISOR_LOCK%'; if (Test-Path $lock) { [System.IO.File]::WriteAllText($lock, (Get-Date -Format o)) }"
exit /b 0

:acquire_lock
for /f "tokens=* delims=" %%P in ('powershell -NoProfile -Command "$lock = '%SUPERVISOR_LOCK%'; if (Test-Path $lock) { $age = (Get-Date) - (Get-Item $lock).LastWriteTime; if ($age.TotalSeconds -lt 120) { exit 10 } } [System.IO.File]::WriteAllText($lock, (Get-Date -Format o)); Write-Output 'ok'"') do set "LOCK_ACQUIRED=%%P"
if errorlevel 10 (
  call :log "supervisor ya activo (lock=%SUPERVISOR_LOCK%)"
  exit /b 1
)
set "LOCK_HELD=1"
if defined LOCK_ACQUIRED call :log "lock de supervisor tomado"
exit /b 0

:restore_legacy_history
if not exist "%HISTORY_DB_SOURCE%" exit /b 0
if not exist "%HISTORY_DB_TARGET%" (
  call :log "historial runtime no existe -> restaurando desde %HISTORY_DB_SOURCE%"
  call :copy_legacy_history
  exit /b 0
)

set "SOURCE_BYTES=0"
set "TARGET_BYTES=0"
for %%S in ("%HISTORY_DB_SOURCE%") do set "SOURCE_BYTES=%%~zS"
for %%T in ("%HISTORY_DB_TARGET%") do set "TARGET_BYTES=%%~zT"

if %TARGET_BYTES% GTR 5242880 goto :legacy_history_done
if %SOURCE_BYTES% LEQ 100000000 goto :legacy_history_done

call :log "restaurando historial legacy: target=%HISTORY_DB_TARGET%(%TARGET_BYTES% bytes), source=%HISTORY_DB_SOURCE%(%SOURCE_BYTES% bytes)"
call :copy_legacy_history
if errorlevel 1 (
  call :log "restauracion legacy fallida: no se pudo copiar %HISTORY_DB_SOURCE% a %HISTORY_DB_TARGET%"
  exit /b 1
)
call :log "restauracion de historial completada"

:legacy_history_done
exit /b 0

:copy_legacy_history
powershell -NoProfile -Command "try { Copy-Item -LiteralPath '%HISTORY_DB_SOURCE%' -Destination '%HISTORY_DB_TARGET%' -Force; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  exit /b 1
)
exit /b 0

endlocal
exit /b 0
