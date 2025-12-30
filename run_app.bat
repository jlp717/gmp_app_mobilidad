@echo off
echo ====================================
echo GMP App - Limpieza y Ejecucion
echo ====================================
echo.

echo [1/5] Matando procesos de Gradle y Java...
taskkill /F /IM java.exe 2>nul
taskkill /F /IM gradle.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/5] Borrando cache de Gradle...
rmdir /s /q "%USERPROFILE%\.gradle\caches" 2>nul

echo [3/5] Limpiando proyecto Flutter...
call flutter clean

echo [4/5] Configurando variables de entorno...
set ANDROID_HOME=C:\Android
set ANDROID_SDK_ROOT=C:\Android

echo [5/5] Ejecutando app en dispositivo Android...
echo.
echo IMPORTANTE: Asegurate de que tu movil este conectado por USB
echo.
call flutter run -d dd3c697b

pause
