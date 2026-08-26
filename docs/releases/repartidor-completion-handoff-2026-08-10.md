# Handoff de finalizaciÃ³n del perfil de reparto

Fecha de corte: 2026-08-10  
Repositorio: `gmp_app_mobilidad`  
Rama local en el corte: `test`  
HEAD local y `origin/test` en el Ãºltimo preflight: `10143aac6b045d1540b62107b8f29f00bc9a38bb`

## 1. PropÃ³sito y regla de verdad

Este documento permite que otra IA continÃºe el trabajo hasta completarlo, sin repetir el descubrimiento ya realizado y sin saltarse los gates de seguridad, DB2 o producciÃ³n.

El estado actual **no se puede declarar al 100% ni listo para producciÃ³n**. Hay cÃ³digo muy avanzado y varias verificaciones independientes verdes, pero todavÃ­a faltan:

1. Corregir dos brechas fail-closed del ejecutor DDL aislado.
2. Repetir una verificaciÃ³n independiente final de auth despuÃ©s del Ãºltimo barrido de logs.
3. Sincronizar dependencias y ejecutar las baterÃ­as completas de backend y Flutter sobre el Ã¡rbol final.
4. Ejecutar y verificar el DDL Ãºnicamente en `JAVIER.TEST_*`.
5. Completar staging/E2E, QA, AppSec y SRE.
6. Rotar secretos JWT que estuvieron expuestos en el historial Git.
7. Resolver la contradicciÃ³n entre el despliegue solicitado desde `test` y la polÃ­tica productiva que solo admite `main`.
8. Ejecutar, si todos los gates estÃ¡n verdes y Javier dice literalmente `adelante`, el DDL aditivo de producciÃ³n, el despliegue acotado y la comprobaciÃ³n post-despliegue.
9. Restaurar los ACL temporales y cerrar el issue de beads.

Ninguna credencial se incluye en este documento. La IA sucesora no debe copiar secretos a comandos, logs, tickets, commits ni respuestas.

## 2. Restricciones no negociables

- Nunca ejecutar `DELETE` en DB2.
- Nunca ejecutar DDL ni DML contra `DSEDAC`. Las consultas de catÃ¡logo o datos en `DSEDAC` solo pueden ser de lectura y deben estar justificadas.
- Toda escritura DB2 nueva pertenece a `JAVIER` o `JAVIER.TEST_*` segÃºn la fase.
- No usar `DROP`, `TRUNCATE`, limpieza destructiva ni reparaciÃ³n automÃ¡tica de un DDL parcial.
- No ejecutar DDL productivo, rotaciÃ³n de secretos, despliegue, rollback, push forzado ni reescritura de historial sin aprobaciÃ³n fresca y los gates requeridos.
- En el servidor, el usuario ha limitado el despliegue a dos operaciones: `git pull origin <rama autorizada>` y `pm2 restart gmp-api`.
- Nunca usar `pm2 restart all`, `pm2 reload`, `pm2 delete` ni un hook PM2 de deploy.
- Preservar las 49 entradas locales del worktree remoto; no borrarlas, moverlas ni sobreescribirlas.
- No ejecutar `git reset --hard`, `git checkout --`, `git clean` ni `git add -A`.
- Flutter nunca accede directamente a DB2.
- Los guards de confirmaciÃ³n y finanzas siguen separados. `REPARTO_FINANCE_DB2_CAPABILITY_APPROVED` debe permanecer `false` por defecto.
- ProducciÃ³n debe fallar cerrada si Redis no estÃ¡ disponible. Los tokens anteriores pueden requerir nuevo login, decisiÃ³n ya aceptada por Javier.
- La pÃ¡gina protegida `lib/features/entregas/presentation/pages/albaran_detail_page.dart` debe conservar el SHA-256 `DD4D515F630E4566638BACB77ECDB6986D07E8ADDC6372AEBCDBA9E74336CDAF`.

## 3. Snapshot verificable del cÃ³digo

Antes de continuar, calcular de nuevo estos hashes. Si cualquiera cambia, detenerse y revisar el diff antes de usar la evidencia de este documento.

