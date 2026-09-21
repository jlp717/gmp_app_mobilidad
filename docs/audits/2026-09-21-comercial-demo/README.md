# Auditoría comercial ejecutada — 21/09/2026

**Listo demo: NO.** Los flujos funcionales por API pasan; la UI real, el objetivo de latencia en frío y los gates globales de CI siguen sin aprobar. No se declara 100%.

Código comercial publicado y ejecutado en `test`: `93fd9f8`. Corrección del bundle publicada: `27667ec`. API `192.168.1.230:3335`, PM2 `gmp-api`, ocho workers online, `/api/ready` 200, DB3ms y respuesta11ms después del despliegue. Sólo se usaron `git pull origin test` y `pm2 restart gmp-api` para desplegar API. El commit de documentación posterior no cambia su comportamiento.

## Evidencia y alcance

- Backend: `npm test -- --maxWorkers=2`, exit0, **262 suites / 3198 tests ejecutados PASS**, una suite y dos tests omitidos. 283,911s. Evidencia: `jest-delivery-final.log`.
- Flutter: **25/25 tests de cobros PASS**, exit0. Análisis de archivos afectados: exit0, cero errores, 275 avisos/informaciones. No es un análisis global sin avisos.
- Revisión independiente: 115 tests críticos PASS; aislamiento/AppSec del diff PASS; revisión independiente de Clientes y bundle PASS.
- Runner A–F, autenticación, catálogo, guardas y limpieza: **71 PASS, 0 FAIL**, exit0, limpieza propia0 y secuencia TEST restaurada. Cobro limitado por documento/sin entrega: **14 PASS, 0 FAIL**, limpieza0.
- Pestañas: matriz principal **97/97 asserts HTTP PASS**, suplemento Facturas/Pedidos/Liquidación **20/20 PASS**. Incluye denegaciones403 esperadas, no500/404 inesperados. [Matriz pestaña × flujo × rol y p50/p95](matrix.md).
- El AVD abortó con Impeller/SIGSEGV. Los intentos sin Impeller y software rendering tampoco completaron un flujo. **PARCIAL UI** en todas las pestañas; instalación de APK no se cuenta como prueba de UI. [Presencia estática de estados, colores, Semantics y select](ui-source-matrix.md).

## Escenarios ejecutados

| Escenario | Resultado y evidencia | Estado |
|---|---|---|
| A. Pedido + regalo + Mis pedidos + confirmación | ERP ofrece NST_010101: compra3, regalo2. Se guardan3 unidades de pago y2 de regalo con precio0; base77,41 + IVA7,74 = total85,15. Create201/3128ms, confirm200/1179ms; segundo pedido en mano201/2321ms y confirm200/461ms. Ambos CONFIRMADO/LOCAL. Sólo el asignado aparece como PEDIDO en overlay200/795ms; listado200/194ms. | HECHO API |
| B. Parcial, historial y resto | Registrar200/1757ms; historial200/166ms con pago exacto; resto200/274ms. Mismo token200/200ms; token con payload distinto409/1015ms; exceso409/170ms. | HECHO API |
| C. Cruce y entrega independiente | Comercial→repartidor409 REPARTO_COBRO_COMMERCIAL_CONFLICT/4784ms. Repartidor→comercial409 y carrera un ganador201+un409: ejecutados esta sesión en `strict-payments-fourth.jsonl`, antes del último deploy; no repetidos después porque el éxito de reparto envía SMTP. Entregar sin cobrar:201/596ms, cobroIdnull, estadoENTREGADO, cero pago. Cobrar sin entregar:200/825ms, resto116,37, entrega siguePENDIENTE200/1826ms. | HECHO API; alcance temporal indicado |
| D. Cobrar → guardar → devuelve PG → PDF | Guardar201/44ms; factura PG real FPG/P2 a75días; devolución1€ YA_COBRADOS201/65ms; PDF200/135ms con `%PDF-`. LQD no se resta otra vez. Además se probó fecha con LQD real:394,05 a ingresar permanece394,05 (`strict-real-lqd-evidence.jsonl`, evidencia local). | HECHO API |
| E. Mínimo de cobro | Cliente vivo con97,47% frente a100% CLX; snapshot=false. JEFE98 consulta vendedor93: create403/2233ms y confirm403/75ms, ambos MIN_COBRO_ORDER_BLOCKED. Confirm usa borrador propio TEST; regla CLX/CVC viva intacta. | HECHO API; UI pendiente |
| F. Cobro hoy, entrega futura | Confirmado21/09, entrega24/09 propuesta por ruta real, cobrado21/09:200/2067ms, saldo0. Sigue en overlay de entrega200/92ms y Pendiente ERP. | HECHO API |

Evidencia curada con status/ms/body y SHA del original: `scenario-evidence.json`. PDF de LQD real disponible localmente como `devolucion-pg-live-lqd.pdf`. Datos y documentos se han limpiado al terminar, por lo que no se mantienen pedidos ficticios en la demo.

