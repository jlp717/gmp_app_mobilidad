# Plan maestro de certificación del perfil Repartidor y preparación de la demo

Fecha objetivo: 2026-08-11  
Repositorio: `gmp_app_mobilidad`  
Rama operativa observada: `test`  
Commit publicado observado localmente: `e7cfd8eed2233c483f06fff4caf0f1535b82adc0`  
Servidor: `192.168.1.230`, aplicación `/opt/gmp-api`, PM2 `gmp-api`, puerto `3335`  
DB2: DSN `GMP`, servidor `192.168.1.22`, schemas `JAVIER` y `DSEDAC`

## 1. Regla de verdad

Este plan no permite declarar «100%», «listo» ni «producción correcta» por una respuesta anterior, por el número de tests comunicado o porque `/api/ready` responda 200. El cierre solo es válido cuando **todos** los gates G0-G14 de este documento tengan:

- comando exacto, directorio, fecha, commit y código de salida;
- evidencia independiente, no solo evidencia del implementador;
- cero BLOCK abiertos;
- cero datos simulados presentados como reales;
- cero secretos, tokens, DNI, firmas, SQL o PII en logs/evidencias;
- estado Git, DB2 y servidor coincidentes con el mismo commit certificado;
- prueba E2E real de las acciones críticas de la demo.

Un WARN puede permanecer únicamente si no afecta funcionalidad, integridad de datos, seguridad, despliegue ni demo, y debe estar firmado por QA/AppSec/SRE. Cualquier otra limitación equivale a BLOCK.

## 2. Estado real de partida: NO CERTIFICADO

Hechos ya comprobados:

- La rama local es `test`.
- `HEAD` local es `e7cfd8eed2233c483f06fff4caf0f1535b82adc0`.
- La referencia local `origin/test` coincide con ese commit (`ahead=0`, `behind=0`).
- El árbol de trabajo no está limpio: se observaron al menos 1 cambio staged, 17 cambios tracked adicionales y varios árboles untracked.
- Entre los untracked existen código/tests potencialmente válidos, pero también `.codex/graph-runs`, `backend/.opencode`, `backend/scripts/temp`, informes CSV/JSON, backups, APK y documentación generada. No deben subirse en bloque.
- El issue `gmp_app_mobilidad-xlx` fue cerrado, pero sus propias notas conservan «APK BLOCKED», «staging E2E residual not re-run» y «JWT SKIP waiver»; por tanto ese cierre no prueba el criterio de aceptación.
- El contrato local de toggles es fail-closed, pero el estado efectivo del servidor no se ha revalidado en esta auditoría.
- No se ha reconsultado QSYS2 en esta auditoría; la afirmación «todo creado en DB2» sigue sin prueba independiente.
- La renuncia permanente a rotar JWT es aceptación de riesgo, no un AppSec PASS ni seguridad al 100%.

Conclusión inicial: **NO-GO para afirmar 100% o hacer una demo de escrituras contra producción hasta completar este plan.**

## 3. Roles y separación obligatoria

Una IA puede coordinar, pero las evidencias deben dividirse así:

| Rol | Responsabilidad | Puede escribir |
|---|---|---|
| Coordinador | Congelar alcance, ordenar gates y reducir resultados | Solo documentos/estado de tarea |
| Inventario Git | Clasificar todos los cambios | No |
| Backend writer | Corregir backend, rutas, servicios y repositorios | Solo archivos asignados |
| Flutter writer | Corregir UI/modelos/providers | Solo archivos asignados |
| DB2 specialist | Catálogo, migraciones y pruebas TEST | JAVIER, solo tras gate |
| QA independiente | Tests y E2E | No producto |
| AppSec independiente | Auth, secretos, logs, DDL runner, ACL | No producto |
| SRE independiente | Preflight, despliegue, health/readiness y rollback | Solo tras aprobación |
| Usuario de aceptación | Prueba de demo y aceptación final | Datos de prueba autorizados |

Una misma IA no puede implementar un bloque material y otorgarse su propia verificación final.

## 4. Gates de ejecución

### G0 — Congelar objetivo y evidencia

1. Reabrir `gmp_app_mobilidad-xlx` porque sus criterios no están demostrados.
2. Registrar commit inicial, rama, fecha y árbol sucio.
3. Crear un directorio de evidencia fuera del repositorio o bajo un path ignorado; nunca poner credenciales ni respuestas con PII.
4. Prohibir durante la auditoría:
   - `git add -A`;
   - borrados masivos;
   - `git reset --hard` o checkout destructivo;
   - DML/DDL sobre `DSEDAC`;
   - `pm2 restart all`, `pm2 reload`, `pm2 delete`;
   - despliegue antes de G0-G12 verdes.