| Archivo | SHA-256 en el corte |
|---|---|
| `backend/middleware/auth.js` | `673B3E79B35DE24C15E5E3D753F7DFD4E7ADDB864A09E2DFF362EECAF82A2C25` |
| `lib/core/api/api_config.dart` | `994E000B687DF7E5C866218D3790A2F5B9060C7B5FAB6C6F29EDA7F30C2A8B5C` |
| `backend/routes/repartidor-finanzas.js` | `3A5C2C4D7E126B0AD159A71801B514FA8316113EC79F4F34F8AA0512464A3081` |
| `backend/repositories/repartidor-liquidacion-db2-repository.js` | `2E947B894409B33BA384EE459BDF26EF9DD67C223D668790BDAC716033A17BD4` |
| `backend/scripts/reparto-isolated-ddl-runner.js` | `074BE6082AE8350772E521930492127E7F8D7264BF3DDAB711CF64DCAEA6B369` |
| `backend/scripts/reparto-isolated-ddl-manifest.js` | `90620341536D84C5C06064F7D8E68834F931F7512AC201FEBF86B377F5B6AA90` |
| SQL 033 | `75F229BE53F545E3F404E422010734566FA5B84BF1C110C89F2BD4A11D95F6CD` |
| SQL 034 | `11EB5954A87D66D96FCB3E2C859D182E1BAB24617D6E58E184FD91FE4E52CEA8` |
| SQL 035 | `AB5CFF817C7E0E9D88A421885170B693C08DC032BC76CFEA5DC608C9911A8520` |
| SQL 036 | `10DBF06952F1259A3C9436C1A2FA8A1438AB6904496212FB3EBF8FD55B7C9400` |
| SQL 037 | `0FE885DAFE43428BCF143F3AA9D8847FE03C921F6B6FF2C97F6E954CD0B2BF2B` |

## 4. Evidencia verde ya obtenida

Esta evidencia es vÃ¡lida Ãºnicamente para los hashes o estados indicados. No sustituye las baterÃ­as completas pendientes.

### 4.1 Recibo y evidencias

- Ruta canÃ³nica GET por `confirmationId` o `idempotencyKey`, selector exclusivo.
- Ownership comprobado antes de cargar PII, lÃ­neas, evidencia binaria o cobro.
- Un solo deadline absoluto y un Ãºnico `AbortSignal` en snapshot, evidencia y render.
- CancelaciÃ³n/close DB2 y ausencia de consultas posteriores tras timeout.
- PDF construido desde snapshot persistido, con cantidades, cobro y observaciones reales.
- `private, no-store`, sin ETag, coalescing ni cache para 401/422/403/404/503/504/200.
- Endpoints legacy de recibo/email devuelven 410 antes de DB/envÃ­o.
- VerificaciÃ³n independiente: 18 suites, 197/197 tests PASS, sin `forceExit`.

### 4.2 LiquidaciÃ³n backend y seguridad de catÃ¡logo

- Runtime y servicios activos ya no dependen de `LQD` ni escriben/leen `DSEDAC.LQD`.
- Replay y resÃºmenes usan `liquidationOps`.
- CatÃ¡logo bidireccional: columnas, ordinales, metadata, constraints e Ã­ndices Ãºnicos/no Ãºnicos; extras y faltantes devuelven 503 antes de `BEGIN`.
- Sentry solo recibe `action`, `requestId`, `status` y `code` allowlisted.
- Logs de denegaciÃ³n y cache no contienen IDs, patrones ni errores crudos.
- SQL 034/035 no contienen `DSEDAC` ni `TEST_LQD`; 035 detecta firmas extra/faltantes.
- VerificaciÃ³n independiente final: PASS; harness de cinco drifts extra produjo 503 con `BEGIN=0`.

### 4.3 LiquidaciÃ³n Flutter

- Contrato de transporte preserva HTTP status.
- Solo acepta `201 + created:true` y `200 + created:false`.
- Fingerprint JSON canÃ³nico sin ambigÃ¼edad por delimitadores.
- 409/503/timeout/offline de Dio se convierten en excepciones tipadas y saneadas.
- Reintentos conservan el mismo token; doble submit tiene mutex.
- `createdAt` rechaza fechas civiles imposibles.
- VerificaciÃ³n independiente final: 26/26 PASS, 0 errores/warnings, sin red externa.

### 4.4 Auth y Redis

