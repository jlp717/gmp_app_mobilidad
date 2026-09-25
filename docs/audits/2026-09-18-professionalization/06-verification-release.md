# Verificación, comandos y promoción

## Cuatro estados distintos

- **PLAN_VALIDADO:** dependencias, paths, pasos, evidencia y límites del documento revisados. No significa código implementado.
- **SLICE_VERIFICADO:** diff concreto aprobado y tests aplicables del mismo SHA pasan.
- **STAGING_VERIFICADO:** integración real aislada, QA/AppSec y salud del artefacto pasan.
- **PRODUCCIÓN_VERIFICADA:** autorización específica vigente, despliegue autorizado y postcheck reales.

WARN requiere limitación y seguimiento. Un test fallido no se convierte en WARN por ser incómodo: bloquea el alcance que pretende certificar. En esta entrega hay un baseline de producto con fallos; se registra, no se repara fuera del encargo de plan.

## Entornos y side effects

| Lane | Acceso permitido | Prohibiciones |
|---|---|---|
| Estática/documental | Código permitido, metadatos, schemas, análisis, enlaces. | Archivos de secretos y lecturas de PII no necesarias. |
| Unit/widget | Fakes, reloj controlado, store en memoria, temporales propios. | Red/DB2 real, lectura .env, correo/WhatsApp, jobs reales. |
| Contrato HTTP | App en memoria/puerto efímero local, repositorios fake. | Arranque de pool/proveedores por import. |
| Integración lectura | Runner aislado y DB2 autorizado de solo lectura. | DDL/DML y acceso fuera de allowlist; export de datos reales. |
| Integración escritura | TEST/isolated_test autorizado, fixtures sintéticas con runId. | DSEDAC/ERP write, mailbox real, limpieza por criterios amplios. |
| Carga/chaos | Entorno aislado y ventana/límites aprobados. | Producción o terceros por defecto. |
| Dispositivo | Build/SHA/rol/red registrados, datos sintéticos cuando posible. | PINs/PII en logs/screenshots públicos. |
| Producción | Solo cadena humana de AGENTS. | Ampliar permisos por un script o por la existencia del plan. |

El `setup.js` que fija NODE_ENV=test y Redis localhost no demuestra aislamiento suficiente. QA-01 debe bloquear I/O no permitido antes de activar suite completa sin supervisión.

## Comandos existentes verificados en el árbol

Estos comandos son **recetas de comprobación**, no una orden de ejecutarlos todos ahora. Leer scripts/configuración del SHA y sus imports antes de cada lane. Ejecutar cada comando por separado y conservar su exit code real; no usar `;`/pipes que oculten el fallo.

| ID | Cwd | Comando existente | Precondición y significado |
|---|---|---|---|
| C-01 | raíz | `git status --short` y `git diff --check` | Identificar cambios ajenos; whitespace no prueba calidad de producto. |
| C-02 | raíz | `python docs/audits/2026-09-18-professionalization/validate-plan.py` | Verifica este plan y paths presentes; no accede DB/red. |
| C-03 | raíz | `node scripts/team/sync-harness.cjs --check` | Script local puede no estar en checkout limpio: REP-03 debe resolverlo. No ejecutar sin --check durante auditoría. |
| C-04 | raíz | `node scripts/check_domain_imports.mjs` | Guard actual Dart domain. No cubre toda la arquitectura. |
| C-05 | raíz | `flutter analyze` | Toolchain fijada. Registrar todos los niveles y exit; no ocultar compile errors. |
| C-06 | raíz | `dart analyze lib --format machine` | Diagnóstico estático ejecutado en esta sesión; no sustituye flutter analyze/build nativo. |
| C-07 | raíz | `flutter test --no-pub test/core/utils/vendor_scope_test.dart test/core/cache/fresh_fetch_test.dart test/features/repartidor/data/reparto_confirmation_request_contract_test.dart` | Subset revisado de scope/cache/serialización; journal en memoria. |
| C-08 | backend | `npm run test:targeted -- --runTestsByPath <test-aprobado>` | Sustituir placeholder por path real revisado antes de ejecutar; no elegir una suite con I/O por nombre. |
| C-09 | backend | `npm run test:ci` | Suite completa solo tras QA-01 o inspección de aislamiento. forceExit actual limita evidencia de lifecycle. |
| C-10 | backend | `npm audit --omit=dev --json` | Requiere red al registro; resume resultados redactados. No ejecutar audit fix automáticamente. |
| C-11 | raíz | `npm run lint` | ESLint actual; exit real, revisar coverage de JS/TS. No --fix por defecto. |
| C-12 | raíz | `dart run build_runner build --delete-conflicting-outputs` | Es mutativo: solo en checkout propio, cuando cambian modelos/generación y después de leer config. |
| C-13 | raíz | `flutter build apk --release --target-platform android-arm64` | Firma y configuración gestionadas; no abrir keystore/env. Registrar hash y manifest real. |
| C-14 | raíz | `flutter test integration_test/repartidor_cierre_flow_test.dart` | Dispositivo/fixtures/sinks TEST autorizados; no es unit test. |
| C-15 | raíz | `flutter test integration_test/app_flow_test.dart` | Lane comercial/login según matriz; no certifica reparto por sí sola. |
| C-16 | raíz | `python C:\Users\Javier\.codex\skills\loop-engineering\loop_gate.py --project . --json` | Gate obligatorio GMP; leer plan/alcance y preservar estados WARN/BLOCKED. En otro equipo resolver ruta de skill instalada. |

En Windows, `Get-Command flutter,npm` permite localizar `.bat/.cmd`; invocar la ruta resuelta con `&` desde PowerShell. No componer strings para ejecutar comandos ni convertir JSON en quoting shell. El wrapper futuro FND-03 debe hacerlo portable y preservar códigos de salida.