5. Toda prueba debe registrar: `caseId`, commit, entorno, hora, comando, exit code, duración y resultado.

Aceptación G0: alcance firmado y ninguna mutación accidental.

### G1 — Resolver exactamente los “493 archivos”

Ejecutar en la raíz, con parser NUL-safe:

```powershell
git status --porcelain=v2 --branch
git status --porcelain=v1 -z --untracked-files=all
git diff --cached --name-status
git diff --name-status
git ls-files --others --exclude-standard -z
git ls-files --others --ignored --exclude-standard -z
git diff --check
```

Generar una tabla completa, una fila por path:

| Path | Estado | Tracked | Staged | Tamaño | Categoría | Propietario | Acción | Justificación |
|---|---|---:|---:|---:|---|---|---|---|

Categorías obligatorias:

- código productivo backend;
- código productivo Flutter;
- pruebas;
- SQL/migraciones/manifiestos;
- configuración segura versionable;
- documentación de release imprescindible;
- beads/estado de issue;
- generado reproducible;
- build/cache;
- APK/binario;
- scratch/temp/backup;
- export CSV/JSON potencialmente sensible;
- secreto/.env/credencial;
- cambio ajeno o no explicado.

Reglas:

- No publicar `.env`, credenciales, tokens, dumps, datos de clientes, firmas, fotografías ni exports de negocio.
- No publicar `backend/scripts/temp`, `.codex/graph-runs`, backups, `.orig`, patches o cachés salvo que exista una razón contractual revisada.
- Los APK solo se publican en el canal de artefactos elegido; no se añaden al repo por defecto.
- Cada cambio tracked debe tener una prueba o una justificación.
- Cada cambio no relacionado debe preservarse y separarse, no descartarse.
- Staging por allowlist explícita: `git add -- <path1> <path2> ...`; nunca staging global.

Salida G1:

- conteo exacto staged/unstaged/untracked/ignored;
- conjunto `PUBLICAR`;
- conjunto `NO_PUBLICAR_GENERADO`;
- conjunto `REQUIERE_DECISIÓN`;
- árbol limpio después de commits intencionales y limpieza segura/autorizada.

Aceptación G1: `git status --porcelain=v2` vacío en el checkout de release y ningún secreto/binario/scratch incluido por accidente.

### G2 — Auditoría del código que realmente se desplegará

1. Comparar el conjunto `PUBLICAR` con `e7cfd8ee`.
2. Revisar arquitectura:
   - rutas validan y delegan;
   - servicios contienen reglas de negocio;
   - repositorios/adapters son los únicos que acceden DB2;
   - Flutter no accede a DB2 ni servicios internos directamente;
   - no hay llamadas de red/DB dentro de bucles de registros;
   - toda lista está paginada y ordenada;
   - toda mutación tiene idempotencia o `no_retry_reason` explícito.