- Backend usa claims canÃ³nicos `sid/sub/jti`.
- Switch de privilegio crea SID nuevo y revoca el anterior.
- Refresh revalida DB2, conserva SID y rota access/refresh JTI.
- Logout canÃ³nico revoca; Flutter hace un Ãºnico POST con bearer antes de limpiar localmente.
- Login/login con rol aplican commit local fail-closed; fallos de almacenamiento limpian la sesiÃ³n.
- JEFE/REPARTIDOR/ALMACEN proyectan perfil y scopes completos.
- ProducciÃ³n fuerza Redis y devuelve 503 si Redis no estÃ¡ listo.
- Ãšltimo barrido: 17 familias de log pasan por un emisor allowlisted; solo metadata entera `count/suppressed`; 52/52 pruebas focales PASS.
- **Pendiente:** una IA independiente debe repetir la matriz final sobre el hash `673B...A2C25`. La verificaciÃ³n anterior detectÃ³ una fuga y terminÃ³ antes de poder certificar el Ãºltimo arreglo.

### 4.5 Reparto, historial y planner

- Semana/rutero no infieren entregado por fecha pasada y usan identidad documental completa.
- Enrichment de pedidos falla 503, nunca fabrica `SIN_PEDIDO` ante error DB2.
- Historial pagina documentos lÃ³gicos, conserva subempresa/cliente, evita doble importe y no inventa deuda.
- Collections CVC usa clave completa y falla cerrado si falta o es contradictoria.
- Delivery summary aplica precedencia canÃ³nica exclusiva.
- Parsers Flutter de entregas fallan cerrados y limpian estado al cambiar de repartidor.

### 4.6 Servidor, Redis y salud actuales

Ãšltimo preflight read-only:

- 7/7 workers `gmp-api` online.
- Puerto 3335 escuchando.
- `/api/health` = 200.
- `/api/ready` = 200 con `User-Agent: GMP-SRE-HealthCheck/1.0`.
- Redis PING = PASS; una configuraciÃ³n efectiva y consistente.
- Node remoto >= 20.6 en los siete workers.
- Aproximadamente 71 GB libres y 11 GB de memoria disponible.
- Los seis flags de reparto estaban `unset` en los siete workers.
- Rama remota: `test`; HEAD coincidente con el corte; 49 entradas locales no tracked/modificadas que se deben preservar.

## 5. Bloqueadores actuales

### B1. El ejecutor DDL todavÃ­a no es confiable

Archivo: `backend/scripts/reparto-isolated-ddl-runner.js`.

La suite oficial pasa 37/37, pero el verificador independiente encontrÃ³ dos categorÃ­as que deben repararse antes de cualquier conexiÃ³n DB2:

1. `EXECUTE IMMEDIATE` acepta una expresiÃ³n compuesta; la validaciÃ³n solo extrae el primer literal. Debe aceptar exclusivamente un Ãºnico literal SQL completo.
2. La allowlist solo inspecciona referencias calificadas. Nombres no calificados pueden resolverse mediante `DBQ=JAVIER` fuera del contrato aislado.

No ejecutar `--execute` hasta que una nueva verificaciÃ³n independiente dÃ© `valid=true`.

### B2. Auth necesita dictamen independiente sobre el Ãºltimo hash

El producto y las pruebas del writer estÃ¡n verdes, pero falta repetir externamente:

- Todas las ramas de rechazo/log con canarios de usuario, rol, token, IP, SQL, path y stack.
- `requireJefeVentas` sin ID de usuario.
- Login/loginWithRole, switch, refresh y logout completos.
- `API_BASE_URL=https://invalid.invalid` efectivo con adapter fake y cero egress.

### B3. Dependencias y baterÃ­as completas no estÃ¡n certificadas

- `backend/node_modules` quedÃ³ obsoleto respecto a `package-lock.json`.
- El lock eliminÃ³ `jest-junit`, exige Node `>=20.6.0` y fija override `minimatch 9.0.9`.
- Falta `npm ci`, rebuild de `bcrypt/odbc`, `npm ls`, audit y las 125 suites backend.
- Faltan las 89 suites Flutter completas, analyze final, build_runner y APK release.

### B4. Secretos JWT histÃ³ricos

`backend/.env.produccion` estuvo versionado en dos commits histÃ³ricos. Un scan redacted identificÃ³ dos JWT signing secrets. No se compararon valores actuales, pero se deben tratar como expuestos.

ProducciÃ³n queda bloqueada hasta que un propietario:

1. Rote `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` mediante el store autorizado.
2. Fuerce nuevo login de las sesiones anteriores.
3. Acredite que los valores histÃ³ricos estÃ¡n revocados.
4. Decida aparte si reescribe el historial Git; reescribir historial no sustituye la rotaciÃ³n.

No rotar secretos automÃ¡ticamente. No incluir valores en ningÃºn output.

### B5. Rama y worktree remoto