## Bugs corregidos y pendientes

**P0 corregidos y revalidados:** auxiliares de pedido/bolsa salían de TEST; regalos escogían SKU sin stock y heredaban datos del artículo pagado; stock no sumaba compra+regalo del mismo SKU; fallos de validación de stock podían quedar silenciados; creación bajo mínimo respondía500 en lugar de403; cartera cobrable tomaba CVC aunque excediera el total real CPC/CAC; consultas de Clientes podían bloquearse con carteras grandes; Asistente80 podía tomar el agregado del equipo; bundle de una ABI incluía bibliotecas incompletas de otras arquitecturas.

**P0 abierto — rendimiento:** primeras solicitudes de la matriz: objetivos35 15,765s, resumen cobros35 14,236s, comparación objetivo80/equipo19,210s, Panel98 matriz22,345s y evolución13,197s. Bajo auditoría concurrente, no frío aislado. Series n5: productos p95=3959ms, historial de compra p95=7973ms. No se cumple la exigencia de pantalla crítica <~3s. El A/B SELECT-only del predicado CVC mantuvo resultados idénticos pero no mejoró de forma concluyente la primera consulta (2603ms antiguo,3230ms nuevo); no se introdujo un parche especulativo. Se necesita perfilar planes/colas e índices antes de atribuirlo exclusivamente a DB2. No se creó ningún índice ni se hizo DDL ERP.

**PARCIAL UI / recurso:** falta recorrer app en dispositivo estable, incluido offline, loading/empty/error, tema, Semantics y reconstrucciones por select por pestaña. El bloqueo observado es del host AVD; no se certifica que sea un bug de producto.

Los calentamientos de jefe ya están implementados y aparecen ejecutados con HTTP200 en `runtime-warmup-health.jsonl`. Purchase-history realiza cinco consultas LACLAE en paralelo (`backend/routes/pedidos.js`); el warmup HTTP exterior es secuencial (`backend/services/jefe-hot-route-warmer.js`). Esto no acredita que termine antes de la primera pantalla. La siguiente validación de rendimiento debe correlacionar un único login con tiempos SQL y espera en cola; no basta con repetir peticiones con caché.

**P1 / alcance restante:** la búsqueda rápida de Clientes usa el catálogo de clientes con visita; un cliente asignado sin ruta podría quedar fuera (riesgo por lectura, no cliente activo ausente reproducido). No se auditó exhaustivamente toda combinación PMR/PMP, incluidos máximos por SKU. Persisten filtros SQL literales en caminos heredados fuera del diff; no se certifica cumplimiento SQL-bind de todo el repositorio. Las rutas materialmente modificadas usan binds.

**P1 — CI no aprobado:** los cuatro workflows consultados fallan. Gitleaks pasa, pero npm audit bloquea por un HIGH de desarrollo; no hay high/critical de runtime en el audit omit-dev ejecutado. También fallan Politec, resolución de dependencias con Flutter estable3.47.5 y documentación API. [Causas, severidad y enlaces verificables](ci-status.md). La revisión AppSec del diff no sustituye este gate global.

**P2 / herramientas:** cuatro mirrors de skills ausentes en `.opencode` (`team-sync-check.log`, exit1). `loop_gate.py --project . --json` ejecutado: WARN porque no encuentra wrappers Windows de herramientas; las pruebas reales con rutas resueltas están documentadas y pasan. Diff-check, escaneo de secretos y presencia de políticas PASS. No requiere aceptación humana según el gate. Coste/tokens de agentes no medidos.

Grafo de trabajo: 15 nodos y27 aristas validados; fanout inicial de cuatro revisores, un único escritor en cada fase y verificaciones independientes de corrección y seguridad antes de entrega. Máximo tres rondas de descubrimiento y reparación por hallazgo. El gate de demo queda FAIL por los límites de rendimiento y UI; los tests funcionales aprobados no lo sustituyen.

## Prompt y modelo técnico frente a realidad

