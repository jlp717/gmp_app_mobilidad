@echo off
chcp 65001 >nul
echo ============================================================
echo    INSTALACION AUTOMATICA - GMP MOVILIDAD BACKEND
echo    Servidor: %COMPUTERNAME%
echo    Fecha: %date% %time%
echo ============================================================
echo.

REM Verificar si se ejecuta como Administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Este script debe ejecutarse como ADMINISTRADOR
    echo         Click derecho -^> Ejecutar como administrador
    pause
    exit /b 1
)

echo [1/6] Creando estructura de carpetas...
if not exist "C:\GMP_Mobile" mkdir "C:\GMP_Mobile"
if not exist "C:\GMP_Mobile\Backend" mkdir "C:\GMP_Mobile\Backend"
if not exist "C:\GMP_Mobile\Logs" mkdir "C:\GMP_Mobile\Logs"
echo [OK] Carpetas creadas: C:\GMP_Mobile\Backend y C:\GMP_Mobile\Logs
echo.

echo [2/6] Verificando Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js no encontrado. Descargando...
    echo     Por favor, instala Node.js LTS desde: https://nodejs.org
    echo     Despues de instalar, vuelve a ejecutar este script.
    start https://nodejs.org/en/download
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('node -v') do echo [OK] Node.js: %%i
)
echo.

echo [3/6] Instalando PM2 globalmente...
call npm install pm2 -g
if %errorlevel% neq 0 (
    echo [ERROR] Fallo al instalar PM2
    pause
    exit /b 1
)
echo [OK] PM2 instalado
echo.

echo [4/6] Instalando pm2-windows-startup...
call npm install pm2-windows-startup -g
echo [OK] pm2-windows-startup instalado
echo.

echo [5/6] Configurando PM2 para inicio automatico...
call pm2-startup install
echo [OK] PM2 configurado para auto-inicio
echo.

echo [6/6] Abriendo regla de firewall para puerto 3000 (local)...
netsh advfirewall firewall add rule name="GMP-API-3000" dir=in action=allow protocol=tcp localport=3000 >nul 2>&1
echo [OK] Regla de firewall creada (puerto 3000 local)
echo.

echo ============================================================
echo    INSTALACION COMPLETADA
echo ============================================================
echo.
echo SIGUIENTE PASO MANUAL:
echo 1. Copia los archivos del backend a C:\GMP_Mobile\Backend
echo    (Excepto node_modules - se instalara fresco)
echo 2. Abre PowerShell como Admin en C:\GMP_Mobile\Backend
echo 3. Ejecuta: npm install
echo 4. Ejecuta: pm2 start server.js --name "gmp-api"
echo 5. Ejecuta: pm2 save
echo.
echo El backend estara corriendo 24/7 en localhost:3000
echo ============================================================
pause