- El usuario pidiÃ³ desplegar con `git pull origin test`.
- La polÃ­tica productiva del proyecto permite producciÃ³n solo desde `main`.
- El servidor productivo estÃ¡ actualmente en `test` y conserva 49 entradas locales.

La IA sucesora debe detenerse y obtener una decisiÃ³n explÃ­cita de Javier/SRE:

- declarar ese host como staging y mantener `test`, o
- promover el cambio a `main` y desplegar `main` conforme a la polÃ­tica.

No asumir que la instrucciÃ³n de `test` invalida el gate productivo. No limpiar las 49 entradas.

## 6. Plan de ejecuciÃ³n, en orden obligatorio

### Fase 0. Reanudar sin destruir el worktree

1. Leer `AGENTS.md`, `.opencode/AGENTS.md` y este documento completos.
2. Ejecutar `bd prime` y abrir `gmp_app_mobilidad-xlx`.
3. Confirmar rama/HEAD y hashes de la secciÃ³n 3.
4. Guardar `git status --short` y clasificar cambios propios frente a cambios previos del usuario.
5. No usar `git add -A`, reset, checkout ni clean.
6. Crear un graph manifest: un writer por archivo y verificadores read-only separados.

Gate de salida: snapshot reproducible y ningÃºn hash crÃ­tico cambiado sin explicaciÃ³n.

### Fase 1. Reparar el runner DDL

Cambiar solo runner y tests; no modificar SQL ni el manifest salvo que un hash cambie legÃ­timamente.

#### 1.1 `EXECUTE IMMEDIATE`

- El lexer debe contar cada ocurrencia de `EXECUTE IMMEDIATE` fuera de comments/strings.
- Cada ocurrencia debe tener como expresiÃ³n **exactamente un Ãºnico literal string DB2**.
- Tras el literal solo se admite whitespace y el delimitador sintÃ¡ctico esperado.
- Rechazar concatenaciÃ³n, variables, funciones, parÃ¡metros, hex literals, expresiones, mÃºltiples literales o tokens residuales.
- Decodificar comillas escapadas y validar el payload completo resultante.
- El nÃºmero de payloads extraÃ­dos debe ser igual al nÃºmero de `EXECUTE IMMEDIATE` encontrados.

#### 1.2 Referencias a objetos

- Exigir cualificaciÃ³n explÃ­cita en `CREATE`, `ALTER`, `REFERENCES`, `INDEX ... ON`, `SEQUENCE`, `FROM` y `JOIN`.
- En 033/034 solo permitir objetos exactos `JAVIER.TEST_*` incluidos en el manifest.
- En 035 solo permitir `QSYS2.*`, `SYSIBM.SYSDUMMY1` y los `JAVIER.TEST_*` exactos del verificador.
- Rechazar quoted identifiers, case tricks, Unicode confusable, comentarios intercalados y nombres no cualificados si no se normalizan de forma inequÃ­voca.
- No implementar una allowlist basada Ãºnicamente en regex parciales; el lexer debe cubrir strings, comments y delimitadores.

#### 1.3 Pruebas mÃ­nimas

- ExpresiÃ³n dinÃ¡mica compuesta, variable, funciÃ³n, hex y mÃºltiples literales: reject.
- Objetos no cualificados en DDL y SELECT/WITH: reject.
- Referencia no allowlisted tras `FROM`, `JOIN`, `REFERENCES` e `INDEX ON`: reject.
- SQL 033/034/035 reales y sus hashes: accept.
- Path escape, symlink, digest, statement count, DSN/schema, partial/extra catalog, STOP, fail-fast y resource close: conservar verdes.
- Logs nunca contienen SQL, connection string, credenciales o result rows.

Comandos de verificaciÃ³n:

```powershell
cd backend
node --check scripts/reparto-isolated-ddl-runner.js
npx jest __tests__/reparto-isolated-ddl-runner.test.js --runInBand --no-forceExit --detectOpenHandles
npx jest __tests__/reparto-confirmation-ddl-contract.test.js __tests__/reparto-isolated-finance-ddl-contract.test.js --runInBand --no-forceExit
```

DespuÃ©s, lanzar un verificador independiente con arnÃ©s propio. Gate: `valid=true`. Si vuelve a fallar tras tres iteraciones, detenerse y pedir revisiÃ³n humana; nunca probarlo contra DB2 para â€œver si funcionaâ€.

### Fase 2. Revalidar auth final

No editar salvo fallo reproducible.