1. «3+1» → promoción viva seleccionada PMR compra3/regalo2, aunque su texto comercial diga3+1. Se aplicaron los valores reales, no el ejemplo del prompt.
2. «Viernes» → ruta/vehículo devolvió jueves24/09; se comprobó la separación entre confirmar/cobrar hoy y entregar después con fecha válida.
3. Hipótesis inicial del runner: cambiar activeMode durante login → login98 conserva modo COMERCIAL; el cambio real exige POST `/auth/switch-role`. Se ejecutó y verificó.
4. Se confirma la hipótesis PG del prompt: condición FPG de pagaré y plazo real75días, no un tipo de documento ni30 fijo. Además CVC PGC/F es un efecto con nominal propio; no es una factura CAC con la misma numeración.
5. «Pendiente CVC» → hay albarán P-35-3637 con CVC960,40 y CPC232,74. Se limita a232,74; exceso233 devuelve409. Importes negativos/sin documento no se convierten por ABS en cobros válidos.
6. Hipótesis del código: clientes por CLP → vendedor35 no tenía esas filas CLP en la comprobación; una intersección CLP obligatoria vaciaba ventas. La ruta activa DDD usa lista autorizada, filtro CLI activo y consultas por páginas/lotes; se verificaron lista, búsqueda y detalle35/80.
7. «Todo isolated_test» → cabeceras/líneas ya eran TEST, pero cinco auxiliares no. Se añadieron tablas TEST verificadas en QSYS2, siete constraints y cuatro índices. Se corrigió también la calificación JAVIER de constraints; CURRENT_SCHEMA remoto no se asumió.
8. El código del Asistente podía agregar el equipo de80 como objetivo personal →80 es líder, como indica el prompt, y su objetivo personal debe permanecer separado. Asistente y Objetivos personales coinciden: vendido118446,91€, objetivo185172,19€; distinto del equipo. Panel sólo JEFE98 es correcto.
9. Código heredado de historia con LINDTO → la historia comercial se obtiene de DSED.LACLAE viva, como exige el prompt; se verificaron columnas reales y binds CHAR10 para no aplicar TRIM al índice del cliente.
10. Hipótesis del build: filtro ABI en defaultConfig basta → Flutter configura ABI también en release buildType. Se corrigió ese nivel; ZIP final contiene sólo arm64 y todas sus bibliotecas.
11. Hipótesis de rendimiento «falta un índice en LACLAE» → QSYS2 confirma que **DSED.LACLAE es una vista** sobre12 tablas DSEDAC. LAC ya tiene8 índices SQL, incluido LAC_VENDOR_DATE_IDX(vendedor,ejercicio,mes). La definición de la vista vuelve vacía con este acceso; no se puede atribuir el coste ni recomendar un índice sin el plan y las tablas base. [SELECTs, binds y resultados de catálogo](db2-sales-view-catalog.json).

## Confirmaciones de aislamiento y honestidad

- Ventas, KPIs, Panel y Objetivos: ERP vivo **DSED.LACLAE/DSEDAC**, no TEST_LACLAE. Cartera: DSEDAC.CVC y documentos CPC/CAC/FPG vivos.
- Estado final de escritura de negocio: **JAVIER.TEST_***, incluidos auxiliares. Limpieza de las filas propias de cada HIT:0 pendientes. No se borraron datos ajenos.
- **Incidente de aislamiento detectado durante la auditoría:** el primer HIT anterior a la corrección dejó2 reservas y1 idempotencia en auxiliares compartidos JAVIER. Se identificaron por pedido/marker, eliminaron exactamente esas3 filas y comprobaron0. La secuencia compartida no se retrocedió para no reutilizar números. Por tanto no sería veraz afirmar que absolutamente todas las escrituras de toda la sesión fueron TEST; el estado final sí lo impone.
- **Cero escrituras DSED/DSEDAC/ERP** en esta sesión. QSYS2 y ERP sólo SELECT parametrizados. Los cambios DDL se limitaron a JAVIER.TEST_*.
- **Export OPP/CPC apagado**: pedido CONFIRMADO+LOCAL significa «Pendiente ERP»; no se ha presentado el traspaso a producción como realizado.
- Doble cobro comercial/repartidor: ambos sentidos409 y concurrencia con un ganador comprobados esta sesión; límite temporal del re-HIT indicado en C.
- PIN obtenido por SSH/VDPL1 sólo en memoria. Sin PIN, JWT ni claves en entregables/commits. Archivos intocables sin cambios. `albaran_detail_page.dart` no se editó.

## Appbundle y entrega

`build-local-comercial-20260921/app/outputs/bundle/release/app-release.aab`

- Android **4.1.34+90**, paquete`com.maripepa.gmp_mobilidad`, minSdk24, targetSdk36.
- **arm64-v8a solamente**, 27.971.487bytes. ZIP:10 bibliotecas, incluye libapp.so y libflutter.so, ninguna ABI incompleta. R8/minify/shrink y firma release permanecen activos.
- SHA256: `610c26a5c3c93759ee175c16a3d9e57199a2ab6f139c4442ebb2710dc75b9b82`.
- `jarsigner -verify`: exit0, jar verified; advertencias de certificado de subida autofirmado y sin timestamp conservadas en log.
- API compilada: `http://192.168.1.230:3335/api`; requiere acceso a esa LAN. No se subió a Play ni se envió a clientes.
- Build exitoso con Gradle y salida local alternativa; se restauró la configuración global temporal de Flutter. El enlace `build` a la unidad de red y temporales de intentos fallidos quedan como residuos locales: la retirada fue rechazada por revisión automática. No se borró su destino. El artefacto final está en el directorio local indicado.

`changed-files.txt` lista las rutas de código modificadas desde el inicio; las evidencias curadas, la matriz y este informe se versionan en`test`. Los logs de intentos y el PDF con datos comerciales permanecen locales. Se conserva sin tocar el trabajo ajeno de profesionalización.