C-08 tiene un placeholder deliberado porque las suites exactas futuras dependen del slice. **Nunca ejecutar literalmente un comando con `<...>`**. Antes de MAKER, registrar en spec la ruta final del test y la orden concreta. Para pruebas propuestas en backlog, primero crearlas y revisar sus imports.

## Receta por familia de tareas

| Familia | Antes del cambio | Después del slice | Evidencia adicional para cerrar |
|---|---|---|---|
| FND/REP/docs | C-01, inventario/paths y source of truth. | C-02 si modifica este plan, enlaces/diff y checks de herramientas afectadas. | Checkout limpio; no tests espejo para edición documental. |
| SEC backend/DATA | Test negativo de ruta/adapter puro que reproduzca la regla. | C-08 de tests afectados + C-11; C-09 tras aislamiento. | Matriz objeto/acción y revisión AppSec; driver real si cambia SQL/tx. |
| SEC móvil | Test de policy/config y manifest de referencia. | C-05/C-07 ampliado + build nativo afectado. | TLS/permisos/WebView en dispositivo; helper mock no basta. |
| FIN | Invariantes/fixtures/race/cancel antes del código. | Unit/contrato backend y Flutter correspondiente. | DB2 TEST y reconciliación autorizada; cero resultado monetario inventado. |
| CACHE | Scope/freshness/invalidation/multiworker. | Unit/fake Redis + contrato HTTP/cliente. | Redis aislado y fallo/reinicio; métricas de carga/consistencia. |
| ARCH | Contrato de fachada y snapshot de montaje. | Suites afectadas, C-04/C-05/C-11, build si aplica. | Diff mecánico separado; matriz runtime completa. |
| UX | Matriz de estados/roles/temas. | Widget/semantics/goldens justificados. | Prueba visual con tamaños/lector/periférico reales. |
| PERF | PERF-01, mismo dataset/dispositivo/entorno. | Benchmark antes/después, correctness tests. | Frío/HIT y percentiles con muestras; no sustitución por captura de fuente. |
| QA | Fixture que haga fallar el gate por el motivo esperado. | Runner final y teardown; tres repeticiones al introducir lifecycle. | Tests completos y ausencia de I/O accidental. |
| OPS | Config validada en local + runbook/destinos. | Validadores específicos y smoke aislado. | Alerta/restore/release real solo si autorizado, evidencia del artefacto. |

Herramientas futuras como actionlint/promtool/SBOM scanner/k6 se seleccionan, fijan e instalan en su tarea. Un comando propuesto `npm run test:unit` no existe hasta implementarlo: no documentarlo como ejecutado. Nunca ejecutar scripts con nombres chaos/optimize/rollback sin inspeccionar sus efectos.

## Matriz mínima de regresión GMP

| Caso | Aserciones esenciales |
|---|---|
| Login alias y código | Identidad correcta; no bloqueo colateral de homónimos; mensajes seguros. |
| JEFE ALL / líder80 / comercial | Scope correcto, objetivo personal separado, sin IN masivo incorrecto ni acceso ajeno. |
| Roles de reparto | Jefe en reparto y repartidor raso; rutas/tabs/documentos autorizados. |
| Rutero | ORDEN negativo excluido; lista/detalle/cabecera consistentes. |
| Cambiar cantidades | Unitario/totales/IVA/saldo/liq coherentes; no excede documento. |
| Cobro parcial y resto | Resto disponible desde Cobros; no duplica cobro al reintentar. |
| Talón | Número, vencimiento, banco ENB; Transferencia no aparece en UI. |
| Finalizar | Evidencia completa y cobro+entrega juntos; doble toque/replay no duplica. |
| Recibo | Serie completa y destinatarios lógicos operaciones+repartidor; sink TEST. |
| Devolución de cobrado | Ajusta caja según regla, sin doble descuento LQD. |
| Cambio usuario/rol | Cache, ETag, memoria, store y cola no cruzan identidades. |
| Offline/timeout/reinicio | Pendiente visible, replay/reconciliación y cero pérdida silenciosa. |
| Tema/accesibilidad | Contenido completo, filtros/tablas/matrices y modales claros/oscuros. |
| Dependencias caídas | Errores acotados, recursos liberados, no datos financieros fabricados. |

## Formato de evidencia por task/slice

Guardar JSON redactado: task_id, spec_id, run_id, SHA, dirty_scope, environment, versions, commands[{cwd,argv,exit_code,duration,artifact}], tests_count, known_failures, affected_paths, reviewer_verdict, limitations, next_action.

La evidencia no incluye bodies financieros, contactos, firmas, PINs, tokens ni dumps. Los reportes grandes/sensibles quedan en almacén restringido; Git recibe resumen seguro y hash cuando procede.

## Promoción y reversión

- No fusionar un slice con código financiero roto porque el documento del plan pase.
- Cambios compatibles primero: expandir/adapter → migrar consumidores → observar → contraer. Cambios persistentes requieren plan de forward recovery y DBA.
- La reversión de código no deshace emails, cobros ni estados externos. Preservar journal, reconciliar y usar comandos compensatorios autorizados.
- Antes de producción: staging, QA PASS, AppSec PASS y health; luego `/adelante-production` y gate `prod_approved` con TTL≤30min.
- Solo la whitelist de AGENTS permite `git pull origin test` y `pm2 restart gmp-api` tras aprobación. No `pm2 start/reload/save/set`, secretos ni DDL.
- Postcheck: versión/estado online, errores recientes y readiness conforme al runbook; si falla, detener promoción e informar. No autoejecutar script legacy de rollback.

CLOSE-01 comprueba el commit/artefacto real, todos los gates aplicables y los límites pendientes. Un campo sin medir se declara pendiente; no se reemplaza por “100%”.