1. Verificar SHA de `auth.js`.
2. Ejecutar suites auth con `--no-forceExit --detectOpenHandles`.
3. Ejecutar matriz independiente de las 17 familias de log y revisar todos los argumentos.
4. Confirmar que solo aparecen cÃ³digos allowlisted y enteros `count/suppressed`.
5. Repetir login, loginWithRole, switch, refresh, logout, Redis fail-closed, respuesta perdida y 403 pre-rotaciÃ³n.
6. Repetir Flutter con adapters fake y `API_BASE_URL=https://invalid.invalid`.

Gate: verificador independiente `valid=true`, 0 errores/warnings de analyze y cero red real.

### Fase 3. Sincronizar dependencias

No ejecutar mientras haya otros Jest/Node escribiendo o ejecutÃ¡ndose.

```powershell
cd backend
npm ci --ignore-scripts --engine-strict --audit=false --fund=false
npm rebuild bcrypt odbc --foreground-scripts
npm ls --all
npm audit --json
npm audit --omit=dev --json
```

Condiciones:

- No usar `npm install`.
- `npm ls` sin invalid/extraneous.
- Audits con 0 high/critical; documentar cualquier lower severity y resolverla antes de producciÃ³n si es explotable.
- `odbc` y `bcrypt` deben cargar en un smoke local sin imprimir configuraciÃ³n.

### Fase 4. QA backend completo

Preparar entorno test fail-closed; no cargar `.env.produccion`.

```powershell
cd backend
$env:NODE_ENV='test'
$env:REPARTO_ENVIRONMENT='test'
$env:REPARTO_RUNTIME_ENABLED='false'
$env:REPARTO_WRITES_ENABLED='false'
$env:REPARTO_FINANCE_DB2_CAPABILITY_APPROVED='false'
$env:REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED='false'
npx tsc --noEmit
npx jest --runInBand --no-forceExit --detectOpenHandles
```

Requisitos:

- 125/125 suites cargan y pasan.
- NingÃºn test conecta a DB2, Redis, HTTP o producciÃ³n salvo suites de integraciÃ³n explÃ­citas y gated.
- Cero `forceExit`, handles abiertos, SQL/PII en logs o snapshots falsos.
- Ejecutar `node --check` en todos los JS productivos modificados.
- Ejecutar `git diff --check`.

Si una suite legacy falla por contrato obsoleto, demostrarlo con cÃ³digo/HEAD antes de ajustar solo la prueba. No debilitar el producto para poner verde un fixture.

### Fase 5. QA Flutter completo

```powershell
flutter pub get --offline
dart run build_runner build --delete-conflicting-outputs
flutter analyze --no-fatal-infos
flutter test --dart-define=API_BASE_URL=https://invalid.invalid
flutter build apk --release
```

Si `pub get --offline` falla, pedir aprobaciÃ³n para acceso de red antes de repetir.

Requisitos:

- 89/89 archivos de test pasan.
- 0 errores y 0 warnings de analyze; los infos se registran como deuda, no como PASS estricto.
- Cero llamadas reales a `api.mari-pepa.com` durante tests.
- `build_runner` no deja diffs inesperados.
- APK release compila.
- Recalcular el hash del archivo protegido `albaran_detail_page.dart`.

Flujos crÃ­ticos a cubrir explÃ­citamente:

- Login/switch/refresh/logout y relogin de token legacy.
- Rutero, cambio de repartidor y fallo de carga sin datos cruzados.
- ConfirmaciÃ³n, 409, reinicio de journal y manual review.
- Recibo GET-only, PDF vÃ¡lido, 401/403/404/409/503/timeout.
- Gastos, ingresos, ajustes por rol, ledger OPEN/CLOSED, 201/200 replay, 409/503/offline y doble tap.
- Historial, compartir/descargar/firma sin PII en errores.
- NavegaciÃ³n JEFE/COMERCIAL/REPARTIDOR/ALMACEN.

