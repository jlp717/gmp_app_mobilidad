@echo off
echo ===============================================
echo Copiando Android SDK 36 a la ubicacion antigua
echo ===============================================
echo.
echo IMPORTANTE: Ejecuta este archivo como ADMINISTRADOR
echo (clic derecho -> Ejecutar como administrador)
echo.
pause

robocopy "C:\Android\platforms\android-36" "C:\Program Files (x86)\Android\android-sdk\platforms\android-36" /E

echo.
echo ===============================================
echo Copia completada!
echo ===============================================
pause
