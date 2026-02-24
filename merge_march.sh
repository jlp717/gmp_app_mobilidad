cd /c/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad
git checkout test
git pull origin test
git cherry-pick 022ef13
# Si hay conflicto, abrir en VS Code, aceptar los cambios de "backend/utils/common.js" y "backend/routes/*" y correr:
# git add .
# git cherry-pick --continue
# Y luego generar versión:
flutter clean
flutter build apk --release
pm2 restart gmp-api
