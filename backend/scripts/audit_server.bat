@echo off
echo ========================================================
echo AUDITORIA DEL SERVIDOR - GMP MOVILIDAD
echo ========================================================
echo.

echo [1/4] Verificando Sistema Operativo...
ver
echo.

echo [2/4] Verificando Node.js...
node -v > remove_me_version.txt 2>&1
set /p NodeVer=<remove_me_version.txt
del remove_me_version.txt
if "%NodeVer%"=="" (
    echo [X] Node.js NO DETECTADO. Debes instalarlo (v20 Recomendado).
    echo     Descarga: https://nodejs.org/en/download
) else (
    echo [OK] Node.js Instalado: %NodeVer%
)
echo.

echo [3/4] Verificando Git...
git --version > remove_me_git.txt 2>&1
set /p GitVer=<remove_me_git.txt
del remove_me_git.txt
if "%GitVer%"=="" (
    echo [!] Git NO DETECTADO. (No es critico si copias los archivos a mano).
) else (
    echo [OK] Git Instalado: %GitVer%
)
echo.

echo [4/4] Verificando Acceso a Internet (Google.com)...
ping google.com -n 1 > nul
if errorlevel 1 (
    echo [X] SIN ACCESO A INTERNET DETECTADO.
    echo     Cloudflare Tunnel NO funcionara sin internet.
) else (
    echo [OK] Internet Conectado.
)
echo.

echo ========================================================
echo INSTRUCCIONES SIGUIENTES:
echo 1. Si falta Node.js, instalalo.
echo 2. Copia la carpeta 'backend' a C:\GMP_Mobile\Backend
echo 3. Abre PowerShell como Administrador en esa carpeta.
echo 4. Ejecuta: npm install
echo ========================================================
pause
