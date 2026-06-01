@echo off
title Chief Engineer Assistant - GMP Mobile Mode
color 0A

echo ====================================================
echo   CHIEF ENGINEER ASSISTANT - MODO MOVIL
echo   Inicio: %DATE% %TIME%
echo ====================================================

set "OPENCODE_ENV_FILE=%USERPROFILE%\.config\opencode\.env"
if exist "%OPENCODE_ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%OPENCODE_ENV_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%TELEGRAM_BOT_TOKEN%"=="" ( echo [ERROR] TELEGRAM_BOT_TOKEN no configurado & pause & exit /b 1 )
if "%ELEVENLABS_API_KEY%"=="" ( echo [WARN] ELEVENLABS_API_KEY no configurado - voz desactivada )
if "%GITHUB_TOKEN%"=="" ( echo [WARN] GITHUB_TOKEN no configurado - GitHub ops limitadas )

set "SSH_EXE=ssh"
where ssh >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\Git\usr\bin\ssh.exe" set "SSH_EXE=C:\Program Files\Git\usr\bin\ssh.exe"
)
if exist "C:\Program Files\Git\usr\bin" set "PATH=C:\Program Files\Git\usr\bin;%PATH%"

echo [1/5] Verificando servicios en 192.168.1.230...
"%SSH_EXE%" -o BatchMode=yes -o ConnectTimeout=5 gmp@192.168.1.230 "python3 -c 'import chromadb; chromadb.HttpClient(host=\"localhost\", port=8000).list_collections()' >/dev/null && echo CHROMADB_OK || echo CHROMADB_FAIL" 2>nul
"%SSH_EXE%" -o BatchMode=yes -o ConnectTimeout=5 gmp@192.168.1.230 "redis-cli ping 2>/dev/null" | findstr "PONG" > nul && echo REDIS_OK || echo REDIS_FAIL
"%SSH_EXE%" -o BatchMode=yes -o ConnectTimeout=5 gmp@192.168.1.230 "curl -sf -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/health >/dev/null && echo GMP_API_OK || echo GMP_API_FAIL" 2>nul

set OPENCODE_CLIENT_TYPE=mobile
set OPENCODE_MOBILE_MODE=true
set OPENCODE_AGENT=chief-engineer-assistant

echo [2/5] Activando Chief Engineer mode...
echo [3/5] Cargando contexto RAG...
echo [4/5] Verificando ElevenLabs...
if not "%ELEVENLABS_API_KEY%"=="" (
  "%SSH_EXE%" -o BatchMode=yes -o ConnectTimeout=5 gmp@192.168.1.230 "curl -sf https://api.elevenlabs.io/v1/user -H 'xi-api-key:%ELEVENLABS_API_KEY%' >/dev/null && echo ELEVENLABS_OK || echo ELEVENLABS_FAIL" 2>nul
)

echo [5/5] Iniciando OpenCode en modo Chief Engineer...
echo.
echo Para activar voz: escribe /voice on
echo Para digest del dia: escribe /digest
echo Para peticiones al equipo: Equipo, [tu peticion]
echo Para agente especifico: @sre-engineer [peticion]
echo ====================================================
echo.

cd /d "%USERPROFILE%\Desktop\Repositorios\gmp_app_mobilidad"
opencode --config ".\opencode.json" --agent chief-engineer-assistant

pause
