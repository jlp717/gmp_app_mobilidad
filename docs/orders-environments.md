# Entornos de pedidos y preparación del cambio

Run `orders-tablet-20261102`. No se ha editado el archivo de credenciales real, desplegado código, reiniciado PM2 ni habilitado producción durante este trabajo.

`backend/server.js` valida `APP_ENV` antes de cargar rutas, adaptadores de base de datos y tareas programadas. Los comandos `start`, `dev` y `api` usan ese mismo arranque. La selección es obligatoria: `test`, `demo` o `production`. Una combinación heredada que contradiga el perfil impide el arranque con un mensaje que identifica la variable.

| Perfil | Lecturas ERP | Buffers de aplicación | Escrituras al seleccionar sólo el perfil | Exportación ERP |
|---|---|---|---|---|
| test | DSEDAC / DSED | JAVIER.TEST_* | Permitidas en tablas de prueba | Desactivada |
| demo | DSEDAC / DSED | JAVIER.TEST_* | Permitidas en tablas de prueba | Desactivada |
| production | DSEDAC / DSED | JAVIER, sin prefijo TEST_ | Desactivadas hasta las aprobaciones existentes | Desactivada hasta sus aprobaciones existentes |

Las plantillas autorizadas son `backend/.env.test.example`, `backend/.env.demo.example` y `backend/.env.production.example`. No contienen credenciales. Se conservan las referencias de conexión ya administradas por el operador. Las aprobaciones de escritura deben proceder del entorno protegido del proceso; un archivo `.env` no puede crearlas.

## Migración inicial y verificación

El operador debe añadir `APP_ENV=demo` a la configuración protegida y retirar las variables antiguas de enrutamiento que contradigan el perfil. Esta limpieza es una operación inicial; después basta cambiar `APP_ENV` para seleccionar TEST o DEMO. No se debe forzar `NODE_ENV=production` mientras se use `isolated_test`.

Desde `backend`, antes de cualquier reinicio:

```sh
npm run env:verify -- --no-db
npm run env:verify
```

El primer comando sólo valida la configuración. El segundo abre una conexión dedicada y ejecuta `SELECT 1` y una consulta parametrizada a `QSYS2.SYSTABLES`; no inicia servidor, migraciones, trabajos ni escrituras. Imprime el perfil, los esquemas y los objetos ausentes; un fallo produce código de salida distinto de cero. Los errores ODBC se reducen a un código, sin imprimir credenciales.

En esta sesión se ejecutaron los resolutores y el verificador locales en memoria en el servidor con la conexión existente. Los tres perfiles encontraron los ocho objetos esperados, con `SELECT 1` correcto. No se instaló el nuevo arranque en el servidor. La evidencia está en `docs/audits/orders-tablet-20261102/env-profile-db-evidence.json`.

Flutter consulta `GET /api/runtime-profile` y muestra TEST, DEMO o PRODUCCIÓN junto al estado de escritura. Una respuesta ausente, no verificada o fallida muestra «Entorno sin verificar». Una instalación antigua del servidor no puede producir una etiqueta falsa de producción verificada.

## Activación de producción pendiente del operador

El cambio `APP_ENV=production` prepara un arranque de sólo lectura: no permite login mutante, pedidos, cobros ni tareas programadas de escritura. No equivale a aprobar la demo ni la producción.

Las reglas PROD de `AGENTS.md` siguen vigentes: staging, QA, AppSec, salud y autorización explícita `/adelante-production`, registrada con TTL máximo de 30 minutos. Tras esos gates, el operador puede inyectar las aprobaciones ya existentes en el entorno protegido del proceso:

```sh
APP_ENV=production
REPARTO_WRITES_ENABLED=true
REPARTO_PRODUCTION_WRITES_APPROVED=true
```

No se han activado esas variables. No es necesario un cambio posterior de código para que el perfil las reconozca. La exportación de pedidos al ERP requiere además las tres aprobaciones `PEDIDOS_EXPORT_TO_SYSTEM`, `PEDIDOS_DSEDAC_EXPORT_APPROVED` y `PEDIDOS_DSEDAC_STORAGE_APPROVED`; permanecen desactivadas. Las capacidades de reparto conservan sus propios gates y quedan fuera de esta activación comercial.

Después de verificar la configuración, únicamente el procedimiento de despliegue aprobado puede ejecutar las mutaciones de producción permitidas:

```sh
git pull origin test
pm2 restart gmp-api
```

No se debe ejecutar `pm2 --env production`, `--update-env`, `pm2 set` ni editar el entorno remoto como parte de una prueba de pedidos. El operador debe preparar la inyección de variables con su procedimiento autorizado antes del reinicio.

La comprobación posterior de salud es:

```sh
ssh gmp@192.168.1.230 'curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready'
```

La comprobación real anterior al despliegue devolvió HTTP 503 por un vendedor activo sin hash PIN (B2); DB2 y Redis respondieron. Este bloqueo de preparación no se ha corregido modificando autenticación ni secretos y requiere su procedimiento específico antes de declarar el entorno listo.

## Compatibilidad observada el 03/11/2026

El diagnóstico de enrutamiento `read-env-profile-conflicts.ps1` ejecutó únicamente el cargador/perfil fijados en `f4b025a`, sin abrir DB2, modificar archivos ni imprimir valores de credenciales. `environment-routing-conflicts-current.json` acredita que **APP_ENV=demo es compatible con la configuración heredada actual: cero contradicciones**. Su perfil mantiene DSEDAC/DSED para lectura, JAVIER.TEST_* para escritura y exportación apagada.

APP_ENV=test encuentra dos contradicciones: NODE_ENV y REPARTO_ENVIRONMENT; el perfil test exige ambos `test`. No se debe cambiar el servidor a TEST sólo para acomodar una sonda. Para esta instalación, el operador debe usar la línea `APP_ENV=demo`, ejecutar los dos comandos env:verify anteriores y seguir el despliegue autorizado. La comprobación de compatibilidad no instala ni reinicia nada.

APP_ENV=production encuentra cuatro selectores heredados que requieren la migración inicial antes de ser válido: NODE_ENV, REPARTO_ENVIRONMENT, REPARTO_TABLE_SET y REPARTIDOR_FINANCE_ERP_SCHEMA. El perfil espera respectivamente production, production, production y DSEDAC. El operador debe retirar esos selectores heredados de su configuración protegida para que APP_ENV derive la combinación, verificar el perfil de sólo lectura y completar los gates de activación. No se han retirado ni se han habilitado escrituras reales durante esta sesión.

La sonda financiera fijó TEST en vez del DEMO compatible; su tercer intento se detuvo antes de DB2 con INVALID_APP_ENV_PROFILE. Es un bloqueo de esa instrumentación bajo su límite de reparaciones, no evidencia de un cobro fallido ni de que el perfil DEMO sea inválido. No se vuelve a ejecutar Run sin una autorización nueva para esa unidad.