### Fase 6. Gates locales

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/politec-quality-gate.ps1 -Json
$env:PATH='C:\flutter\bin;' + $env:PATH
python C:\Users\Javier\.codex\skills\loop-engineering\loop_gate.py --project . --json
```

AdemÃ¡s ejecutar los gates del proyecto para Tier 2/3: elite-quality, flow-policy, workflow-state, handoff-ledger, model assignment y readiness, usando sus herramientas/configuraciÃ³n canÃ³nicas. No inventar nombres si una herramienta no estÃ¡ disponible; registrar WARN/BLOCK con precisiÃ³n.

Gate: Politec PASS, loop sin BLOCK, AppSec independiente PASS y QA independiente PASS.

### Fase 7. RotaciÃ³n de secretos y seguridad Git

Esta fase requiere propietario humano y canal seguro.

1. Rotar JWT access y refresh de forma atÃ³mica en el secret store.
2. Reiniciar sesiones: todos los tokens anteriores deben requerir login.
3. Verificar en staging que tokens viejos fallan y nuevos login/refresh/logout funcionan.
4. Confirmar que Redis mantiene Ãºnicamente sesiones creadas con el nuevo despliegue.
5. Rotar o retirar `TOKEN_SECRET` si el propietario confirma que no tiene consumidor.
6. Revisar SMTP/SFTP/Groq/Redis por separado; no rotarlos sin mapa de consumidores.
7. DB2 no fue detectado por gitleaks histÃ³rico; no cambiar su credencial por inferencia. Si se decide rotarla, usar un usuario de servicio de mÃ­nimo privilegio y un cutover separado.
8. Solo despuÃ©s de rotar, decidir una reescritura de historial con aprobaciÃ³n explÃ­cita y coordinaciÃ³n de todas las ramas/clones.

Gate: constancia humana de rotaciÃ³n/revocaciÃ³n y gitleaks redacted limpio para el commit que se va a promover.

### Fase 8. Preparar commit sin contaminar el alcance

El worktree contiene muchos cambios y archivos no tracked. Una IA debe clasificar cada diff antes de stage.

1. Generar lista de archivos del objetivo reparto/auth/seguridad/SQL/tests.
2. Excluir `.env*`, `backend/scripts/temp`, `.orig`, dumps, CSV, backups, logs, `.mcp.json`, configuraciones personales y documentaciÃ³n ajena.
3. Stage explÃ­cito con `git add -- <lista>`; nunca `git add -A`.
4. Revisar:

```powershell
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
```

5. Ejecutar gitleaks sobre el contenido staged/commit, con output redacted.
6. Actualizar beads y cerrar `gmp_app_mobilidad-xlx` solo cuando todos los gates estÃ©n verdes.
7. Crear commit normal; no amend de commits ajenos.
8. Push de la rama aprobada.

Preparar un rollback como **commit revertible**, no con reset. Si producciÃ³n falla, crear/push de un revert commit y hacer en servidor Ãºnicamente pull + restart.

### Fase 9. DB2 isolated TEST

Precondiciones:

- Runner corregido y verificado independientemente.
- SQL hashes coinciden.
- QA/AppSec locales verdes.
- DSN `GMP`, esquema write `JAVIER`, entorno `isolated_test`.
- Credenciales tomadas del entorno seguro, nunca de argumentos o output.

Primero dry-run, sin conexiÃ³n de escritura:

```powershell
cd backend
node scripts/reparto-isolated-ddl-runner.js --migration=033
node scripts/reparto-isolated-ddl-runner.js --migration=034
node scripts/reparto-isolated-ddl-runner.js --migration=035
```

DespuÃ©s, preflight QSYS2 read-only: los objetos deben estar todos ausentes o todos exactos. Partial/mixed/extra bloquea.

EjecuciÃ³n autorizada Ãºnicamente tras preflight:

```powershell
node scripts/reparto-isolated-ddl-runner.js --migration=033 --environment=isolated_test --confirm=JAVIER_TEST_DDL --execute
node scripts/reparto-isolated-ddl-runner.js --migration=034 --environment=isolated_test --confirm=JAVIER_TEST_DDL --execute
node scripts/reparto-isolated-ddl-runner.js --migration=035 --environment=isolated_test --confirm=JAVIER_TEST_DDL --execute
```

Reglas:

- 033 esperado: 10 statements.
- 034 esperado: 20 statements.
- 035 esperado: 9 statements SELECT/WITH, sin mutation.
- Cerrar connection y pool en `finally`.
- Log solo migration, ordinal/label, SQLSTATE/native code, elapsed y status.
- Si falla una sentencia: detener, marcar `PARTIAL_OR_UNKNOWN_STATE`, cerrar recursos y ejecutar Ãºnicamente catÃ¡logo read-only. No reintentar ni â€œarreglarâ€ con DROP/ALTER.
- Ejecutar 035 postflight y rechazar cualquier `STOP_*`.

DespuÃ©s, hacer integraciÃ³n DB2 sin limpieza DELETE:

- Preferir una transacciÃ³n real y `ROLLBACK` explÃ­cito.
- ConfirmaciÃ³n: insert header/lÃ­neas/evidencia, lookup de recibo y rollback.
- Cobro/ledger: idempotencia/replay/conflict y rollback.
- LiquidaciÃ³n: catÃ¡logo, snapshot set-based y failpoint antes de commit; rollback.
- Si un servicio no permite rollback externo, aÃ±adir un seam de integraciÃ³n seguro antes de usar datos persistentes.
- No crear transacciones financieras falsas en producciÃ³n.

Gate: metadata exacta, integraciÃ³n verde, cero objetos/datos en DSEDAC y cero DELETE.

### Fase 10. Staging

Usar `JAVIER.TEST_*`, flags de staging y bind localhost. No usar el PM2 productivo como staging sin decisiÃ³n explÃ­cita.

1. Configurar el runtime con table set `isolated_test` y capabilities aprobadas solo para staging.
2. Mantener los production approval flags en false.
3. Arrancar backend en localhost/puerto alternativo.
4. Ejecutar Supertest/E2E backend con DB2 TEST y Redis de staging.
5. Ejecutar Flutter contra ese backend o un proxy de staging controlado.
6. Probar auth, ownership/IDOR, confirmaciÃ³n, recibo, ledger y liquidaciÃ³n.
7. Probar caÃ­da Redis en staging: auth/readiness 503, health permanece disponible.
8. Probar timeout DB2, audit failure y rollback; nunca degradar a 200 con datos inventados.

Gate: QA, AppSec y SRE firman PASS; no quedan BLOCK ni warnings sin propietario.

### Fase 11. Resolver rama y remote worktree

Antes del despliegue:

1. Javier/SRE debe decidir `test` como staging o `main` como producciÃ³n.
2. Hacer preflight remoto read-only: tracked dirty count, untracked count e intersecciÃ³n de rutas con el commit entrante; no imprimir nombres sensibles.
3. Si existe intersecciÃ³n, detenerse. No mover ni borrar los 49 archivos.
4. Obtener el token de `production-approval-gate` y la palabra literal `adelante` de Javier despuÃ©s de QA/AppSec/SRE.

Sin estas cuatro condiciones no se despliega.

### Fase 12. DDL productivo JAVIER

Los SQL 036/037 no se han ejecutado.

1. Mantener todos los flags de reparto en false.
2. Crear un runner productivo separado y versionado; el runner isolated debe seguir rechazando production.
3. Pin de hashes 036/037 y manifest exacto live QSYS2.
4. Allowlist exclusiva `JAVIER`, sin ninguna DDL/DML `DSEDAC`.
5. Preflight exacto: columnas, tipos, longitudes, null/default, identity, constraints, Ã­ndices y sequences.
6. Ejecutar primero 036 (confirmaciÃ³n) y despuÃ©s 037 (liquidaciÃ³n/ledgers) de forma aditiva.
7. No usar DROP/DELETE/TRUNCATE ni declarar rollback de DDL.
8. Postflight exacto; si parcial, flags siguen false y se escala a remediaciÃ³n manual.

No habilitar finanzas mientras falten fuentes estructuradas o catÃ¡logo exacto.

### Fase 13. Despliegue acotado

Solo despuÃ©s de todos los gates y la decisiÃ³n de rama.

En servidor, Ãºnicamente:

```bash
git pull origin <rama_aprobada>
pm2 restart gmp-api
```

Nunca `restart all`, `reload`, `delete` ni hooks de deploy.

ComprobaciÃ³n durante 60 segundos:

- 7/7 workers online y sin nuevo crash loop.
- `localhost:3335/api/health` = 200.
- `localhost:3335/api/ready` = 200 con `User-Agent: GMP-SRE-HealthCheck/1.0`.
- Redis readiness PASS.
- Logs solo con cÃ³digos allowlisted, sin SQL/PII/token.

HabilitaciÃ³n por fases mediante el secret/config store autorizado, no editando secretos en shell:

1. CÃ³digo nuevo con todos los flags false; restart y smoke.
2. ConfirmaciÃ³n: habilitar solo runtime/writes + confirmation capability/production approval; restart y smoke.
3. Finanzas: habilitar `REPARTO_FINANCE_DB2_CAPABILITY_APPROVED` y el approval productivo correspondiente; restart y smoke.

Validar los nombres y la matriz exacta desde `backend/.env.example` y `reparto-runtime.js`; no adivinar flags. En el Ãºltimo preflight estos seis estaban unset en los siete workers:

- `REPARTO_RUNTIME_ENABLED`
- `REPARTO_WRITES_ENABLED`
- `REPARTO_FINANCE_DB2_CAPABILITY_APPROVED`
- `REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED`
- `REPARTO_PRODUCTION_CONFIRMATION_APPROVED`
- `REPARTO_PRODUCTION_WRITES_APPROVED`

Si readiness falla, primero deshabilitar capabilities mediante el store autorizado. El rollback de cÃ³digo se hace con un revert commit + push; en servidor solo pull + restart.

### Fase 14. Smoke productivo

No fabricar cobros, gastos o liquidaciones de negocio.

- Auth: login, SID/JTI, refresh, switch y logout con una cuenta de prueba autorizada.
- Token legacy: exige nuevo login.
- Redis: no simular outage en producciÃ³n.
- Reparto read-only: week/day/history/summary de un repartidor autorizado.
- Ownership: selector ajeno 403 antes de DB.
- ConfirmaciÃ³n/recibo: usar una entrega real designada por negocio o no ejecutar la escritura.
- Finanzas: reads canÃ³nicos; una escritura solo con operaciÃ³n real aprobada por negocio.
- PDF receipt: `%PDF-`, no-store y ownership.
- Flutter: navegaciÃ³n y acciones visibles coherentes con capabilities.

Gate final: evidencia E2E real, no mocks, sin PII en logs, y SRE health estable.

### Fase 15. Limpieza y cierre

Scratch confirmado que debe retirarse solo al final y con targets exactos:

- `backend/routes/repartidor.js.orig`
- `lib/features/repartidor/data/repartidor_data_service.dart.orig`
- `lib/features/repartidor/presentation/pages/repartidor_historico_page.dart.orig`
- `lib/features/repartidor/presentation/pages/repartidor_panel_page.dart.orig`
- `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart.orig`
- `.codex/flutter_liquidacion_ui_widgets.patch`
- `test_write.txt`
- `.beads/.~issues.jsonl.*`

No tocar `backend/scripts/temp/*` ni otros artefactos del usuario.

Restaurar ACL temporal del root del repositorio:

- `LAPTOP-JLP\CodexSandboxUsers`: `(OI)(CI)(M)`.
- SID `S-1-5-21-465580371-245034386-95846919-2465858079`: `(OI)(CI)(M,DC)`, eliminando `WDAC`.

Modificar solo esas ACE, sin reemplazar el resto del ACL. Verificar root e inheritance de hijos. Considerar ACL mÃ¡s restrictivo para `.env*` en una tarea separada y con aprobaciÃ³n explÃ­cita.

Cerrar beads, registrar hashes finales, commit desplegado, estado DB2, flags, health/readiness y rollback reference.

## 7. Matriz de aceptaciÃ³n final

| Ãrea | CondiciÃ³n para PASS |
|---|---|
| Auth | Verificador independiente verde; sid/sub/jti, Redis fail-closed, refresh DB2, logout revocado, cero PII |
| Reparto | Rutero/history/summary con identidad completa y sin datos inventados |
| Recibo | Ownership antes de PII, deadline/cancel, PDF persistido, no-store, E2E real |
| LiquidaciÃ³n Flutter | 201/200 estricto, idempotencia, 409/503/offline, mutex, roles/capabilities |
| LiquidaciÃ³n backend | CatÃ¡logo exacto, OPS canÃ³nico, audit/outbox en tx, no LQD/DSEDAC |
| Runner DDL | Dos blockers reparados y verifier `valid=true` |
| DB2 TEST | 033/034 aplicados, 035 sin STOP, integration rollback, cero DELETE/DSEDAC writes |
| Dependencias | npm ci/rebuild/ls/audit verdes; Flutter deps/build verdes |
| QA | 125 backend suites + 89 Flutter tests, analyze/tsc/build PASS |
| AppSec | Secrets rotados, staged gitleaks limpio, logs/guards/rate-limit/proxy verdes |
| Git | Stage explÃ­cito, sin env/temp/scratch, branch gate resuelto |
| ProducciÃ³n DB2 | 036/037 additive JAVIER, metadata postflight exacta, flags aÃºn false durante DDL |
| Deploy | Solo pull de rama aprobada + restart gmp-api, ready 200 en 60 s |
| Producto | Smoke real de todas las acciones autorizadas; ninguna acciÃ³n visible siempre 503 |
| Cierre | ACL restaurado, scratch retirado, beads cerrado y rollback documentado |

No declarar â€œ100%â€ mientras alguna fila de esta matriz no tenga evidencia obtenida en el entorno correspondiente.