3. Eliminar rutas legacy de escritura o garantizar 410/501/503 antes de DB.
4. Confirmar que no existe `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `ALTER`, `DROP`, `CREATE` ni procedimiento dinámico dirigido a `DSEDAC`.
5. Confirmar que los guards son independientes:
   - confirmación/evidencias: capability de confirmación;
   - cobros/liquidación: `REPARTO_FINANCE_DB2_CAPABILITY_APPROVED`;
   - GET de recibo no usa un guard de escritura.
6. Verificar que `REPARTO_FINANCE_DB2_CAPABILITY_APPROVED` permanece `false` por defecto en ejemplo, ecosystem y proceso.

Aceptación G2: revisión independiente sin BLOCK de arquitectura, SQL inseguro, N+1, PII o guard incorrecto.

### G3 — Autenticación, sesión y seguridad

Ejecutar pruebas reales con Redis y DB2 simulados:

- login crea `sid`, access `jti` y refresh `jti` distintos;
- cada request protegido valida sesión activa;
- refresh rota JTI con compare-and-set y revalida usuario/roles/scope en DB2;
- replay de refresh falla;
- logout de Flutter llama una vez a `/api/auth/logout` antes de borrar credenciales locales;
- logout revoca la sesión en Redis;
- token antiguo sin `sid/sub/jti` exige nuevo login;
- switch de modo `VENTAS/ALMACEN/REPARTIDOR` rota sesión y proyecta perfil completo;
- REPARTIDOR nunca conserva scope de JEFE;
- COMERCIAL no puede activar ALMACEN;
- fallo durante persistencia local no deja tokens nuevos con UI antigua;
- Redis caído/timeout/error devuelve 503 controlado en producción, sin fallback en memoria;
- health básico puede responder sin Redis, readiness debe fallar;
- logs no contienen usuario crudo, token, sid/jti, Authorization, cookie, PIN, DNI, SQL, stack ni rutas locales.

Secreto JWT:

- Buscar de forma redactada en HEAD, índice, working tree y todas las refs.
- Si un JWT secret estuvo versionado, rotarlo y revocarlo antes del GO. La rotación obliga a nuevo login, ya aceptado funcionalmente.
- Si Javier decide no rotar, registrar una excepción con propietario, caducidad y controles compensatorios; el resultado será `GO CON RIESGO`, nunca “100% seguro”.

ACL:

- `CodexSandboxUsers`: `(OI)(CI)(M)`.
- SID temporal: sin `WDAC/WriteDac`; conservar únicamente permisos originalmente autorizados.
- Comparar herencia y ACE con snapshot previo; no aceptar solo una línea resumida.

Aceptación G3: AppSec independiente `valid=true` y ningún waiver permanente presentado como PASS.

### G4 — QA backend completo

Preparación:

```powershell
cd backend
npm ci --ignore-scripts --audit=false --fund=false
npm rebuild bcrypt odbc --foreground-scripts
npm ls --all
npm audit --omit=dev --json
```

No usar `npm install`. Si cambian hashes de `package.json` o lock, detenerse.

Entorno de test obligatorio:

```text
NODE_ENV=test
REPARTO_ENVIRONMENT=test
REPARTO_TABLE_SET=isolated_test
REPARTO_WRITES_ENABLED=false
REPARTO_PRODUCTION_WRITES_APPROVED=false
REPARTO_PRODUCTION_ERP_WRITES_APPROVED=false
REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=false
REPARTO_PRODUCTION_CONFIRMATION_APPROVED=false
REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=false
```

Ejecutar:

```powershell
.\node_modules\.bin\jest.cmd --ci --runInBand --detectOpenHandles --no-forceExit
```

Además, ejecutar matrices focales de:

- auth/session/Redis;
- rutas y ownership;
- planner/rutero/week;
- confirmación/evidencias/recibo;
- cobros/finanzas/liquidación;
- histórico/documentos/paginación;
- runtime/toggles/startup/readiness;
- DDL contracts/runner;
- cache/no-store/log redaction;
- regresión comercial y almacén compartida.

No exigir ciegamente `129/1573`: registrar el inventario actual y explicar cualquier diferencia. Cero `--forceExit`, cero handles abiertos, cero tests omitidos relevantes.

Aceptación G4: exit 0 completo y repetición aleatoria de los flujos críticos sin flakiness.

### G5 — QA Flutter completo

Usar endpoint imposible para impedir egress durante unit/widget tests:

```powershell
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter analyze --no-fatal-infos
flutter test --dart-define=API_BASE_URL=https://invalid.invalid
```

Repetir por grupos para localizar fallos:

- `test/features/repartidor`;
- `test/features/repartidor_finanzas`;
- `test/features/entregas`;
- `test/features/dashboard`;
- `test/core/providers` y auth;
- `test/integration`/navegación;
- widgets financieros e histórico;
- contratos API/modelos/providers.

Condiciones:

- analyzer: 0 errores y 0 warnings; infos se documentan como deuda, no como “cero incidencias”;
- ninguna prueba intenta `api.mari-pepa.com` ni DNS real;
- fakes registran cero llamadas inesperadas;
- modelos fail-closed ante campos críticos ausentes;
- cambio de repartidor borra datos previos y respuestas tardías no repueblan otro scope;
- errores mostrados están saneados;
- doble tap produce una sola mutación;
- 409/503/offline conservan la misma clave idempotente solo para contenido idéntico;
- no se inventan cliente, fecha, cantidad, importe, deuda o estado.

Construir el APK de demo desde el commit certificado. Si falta disco, liberar únicamente caches/build reproducibles ya inventariados; no borrar trabajo del usuario.

Aceptación G5: analyze verde, suite completa verde, APK instalable y hash SHA-256 registrado.

### G6 — Contrato funcional de todas las pestañas Repartidor

La navegación efectiva de Repartidor contiene:

- `Panel` para JEFE en modo Repartidor;
- `Clientes`;
- `Rutero`;
- `Liquidación`;
- `Vencimientos`;
- `Evolución`;
- `Comisiones`;
- `Histórico`;
- `Asistente`.

Probar dos perfiles por separado:

1. repartidor real, restringido a su código;
2. JEFE_VENTAS en modo REPARTIDOR, con selector individual y agregado cuando proceda.

#### Panel

- Carga del repartidor correcto.
- Estado loading/error/retry.
- Selector `ALL` solo donde esté permitido.
- Fallo de `/auth/repartidores` visible y saneado.
- Nunca mostrar datos del repartidor anterior tras cambiar selector.

#### Clientes

- Lista, búsqueda, paginación y orden estables.
- Scope propio para REPARTIDOR; selector múltiple solo JEFE/ADMIN.
- Apertura de cliente y navegación a sus documentos.
- Cliente inexistente/ajeno: 404/403 antes de DB adicional.

#### Rutero y repartos

- Semana/día correcto sin inferir entregado por fecha pasada.
- Identidad documental completa: subempresa, ejercicio, serie, terminal, número, tipo, origen, XDE/DEX y cliente cuando corresponda.
- Dos albaranes con mismo número pero distinta serie/terminal/subempresa permanecen separados.
- Estado de pedido no se convierte en `SIN_PEDIDO` si falla el enrichment; debe fallar cerrado.
- Detalle muestra líneas, cantidades, incidencias y observaciones reales.
- Evidencia de firma/foto solo same-origin y con owner correcto.
- Confirmación sin cobro y con cobro.
- Entrega total, parcial, no realizada y rechazada con invariantes coherentes.
- Receptor de 100 caracteres y límite 101.
- Doble submit/replay devuelve el mismo resultado; conflicto distinto devuelve 409.
- Respuesta ACK incompleta deja revisión manual, no éxito terminal.
- Timeout cancela todas las fases y cierra conexión.

#### Recibo y documento posterior a la entrega

Caso E2E obligatorio:

1. Abrir un pedido no confirmado del repartidor de prueba.
2. Firmar y confirmar la entrega.
3. Recibir `confirmationId` canónico positivo.
4. Consultar el recibo por `confirmationId` y, en el caso permitido, por `idempotencyKey`, usando exactamente un selector.
5. Validar PDF real, no solo prefijo truncado; cantidades, precios, observaciones, receptor, fecha y cobro coinciden con snapshot persistido.
6. Reiniciar la app.
7. Abrir `Histórico`/documentos del cliente.
8. Verificar que el documento recién confirmado aparece una sola vez, con estado correcto.
9. Descargar/visualizar/compartir el mismo documento; cero POST legacy, cero email si capability está apagada.
10. Confirmar headers `private, no-store` en 200, 401, 403, 404, 422, 503 y 504.

Esta cadena debe ser real API -> repositorio -> DB2 TEST/staging -> API -> Flutter. Un test unitario aislado no sustituye este caso.

#### Liquidación diaria — deudas del repartidor

Probar con un único repartidor y fecha controlada:

- GET de desglose real antes del cierre.
- Saldo inicial real.
- Entregas del día y pendientes derivadas de confirmaciones persistidas.
- Cobros reales, ligados a documento completo y repartidor.
- Gastos e ingresos bancarios por endpoints estructurados, append-only e idempotentes.
- Ajustes visibles solo a JEFE/ADMIN con capability explícita.
- No aceptar totales/balance/snapshot calculados por cliente.
- No aceptar importes `null`, boolean, array, objeto, vacío, NaN, negativos donde no proceda ni más precisión de la permitida.
- Fechas civiles imposibles rechazadas.
- ENTREGADA/PARCIAL/NO_REALIZADA/RECHAZADA cumplen amount/pending.
- `pending[]`, breakdown y balance cuadran exactamente.
- Cierre: una transacción, preflight antes de BEGIN, snapshot server-side, filas exactas marcadas, balance, audit y outbox antes de COMMIT.
- Replay exacto: 200, sin duplicar ledger/outbox.
- Primera creación: 201.
- Replay distinto/día ya cerrado: 409.
- Fallo catálogo: 503 antes de BEGIN.
- Fallo antes de commit: rollback sin residuo.
- Fallo al cerrar conexión después de commit no puede convertir éxito comprometido en reintento inseguro.
- Botón de reversión oculto mientras `canReverseCobros=false`.
- Resumen devuelve `canReverseCobros:false` explícito.
- Tras cerrar, volver a cargar y comprobar status `CLOSED`, totales y deuda resultante.

#### Vencimientos

- Datos del repartidor correcto.
- Documento y ownership completos.
- Paginación y estados loading/empty/error/retry.
- CVC ausente o ambiguo no equivale a cobrado; responder estado no disponible/503.
- Ninguna deuda 0 inventada.

#### Evolución

- Loading, éxito, vacío, error y retry.
- Cambio A -> B limpia datos A inmediatamente.
- Respuesta tardía A no sobrescribe B.
- Agregado JEFE correcto y repartidor individual restringido.

#### Comisiones

- Permiso/visibilidad correctos.
- Importes y periodos reales.
- Error de fuente visible; no conservar valores antiguos ni inventar cero.
- Paginación/refresh sin duplicados.

#### Histórico / documentos

- Paginación lógica, no por filas físicas; `nextOffset` reutilizable.
- Identidad incluye subempresa y clave documental completa.
- Factura usa cabecera una vez y solo está entregada si todos sus albaranes lo están.
- Estado canónico tiene precedencia exclusiva sobre legacy.
- Deuda `AVAILABLE/UNAVAILABLE`, nunca 0 hardcodeado.
- Descarga y share tienen mutex.
- Errores no exponen rutas, DNI, token o payload.
- Email oculto por defecto y servicio fail-closed sin POST si capability está apagada.
- Firma cerrada durante carga no hace `setState` tras dispose.

#### Asistente

- La pestaña abre sin excepción.
- Respeta identidad/scope actual.
- Loading/error/offline se muestran de forma segura.
- No transmite firma, DNI, token, documento o PII innecesaria.
- Si no forma parte de la demo o no tiene backend certificado, ocultarla mediante capability; no dejar una acción visible que siempre falla.

Aceptación G6: todos los casos automatizados posibles más checklist manual en dispositivo, con captura del ID de caso y sin datos sensibles.

### G7 — Contratos HTTP y acciones canónicas

Inventariar desde el router montado; no confiar en una lista manual. Como mínimo:

- `/api/auth/login`;
- `/api/auth/refresh`;
- `/api/auth/switch-role`;
- `/api/auth/logout`;
- `/api/auth/repartidores`;
- `/api/repartidor/rutero/week/:repartidorId`;
- rutas día/detalle/movimiento/configuración del rutero;
- `/api/repartidor-finanzas/rutero/confirm-delivery-cobro`;
- rutas canónicas de evidencia firma/foto;
- `/api/repartidor-finanzas/rutero/confirmations/:confirmationId/receipt`;
- recibo por `idempotencyKey` con selector exclusivo;
- `/api/repartidor-finanzas/daily-summary/:repartidorId`;
- summary/cuentas/vencimientos/comisiones;
- cierre de liquidación;
- gastos, ajustes e ingresos bancarios;
- desglose diario;
- histórico/documentos/delivery-summary.

Para cada endpoint registrar:

| Método/path | Auth | Roles | Selector | Schema | Capability | Servicio | Repo | Timeout | Idempotencia | Éxito | Errores | Cache |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Casos mínimos por endpoint: 401, 403, 404, 409, 422, 503, timeout, éxito, owner ajeno, payload hostil y doble submit. Confirmar que autorización ocurre antes de leer PII/binario y que Sentry/logger reciben solo campos allowlisted.

Aceptación G7: route matrix completa, tests HTTP verdes y ninguna ruta visible permanentemente 410/501/503 sin capability UI que la oculte.

### G8 — Seguridad del runner DDL

Antes de cualquier DDL:

- fijar hashes completos de runner, manifest y SQL;
- dry-run de 033, 034 y 035;
- validar 036/037 con runner autorizado equivalente;
- rechazar `EXECUTE IMMEDIATE` concatenado, variables, funciones o múltiples literales;
- rechazar objetos no cualificados o resolverlos contra DBQ y comprobar allowlist;
- rechazar `SET SCHEMA`, `SET PATH`, alias/synonyms no permitidos;
- rechazar DML, `DROP`, `TRUNCATE` y cualquier referencia a DSEDAC salvo SELECT metadata/LIKE expresamente permitido por el contrato;
- exigir schema `JAVIER`, entorno y frase de confirmación exacta;
- fallo parcial debe detenerse, cerrar pool y dejar estado `UNKNOWN/REQUIERE_INSPECCIÓN`, nunca fingir rollback de DDL.

Aceptación G8: verifier AppSec independiente reproduce todos los rechazos y `valid=true`.

### G9 — Certificación DB2 TEST

Primero, solo catálogo QSYS2. Derivar objetos del manifest actual, no de esta lista. Verificar al menos:

- cuatro tablas TEST de confirmación;
- tablas TEST de cobros, audit, balances, OPS, gastos, ajustes, ingresos y outbox;
- secuencias requeridas;
- tablas/índices auxiliares exactos del mapping runtime.

Comparación exacta:

- nombre y ordinal de cada columna;
- tipo, longitud, precisión, escala y CCSID;
- nullable/default;
- identity y parámetros;
- PK/FK/UNIQUE/CHECK;
- índices, orden, dirección y multiplicidad;
- secuencias completas.

Si falta o deriva algo:

1. generar diff catalog-driven;
2. revisar SQL 033/034;
3. dry-run;
4. AppSec/DB2 verifier;
5. ejecutar solo en `JAVIER.TEST_*`;
6. ejecutar 035/postflight;
7. no continuar si queda `MISSING` o `DRIFT`.

Prueba de integración TEST con rollback limpio:

- crear confirmación + líneas + evidencia metadata;
- leer recibo;
- registrar cobro de prueba;
- crear gasto/ingreso/ajuste;
- obtener desglose;
- cerrar liquidación;
- comprobar idempotencia y conflicto;
- rollback/cleanup mediante claves de prueba y mecanismo autorizado, nunca DELETE general;
- confirmar cero filas residuales por las claves de caso;
- scan de SQL/log: cero DML a DSEDAC.

Aceptación G9: catálogo `EXACT`, integración E2E `ok:true`, rollback comprobado y conexión/pool cerrados.

### G10 — Certificación DB2 producción

Este gate se ejecuta después de G0-G9.

1. Snapshot metadata-only previo de todos los objetos `JAVIER` afectados.
2. Comprobar objetos de confirmación de producción.
3. Comprobar OPS/cobros/audit/balances/gastos/ajustes/ingresos/outbox y secuencia de producción según manifest exacto.
4. Si 036/037 ya se ejecutaron, compararlos con catálogo; no volver a ejecutar por confianza en un log.
5. Si falta algo, solo DDL aditivo `JAVIER`, idempotente y revisado.
6. Prohibido DDL/DML/DELETE en DSEDAC.
7. Postflight exacto y diff contra snapshot.
8. No insertar datos de demo directamente en producción; usar API canónica con un usuario/documento autorizado.

Aceptación G10: todos los objetos production `EXACT`, cero drift y cero DSEDAC mutation.

### G11 — Staging / E2E real previo a producción

No sustituir staging por tests unitarios.

Matriz mínima:

- login -> refresh -> switch modo -> logout/relogin;
- repartidor abre clientes y rutero;
- pedido sin confirmar -> firma -> confirmación -> recibo -> histórico/documento;
- entrega sin cobro;
- entrega con cobro;
- doble tap/replay;
- parcial/no realizada;
- gasto/ingreso/ajuste -> desglose -> cierre liquidación -> recarga CLOSED;
- vencimientos/evolución/comisiones;
- Redis caído: 503 fail-closed;
- DB2 capability apagada: 503 sin BEGIN/DML;
- timeout de evidencia/recibo cancela queries;
- ownership ajeno 403 antes de datos.

Ejecutar desde APK candidata y backend candidato del mismo commit. Registrar IDs técnicos, no PII.

Aceptación G11: 100% de casos críticos PASS en dos ejecuciones consecutivas.

### G12 — Configuración efectiva test/producción

No existe un único botón TEST/PROD. La configuración es una matriz y PM2 puede sobrescribir `.env`.

#### Test seguro apagado

```text
NODE_ENV=test
REPARTO_ENVIRONMENT=test
REPARTO_TABLE_SET=isolated_test
REPARTIDOR_FINANCE_APP_SCHEMA=JAVIER
REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER
REPARTO_WRITES_ENABLED=false
REPARTO_PRODUCTION_WRITES_APPROVED=false
REPARTO_PRODUCTION_ERP_WRITES_APPROVED=false
REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=false
REPARTO_PRODUCTION_CONFIRMATION_APPROVED=false
REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=false
```

Para habilitar solo confirmación TEST: `WRITES=true`, confirmation capability `true`, finance `false`.  
Para habilitar solo finanzas TEST: `WRITES=true`, confirmation `false`, finance `true`.

#### Producción segura apagada

```text
NODE_ENV=production
REPARTO_ENVIRONMENT=production
REPARTO_TABLE_SET=production
REPARTIDOR_FINANCE_READ_SCHEMA=DSEDAC
REPARTIDOR_FINANCE_APP_SCHEMA=JAVIER
REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER
REPARTO_WRITES_ENABLED=false
REPARTO_PRODUCTION_WRITES_APPROVED=false
REPARTO_PRODUCTION_ERP_WRITES_APPROVED=false
REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=false
REPARTO_PRODUCTION_CONFIRMATION_APPROVED=false
REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=false
```

#### Producción por fases

Confirmación únicamente:

```text
REPARTO_WRITES_ENABLED=true
REPARTO_PRODUCTION_WRITES_APPROVED=true
REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=true
REPARTO_PRODUCTION_CONFIRMATION_APPROVED=true
REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=false
REPARTO_PRODUCTION_ERP_WRITES_APPROVED=false
```

Finanzas únicamente:

```text
REPARTO_WRITES_ENABLED=true
REPARTO_PRODUCTION_WRITES_APPROVED=true
REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=false
REPARTO_PRODUCTION_CONFIRMATION_APPROVED=false
REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=true
REPARTO_PRODUCTION_ERP_WRITES_APPROVED=false
```

Ambas capacidades: activar ambos grupos anteriores. `REPARTO_PRODUCTION_ERP_WRITES_APPROVED` permanece `false`; las escrituras canónicas son a tablas app `JAVIER`, no a DSEDAC.

Variables adicionales obligatorias:

- `REPARTO_CONFIRMATION_TABLE_SET` debe estar ausente; es un alias retirado y se rechaza.
- TTL de evidencia entre 1 y 168.
- DSN con identificador seguro.
- rutas TS desactivadas y DDD activadas según ecosystem vigente.

Procedimiento de inspección en servidor, sin mostrar secretos:

1. Verificar el path de env realmente cargado: `GMP_ENV_FILE`, después `.env.production`, `.env.produccion`, `.env` según startup.
2. Confirmar si `/opt/gmp-api/backend/.env` existe, pero no asumir que sea efectivo.
3. Parsear `pm2 jlist` dentro del host y emitir solo valores no secretos de `NODE_ENV`/`REPARTO_*` y conteos.
4. Comparar los 8 workers; todos deben ser idénticos.
5. Si `.env` y PM2 difieren, el estado efectivo es PM2, y el gate falla hasta corregir la fuente de verdad.

Para la demo no alternar el proceso vivo entre TEST y producción de forma improvisada. Elegir un único entorno certificado. Si la app apunta a producción y las capabilities siguen apagadas, confirmación/liquidación devolverán 503 y la demo crítica no puede declararse lista.

Aceptación G12: entorno elegido documentado, ocho workers consistentes y capacidades correspondientes a la demo realmente activas solo después de G0-G11.

### G13 — Publicación y despliegue

Precondiciones:

- G0-G12 verdes;
- commit de release único y firmado/identificado;
- working tree local limpio;
- origin contiene exactamente ese commit;
- servidor sin cambios tracked y sin untracked que colisionen;
- plan de rollback aprobado;
- QA, AppSec y SRE `valid=true`;
- production-approval-gate válido;
- Javier dice de nuevo `adelante` después de ver las evidencias.

Resolver antes la contradicción de gobernanza: el proyecto indica que producción acepta `main`, mientras la instrucción operativa previa exige `git pull origin test`. No desplegar un nuevo commit hasta que el gate formal registre cuál manda para esta release.

Si se mantiene la autorización operativa de Javier, los únicos comandos de mutación en el servidor son:

```bash
git pull origin test
pm2 restart gmp-api
```

Nunca:

- `pm2 restart all`;
- `pm2 reload`;
- `pm2 delete`;
- reset/checkout destructivo;
- edición manual de código en servidor.

Post-deploy, desde SSH localhost:

- comprobar commit exacto;
- 8 workers online y mismo env;
- `/api/health` 200;
- `/api/ready` 200 con `User-Agent: GMP-SRE-HealthCheck/1.0`;
- logs nuevos sin errores/PII;
- smoke auth, rutero, confirmación, recibo, histórico y liquidación;
- observar 60 segundos.

Rollback: preparar previamente un commit de reversión publicable. Si readiness o smoke falla, no improvisar comandos prohibidos; publicar el revert aprobado y repetir únicamente el mecanismo autorizado de pull + restart.

Aceptación G13: servidor ejecuta el commit certificado y smoke completo verde.

### G14 — Ensayo exacto de la demo de mañana

Preparar dos usuarios y documentos autorizados:

- un repartidor con ruta, pedido no confirmado, cliente y documento cobrable;
- un JEFE con modo REPARTIDOR y permiso de ajuste.

No usar clientes reales visibles en capturas si no es imprescindible.

Guion cronometrado:

1. Instalación/arranque limpio del APK.
2. Login; si se rotó JWT, nuevo login esperado.
3. Mostrar navegación completa y perfil correcto.
4. Clientes -> seleccionar cliente.
5. Rutero -> pedido -> líneas reales.
6. Firma -> confirmación -> recibo PDF.
7. Histórico -> documento recién creado y acciones permitidas.
8. Vencimientos -> deuda correcta.
9. Liquidación -> desglose -> gasto/ingreso -> cierre -> CLOSED.
10. Evolución y Comisiones.
11. Cambiar modo JEFE/REPARTIDOR y confirmar scope.
12. Logout y prueba de token revocado.

Ensayar al menos dos veces sobre el mismo build. La segunda vez debe usar datos nuevos o replays esperados, nunca depender de residuos de la primera.

Plan de contingencia de demo:

- Wi-Fi/servidor no disponible: no falsear éxito; mostrar pantalla controlada y disponer de vídeo/capturas de la ejecución certificada.
- DB2/Redis no disponible: la app debe mostrar error saneado y retry; no cambiar flags para ocultarlo.
- Caso de datos ya confirmado: usar otro caso preseleccionado, no editar DB2 manualmente.
- Capability apagada: no comenzar la demo crítica; corregir configuración mediante el procedimiento de release, no durante la presentación.

Aceptación G14: dos ensayos consecutivos completos, sin intervención DB manual, errores ni datos inconsistentes.

## 5. Criterio final de “100%”

Solo cerrar el issue cuando exista un manifiesto final con:

```json
{
  "commit": "SHA completo",
  "branch": "rama aprobada",
  "gitClean": true,
  "originMatches": true,
  "backend": {"passed": true, "suites": 0, "tests": 0, "openHandles": 0},
  "flutter": {"analyzeErrors": 0, "analyzeWarnings": 0, "testsPassed": 0, "apkSha256": "..."},
  "appsec": {"valid": true, "jwtRotatedOrTimeBoundException": true, "aclRestored": true},
  "db2Test": {"catalogExact": true, "integration": true, "rollbackClean": true},
  "db2Production": {"catalogExact": true, "dsedacMutations": 0},
  "stagingE2E": {"runs": 2, "failedCases": 0},
  "server": {"commitMatches": true, "workersOnline": 8, "health": 200, "ready": 200},
  "demoRehearsal": {"runs": 2, "failedCases": 0},
  "politec": "PASS",
  "loopGate": "PASS",
  "qaApproval": true,
  "appsecApproval": true,
  "sreApproval": true,
  "javierAcceptance": true
}
```

Los números se rellenan con resultados reales; nunca copiar `129/1573` o `215+188` sin repetirlos sobre el commit final.

## 6. Orden exacto para la siguiente IA

1. Leer `AGENTS.md`, `.opencode/AGENTS.md` y este documento.
2. Reabrir el issue y ejecutar G0.
3. Completar G1; no tocar DB2/servidor mientras Git siga sin clasificar.
4. Aplicar correcciones locales de G2-G3 con TDD y verifier independiente.
5. Ejecutar G4-G5 completos.
6. Ejecutar G6-G8 con matrices adversariales.
7. Certificar DB2 TEST mediante G9.
8. Ejecutar G11 en staging/TEST real.
9. Certificar DB2 producción metadata-only; aplicar DDL JAVIER solo si falta y tras aprobación.
10. Inspeccionar y fijar toggles efectivos con G12.
11. Obtener QA/AppSec/SRE y `adelante` fresco.
12. Publicar únicamente el conjunto allowlisted, dejar Git limpio y desplegar con G13.
13. Ejecutar G14 dos veces.
14. Cerrar el issue solo si el manifiesto final tiene todos los booleanos requeridos en `true` y cero BLOCK.

## 7. Estado al entregar este plan

- Plan: completo.
- Código actual: no certificado por esta auditoría.
- 493 archivos: no clasificados todavía.
- Servidor actual: no certificado independientemente.
- DB2 actual: no certificado independientemente.
- Demo de mañana: NO-GO hasta completar como mínimo G1, G3-G7, G9, G11-G14.

Este estado es deliberadamente honesto: evita que una cifra de tests o un readiness 200 oculte un fallo funcional en firma, documento, deuda, liquidación, configuración o despliegue.
