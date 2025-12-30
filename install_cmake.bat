@echo off
echo ===============================================
echo Instalando CMake 3.22.1 para Android
echo ===============================================
echo.

cd /d "C:\Android\cmdline-tools\12.0\bin"
call sdkmanager.bat "cmake;3.22.1"

echo.
echo ===============================================
echo Instalacion completada!
echo ===============================================
pause
