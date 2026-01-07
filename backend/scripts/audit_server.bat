@echo off
chcp 65001 >nul
echo ============================================================
echo    AUDITORIA COMPLETA DEL SERVIDOR - GMP MOVILIDAD
echo    Fecha: %date% %time%
echo ============================================================
echo.

echo [1/8] SISTEMA OPERATIVO
echo --------------------------------------------------------
ver
systeminfo | findstr /B /C:"OS Name" /C:"OS Version" /C:"System Type"
echo.

echo [2/8] NODE.JS
echo --------------------------------------------------------
where node >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('node -v') do echo [OK] Node.js instalado: %%i
) else (
    echo [X] Node.js NO INSTALADO
    echo     Descarga: https://nodejs.org/en/download
)
echo.

echo [3/8] NPM
echo --------------------------------------------------------
where npm >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('npm -v') do echo [OK] NPM instalado: %%i
) else (
    echo [X] NPM NO INSTALADO
)
echo.

echo [4/8] GIT
echo --------------------------------------------------------
where git >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('git --version') do echo [OK] Git instalado: %%i
) else (
    echo [!] Git NO instalado (no critico si copias archivos manual)
)
echo.

echo [5/8] CONECTIVIDAD INTERNET
echo --------------------------------------------------------
ping -n 1 google.com >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Internet conectado
) else (
    echo [X] SIN INTERNET - Cloudflare NO funcionara
)
echo.

echo [6/8] PUERTO 3000 (Backend API)
echo --------------------------------------------------------
netstat -an | findstr ":3000" >nul 2>&1
if %errorlevel%==0 (
    echo [!] PUERTO 3000 YA EN USO:
    netstat -ano | findstr ":3000"
) else (
    echo [OK] Puerto 3000 disponible
)
echo.

echo [7/8] DRIVER ODBC AS400/iSeries
echo --------------------------------------------------------
reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI" 2>nul | findstr /I "iSeries\|AS400\|IBM" >nul
if %errorlevel%==0 (
    echo [OK] Driver ODBC IBM detectado
    reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI" 2>nul | findstr /I "iSeries\|AS400\|IBM"
) else (
    echo [?] Driver ODBC IBM no detectado en registro estandar
    echo     Verificar si Client Access esta instalado
)
echo.

echo [8/8] FIREWALL WINDOWS
echo --------------------------------------------------------
netsh advfirewall show currentprofile state 2>nul | findstr "ON OFF"
echo.

echo ============================================================
echo    RESUMEN DE PROXIMOS PASOS
echo ============================================================
echo 1. Crear carpeta: C:\GMP_Mobile\Backend
echo 2. Copiar archivos del backend (sin node_modules)
echo 3. Abrir PowerShell como Admin en esa carpeta
echo 4. Ejecutar: npm install
echo 5. Ejecutar: npm install pm2 -g
echo ============================================================
pause
