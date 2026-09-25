# Backlog ejecutable de profesionalización

Estado: **PROPUESTO; ninguna de estas tareas se marca implementada por esta auditoría**. Fuente editable: [backlog.json](backlog.json). Protocolo obligatorio: [08-executor.md](08-executor.md). Comandos/entornos: [06-verification-release.md](06-verification-release.md).

P0 significa barrera previa a la entrega del alcance afectado, no una vulnerabilidad explotable demostrada. P1 es trabajo necesario de profesionalización; P2 es optimización/soporte condicionado. S/M/L son órdenes de magnitud, no plazos comprometidos. L se divide en slices de una responsabilidad.

## Orden calculado por dependencias

Estas fronteras permiten revisión en paralelo. **La implementación mantiene un único writer concurrente**, aunque dos tareas estén listas; elegir primero P0 y luego menor fase/ID. No usar el número de fase para saltarse dependencias. Un bloqueo humano detiene solo su rama hasta el cierre que lo necesita.

1. FND-01
2. FND-02, FND-03, FND-04, FND-05, REP-01
3. PERF-01, SEC-01, REP-03, FIN-01, OPS-05, QA-01, QA-04, SEC-08
4. SEC-03, SEC-02, SEC-05, SEC-06, CACHE-01, ARCH-03, OPS-06
5. SEC-04, ARCH-01, ARCH-04, PERF-05, UX-01, UX-03
6. DATA-01, SEC-07, ARCH-05, SEC-09, SEC-10, ARCH-02, REP-02, REP-05
7. FIN-03, FIN-02, OPS-01, PERF-02, PERF-03, PERF-04, REP-04
8. QA-02, FIN-04, FIN-05, OPS-02
9. CACHE-02, FIN-06, UX-02, QA-05
10. QA-03, CACHE-03, OPS-04
11. PERF-06, OPS-03, OPS-07
12. CLOSE-01

## Índice

| ID | Prioridad | Paquete | Esfuerzo | Dependencias |
|---|---|---|---|---|
| FND-01 | P0 | Congelar alcance, baseline y cambios concurrentes | S | ninguna |
| FND-02 | P0 | Alinear Node, Flutter, Dart y dependencias reproducibles | L | FND-01 |
| FND-03 | P0 | Hacer honestos y portables los gates | L | FND-01 |
| FND-04 | P0 | Estabilizar reloj y pruebas de contrato antes de refactorizar | M | FND-01 |
| FND-05 | P0 | Inventariar runtime, endpoints y consumidores efectivos | L | FND-01 |
| SEC-01 | P0 | Modelo de amenazas y clasificación de datos | M | FND-05 |
| SEC-02 | P1 | Revisar protocolo de autenticación sin romper sesiones | L | SEC-01 |
| SEC-03 | P0 | Autorización uniforme por objeto y acción | L | FND-05, SEC-01 |
| SEC-04 | P0 | Validación, límites y errores de API por operación | M | FND-05, SEC-03 |
| SEC-05 | P1 | Resolver TLS y pinning con una decisión verificable | L | SEC-01, FND-02 |
| SEC-06 | P1 | Mínimo privilegio y privacidad en plataformas móviles | M | SEC-01 |
| SEC-07 | P0 | Limitar chatbot y herramientas de IA | L | SEC-03, SEC-04 |
| SEC-08 | P1 | Supply chain y secretos con evidencia redactada | M | FND-02, FND-03 |
| SEC-09 | P1 | Logs y telemetría sin filtración de datos | M | SEC-01, SEC-04 |
| SEC-10 | P1 | Evidencias, PDFs, ficheros y destinatarios seguros | M | SEC-03, SEC-04 |
| DATA-01 | P0 | Garantizar SQL y destinos de escritura | L | FND-05, SEC-04 |
| FIN-01 | P0 | Especificar y congelar invariantes de negocio | L | FND-04, FND-05 |
| FIN-02 | P1 | Representación monetaria y redondeo compartidos | L | FIN-01, ARCH-05 |
| FIN-03 | P0 | Idempotencia y concurrencia en todas las mutaciones | L | FIN-01, SEC-03, DATA-01 |
| FIN-04 | P1 | Outbox fiable y entregas externas reconciliables | L | FIN-03, SEC-10 |
| FIN-05 | P1 | Comandos offline tipados y recuperación de sesión | L | FIN-03, FIN-01 |
| FIN-06 | P1 | Reconciliación y trazabilidad de cierre | M | FIN-01, FIN-03, FIN-04 |
| CACHE-01 | P0 | Política única de frescura y aislamiento | L | FND-05, SEC-01, FIN-01 |
| CACHE-02 | P1 | Invalidación post-commit y read-your-writes | L | CACHE-01, FIN-03, FIN-04 |
| CACHE-03 | P1 | Reducir solapamientos y estampidas de caché | L | CACHE-01, CACHE-02, PERF-01 |
| PERF-01 | P0 | Baseline de rendimiento por flujo y entorno | M | FND-01, FND-05 |
| PERF-02 | P1 | Optimizar consultas por evidencia y catálogo DB2 | L | DATA-01, PERF-01 |
| PERF-03 | P1 | Unificar pool, deadlines y cancelación ODBC | L | FND-05, DATA-01, PERF-01 |
| PERF-04 | P1 | Contratos de payload, paginación y export | M | PERF-01, ARCH-05 |
| PERF-05 | P1 | Optimización Flutter guiada por perfiles | M | PERF-01, ARCH-03, CACHE-01 |
| PERF-06 | P1 | Carga, saturación y pruebas de larga duración | L | PERF-01, PERF-03, CACHE-03, OPS-01 |
| ARCH-01 | P1 | Arquitectura backend canónica y migración vertical | L | FND-05, SEC-03, FIN-01 |
| ARCH-02 | P1 | Descomponer rutas y servicios de alto coste | L | ARCH-01, QA-01 |
| ARCH-03 | P1 | Dividir núcleo Flutter y navegación sin cambiar UX | L | FND-04, FND-05, QA-04 |
| ARCH-04 | P1 | Fronteras por feature y tipado gradual | L | ARCH-03, FND-03 |
| ARCH-05 | P1 | Contrato API versionado y compatibilidad móvil | L | FND-05, SEC-04 |
| UX-01 | P1 | Tema, accesibilidad y sistema de componentes | L | ARCH-03, FND-05 |
| UX-02 | P1 | Estados, errores y protección ante doble acción | M | FIN-05, ARCH-05, UX-01 |
| UX-03 | P2 | Matriz de plataformas e integraciones nativas | M | SEC-06, QA-04 |
| QA-01 | P0 | Separar suites herméticas y lifecycle Jest | L | FND-02, FND-03 |
| QA-02 | P0 | Pruebas de dinero, carreras y fallos de persistencia | L | FIN-01, FIN-03, QA-01 |
| QA-03 | P0 | E2E determinista de reparto y comercial separados | L | FIN-05, FIN-06, QA-02, UX-02 |
| QA-04 | P1 | Builds y análisis reproducibles sin señales silenciadas | L | FND-02, FND-03 |
| QA-05 | P1 | Cobertura útil, ratchet y contratos de arquitectura | M | QA-01, QA-02, ARCH-04 |
| OPS-01 | P1 | Observabilidad operativa y correlación extremo a extremo | L | SEC-09, FND-03 |
| OPS-02 | P1 | SLO, alertas y procedimientos de degradación | M | OPS-01, PERF-01 |
| OPS-03 | P1 | Release verificable y promoción con gates | L | FND-03, QA-03, QA-04, SEC-08, OPS-02 |
| OPS-04 | P1 | Backup, restauración y continuidad de negocio | L | SEC-01, FIN-06, OPS-01 |
| OPS-05 | P0 | Separar scripts administrativos y proteger producción | M | FND-01, FND-05 |
| OPS-06 | P2 | Empaquetado backend y servicios auxiliares mínimos | M | FND-02, SEC-08, OPS-05 |
| OPS-07 | P1 | Validación adversarial y respuesta a incidentes | L | SEC-02, SEC-03, SEC-05, SEC-07, SEC-10, QA-03, OPS-02, OPS-04 |
| REP-01 | P1 | Clasificación completa del árbol y política de limpieza | M | FND-01 |
| REP-02 | P1 | Retirar residuos versionados y preservar evidencia privada | L | REP-01, OPS-05, ARCH-01 |
| REP-03 | P1 | Reconciliar gobernanza y portabilidad de agentes | M | REP-01, FND-03 |
| REP-04 | P1 | Documentación viva y onboarding verificable | M | FND-05, REP-03, ARCH-05 |
| REP-05 | P2 | Dependencias, assets, licencias y tamaño | M | REP-01, SEC-08, UX-03 |
| CLOSE-01 | P0 | Cierre integral desde checkout limpio y entrega | M | FND-01, FND-02, FND-03, FND-04, FND-05, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, DATA-01, FIN-01, FIN-02, FIN-03, FIN-04, FIN-05, FIN-06, CACHE-01, CACHE-02, CACHE-03, PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06, ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, UX-01, UX-02, UX-03, QA-01, QA-02, QA-03, QA-04, QA-05, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, REP-01, REP-02, REP-03, REP-04, REP-05 |

## FND-01 — Congelar alcance, baseline y cambios concurrentes

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** S · **Estado:** TODO

**Dependencias:** ninguna.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `AGENTS.md`.
- Existente: `memory-bank/activeContext.md`.
- Existente: `memory-bank/progress.md`.
- Propuesto, crear solo tras spec: `docs/engineering/baseline.md`.

**Requisito EARS propuesto:** Cuando comience una tarea, el ejecutor registrará SHA, rama, estado local, alcance y propietario antes de modificar archivos.

**Pasos, en orden:**

1. Leer las reglas vigentes y comparar git status con la instantánea del plan; identificar commits y cambios de otros workstreams, sin stash/reset/clean global.
2. Crear una rama codex/<ID> desde test en un checkout aislado autorizado; documentar si se incluyen cambios locales y por qué.
3. Copiar solo evidencias redactadas; registrar versiones de herramientas, SO, flags de montaje no secretos, entorno y checks realmente ejecutados.
4. Marcar como pendiente de reconfirmación cada referencia del plan que haya cambiado desde 0e3912a; las rutas del plan son puntos de entrada, no autorización de edición indiscriminada.

**Aceptación verificable:**

- Baseline tiene SHA y lista explícita de paths propios/ajenos.
- Ningún diff de producto ajeno forma parte del commit de esta tarea.
- El alcance de pruebas y exclusiones queda firmado en ledger.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir únicamente el documento de baseline de esta tarea; conservar todos los cambios preexistentes.

**Límite de autorización:** Autorización de implementación del paquete; nunca se infiere de la aprobación de este plan.

## FND-02 — Alinear Node, Flutter, Dart y dependencias reproducibles

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `.nvmrc`.
- Existente: `.fvmrc`.
- Existente: `package.json`.
- Existente: `backend/package.json`.
- Existente: `package-lock.json`.
- Existente: `backend/package-lock.json`.
- Existente: `pubspec.lock`.
- Existente: `.github/workflows`.
- Propuesto, crear solo tras spec: `docs/adr/runtime-toolchain.md`.

**Requisito EARS propuesto:** Cuando se construya el proyecto, desarrollo y CI usarán versiones soportadas y compatibles fijadas en una fuente única.

**Pasos, en orden:**

1. Registrar node --version y Flutter/Dart efectivos; Node local 20.2.0 está por debajo del mínimo declarado y Node20 está EOL según fuente oficial consultada.
2. Ensayar Node24 LTS mantenido como candidato en rama aislada, comprobando ABI nativa de odbc/bcrypt, addon IBM i y Linux/Windows; si falla, evaluar otra LTS soportada con ADR, sin parchear el host productivo.
3. Fijar una versión exacta validada; derivar CI y documentación de .nvmrc/.fvmrc y alinear engines sin ampliar rangos a ciegas.
4. Regenerar lockfiles solo con herramienta elegida, npm ci en limpio y Flutter pub get controlado; revisar diff de dependencias y licencias; separar actualización de refactor funcional.

**Aceptación verificable:**

- Instalación y tests herméticos reproducibles en Windows y runner Linux.
- Ningún workflow usa un Flutter diferente ni un Node sin soporte.
- Compatibilidad ODBC real queda en prueba aislada autorizada; si no se ejecuta, no promover runtime.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Restaurar conjuntamente pines y lockfiles del commit anterior; nunca degradar producción automáticamente.

**Límite de autorización:** Javier aprueba cambios de runtime productivo y credenciales; este paquete solo valida local/CI.

## FND-03 — Hacer honestos y portables los gates

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `.github/workflows/quality-gates.yml`.
- Existente: `.github/workflows/zero-trust-gates.yml`.
- Existente: `.github/workflows/ci-cd.yml`.
- Existente: `scripts/politec-quality-gate.ps1`.
- Propuesto, crear solo tras spec: `scripts/quality/run-checks.mjs`.
- Propuesto, crear solo tras spec: `docs/engineering/quality-gates.md`.

**Requisito EARS propuesto:** Si un control obligatorio falla, no se podrá presentar el conjunto como PASS ni publicar una release.

**Pasos, en orden:**

1. Inventariar check real, comando, scope, exit code y timeout; distinguir checks docs, unitarios, contratos, integración y release.
2. Crear wrapper de proyecto que resuelva npm.cmd/flutter.bat en Windows y ejecutables en Linux, preserve códigos de salida y mate solo sus propios hijos si vence timeout; no modificar silenciosamente la skill global.
3. Sustituir placeholders y tolerancias de controles obligatorios por resultados explícitos; los controles en transición generan deuda con responsable y vencimiento, sin bandera global que convierta fallo en éxito.
4. Consolidar workflows reutilizables y definir required checks en test mediante cambio administrativo autorizado; las tareas docs no simularán certificación de producto.
5. Revisar el scanner de Politec antes de ejecutarlo: excluir rutas de secretos antes de leerlas y emitir solo path/categoría redactados; el git grep general actual puede leer archivos prohibidos y divulgar una coincidencia. Probar redacción con fixtures sintéticas.

**Aceptación verificable:**

- Una fixture de comando exit1 produce BLOCKED; herramienta ausente produce WARN, nunca PASS.
- Checks de seguridad y pruebas obligatorias no usan || true/continue-on-error.
- Pipeline documenta que la prueba local de este audit falló y el gate de skill quedó WARN por resolución Windows.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir solo wrapper/workflows; conservar evidencias y required checks previos hasta nueva aprobación.

**Límite de autorización:** Cambiar protección de ramas requiere permiso administrativo específico; no usar un PUT destructivo sobre protección existente.

## FND-04 — Estabilizar reloj y pruebas de contrato antes de refactorizar

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `test/features/repartidor/data/reparto_confirmation_request_contract_test.dart`.
- Existente: `lib/features/repartidor/data/reparto_confirmation_request.dart`.
- Existente: `test/core/utils/vendor_scope_test.dart`.
- Existente: `test/core/cache/fresh_fetch_test.dart`.
- Propuesto, crear solo tras spec: `docs/engineering/test-baseline.md`.

**Requisito EARS propuesto:** Dado un reloj fijo, la serialización de confirmaciones producirá siempre el mismo resultado y rechazará fechas futuras fuera del margen aprobado.

**Pasos, en orden:**

1. Reproducir la suite que falló en esta auditoría: 'serializa cobro+notificaciones al Finalizar' rechazó occurredAt futuro; inspeccionar fixture, zona Europe/Madrid y comparación UTC actual antes de decidir si falla fixture o lógica.
2. Definir Clock inyectable o parámetro now en el punto de validación sin desactivar la defensa contra fechas futuras; los tests no dependerán del día/hora en que corran.
3. Añadir límites justo antes/en/después del margen, cambio horario, conversión UTC y dispositivo con reloj desviado; documentar tolerancia aprobada.
4. Reejecutar las tres suites identificadas y la suite afectada por request/receipt; publicar comandos/cwd/exit y aislar cambios concurrentes.

**Aceptación verificable:**

- La prueba fallida pasa por causa comprendida, no por skip o relajación global.
- Fechas futuras inválidas siguen rechazadas; reloj congelado evita flakiness.
- No cambian importe, firma, notas ni destinatarios en el contrato.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir el pequeño cambio de reloj/fixture; conservar el fallo reproducido como evidencia, sin tocar validaciones ajenas.

**Límite de autorización:** Spec EARS aprobada; no autoriza despliegue.

## FND-05 — Inventariar runtime, endpoints y consumidores efectivos

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/app.js`.
- Existente: `backend/server.js`.
- Existente: `backend/src/shared/routes`.
- Existente: `lib/core/api/api_client.dart`.
- Existente: `.cline/knowledge/api-catalog.md`.
- Propuesto, crear solo tras spec: `docs/architecture/runtime-matrix.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/runtime-route-matrix.test.js`.

**Requisito EARS propuesto:** Para cada combinación soportada de flags, cada método+path tendrá exactamente un propietario y contrato de autorización conocido.

**Pasos, en orden:**

1. Extraer de app/server y adapters todos los montajes, routers, prefijos y middleware en orden; marcar flags USE_TS_ROUTES/USE_DDD_ROUTES y combinaciones no soportadas explícitamente.
2. Trazar para cada dominio consumidor Flutter, permisos, entrada/salida, caché, transacción y side effects; el catálogo antiguo de 255 endpoints no es el total actual verificado.
3. Construir pruebas de montaje sin abrir puerto/DB real; comparar ruta real con OpenAPI y snapshot aprobado.
4. Elegir una implementación canónica por dominio con ADR; no activar flags ni retirar rutas todavía.

**Aceptación verificable:**

- Matriz incluye auth, reparto, comercial, almacén, reporting, chatbot, health, métricas y jobs.
- No hay rutas duplicadas o sin auth en las combinaciones soportadas.
- Los totales provienen de extracción reproducible; cada excepción tiene owner.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir solo extractor/tests/docs; flags de runtime intactos.

**Límite de autorización:** Spec aprobada; lectura de configuración por nombres de variables, nunca valores secretos.

## SEC-01 — Modelo de amenazas y clasificación de datos

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `docs/spec/gmp-app-mobilidad.md`.
- Existente: `backend/app.js`.
- Existente: `lib/core/offline`.
- Propuesto, crear solo tras spec: `docs/security/threat-model.md`.
- Propuesto, crear solo tras spec: `docs/security/control-matrix.csv`.

**Requisito EARS propuesto:** Todo activo crítico tendrá actor, frontera de confianza, amenaza, control, prueba y propietario de riesgo.

**Pasos, en orden:**

1. Dibujar app→edge→API→DB2/Redis/archivos/mensajería/IA/CI con separación lectura ERP y escritura TEST; incluir móvil robado, comercial malicioso y dependencia comprometida.
2. Clasificar tokens, DNI, firma, ubicación, importes, PDF, email y telemetría por finalidad, acceso, retención y borrado; datos de prueba sintéticos.
3. Usar ASVS5.0.0 L2 como objetivo de backend con selección L3 justificada para dinero/auth; seleccionar controles MASVS/MASTG por amenaza móvil, sin inventar niveles MASVS antiguos.
4. Mapear control→ruta→test→evidencia; marcar NA con motivo y riesgos residuales; obtener revisión independiente antes de cambiar políticas.

**Aceptación verificable:**

- Toda amenaza alta tiene prevención, detección, recuperación y caso negativo verificable.
- No se promete invulnerabilidad ni cumplimiento legal certificado.
- Existe responsable para riesgo residual, excepción y fecha de revisión.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir documentos propuestos; no debilitar controles vigentes.

**Límite de autorización:** Aprobación de política/riesgo por Javier; privacidad legal a revisar por responsable competente.

## SEC-02 — Revisar protocolo de autenticación sin romper sesiones

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** SEC-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/middleware/auth.js`.
- Existente: `backend/routes/auth.js`.
- Existente: `backend/src/modules/auth/application/auth-claims-session-store.js`.
- Propuesto, crear solo tras spec: `docs/adr/authentication-protocol.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/auth-protocol-contract.test.js`.

**Requisito EARS propuesto:** Tokens inválidos, de otro propósito, revocados, caducados o emitidos en un futuro no permitido serán rechazados sin revelar información sensible.

**Pasos, en orden:**

1. Caracterizar el formato HMAC actual y sesión revocable; no llamarlo inseguro solo por ser propio. Enumerar claims, tipos, algoritmo fijo, timestamp, scope y transición refresh.
2. Preparar ADR de mantener formalmente el formato o migrar a JWS maduro; diseñar issuer/audience, expiración, nbf/iat, jti/sid, rotación y skew; no introducir dos formatos sin ventana de retirada.
3. Escribir negativas de firma, tipo, future time, revocación/logout, cambio de rol, replay refresh y alias de login diego/código numérico.
4. Entregar diff propuesto para auth.js al propietario humano; ningún agente lo aplica. Probar compatibilidad de clientes antiguos y temporizar retirada del formato anterior.

**Aceptación verificable:**

- No se rompe login por alias ni el alcance del líder80/JEFE ALL.
- Revocación y refresh concorrente se mantienen atómicos.
- Revisión criptográfica independiente; cambios intocables ejecutados manualmente por Javier.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Mantener compatibilidad temporal acotada si se aprueba; rollback de protocolo exige evaluar tokens emitidos/revocados y nunca reactivar claves comprometidas.

**Límite de autorización:** MANUAL JAVIER: backend/middleware/auth.js es intocable; secretos/rotación requieren autorización separada.

## SEC-03 — Autorización uniforme por objeto y acción

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-05, SEC-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes/entregas.js`.
- Existente: `backend/routes/facturas.js`.
- Existente: `backend/routes/cobros.js`.
- Existente: `backend/routes/pedidos.js`.
- Existente: `backend/routes/repartidor-document-routes.js`.
- Propuesto, crear solo tras spec: `backend/middleware/resource-authorization.js`.
- Propuesto, crear solo tras spec: `backend/__tests__/resource-authorization-matrix.test.js`.

**Requisito EARS propuesto:** Una petición sobre un documento ajeno al ámbito efectivo será denegada antes de leer contenido, generar PDF, modificar estado o enviar mensajes.

**Pasos, en orden:**

1. Construir matriz rol×modo×vendedor×objeto×acción para cada ruta efectiva; extraer scope exclusivamente de identidad verificada y resolución autorizada de recurso.
2. Reutilizar helpers existentes de ownership; centralizar policy pura y mantener consulta parametrizada en repositorio; evitar una consulta extra por cada fila.
3. Distinguir JEFE ALL literal, comercial80 y equipo, comercial individual, jefe en reparto y repartidor raso; no confiar en un ID enviado en body/query.
4. Probar cada variante de detalle/listado/export/PDF/email/WhatsApp y rutas DDD/legacy; normalizar 400/401/403/404 según contrato sin filtración de existencia.

**Aceptación verificable:**

- ActorA no lee/manda/modifica objetoB y el servicio de efecto no es llamado.
- Permisos se aplican también a jobs/IA y caché.
- Casos legítimos ALL/equipo/alias siguen pasando; no hay N+1 de autorización.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir adaptación de un dominio conservando política anterior probada; nunca activar modo permisivo global.

**Límite de autorización:** Spec aprobada; cambios que dependan de auth.js los aplica Javier, la policy nueva no modifica ese archivo.

## SEC-04 — Validación, límites y errores de API por operación

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-05, SEC-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes`.
- Existente: `backend/middleware/security.js`.
- Existente: `backend/app.js`.
- Propuesto, crear solo tras spec: `backend/contracts`.
- Propuesto, crear solo tras spec: `backend/__tests__/api-boundaries.test.js`.

**Requisito EARS propuesto:** Entradas fuera de schema o presupuesto se rechazarán antes de consumir DB2, memoria o servicios externos.

**Pasos, en orden:**

1. Catalogar schema de path/query/body/headers para cada endpoint; adoptar librería ya presente, sin sumar Zod/Joi nuevos innecesariamente; strict o compatibilidad documentada para campos extra.
2. Definir longitudes, rangos, precisión decimal, enums, tamaños de páginas/archivos, profundidad JSON, límites de historial y timeouts; comprobar límites en proxy y app.
3. Unificar error {code,message,requestId,details permitidos}; excluir stack, SQL, datos de sesión y PII de respuestas.
4. Añadir límites diferenciados por login, PDF, export, upload, email e IA; probar IP efectiva detrás del proxy sin asumir confiabilidad de headers directos.

**Aceptación verificable:**

- Malformados devuelven 400/422; tamaño413/tipo415; abuso429 sin trabajo DB.
- Límites no bloquean carga legítima de jefe con más datos.
- Redis caído sigue la política explícita de endpoints; no fail-open accidental.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir límites del endpoint afectado a valores medidos anteriores manteniendo validación; no deshabilitar seguridad global.

**Límite de autorización:** Spec EARS aprobada; no autoriza despliegue.

## SEC-05 — Resolver TLS y pinning con una decisión verificable

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** SEC-01, FND-02.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/core/api/api_client.dart`.
- Existente: `lib/core/security/certificate_pinning.dart`.
- Existente: `docs/adr`.
- Propuesto, crear solo tras spec: `test/core/security/tls-policy_test.dart`.
- Propuesto, crear solo tras spec: `docs/security/tls-device-test.md`.

**Requisito EARS propuesto:** El artefacto release respetará exactamente la política TLS aprobada y nunca anunciará pinning que no se ejecuta.

**Pasos, en orden:**

1. Leer ADR existente de pinning y topología Cloudflare/certificados; elegir PKI de plataforma con documentación precisa o pinning realmente necesario por amenaza y operable.
2. Corregir la premisa: badCertificateCallback solo se invoca cuando falla confianza, y puede aceptar un certificado inválido si devuelve true; no es validación adicional en todo handshake.
3. Si se elige pinning, validar cadena+hostname+vigencia y pin en todo handshake mediante mecanismo soportado; dos pines/rotación y recuperación por release firmado, sin bypass remoto genérico.
4. Probar CA confiable con pin ajeno, certificado caducado/autofirmado, hostname erróneo, pin backup, pins ausentes y rotación en dispositivo; web usa controles navegador/servidor.

**Aceptación verificable:**

- Prueba de certificado confiable/pin incorrecto refleja la decisión ADR, no un mock de helper.
- No se acepta certificado inválido solo por hash.
- APK release y plataforma web tienen garantías distintas documentadas; no se bloquea accidentalmente toda flota.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir a la política PKI segura aprobada mediante release compatible; jamás devolver true globalmente en callback.

**Límite de autorización:** Javier aprueba política y coordinación de certificados; no leer claves ni cambiar CDN/producción.

## SEC-06 — Mínimo privilegio y privacidad en plataformas móviles

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** SEC-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `android/app/src/main/AndroidManifest.xml`.
- Existente: `android/app/src/main/res/xml/network_security_config.xml`.
- Existente: `ios/Runner/Info.plist`.
- Existente: `lib/core/services`.
- Propuesto, crear solo tras spec: `android/app/src/debug/res/xml/network_security_config.xml`.
- Propuesto, crear solo tras spec: `docs/security/mobile-permissions.md`.

**Requisito EARS propuesto:** Release no permitirá HTTP local ni solicitará permisos no vinculados a una función justificada y activada por el usuario.

**Pasos, en orden:**

1. Mapear cada permiso a función real: fotos, PDF, impresora Bluetooth, notificaciones, localización; probar denegación, revocación y Android versiones soportadas.
2. Mover excepciones LAN/emulador a debug y verificar manifest fusionado release; no basarse solo en el XML fuente.
3. Sustituir almacenamiento global por APIs de aplicación/SAF/share; retirar background location si no existe requisito y prueba; revisar Android backup/data extraction e iOS protección de archivos.
4. Limpiar temporales sensibles tras impresión/compartición con retención aprobada; revisar previews, clipboard, screenshots y notificaciones según riesgo.

**Aceptación verificable:**

- Inspección APK release sin cleartext ni permisos injustificados.
- Fotos, impresión, ubicación requerida y PDF funcionan con permisos mínimos.
- Dispositivo compartido/logout no deja documentos sensibles accesibles al siguiente usuario.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir solo cambio de permiso que impida función aprobada en release de corrección; no restaurar permisos globales sin evidencia.

**Límite de autorización:** Cambios de privacidad y requisitos de ubicación requieren decisión de producto; no conceder permisos vía herramientas.

## SEC-07 — Limitar chatbot y herramientas de IA

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** SEC-03, SEC-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes/chatbot.js`.
- Existente: `backend/src/chatbot/llm-orchestrator.js`.
- Existente: `lib/features/chatbot`.
- Propuesto, crear solo tras spec: `backend/__tests__/chatbot-boundaries.test.js`.
- Propuesto, crear solo tras spec: `docs/security/ai-tool-policy.md`.

**Requisito EARS propuesto:** Ni instrucciones del usuario ni contenido recuperado podrán ampliar el ámbito de datos o permisos de herramientas del chatbot.

**Pasos, en orden:**

1. Seguir ruta→orquestador→herramientas y demostrar cuáles están activas; si el módulo no está expuesto, conservar tarea como gate previo a habilitarlo.
2. Validar mensaje, historial, IDs, tamaños y salida; presupuesto por usuario/rol de tokens, peticiones, concurrencia, tiempo y coste.
3. Pasar identidad autorizada a repositorios; tratar texto de documentos/modelo como datos sin autoridad. Herramientas permitidas con schemas, permisos propios y prohibición de SQL/comandos arbitrarios.
4. Añadir corpus de prompt injection, historial adulterado, objeto ajeno, salida malformada, timeout y proveedor caído; no enviar datos reales a un proveedor sin política aprobada.

**Aceptación verificable:**

- Prompts adversarios no revelan datos fuera de scope ni ejecutan efectos no autorizados.
- Cuotas fallan antes del proveedor y liberan recursos.
- Telemetría registra coste/latencia agregados sin prompts ni PII.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Desactivar feature por configuración autorizada si falla aislamiento; mantener funcionalidad principal sin depender de IA.

**Límite de autorización:** No autoriza envío de datos a terceros ni contratación; habilitación y datos permitidos los decide Javier.

## SEC-08 — Supply chain y secretos con evidencia redactada

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-02, FND-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `.github/workflows/security.yml`.
- Existente: `.github/workflows/backend-ci.yml`.
- Existente: `.gitleaks.toml`.
- Existente: `.semgrep`.
- Existente: `package-lock.json`.
- Existente: `backend/package-lock.json`.
- Existente: `pubspec.lock`.
- Propuesto, crear solo tras spec: `docs/security/dependency-exceptions.md`.
- Propuesto, crear solo tras spec: `docs/security/sbom-policy.md`.

**Requisito EARS propuesto:** Un artefacto con secreto detectado o vulnerabilidad bloqueante sin excepción vigente no podrá promocionarse.

**Pasos, en orden:**

1. Repetir auditorías en la versión exacta del lock y registrar alcance runtime/dev; baseline actual solo npm producción:4moderate+1low, no equivale a cero riesgos.
2. Fijar GitHub Actions por SHA y revisar permisos mínimos, fork PR, caches, artefactos y runners; no ejecutar código de PR con secretos productivos.
3. Generar SBOM Node/Dart/assets nativos y revisar licencias; tool de escaneo elegida con versión/pin y salida redactada; evaluar cada advisory por reachability y parche.
4. Configurar excepciones por hallazgo concreto con owner/fecha/mitigación, y escaneo autorizado del histórico por proceso seguro; no abrir archivos secretos bloqueados ni imprimir coincidencias.

**Aceptación verificable:**

- Fixtures de secreto sintético y dependencia bloqueante detienen promoción.
- SBOM ligada al SHA de artefacto; hashes/firmas verificables.
- Avisos moderados/bajos tienen decisión y vencimiento; ningún npm audit fix --force automático.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir actualización incompatible de forma aislada con aceptación de riesgo temporal; si hay credencial real, parar y activar respuesta humana.

**Límite de autorización:** Rotación/revocación de secretos y revisión histórica sensible solo Javier/proceso autorizado; publicar solo resultados redactados.

## SEC-09 — Logs y telemetría sin filtración de datos

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** SEC-01, SEC-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/middleware/logger.js`.
- Existente: `backend/routes/telemetry.js`.
- Existente: `backend/instrument.js`.
- Existente: `lib/core/utils/app_logger.dart`.
- Existente: `lib/main.dart`.
- Propuesto, crear solo tras spec: `backend/__tests__/logging-redaction.test.js`.
- Propuesto, crear solo tras spec: `docs/security/data-retention.md`.

**Requisito EARS propuesto:** Los logs y errores de producción contendrán solo campos permitidos y nunca token, PIN, DNI, firma ni cuerpos financieros.

**Pasos, en orden:**

1. Definir allowlist de campos y redactor profundo compartido; normalizar ruta sin query, reemplazar identificadores por correlación no reversible donde proceda.
2. Separar audit trail financiero de logs de diagnóstico: acceso, integridad, retención y finalidad distintos; no borrar evidencia necesaria al aplicar minimización.
3. Probar objetos anidados, headers, excepciones, SQL params y eventos RUM con datos sintéticos; no enviar eventos reales durante la prueba.
4. Configurar muestreo y cardinalidad para no multiplicar costes ni esconder fallos; revisar beforeSend de Sentry y SDK nativo.

**Aceptación verificable:**

- Canary sintético de PII nunca aparece en ningún sink de test.
- Cada request se correlaciona por requestId sin contenido sensible.
- Retención/borrado y acceso de audit trail quedan aprobados y ensayados.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir cambios de formato incompatibles manteniendo redacción; ante fallo cerrar el logging de payload, no abrirlo.

**Límite de autorización:** Política de conservación financiera/privacidad debe aprobarla responsable de negocio/legal; no se presume cumplimiento normativo.

## SEC-10 — Evidencias, PDFs, ficheros y destinatarios seguros

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** SEC-03, SEC-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes/entregas.js`.
- Existente: `backend/routes/facturas.js`.
- Existente: `backend/routes/repartidor-document-routes.js`.
- Existente: `backend/services/reparto-receipt-service.js`.
- Existente: `lib/features/repartidor/presentation/widgets`.
- Propuesto, crear solo tras spec: `backend/__tests__/document-safety-matrix.test.js`.

**Requisito EARS propuesto:** Un archivo o envío estará vinculado a un documento autorizado y ningún input controlará rutas de disco o destinatarios fuera de la política.

**Pasos, en orden:**

1. Validar autorización antes de cargar/generar/compartir; schema para recipients y contacto alternativo aportado por repartidor; construir to/cc completo y separar transporte sink/allowlist TEST.
2. Validar tamaño, MIME y firma de formato; normalizar imagen en librería mantenida bajo límites de píxeles/memoria; generar nombre opaco y almacenar fuera del webroot.
3. Bloquear traversal, rutas absolutas, symlinks fuera de raíz, CRLF y SSRF de URLs remotas; si no hay descarga remota, prohibir introducirla por conveniencia.
4. Revisar PDF/HTML/CSV/impresión frente a texto no confiable, fórmulas CSV, HTML injection y comandos ZPL; preservar serie completa de documento.

**Aceptación verificable:**

- Archivo ajeno, sobredimensionado, tipo falso y ruta escapada se rechazan antes de side effects.
- TEST jamás envía correo ERP real y mantiene destinatarios lógicos correctos.
- Evidencia y recibo tienen ciclo de vida, acceso y trazabilidad probados.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir por canal/handler y mantener deny por defecto ante fallo de validación; no perder evidencias existentes.

**Límite de autorización:** Spec EARS aprobada; no autoriza despliegue.

## DATA-01 — Garantizar SQL y destinos de escritura

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-05, SEC-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/repositories`.
- Existente: `backend/services`.
- Existente: `backend/src/core/infrastructure/database/db2-connection-pool.ts`.
- Existente: `backend/config/db.js`.
- Propuesto, crear solo tras spec: `docs/data/query-catalog.csv`.
- Propuesto, crear solo tras spec: `backend/__tests__/sql-policy.test.js`.

**Requisito EARS propuesto:** Todos los valores externos serán binds y cualquier escritura fuera del destino TEST autorizado será rechazada.

**Pasos, en orden:**

1. Inventariar SQL activo por modo/runtime con hash normalizado, tabla/columna observada, binds, identificadores dinámicos y caller; clasificar scripts administrativos aparte.
2. Asegurar parámetros para valores y mapping allowlisted para schema/tabla/columna/sort; no sustituir bind por escapar comillas. Revisar todos los accesos, no solo pool principal.
3. Verificar existencia/tipos con QSYS2.SYSTABLES/SYSCOLUMNS en sesión autorizada antes de usar nuevas consultas; el inventario estático actual no acredita catálogo vivo.
4. Añadir negativas de payload SQL, identificador no permitido y destinos productivos en adaptadores falsos; cuentas/grants reales los gestiona Javier.

**Aceptación verificable:**

- Cero interpolación de valores de usuario en sentencias.
- Todo builder dinámico tiene allowlist y prueba de rechazo.
- Guard demuestra DSEDAC read-only y escrituras TEST; ninguna prueba de CI lanza DML/DDL real.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir una query por commit, conservando binds/guard; nunca volver a concatenación insegura.

**Límite de autorización:** MANUAL JAVIER si cambia backend/config/db.js, permisos, credenciales o DB2 DDL/DML.

## FIN-01 — Especificar y congelar invariantes de negocio

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-04, FND-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/services/reparto-confirmation-service.js`.
- Existente: `backend/services/delivery-amount-resolver.js`.
- Existente: `backend/services/repartidor-liquidacion-service.js`.
- Existente: `lib/features/repartidor/domain`.
- Propuesto, crear solo tras spec: `docs/spec/finance-invariants.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/finance-invariants.test.js`.

**Requisito EARS propuesto:** Una entrega, su cobro y liquidación mantendrán importes y evidencia coherentes en todos los canales.

**Pasos, en orden:**

1. Crear tabla EARS requisito→caso→fixtures para saldo CPC/documento, cantidades reales, parciales, reversos, abonos, IVA y cierre del día.
2. Separar dominio comercial del reparto: CVC/FPG/CAC/CPC para deuda comercial, no sustituirlo por VISTA_DEUDA_BASE; objetivos R1_T8CDVD y ventas LCCDVD.
3. Fijar Finalizar como confirmación conjunta entrega+cobro con nombre/apellidos/DNI/firma; notas obligatorias nunca null y Talón con número/vencimiento/banco ENB.
4. Caracterizar lista/ficha/cabecera/PDF/impresión/liq con mismo documento y serie completa; identificar estado actual local antes de modificarlo.

**Aceptación verificable:**

- Casos dorados cubren todas las reglas AGENTS sin importes reales publicados.
- Saldo cobrable nunca excede documento ni duplica deuda de cliente.
- Devolución de factura cobrada ajusta caja sin restar de nuevo total LQD; plazo viene de FPG.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Conservar fixtures caracterizadas; no revertir reglas correctas para acomodar refactor. Ante discrepancia bloquear slice financiero.

**Límite de autorización:** Validación de reglas por Javier/negocio; pruebas con datos sintéticos. No autoriza escritura ERP.

## FIN-02 — Representación monetaria y redondeo compartidos

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FIN-01, ARCH-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/core/utils/currency_formatter.dart`.
- Existente: `lib/features/liquidacion_comercial/domain/liquidacion_domain.dart`.
- Existente: `lib/features/pedidos/data/pedidos_service.dart`.
- Existente: `backend/services`.
- Propuesto, crear solo tras spec: `lib/core/domain/money.dart`.
- Propuesto, crear solo tras spec: `backend/domain/money.js`.
- Propuesto, crear solo tras spec: `docs/spec/decimal-contract.md`.

**Requisito EARS propuesto:** Los cálculos económicos usarán precisión y redondeo explícitos, idénticos en backend y cliente.

**Pasos, en orden:**

1. Inventariar escala real de precio, cantidad, porcentaje, base, impuesto y total DB2/API; no convertir todos los precios a céntimos porque pueden requerir más de dos decimales.
2. Definir decimal canónico o enteros escalados por tipo; moneda, rounding mode y punto de redondeo por línea/documento; backend sigue autoridad.
3. Migrar parsers y serialización de un flujo con adaptadores compatibles; evitar cambios históricos y acumulación de double; UI formatea, no decide saldo.
4. Probar vectores compartidos JSON sintéticos: muchas líneas, cantidades fraccionarias, descuentos, impuestos, negativos/devoluciones y parciales.

**Aceptación verificable:**

- Backend/Flutter coinciden exactamente con fixtures aprobadas.
- No hay pérdida de escala ni cambio silencioso del contrato JSON.
- Migración permite clientes previos y documentos históricos; cobertura de overflow/NaN/Infinity.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Restaurar adaptador de serialización del flujo, sin recalcular documentos persistidos ni alterar sumas históricas.

**Límite de autorización:** Contrato contable/DB2 aprobado; librería decimal seleccionada tras revisión de mantenimiento/licencia.

## FIN-03 — Idempotencia y concurrencia en todas las mutaciones

**Prioridad:** P0 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FIN-01, SEC-03, DATA-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/services/reparto-confirmation-service.js`.
- Existente: `backend/repositories/reparto-confirmation-db2-repository.js`.
- Existente: `backend/services/repartidor-liquidacion-service.js`.
- Existente: `backend/routes/pedidos.js`.
- Propuesto, crear solo tras spec: `docs/spec/idempotency-protocol.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/financial-concurrency.test.js`.

**Requisito EARS propuesto:** Repetir un comando confirmado no producirá una segunda mutación; misma clave con payload diferente generará conflicto explícito.

**Pasos, en orden:**

1. Inventariar los controles existentes de confirmación/liquidación y extender solo huecos a cobro pendiente, pedidos, reversos y cierre; conservar locks y constraints ya presentes.
2. Definir clave opaca, scope, canonical payload hash, versión de schema, retención, estado pending/committed y respuesta replay; la clave comercial protege tras expirar cache de respuestas.
3. Escribir antes tests simultáneos con misma clave/mismo cuerpo, misma clave/distinto cuerpo, claves distintas/mismo documento, cierre frente a cobro y timeout después del commit.
4. Reconciliar resultado ambiguo consultando command status por identidad autorizada; nunca reintentar POST monetario automáticamente sin contrato.

**Aceptación verificable:**

- N solicitudes equivalentes producen un único asiento y la misma respuesta canónica.
- Conflicto devuelve código estable y cero escritura adicional.
- Test con driver TEST confirma atomicidad/locks cuando se autorice; unit mocks no certifican DB2.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Desactivar nueva entrada de comandos si falla integridad; preservar journal/asientos y reconciliar read-only. No rollback destructivo de dinero.

**Límite de autorización:** DDL/constraints/tablas TEST y ejecución de escrituras requieren aprobación de Javier; no tocar config/db.js.

## FIN-04 — Outbox fiable y entregas externas reconciliables

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FIN-03, SEC-10.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/services/repartidor-liquidacion-outbox-service.js`.
- Existente: `backend/services/reparto-variance-notification-service.js`.
- Existente: `backend/services/reparto-receipt-service.js`.
- Propuesto, crear solo tras spec: `docs/spec/outbox-protocol.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/outbox-worker-contract.test.js`.

**Requisito EARS propuesto:** El efecto confirmado y la intención de envío se conservarán atómicamente; fallos de transporte quedarán visibles y recuperables.

**Pasos, en orden:**

1. Comparar outboxes existentes y definir claim con lease, owner, vencimiento, intentos, próxima fecha, error redactado y clave del proveedor.
2. Mantener intención de recibo/operaciones/repartidor en transacción cuando corresponda; evitar Promise best-effort como única garantía de entrega.
3. Worker acotado con backoff+jitter, lease renovable, DLQ y acción manual auditada; soportar reinicio entre claim/envío/ack.
4. Declarar transporte al menos una vez; usar deduplicación proveedor o Message-ID cuando garantice efecto. Sin soporte, el envío ambiguo pasa a reconciliación, no se promete exactly-once.

**Aceptación verificable:**

- Dos workers no mantienen claim válido simultáneo de la misma fila.
- Crash tras envío antes de ack tiene tratamiento documentado y no reenvío ciego ilimitado.
- TEST utiliza sink y conserva to/cc completo; no pierde recibo ante fallo Redis/correo.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Parar solo el consumidor nuevo según procedimiento autorizado y preservar pendientes; continuar con lector compatible sin borrar outbox.

**Límite de autorización:** Cambios DB2/aprovisionamiento workers aprobados; no pm2 start/reload ni correo real durante tests.

## FIN-05 — Comandos offline tipados y recuperación de sesión

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FIN-03, FIN-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/core/offline/sync_queue_service.dart`.
- Existente: `lib/features/repartidor/data/reparto_confirmation_request.dart`.
- Existente: `lib/features/repartidor/data/reparto_confirmation_journal.dart`.
- Propuesto, crear solo tras spec: `test/core/offline/command-recovery_test.dart`.
- Propuesto, crear solo tras spec: `docs/spec/offline-commands.md`.

**Requisito EARS propuesto:** Un comando offline conservará identidad, payload, evidencia y estado hasta confirmar su resultado o solicitar revisión, sin ejecutarse bajo otra sesión.

**Pasos, en orden:**

1. Inventariar journal/cola existentes y separar borrador, pendiente, enviando, confirmado, conflicto y revisión; persistir versión de comando y clave estable antes de enviar.
2. Definir tratamiento de logout/cambio de rol con comandos pendientes: bloquear envío por otro usuario, conservar cifrado según política y pedir resolución al propietario autorizado.
3. Probar pérdida de red antes/durante/después de POST, reinicio app, disco lleno, corrupción/migración de store, token expirado y doble toque.
4. UI muestra pendiente y saldo no confirmado; validar servidor al cerrar; no borrar operaciones por edad ni permitir forzar éxito con un409 genérico.

**Aceptación verificable:**

- Replay válido se reconcilia contra misma operación/payload, no contra cualquier conflicto.
- Cambio de usuario no lee ni transmite cola anterior.
- Cero pérdida silenciosa; acción manual informa consecuencias y no duplica cobros.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Mantener lector de schema previo por versión; export/recuperación solo autorizada y cifrada. No vaciar Hive/cola como solución.

**Límite de autorización:** Aprobar política de retención y migración de datos locales; pruebas sintéticas sin DB real.

## FIN-06 — Reconciliación y trazabilidad de cierre

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FIN-01, FIN-03, FIN-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/services/repartidor-liquidacion-service.js`.
- Existente: `backend/repositories/repartidor-liquidacion-db2-repository.js`.
- Existente: `lib/features/repartidor_finanzas`.
- Propuesto, crear solo tras spec: `docs/operations/finance-reconciliation.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/reconciliation-invariants.test.js`.

**Requisito EARS propuesto:** Cada cierre podrá explicar origen, importe, evidencia, actor y estado de todas sus operaciones sin ajustes ocultos.

**Pasos, en orden:**

1. Construir conciliador read-only por documento/día/actor que compare entregado, cobrado, pendiente, reversado, liquidado y notificado.
2. Mostrar diferencias con IDs técnicos y razón, respetando scope; no autocorregir ni reescribir históricos.
3. Probar días frontera/zonas horarias, cobro parcial seguido del resto desde Cobros, cambio cantidades y cierre concurrente.
4. Definir procedimiento de investigación y corrección compensatoria aprobada, con trazabilidad independiente de logs de diagnóstico.

**Aceptación verificable:**

- Suma de fuentes coincide con snapshot/caja según reglas comerciales aprobadas.
- Toda discrepancia tiene estado y owner; no se marca cierre correcto con diferencias ocultas.
- Reporte no exporta DNI/firma/contactos innecesarios.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir visualización/consulta nueva; conservar evidencia y bloquear correcciones automáticas.

**Límite de autorización:** Consulta DB2 solo autorizada; ajustes monetarios requieren instrucción humana específica.

## CACHE-01 — Política única de frescura y aislamiento

**Prioridad:** P0 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-05, SEC-01, FIN-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/middleware/http-cache.js`.
- Existente: `backend/services/redis-cache.js`.
- Existente: `backend/services/query-optimizer.js`.
- Existente: `lib/core/cache/cache_service.dart`.
- Existente: `lib/core/offline`.
- Propuesto, crear solo tras spec: `docs/spec/cache-policy.csv`.
- Propuesto, crear solo tras spec: `backend/config/cache-policy.js`.
- Propuesto, crear solo tras spec: `lib/core/cache/cache_policy.dart`.

**Requisito EARS propuesto:** Cada lectura tendrá scope, edad máxima y regla de invalidación explícitos; una decisión financiera jamás se confirmará con un valor obsoleto.

**Pasos, en orden:**

1. Inventariar endpoint/loader y todas sus capas browser/CDN/HTTP/L1/Redis/query/Hive/provider; elegir una política por clase de dato.
2. Definir key con entorno/schema lógico, versión API/política, sujeto/rol/modo/scope y parámetros normalizados; no poner token/PII en key ni compartir ALL entre permisos distintos.
3. Distinguir caché servidor controlada, snapshot offline cifrado para mostrar y no-store HTTP; datos personales no implican prohibición absoluta de caché cifrada, sí minimización/frescura.
4. Aplicar tabla de políticas del capítulo04, con TTL propuestos pendientes de baseline; precio/saldo/evidencia/permiso se revalidan autoritativamente antes de escribir.

**Aceptación verificable:**

- Cada uso de cache referencia una política conocida; namespace desconocido se rechaza o bypass según contrato.
- Dos identidades/roles/entornos no comparten respuesta/ETag/cola.
- UI distingue stale/offline; ningún POST de liquidación se cachea.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Desactivar caché del namespace afectado y medir carga; nunca habilitar stale global para corregir latencia.

**Límite de autorización:** Cambios de clasificación/retención aprobados; conservar offline requerido por negocio.

## CACHE-02 — Invalidación post-commit y read-your-writes

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** CACHE-01, FIN-03, FIN-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/middleware/http-cache.js`.
- Existente: `backend/services/redis-cache.js`.
- Existente: `backend/routes/repartidor-finanzas.js`.
- Existente: `lib/features/entregas/providers/entregas_provider.dart`.
- Propuesto, crear solo tras spec: `backend/__tests__/cache-invalidation-multiworker.test.js`.
- Propuesto, crear solo tras spec: `test/core/cache/read_your_writes_test.dart`.

**Requisito EARS propuesto:** Tras confirmar una mutación, el actor verá el estado confirmado y las cachés derivadas convergerán dentro del presupuesto aprobado.

**Pasos, en orden:**

1. Mapear agregado→lecturas afectadas para entrega/cobro/nota/precio/cierre/cambio de rol; incluir lista/ficha/cabecera/summary/PDF.
2. Persistir intención/generación de invalidación junto al commit si requiere fiabilidad; aplicar L1 local y pubsub Redis con recuperación tras mensajes perdidos.
3. Usar versionado por agregado o tags acotados; evitar KEYS/barridos globales en Redis y purgar L1 al reconectar si no puede validar generación.
4. Cliente integra respuesta canónica del comando e invalida providers y caché persistente correspondiente, sin fabricar totales.

**Aceptación verificable:**

- Prueba dos procesos+cliente ve misma versión después de mutación/reconexión.
- Caída Redis entre commit e invalidación no deja stale indefinido.
- Métricas invalidation lag y eventos fallidos son observables.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Bypass temporal de lecturas afectadas con límites de carga; preservar outbox de invalidación para replay.

**Límite de autorización:** Cambios DB2 para outbox requieren Javier; no vaciar Redis productivo para probar.

## CACHE-03 — Reducir solapamientos y estampidas de caché

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** CACHE-01, CACHE-02, PERF-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/services/redis-cache.js`.
- Existente: `backend/services/query-optimizer.js`.
- Existente: `backend/middleware/http-cache.js`.
- Existente: `backend/services`.
- Propuesto, crear solo tras spec: `backend/__tests__/cache-contention.test.js`.

**Requisito EARS propuesto:** La caída o expiración de una clave no provocará trabajo duplicado ilimitado ni crecimiento sin cota de memoria.

**Pasos, en orden:**

1. Medir qué capa evita trabajo en cada flujo antes de retirar alguna; mantener caché HTTP solo donde tenga semántica y privacidad verificables.
2. Añadir single-flight local y, cuando medición lo justifique, lease distribuido con fencing/timeout; quien pierde espera con deadline o bypass acotado, nunca bloqueo infinito.
3. Fijar límites de entries/bytes, admisión de payload grande, jitter TTL, máximos stale y warmup con líder/presupuesto; evitar que warmup sature DB2.
4. Probar expiración simultánea, payload corrupto, cardinalidad hostil, Redis lento/caído, pubsub perdido y worker reiniciado.

**Aceptación verificable:**

- N clientes sobre una clave generan cargas aguas abajo acotadas.
- Heap retorna a meseta en soak y cache nunca cruza scope.
- Bypass/fallo mantiene resultados correctos y no reintenta escrituras.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Deshabilitar una optimización por namespace manteniendo límites de concurrencia; revertir por componente.

**Límite de autorización:** Carga solo TEST/staging autorizado; no FLUSHALL/KEYS en producción.

## PERF-01 — Baseline de rendimiento por flujo y entorno

**Prioridad:** P0 · **Fase orientativa:** 0 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-01, FND-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `docs/perf/latency-budgets.md`.
- Existente: `backend/routes/telemetry.js`.
- Existente: `lib/core`.
- Propuesto, crear solo tras spec: `docs/performance/baseline-protocol.md`.
- Propuesto, crear solo tras spec: `docs/performance/baseline-template.csv`.

**Requisito EARS propuesto:** Una afirmación de rendimiento indicará dispositivo, rol, SHA, red, caché, tamaño de datos, muestra y percentiles.

**Pasos, en orden:**

1. Preservar evidencias históricas 14/17sept como historia; no presentar 40s/HIT como SQL frío ni wall-time uiautomator como latencia API.
2. Definir dataset anonimizado representativo, jefe_ventas móvil con máxima carga, jefe en reparto y repartidor raso; comercial en matriz aparte.
3. Medir arranque, login por nombre/código, tabs, filtros, rutero, detalle, cobro/Finalizar, impresión y sync; 30repeticiones por flujo interactivo como mínimo orientativo, separar p50/p95 y muestras de carga suficientes para p99.
4. Registrar frame build/raster, memoria/GC, bytes, requests, pool/query/serialization/cache; perfilar en profile/release y teléfono real para [campo].

**Aceptación verificable:**

- Baseline reproducible con frío completo/L2/HIT/40s/offline diferenciados.
- Objetivos son provisionales hasta aceptación de baseline; no publicar porcentajes globales de una muestra caliente.
- Sin teléfono real, estado campo=NO_MEDIDO; continuar otros paquetes sin inventar resultados.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** No cambia producto; retirar únicamente instrumentación que altere medida y conservar datos agregados.

**Límite de autorización:** Participación autorizada de Javier/dispositivo; no reutilizar PIN ni copiar datos ERP a informes.

## PERF-02 — Optimizar consultas por evidencia y catálogo DB2

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** DATA-01, PERF-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/repositories`.
- Existente: `backend/src/modules`.
- Existente: `docs/perf/latency-budgets.md`.
- Existente: `backend/sql`.
- Propuesto, crear solo tras spec: `docs/data/query-performance.md`.

**Requisito EARS propuesto:** Toda optimización SQL conservará resultados y demostrará mejora en el workload completo, incluido frío.

**Pasos, en orden:**

1. Priorizar top por tiempo total×frecuencia y p95, empezando por consultas realmente lentas de la baseline; considerar LACLAE y pendientes solo si sigue siendo cuello actual.
2. Capturar plan/estadísticas de acceso con DBA y catálogo QSYS2; separar cardinalidad, sorts, scans, pool queue y transferencia; buscar N+1 y consultas repetidas.
3. Aplicar proyección, predicados sargables, batch acotado, paginación estable e índices candidatos; evitar aggregate TEST para mes abierto vivo sin contrato, conservar semántica histórica/mensual.
4. Preparar propuesta DDL con impacto espacio/escritura, mantenimiento y reversión DBA; no ejecutar DDL ni copiar ERP por iniciativa del agente.

**Aceptación verificable:**

- Resultado idéntico en fixtures y contraste autorizado; ORDEN>=0, CPC ROW_NUMBER y ALL se mantienen.
- p95 frío y carga mejoran sin castigar otras consultas; informe distingue espera pool de SQL.
- Cada índice tiene evidencia/coste y aprobación; sin acceso DB2 queda BLOCKED ese subpaso.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir query parametrizada por slice; DDL rollback solo DBA autorizado con plan propio.

**Límite de autorización:** MANUAL JAVIER/DBA: catálogo, planes y DDL/DML; DSEDAC/DSED nunca escritos por agentes.

## PERF-03 — Unificar pool, deadlines y cancelación ODBC

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-05, DATA-01, PERF-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/config/db.js`.
- Existente: `backend/src/core/infrastructure/database/db2-connection-pool.ts`.
- Existente: `backend/ecosystem.config.js`.
- Propuesto, crear solo tras spec: `docs/adr/db2-runtime-adapter.md`.
- Propuesto, crear solo tras spec: `backend/tests/db2-cancellation-contract.test.js`.

**Requisito EARS propuesto:** La expiración de una petición liberará recursos y no dejará una conexión con transacción desconocida disponible para otro actor.

**Pasos, en orden:**

1. Mapear pools/consumidores actuales y presupuesto total procesos×pool, respetando limite servidor; no aumentar workers sin calcular capacidad DB2.
2. Hacer adapters alternativos delegar al canónico después de contratos; BEGIN WORK TS es riesgo condicionado y se retira solo al validar alternativa ODBC.
3. Definir deadline extremo a extremo, cancel signal, queue timeout, query timeout, rollback/destrucción y retry solo lecturas idempotentes.
4. Ensayar consulta lenta/cancel/lock/caída en TEST aprobado; comprobar jobs/locks del servidor y recuperación de capacidad, no solo Promise rechazada.

**Aceptación verificable:**

- Concurrencia/cola tienen cota y respuesta503/504 consistente.
- No se reutiliza conexión de commit ambiguo ni se reintenta dinero.
- Driver real confirma cancelación o se documenta aislamiento/destrucción y límite residual.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Mantener adaptador previo detrás de selección explícita si seguro; cambios de pool productivo exclusivamente humanos.

**Límite de autorización:** MANUAL JAVIER: config/db.js intocable, ajustes PM2/DB2 fuera de autonomía.

## PERF-04 — Contratos de payload, paginación y export

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** PERF-01, ARCH-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes`.
- Existente: `backend/services`.
- Existente: `lib/features/clients`.
- Existente: `lib/features/warehouse`.
- Existente: `lib/features/pedidos`.
- Propuesto, crear solo tras spec: `docs/spec/pagination-export.md`.

**Requisito EARS propuesto:** Las listas y exportaciones tendrán coste acotado sin omitir ni duplicar registros al paginar.

**Pasos, en orden:**

1. Medir bytes/parse/render y número real de filas por pantalla; no limitar datos solo para aparentar velocidad.
2. Diseñar paginación estable con cursor o offset según índices/consistencia medidos, orden total y tie-breaker, filtros normalizados y máximos; conservar totales agregados necesarios.
3. Separar summary ligero/detalle bajo demanda/export asincrónico solo si volumen lo exige; aplicar autorización tanto al job como a descarga.
4. Migrar endpoint y consumidor juntos con contrato compatible; evitar cargar firma/foto/PII en listas y comprimir donde compense CPU.

**Aceptación verificable:**

- Cambio de página no duplica/omite en dataset definido; límites se aplican servidor.
- Totales facturas agregados siguen disponibles con/sin IVA.
- Bytes/parse/render medidos mejoran; export no agota heap ni scope.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Adaptador temporal conserva versión previa y parámetros; no cambiar silenciosamente page semantics.

**Límite de autorización:** Spec de contrato aprobada; no crear servicios externos nuevos por defecto.

## PERF-05 — Optimización Flutter guiada por perfiles

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** PERF-01, ARCH-03, CACHE-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/features/dashboard/presentation/pages/main_shell.dart`.
- Existente: `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart`.
- Existente: `lib/features/warehouse`.
- Existente: `lib/core/api/api_client.dart`.
- Propuesto, crear solo tras spec: `docs/performance/flutter-profile-results.md`.

**Requisito EARS propuesto:** Las interacciones críticas cumplirán presupuesto de frames y memoria en el dispositivo acordado sin degradar exactitud ni accesibilidad.

**Pasos, en orden:**

1. Identificar rebuilds/raster/parse caros en DevTools; separar red/DB de UI antes de optimizar.
2. Aplicar select a estado observado, listas lazy, claves estables, paginación, const cuando proceda y caché de imagen dimensionada; RepaintBoundary solo cuando perfil lo justifique.
3. Mover parse/cálculo pesado a isolate solo con umbral medido y cancelación; revisar listeners/controllers/timers y ciclo background/resume.
4. Validar tema, accesibilidad, offline y feedback de Finalizar con dataset grande; comparar mismos runs baseline.

**Aceptación verificable:**

- p95 build/raster dentro del presupuesto de refresco aprobado y jank bajo umbral.
- Memoria llega a meseta después de múltiples navegaciones; listeners liberados.
- No existe precarga que sature red/pool al login/resume.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir microoptimización que no aporte mejora reproducible; mantener tests de negocio.

**Límite de autorización:** Campo requiere dispositivo; no declarar latencia percibida con emulador.

## PERF-06 — Carga, saturación y pruebas de larga duración

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** PERF-01, PERF-03, CACHE-03, OPS-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/perf/k6/load-test.js`.
- Existente: `backend/ecosystem.config.js`.
- Propuesto, crear solo tras spec: `backend/perf/k6/scenarios`.
- Propuesto, crear solo tras spec: `docs/performance/capacity-model.md`.

**Requisito EARS propuesto:** El sistema rechazará exceso de carga de forma controlada y mantendrá invariantes durante fallos y recuperación.

**Pasos, en orden:**

1. Sustituir placeholder k6 por lecturas sintéticas con modelo de llegada, rampas y umbrales de error/p95; escritores financieros solo en lane TEST autorizado.
2. Definir concurrencia pico a partir de usuarios/dispositivos reales, distribución de roles, think-time y ráfagas; no inventar capacidad comercial.
3. Ejecutar smoke→normal→pico→soak, medir queue/pool/event-loop/heap/cache/DB/worker lag; incluir fallos Redis/correo y cancelación cliente.
4. Detener ante umbral seguro, conservar resultados agregados y plan de capacidad/coste; no dejar stress jobs en background.

**Aceptación verificable:**

- Latencia y errores cumplen objetivos acordados con muestra suficiente.
- No hay crecimiento de memoria/cola ilimitado ni doble efecto financiero.
- Se demuestra recuperación tras retirar carga/fallo, no solo estabilidad en HIT.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Detener exclusivamente el job de prueba iniciado y volver a configuración de TEST; no kill genérico node/PM2.

**Límite de autorización:** Aprobación de ventana/entorno de carga; jamás contra producción por defecto.

## ARCH-01 — Arquitectura backend canónica y migración vertical

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-05, SEC-03, FIN-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes`.
- Existente: `backend/services`.
- Existente: `backend/repositories`.
- Existente: `backend/src/modules`.
- Existente: `backend/src/shared/routes`.
- Propuesto, crear solo tras spec: `docs/adr/backend-module-boundaries.md`.

**Requisito EARS propuesto:** Cada dominio expondrá un único contrato público con responsabilidades claras entre ruta, servicio y acceso a datos.

**Pasos, en orden:**

1. Adoptar monolito modular con capas existentes routes/services/repositories/adapters; preservar módulos canónicos que ya cumplen. No iniciar migración masiva a TS ni microservicios sin necesidad demostrada.
2. Definir ownership para auth, clientes, pedidos, comercial, reparto, finanzas, reporting y almacén; impedir SQL en rutas nuevas y dependencias circulares.
3. Migrar un vertical de bajo riesgo por vez: caracterización→adapter→contrato→paridad→selección explícita→observación→retirada; trasladar cobros/auth al final con pruebas específicas.
4. Publicar calendario de flags/fallbacks con fecha de retirada. Fallo de módulo no debe activar silenciosamente una implementación distinta.

**Aceptación verificable:**

- Un propietario por método/path en cada modo soportado.
- Contrato estable para clientes actuales y reglas de negocio intactas.
- No hay imports de UI hacia backend ni DB2 fuera de repositorios/adapters.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir únicamente vertical no persistente o restaurar adapter aprobado; cambios de datos requieren reconciliación, no rollback ciego.

**Límite de autorización:** Aprobar ADR antes de mover carpetas canónicas; intocables siguen protegidos.

## ARCH-02 — Descomponer rutas y servicios de alto coste

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** ARCH-01, QA-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/app.js`.
- Existente: `backend/routes/entregas.js`.
- Existente: `backend/routes/repartidor-finanzas.js`.
- Existente: `backend/routes/facturas.js`.
- Existente: `backend/services/query-optimizer.js`.
- Propuesto, crear solo tras spec: `docs/engineering/refactor-slices.md`.

**Requisito EARS propuesto:** Una refactorización mantendrá comportamiento observable y separará validación, autorización, reglas y persistencia.

**Pasos, en orden:**

1. Elegir hotspot por churn, complejidad y fallos, no solo longitud; definir fachada pública y tests de caracterización antes de extraer.
2. Separar composición/app de arranque/listen/jobs; extraer handlers pequeños que validen/deleguen y servicios puros para decisiones.
3. Inyectar dependencias en seams existentes para probar reloj/cache/repo/transporte; evitar contenedores DI pesados o wrappers sin responsabilidad.
4. Mantener commits mecánicos separados de cambios de negocio; registrar reducción de complejidad, no perseguir un número de líneas a costa de legibilidad.

**Aceptación verificable:**

- Mismos códigos HTTP/DTO/side effects y orden transaccional en pruebas.
- Importar app para test no abre red ni arranca jobs.
- Cada extracción tiene un propietario y no introduce dependencias circulares.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir extracción de un módulo sin cambios de datos; conservar pruebas caracterizadoras.

**Límite de autorización:** No editar auth.js/db.js; proponer seams externos si hace falta.

## ARCH-03 — Dividir núcleo Flutter y navegación sin cambiar UX

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-04, FND-05, QA-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/features/dashboard/presentation/pages/main_shell.dart`.
- Existente: `lib/core/api/api_client.dart`.
- Existente: `lib/core/offline/sync_queue_service.dart`.
- Existente: `lib/core/theme`.
- Propuesto, crear solo tras spec: `docs/adr/flutter-core-boundaries.md`.
- Propuesto, crear solo tras spec: `test/core/navigation`.

**Requisito EARS propuesto:** Cada rol mantendrá las mismas rutas/tabs válidas y el núcleo expondrá fachadas testeables de red, sesión, caché y sincronización.

**Pasos, en orden:**

1. Caracterizar MainShell: _getNavItems y _buildCurrentPage deben derivar de un registro único por rol/modo o mantenerse sincronizados mediante test.
2. Extraer navegación, badges, lifecycle y presentación de shell; ApiClient separa política retry/auth/telemetry/cache sin cambiar interceptor order.
3. Extraer planificador/ejecutor/reconciliador de cola manteniendo store y migración versionados; tema conserva AppColors como fuente.
4. Probar background/resume, logout/role switch, back button, deep links permitidos, cancelación y disposición de recursos.

**Aceptación verificable:**

- Cada nav item resuelve una página autorizada y viceversa.
- Solo una recuperación refresh en vuelo; no reintento automático de mutaciones ambiguas.
- Tests fachada antes/después pasan; no editar UI muerta albaran_detail_page para entrega.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir una extracción por vez conservando APIs; no borrar estado offline para acomodar cambios.

**Límite de autorización:** Spec aprobada; mantener estructura lib/core+features/{data,domain,providers,presentation}.

## ARCH-04 — Fronteras por feature y tipado gradual

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** ARCH-03, FND-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/features`.
- Existente: `analysis_options.yaml`.
- Existente: `scripts/check_domain_imports.mjs`.
- Existente: `eslint.config.js`.
- Propuesto, crear solo tras spec: `docs/engineering/architecture-rules.md`.
- Propuesto, crear solo tras spec: `scripts/quality/check-boundaries.mjs`.

**Requisito EARS propuesto:** Nuevos cambios respetarán domain puro, contratos explícitos y dependencias dirigidas entre capas.

**Pasos, en orden:**

1. Definir reglas ejecutables: domain no Flutter/Dio/storage; presentation observa providers; data implementa puertos; core no conoce features; composición es excepción acotada.
2. Resolver duplicidad auth/authentication según referencias reales; migrar por feature tocado sin crear carpetas vacías por estética.
3. Reemplazar Map/dynamic crítico por DTOs tipados e inmutables en frontera JSON; fallos de parse con mensajes seguros; versionar compatibilidad.
4. Eliminar ignores globales por lotes pequeños con ratchet de diagnósticos; probar fixtures positivas y negativas de cada regla.

**Aceptación verificable:**

- Ningún nuevo import prohibido o ignore amplio pasa CI.
- Tests de dominio corren sin Flutter/plugins cuando sea viable.
- No cambia schema API por limpiar tipos; codegen reproducible sin diff inesperado.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir lote de feature, mantener baseline de deuda previa explícita; no volver a silenciar todos los diagnósticos.

**Límite de autorización:** Cambios de reglas canónicas requieren decisión/confirmación de Javier según AGENTS.

## ARCH-05 — Contrato API versionado y compatibilidad móvil

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-05, SEC-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `docs/openapi/openapi.yaml`.
- Existente: `backend/routes/docs.js`.
- Existente: `scripts/generate-postman-collection.js`.
- Existente: `lib/core/api`.
- Propuesto, crear solo tras spec: `docs/spec/api-compatibility.md`.
- Propuesto, crear solo tras spec: `backend/__tests__/openapi-runtime-parity.test.js`.

**Requisito EARS propuesto:** Todo endpoint soportado tendrá schema, autorización, errores, paginación y versión compatible con clientes desplegados.

**Pasos, en orden:**

1. Decidir fuente de verdad OpenAPI y comprobar montaje real contra spec; generar ejemplos sintéticos y retirar endpoints documentales inexistentes.
2. Precisar campos opcionales/null, dinero/fechas/serie completa, headers cache/idempotency y códigos de negocio; no inferir tipos de una sola respuesta.
3. Añadir diff de breaking changes, pruebas consumidor Flutter y servidor; cliente generado es opcional tras prueba de integración, no requisito de reescritura.
4. Establecer ventana N/N-1 basada en versiones móviles activas; deprecación observable y kill/forced update solo con política de negocio aprobada.

**Aceptación verificable:**

- Contrato cubre endpoints efectivos y variantes de error/auth, no solo200.
- Cambios incompatibles bloquean CI o requieren versión/adapter aprobado.
- Docs/Postman generados son reproducibles y sin credenciales.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Mantener campos/adapter de compatibilidad hasta retirar clientes antiguos; revertir spec/código juntos.

**Límite de autorización:** No inventar endpoints/tablas; propuestas nuevas marcadas y aprobadas.

## UX-01 — Tema, accesibilidad y sistema de componentes

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** ARCH-03, FND-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/core/theme`.
- Existente: `lib/features`.
- Existente: `test/widgets`.
- Propuesto, crear solo tras spec: `docs/ux/screen-matrix.md`.
- Propuesto, crear solo tras spec: `test/accessibility`.

**Requisito EARS propuesto:** Todas las pantallas soportadas serán legibles y operables en claro/oscuro, móvil/tablet y con ayudas de accesibilidad.

**Pasos, en orden:**

1. Crear matriz ruta×rol×modo×tema×tamaño; incluir filtros, tablas, matrices, modales, charts, PDF preview y estados de dinero.
2. Consolidar colores en AppColors y tokens tipográficos/espaciado con componentes reutilizables; conservar contraste y estado además de color.
3. Añadir Semantics/nombres/roles/valores, foco y orden lógico; targets48dp como estándar del proyecto; texto grande, TalkBack/VoiceOver y teclado cuando plataforma lo soporte.
4. Usar golden tests solo para componentes estables y tests semánticos para comportamiento; revisar con capturas sintéticas, sin exponer clientes.

**Aceptación verificable:**

- Checklist de todas las rutas sin huecos críticos de contraste/foco/lectura.
- Claro/oscuro aplica al contenido completo.
- Finalizar/cobro/error son accesibles y no dependen solo de icono o color.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir componente afectado con prueba visual/semántica; no restaurar hardcodes de colores sin excepción.

**Límite de autorización:** Criterio WCAG2.2 AA como referencia adaptada a nativo, sin afirmar certificación.

## UX-02 — Estados, errores y protección ante doble acción

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FIN-05, ARCH-05, UX-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart`.
- Existente: `lib/features/cobros`.
- Existente: `lib/features/repartidor_finanzas`.
- Existente: `lib/features/pedidos`.
- Propuesto, crear solo tras spec: `docs/ux/state-contract.md`.
- Propuesto, crear solo tras spec: `test/widgets/critical-flow-states_test.dart`.

**Requisito EARS propuesto:** Cada flujo informará loading/empty/error/offline/stale/pendiente y permitirá recuperación sin perder datos ni duplicar efectos.

**Pasos, en orden:**

1. Modelar estados explícitos por pantalla y comando; distinguir error técnico, validación y conflicto de negocio con acción concreta.
2. Bloquear doble envío a nivel UI y backend idempotente; guardar borradores autorizados, cancelar cargas de pantalla desmontada y no usar spinner infinito.
3. Mostrar antigüedad/estado offline donde cambia interpretación del saldo; confirmación monetaria espera resultado canónico y evidencia.
4. Probar back/rotate/resume/logout mientras dialog/envío, red lenta y recuperación; mensajes en español claros sin stack o códigos internos como texto principal.

**Aceptación verificable:**

- No hay pantalla en blanco ni datos obsoletos presentados como confirmados.
- Formulario mantiene datos recuperables y no pierde firma pendiente por navegación inadvertida.
- Cobro parcial se puede completar desde Cobros y Finalizar mantiene evidencia conjunta.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir componente visual sin alterar journal/contrato monetario; preservar borradores.

**Límite de autorización:** Spec UX+negocio aprobada; no cambiar requisitos de evidencia por conveniencia.

## UX-03 — Matriz de plataformas e integraciones nativas

**Prioridad:** P2 · **Fase orientativa:** 4 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** SEC-06, QA-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `android`.
- Existente: `ios`.
- Existente: `linux`.
- Existente: `macos`.
- Existente: `windows`.
- Existente: `web`.
- Existente: `assets/load_planner`.
- Existente: `assets/rutero_map`.
- Existente: `lib/features/warehouse/presentation/widgets/load_canvas.dart`.
- Propuesto, crear solo tras spec: `docs/engineering/platform-support.md`.

**Requisito EARS propuesto:** Solo se declararán soportadas las plataformas y periféricos con build y prueba de funciones críticas.

**Pasos, en orden:**

1. Definir Android principal y decisión explícita para iOS/web/escritorio; conservar scaffolds no soportados etiquetados, no borrarlos por defecto.
2. Revisar identificadores plantilla, firma, iconos, privacidad, permisos, SDK mínimo y dependencias nativas por plataforma.
3. Probar Bluetooth/ZPL/PDF/cámara/share/ubicación/WebView con dispositivos soportados y fallback accesible; validar JSON bridges, navegación allowlisted y assets locales sin cargas remotas no previstas.
4. Inventariar licencias y hashes de Three.js/mapas/fuentes; actualizar con smoke visual/carga, no copiar vendor opaco.

**Aceptación verificable:**

- Cada plataforma tiene supported/experimental/not-supported y evidencia fechada.
- Release principal funciona sin permisos globales ni red en WebViews locales previstos.
- Mensajes JS malformados/navegación externa no invocan acciones privilegiadas.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir paquete nativo con lock y configuración correspondientes; conservar compatibilidad de datos.

**Límite de autorización:** Firma/distribución y dispositivos humanos autorizados; no añadir herramientas de pago sin aprobación.

## QA-01 — Separar suites herméticas y lifecycle Jest

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-02, FND-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/jest.config.js`.
- Existente: `backend/package.json`.
- Existente: `backend/tests/setup.js`.
- Existente: `backend/__tests__`.
- Existente: `backend/tests`.
- Existente: `backend/src/__tests__`.
- Propuesto, crear solo tras spec: `backend/jest.unit.config.js`.
- Propuesto, crear solo tras spec: `backend/jest.contract.config.js`.
- Propuesto, crear solo tras spec: `docs/engineering/test-lanes.md`.

**Requisito EARS propuesto:** La suite unit/contract no accederá a red, DB2, secretos ni producción y fallará con cero tests o errores de teardown.

**Pasos, en orden:**

1. Inventariar suites en todas las raíces, no solo backend/tests; clasificar unit/contract/integration/DB2/write/perf y discovery exacto.
2. Bloquear egress/driver real en unit tests y usar inyección/fakes; setup no leerá .env ni inicializará pool/jobs. Integración usa lane opt-in con identidad mínima.
3. Retirar passWithNoTests de gates; corregir handles abiertos con teardown explícito y retirar forceExit solo después, usando detectOpenHandles como diagnóstico.
4. Publicar tiempos por suite y timeout acotado; tres runs estables tras cambiar lifecycle, sin kill general de node.

**Aceptación verificable:**

- Test que intente red/DB en unit lane falla de inmediato.
- Suite vacía/fallo de test/handle retenido no produce verde falso.
- JS y TS activos están cubiertos y el runner termina naturalmente.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Mantener runner anterior solo como comando explícito de diagnóstico sin llamarlo gate; revertir cambio aislado de setup.

**Límite de autorización:** No ejecutar suites integrales hasta cerrar su aislamiento; escrituras TEST requieren autorización.

## QA-02 — Pruebas de dinero, carreras y fallos de persistencia

**Prioridad:** P0 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FIN-01, FIN-03, QA-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/__tests__`.
- Existente: `test/features/repartidor`.
- Existente: `test/models/albaran_entrega_test.dart`.
- Propuesto, crear solo tras spec: `backend/tests/contracts/finance`.
- Propuesto, crear solo tras spec: `test/contracts/finance`.

**Requisito EARS propuesto:** Cada invariante financiera tendrá caso positivo, negativo, concurrencia y fallo entre etapas.

**Pasos, en orden:**

1. Derivar tabla de pruebas del spec FIN-01, no del código; incluir cantidades, parciales, talón, notas, DNI/firma, serie completa, IVA y plazos.
2. Añadir property tests con generadores de cantidades/escala y semillas persistidas; mutaciones dirigidas para saldo/rounding/idempotencia detectan defectos reales.
3. Inyectar fallo antes/después de begin/commit/outbox y status response; verificar que no se emite recibo de transacción abortada.
4. Separar mocks de driver real; preparar suite transaccional TEST con limpieza acotada aprobada e identificación única de datos.

**Aceptación verificable:**

- Invariantes no dependen de orden de tests ni reloj real.
- Cada fallo ambiguo tiene estado recuperable sin duplicar cobro/entrega.
- Revisión independiente comprueba que quitar un control importante rompe la prueba.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir test incorrecto tras corregir spec con evidencia; no desactivar asserts para obtener verde.

**Límite de autorización:** Ejecutar DML TEST únicamente con permiso/fixtures de Javier; DSEDAC nunca escritura.

## QA-03 — E2E determinista de reparto y comercial separados

**Prioridad:** P0 · **Fase orientativa:** 3 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FIN-05, FIN-06, QA-02, UX-02.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `integration_test/app_flow_test.dart`.
- Existente: `integration_test/repartidor_cierre_flow_test.dart`.
- Existente: `.github/workflows/flutter-tests.yml`.
- Propuesto, crear solo tras spec: `docs/qa/e2e-matrix.md`.
- Propuesto, crear solo tras spec: `integration_test/fixtures`.

**Requisito EARS propuesto:** Una release de reparto requerirá evidencia E2E de jefe en modo reparto y repartidor raso, sin sustituirla por el perfil comercial.

**Pasos, en orden:**

1. Crear dataset sintético aislado y cuentas por rol; preparar/limpiar por runId solo en TEST autorizado y correo sink.
2. Evitar condicionales tipo 'si aparece el botón, probar'; usar keys/Semantics estables y asserts de persistencia posterior, no solo navegación.
3. Ejecutar entrega+cobro conjunto, cantidades modificadas, talón ENB, cobro parcial/resto desde Cobros, recibo to/cc, cierre e impresión; agregar reinicio/offline/conflicto.
4. Mantener suite comercial independiente para pedidos/devoluciones/liquidación y líder80; guardar vídeo/traces/logs redactados con SHA.

**Aceptación verificable:**

- Cada escenario crítico tiene aserción UI+API+persistencia TEST cuando autorizada.
- Emulador válido para flujos; rendimiento de campo se mide aparte.
- Tres runs estables al introducir suite, luego frecuencia por riesgo; fallo bloquea release del dominio.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir fixture/harness defectuoso sin relajar aserciones del negocio; preservar artefactos de fallo.

**Límite de autorización:** Entorno/cuentas TEST/DML y dispositivos autorizados; sin correo ERP ni WhatsApp real de prueba.

## QA-04 — Builds y análisis reproducibles sin señales silenciadas

**Prioridad:** P1 · **Fase orientativa:** 1 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-02, FND-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `analysis_options.yaml`.
- Existente: `pubspec.yaml`.
- Existente: `.github/workflows/flutter-ci.yml`.
- Existente: `.github/workflows/flutter-release.yml`.
- Existente: `android/app/build.gradle.kts`.
- Propuesto, crear solo tras spec: `docs/engineering/build-matrix.md`.

**Requisito EARS propuesto:** Un build soportado fallará ante error real de código/generación y conservará artefactos diagnósticos sin secretos.

**Pasos, en orden:**

1. Capturar baseline de errores/warnings/infos y decidir categorías bloqueantes por deuda, sin ignorar compile errors; separar deuda conocida de regresión.
2. Ejecutar analyzer, tests, codegen cuando aplique y build Android release con firma gestionada; una prueba no sustituye compilación nativa.
3. Validar que generated sources no cambian al regenerar en limpio; no usar || true ni build_runner destructivo fuera del checkout propio.
4. Guardar tamaño/hash/symbols y manifest fusionado; builds iOS/desktop solo en runners disponibles y plataformas declaradas.

**Aceptación verificable:**

- Fuente limpia+lock fijo reproduce build validado con versión anotada.
- Errores nativos/de generación bloquean promoción.
- Ausencia de Mac/keystore se registra como bloqueo de esa plataforma, nunca PASS.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir cambio de configuración/build con pines y archivos generados coherentes; no borrar caches compartidas.

**Límite de autorización:** Firma/keystore solo por secret references; prohibida lectura directa de claves.

## QA-05 — Cobertura útil, ratchet y contratos de arquitectura

**Prioridad:** P1 · **Fase orientativa:** 4 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** QA-01, QA-02, ARCH-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/jest.config.js`.
- Existente: `.github/workflows/quality-gates.yml`.
- Existente: `scripts/check_domain_imports.mjs`.
- Existente: `test`.
- Propuesto, crear solo tras spec: `docs/engineering/coverage-policy.md`.
- Propuesto, crear solo tras spec: `scripts/quality/coverage-ratchet.mjs`.

**Requisito EARS propuesto:** La cobertura de ramas relevantes no disminuirá y los cambios críticos demostrarán detección de regresiones de comportamiento.

**Pasos, en orden:**

1. Medir cobertura por dominio y tipo de test, excluir solo generated/vendor justificados; evitar porcentaje inflado por tests que copian implementación.
2. Definir pisos iniciales según baseline y ratchet diferencial; objetivo orientativo85% ramas en código nuevo financiero/auth sujeto a riesgo, no100% global artificial.
3. Aplicar mutation testing acotado en dinero, scope, idempotencia y cache; cada superviviente se explica o se convierte en caso.
4. Unificar gate arquitectura Flutter/backend, validación OpenAPI y generación; publicar tendencia y excepciones temporales con owner.

**Aceptación verificable:**

- Fixture de regresión de rama cubierta falla; cobertura vacía nunca cumple umbral.
- No se exige test nuevo a cada cambio documental/reversible sin valor.
- Archivos de producto nuevos no quedan fuera del discovery ni de coverage por patrón.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Restaurar umbral previo si baseline era errónea mediante revisión, manteniendo bloqueo de regresiones reales.

**Límite de autorización:** Política aprobada, sin auto-fix de findings ni reducción silenciosa de umbrales.

## OPS-01 — Observabilidad operativa y correlación extremo a extremo

**Prioridad:** P1 · **Fase orientativa:** 2 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** SEC-09, FND-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `observability/prometheus.yml`.
- Existente: `observability/loki-config.yaml`.
- Existente: `observability/tempo.yaml`.
- Existente: `observability/grafana/dashboards/gmp-api-red.json`.
- Existente: `backend/instrument.js`.
- Existente: `backend/routes/health-probes.js`.
- Propuesto, crear solo tras spec: `observability/prometheus-rules.yml`.
- Propuesto, crear solo tras spec: `docs/operations/observability.md`.

**Requisito EARS propuesto:** Los operadores podrán localizar un fallo de flujo mediante métricas/logs/trazas sin acceder a datos personales innecesarios.

**Pasos, en orden:**

1. Confirmar plataforma real desplegada; archivos placeholder no acreditan servicios existentes. Elegir conjunto mínimo que pueda mantenerse antes de instalar todo el stack.
2. Materializar y validar config/dashboards RED, event-loop/heap/pool/queue/cache/outbox/sync; etiquetas de cardinalidad baja y ruta normalizada.
3. Correlacionar requestId/trace/release desde cliente hasta DB/outbox; sampling acotado y medición de overhead.
4. Separar liveness de readiness/degradación; endpoints públicos solo estado mínimo, detalle de dependencias restringido. Activar símbolos Sentry con canal secreto gestionado.

**Aceptación verificable:**

- Validadores de config/dashboard pasan; panel muestra tráfico sintético.
- Petición de prueba se sigue hasta repositorio/transporte sin PII.
- Alerta sintética se puede ensayar sin mandar mensajes externos hasta autorización.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Restaurar configuración observabilidad anterior aprobada; mantener logs esenciales con redacción y límites.

**Límite de autorización:** Despliegue del stack, DSN/secretos y envío de alertas requieren Javier.

## OPS-02 — SLO, alertas y procedimientos de degradación

**Prioridad:** P1 · **Fase orientativa:** 3 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** OPS-01, PERF-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `docs/perf/latency-budgets.md`.
- Existente: `observability`.
- Propuesto, crear solo tras spec: `docs/operations/slo.md`.
- Propuesto, crear solo tras spec: `docs/operations/runbooks`.
- Propuesto, crear solo tras spec: `observability/prometheus-rules.test.yml`.

**Requisito EARS propuesto:** Cada flujo crítico tendrá objetivo medible, propietario y acción de recuperación cuando consuma su presupuesto de error.

**Pasos, en orden:**

1. Elegir SLIs de disponibilidad útil, éxito correcto de confirmación, edad outbox, freshness y crash-free; objetivos provisionales del capítulo04 se calibran con baseline.
2. Definir ventanas y alertas multi-burn-rate, severidad y agrupación; evitar alertar por cada excepción sin impacto.
3. Redactar runbooks de DB2 lento, pool saturado, Redis/auth-store caído, recibo retrasado, disco lleno, token inválido y fallo de update móvil.
4. Ensayar sintéticamente condición y recuperación; documentar escalado, horario y quién puede mutar producción.

**Aceptación verificable:**

- Toda alerta tiene síntoma, query, umbral, owner, runbook y prueba.
- Dashboard distingue disponibilidad de /live de disponibilidad funcional de cobro.
- No se promueve release con presupuesto agotado salvo decisión humana registrada.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Volver a umbral previo si alarma era incorrecta con evidencia; no apagar telemetría para ocultar incumplimiento.

**Límite de autorización:** Javier decide objetivos de negocio, notificaciones y acciones sobre producción.

## OPS-03 — Release verificable y promoción con gates

**Prioridad:** P1 · **Fase orientativa:** 4 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** FND-03, QA-03, QA-04, SEC-08, OPS-02.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `.github/workflows/flutter-release.yml`.
- Existente: `.github/workflows/backend-ci.yml`.
- Existente: `.github/workflows/ci-cd.yml`.
- Propuesto, crear solo tras spec: `docs/operations/release-runbook.md`.
- Propuesto, crear solo tras spec: `docs/operations/release-evidence.schema.json`.

**Requisito EARS propuesto:** Build, firma, distribución y promoción tendrán estados distintos y una release no se declarará distribuida si el canal requerido no recibió el artefacto.

**Pasos, en orden:**

1. Mapear cadena test→revisión→tag/artefacto→staging→QA/AppSec→promoción; default main de GitHub no sustituye test como referencia GMP.
2. Construir una vez artefacto inmutable con SHA/hash/SBOM/provenance/símbolos y verificar firma/versionCode/manifest; no reconstruir contenido distinto tras QA.
3. Hacer explícitos canales obligatorios/opcionales: ausencia de Firebase/config debe producir skipped o blocked según política, no éxito ambiguo; Telegram opcional no bloquea producto si así se aprueba.
4. Compatibilidad API N/N-1 y rollback móvil/backend probado; producción sigue whitelist y prod_approved TTL≤30min después de staging+QA+AppSec+health.

**Aceptación verificable:**

- Release evidence apunta a mismos hashes en QA y distribución.
- No se filtran claves/símbolos sensibles a repositorio público.
- Publicación/deploy no ocurre en PR/fork ni sin gates humanos requeridos.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Mantener artefacto anterior verificable; si hay migración de datos, usar estrategia compatible/forward fix aprobada, no rollback destructivo.

**Límite de autorización:** MANUAL JAVIER para prod/secretos; únicos comandos productivos autónomos autorizables: git pull origin test y pm2 restart gmp-api tras gate.

## OPS-04 — Backup, restauración y continuidad de negocio

**Prioridad:** P1 · **Fase orientativa:** 4 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** SEC-01, FIN-06, OPS-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `docker-compose.yml`.
- Existente: `backend/services/reparto-receipt-service.js`.
- Existente: `docs`.
- Propuesto, crear solo tras spec: `docs/operations/backup-dr.md`.
- Propuesto, crear solo tras spec: `docs/operations/restore-drill-template.md`.

**Requisito EARS propuesto:** La recuperación conservará operaciones confirmadas/evidencia y demostrará RPO/RTO mediante restauración aislada.

**Pasos, en orden:**

1. Inventariar sistemas de registro: DB2 ERP, TEST, journal/offline, outbox, evidencias, configuración por referencia, release/símbolos y Redis; distinguir cache regenerable de sesiones/cola persistente.
2. Acordar RPO/RTO por activo, retención y propietario; cifrado, acceso mínimo, copia separada y comprobación de integridad.
3. DBA define backup IBM i; operador ensaya restauración solo en entorno aislado autorizado con endpoints/sinks incapaces de contactar ERP/correo real.
4. Verificar consistencia de documentos/asientos/evidencias/outbox y arranque funcional tras restore; registrar tiempo real y pérdida de datos medida.

**Aceptación verificable:**

- Informe de restore demuestra RPO/RTO, no solo que existe un backup.
- Ningún job restaurado envía correo/WhatsApp real ni escribe DSEDAC.
- Retención y borrado cumplen decisión de negocio/legal y recuperación.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Detener ensayo propio, aislar entorno restaurado y conservar evidencia; no sustituir ni borrar producción.

**Límite de autorización:** MANUAL JAVIER/DBA para snapshots, copias, restauración y retención; ninguna orden DML/DDL incluida como automática.

## OPS-05 — Separar scripts administrativos y proteger producción

**Prioridad:** P0 · **Fase orientativa:** 1 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-01, FND-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/package.json`.
- Existente: `backend/scripts/rollback.sh`.
- Existente: `Makefile`.
- Existente: `scripts`.
- Existente: `backend/scripts`.
- Propuesto, crear solo tras spec: `docs/operations/command-catalog.csv`.
- Propuesto, crear solo tras spec: `scripts/quality/admin-command-guard.mjs`.

**Requisito EARS propuesto:** Los comandos ordinarios de desarrollo no activarán mutaciones de DB, secretos, despliegue ni borrado de volúmenes.

**Pasos, en orden:**

1. Clasificar cada script read-only/local/TEST/admin/prod con entrada, destino, riesgos y reversión; scripts con nombres optimize/cleanup no se ejecutan por inferencia.
2. Añadir dry-run por defecto y validación de destino exacto a comandos autorizados de TEST; separar scripts administrativos del arranque/test/build.
3. Encapsular rollback legacy que edita configuración/inicia PM2 en runbook humano o retirar comando tras verificar consumidores; no ejecutar el rollback para comprobarlo.
4. Probar guards con fakes y payloads/rutas fuera del workspace; en Windows resolver paths antes de cualquier borrado/move recursivo y no cruzar shells.

**Aceptación verificable:**

- Un npm test/build/prepare ordinario no toca producción ni DB.
- CI detecta nuevos comandos peligrosos sin clasificación/guard.
- Ningún script de 'auto-heal' autoaprueba seguridad, credenciales o despliegues.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Restaurar alias solo si apunta a operación previamente segura; no rehabilitar bypass de producción para resolver fallos.

**Límite de autorización:** Aprobar cambios de política/script administrativo; no usar script heredado como autoridad de producción.

## OPS-06 — Empaquetado backend y servicios auxiliares mínimos

**Prioridad:** P2 · **Fase orientativa:** 4 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-02, SEC-08, OPS-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/Dockerfile`.
- Existente: `backend/.dockerignore`.
- Existente: `docker-compose.yml`.
- Existente: `backend/ecosystem.config.js`.
- Propuesto, crear solo tras spec: `docs/operations/runtime-packaging.md`.

**Requisito EARS propuesto:** El artefacto de runtime contendrá solo dependencias/archivos necesarios y no expondrá herramientas administrativas.

**Pasos, en orden:**

1. Decidir PM2 como plataforma actual y contenedor como soporte verificado si se usa; no migrar a Kubernetes ni añadir Redis cluster sin necesidad medida.
2. Fijar imágenes por digest con actualización mantenida; revisar usuario no root, filesystem writable mínimo, health y límites CPU/memoria.
3. Separar perfiles locales de redis-commander/devtools y puertos; verificar bind real y auth/ACL cuando aplique, sin asumir seguridad de loopback tras contenedor.
4. Probar contexto Docker/paquete: excluye archivos sensibles, dumps, tmp, uploads, tests no necesarios y runtime agente; verificar ODBC nativo en imagen.

**Aceptación verificable:**

- Imagen/config se valida sin expandir secretos productivos.
- Smoke en entorno aislado usa /live y /ready correctamente.
- SBOM runtime refleja binarios/dependencias de verdad y tamaño tiene baseline.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Volver al artefacto anterior por digest y configuración aprobada; no down -v ni borrar volúmenes.

**Límite de autorización:** Cambios de host/Docker/Redis/PM2 requieren operador; publicación de imagen solo con autorización.

## OPS-07 — Validación adversarial y respuesta a incidentes

**Prioridad:** P1 · **Fase orientativa:** 5 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** SEC-02, SEC-03, SEC-05, SEC-07, SEC-10, QA-03, OPS-02, OPS-04.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `docs`.
- Existente: `backend/__tests__`.
- Existente: `integration_test`.
- Propuesto, crear solo tras spec: `docs/security/pentest-scope.md`.
- Propuesto, crear solo tras spec: `docs/operations/incident-response.md`.
- Propuesto, crear solo tras spec: `docs/security/assurance-report.md`.

**Requisito EARS propuesto:** Antes de promoción profesional se evaluarán controles críticos de forma independiente y cualquier riesgo no resuelto tendrá decisión explícita.

**Pasos, en orden:**

1. Definir alcance/ventana/cuentas sintéticas/acciones permitidas de pentest staging con stop conditions y exclusión de terceros/productivo.
2. Ejecutar revisión ASVS/MASVS seleccionada, DAST autenticado, autorización horizontal/vertical, uploads/SSRF, sesión, supply chain, móvil/offline y IA.
3. Ensayar tabletop de dispositivo/token comprometido, filtración, pago ambiguo y restauración; quién revoca/rota/notifica/recupera queda escrito.
4. Convertir hallazgos reproducidos en casos regresión; clasificar residuales con owner/caducidad. Revisión recurrente tras cambios sensibles, no certificado eterno.

**Aceptación verificable:**

- No hay riesgo crítico/alto explotable pendiente sin bloqueo de release; aceptación no sustituye corrección de activos esenciales.
- Informe enlaza prueba/evidencia/versión y limita alcance.
- Runbook reduce tiempo de detección/recuperación medido en ensayo.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Detener pruebas y aislar staging si hay efectos imprevistos; no limpiar evidencias de incidente.

**Límite de autorización:** Autorización explícita de pentest/acciones y notificaciones; no se ejecuta como parte de escribir el plan.

## REP-01 — Clasificación completa del árbol y política de limpieza

**Prioridad:** P1 · **Fase orientativa:** 0 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `.gitignore`.
- Existente: `docs`.
- Existente: `scripts`.
- Existente: `backend`.
- Existente: `lib`.
- Propuesto, crear solo tras spec: `docs/engineering/repository-manifest.csv`.
- Propuesto, crear solo tras spec: `docs/engineering/repository-hygiene.md`.

**Requisito EARS propuesto:** Cada ruta tendrá propósito, propietario, clasificación, fuente de reproducción y decisión de conservación antes de moverla o borrarla.

**Pasos, en orden:**

1. Usar el inventario de este plan como semilla y recapturar paths/estado actual: código propio, plataforma, vendor, generated, runtime privado, gobernanza y evidencia.
2. Crear mapa por archivo candidato actual→destino→referencias→prueba→riesgo→rollback; metadatos no prueban que algo sea basura.
3. Separar Git versionado de disco local: 2070 tracked y más de220k físicos son magnitudes distintas; no intentar 'refactorizar' node_modules/venv/build.
4. Aprobar lotes pequeños de movimiento; validar root absoluto, no seguir reparse ni tocar secretos, .git, worktrees o trabajo ajeno.

**Aceptación verificable:**

- Toda carpeta/subcarpeta censada se resuelve por política + excepciones explícitas.
- Ninguna eliminación sin referencia/caller/artefacto/migración comprobados.
- Sin cambios de reglas ni clean/reset global en este paquete.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir únicamente manifest/movimiento propio por commit; conservar archivos de trabajo no versionados.

**Límite de autorización:** Borrados recursivos, worktree deletion y datos requieren autorización específica; este paquete prepara clasificación.

## REP-02 — Retirar residuos versionados y preservar evidencia privada

**Prioridad:** P1 · **Fase orientativa:** 4 · **Esfuerzo:** L · **Estado:** TODO

**Dependencias:** REP-01, OPS-05, ARCH-01.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `backend/routes/repartidor-finanzas.js.tmp2`.
- Existente: `backend/repositories`.
- Existente: `backend/scripts/temp`.
- Existente: `backend/kpi`.
- Existente: `docs/archive`.
- Existente: `.gitignore`.
- Propuesto, crear solo tras spec: `docs/engineering/cleanup-decisions.csv`.

**Requisito EARS propuesto:** El repositorio público contendrá solo archivos aprobados y no resultados operativos/adjuntos privados sin finalidad de producto.

**Pasos, en orden:**

1. Priorizar .tmp2/.repaired/.fromgit, outputs KPI, backups, adjuntos, estado IDE/vault; revisar contenido solo si permitido y con redacción, sin re-publicar PII al archivarlo en docs.
2. Buscar referencias con rg/git grep, imports dinámicos, CI, scripts, assets y runtime; si hay duda conservar en cuarentena privada con owner.
3. Retirar del índice o mover a destino acordado sin borrar copia local necesaria; archivo regulatorio/evidencia va a almacenamiento restringido aprobado, no al repositorio público.
4. Añadir gate de extensiones/ubicaciones y allowlist para fixtures sintéticas/binarios legítimos; historial con datos sensibles se trata como incidente separado.

**Aceptación verificable:**

- Diff contiene solo paths aprobados, no código de negocio mezclado.
- Build/tests/links afectados pasan y no hay referencias activas rotas.
- Eliminar en HEAD no se presenta como borrado del historial ni sustituto de rotación.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir commit de movimiento si material no sensible; restaurar evidencia privada solo a destino restringido, nunca volver a publicar secreto.

**Límite de autorización:** Javier aprueba retiro/borrado y cualquier saneamiento histórico; no reescribir Git automáticamente.

## REP-03 — Reconciliar gobernanza y portabilidad de agentes

**Prioridad:** P1 · **Fase orientativa:** 0 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** REP-01, FND-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `AGENTS.md`.
- Existente: `.gitignore`.
- Existente: `docs/superpowers/specs/2026-08-27-team-port-design.md`.
- Existente: `.clinerules`.
- Existente: `.cline`.
- Existente: `.claude`.
- Existente: `.opencode`.
- Existente: `scripts/team/sync-harness.cjs`.
- Propuesto, crear solo tras spec: `docs/adr/agent-governance-source.md`.

**Requisito EARS propuesto:** Un checkout limpio reproducirá los controles que el proyecto declara obligatorios, con runtime y secretos fuera de Git.

**Pasos, en orden:**

1. Resolver con Javier discrepancia spec agosto/kernel versionado vs decisión release septiembre/árboles locales ignorados; no asumir que designorar todo es correcto.
2. Enumerar fuente canónica mínima y derivados por harness; excluir settings de usuario, MCP tokens, estados, backups, adjuntos, conversaciones y permisos implícitos.
3. Preparar allowlist de archivos revisados y prueba clean checkout; regenerar cuatro skills faltantes solo después de aprobar política, con generador ya existente.
4. Corregir contradicciones de auto-fix/rollback/autonomía entre reglas por cambio separado; no editar reglas permanentes sin confirmación y capturar decisión en ledger.

**Aceptación verificable:**

- sync-harness --check exit0 en copia limpia, no solo equipo del autor.
- Fuentes/versiones/hashes de derivados conocidas y sin secretos.
- AGENTS enlaza herramientas realmente disponibles en Git o bootstrap documentado.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir política/derivados del commit propio preservando copias locales; no desactivar guardrails existentes.

**Límite de autorización:** CONFIRMACIÓN JAVIER antes de editar reglas canónicas/AGENTS; cambios propuestos en ADR, no autoaprobados.

## REP-04 — Documentación viva y onboarding verificable

**Prioridad:** P1 · **Fase orientativa:** 4 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-05, REP-03, ARCH-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `README.md`.
- Existente: `docs/spec`.
- Existente: `docs/adr`.
- Existente: `docs/audits`.
- Existente: `memory-bank/activeContext.md`.
- Existente: `memory-bank/progress.md`.
- Propuesto, crear solo tras spec: `docs/INDEX.md`.
- Propuesto, crear solo tras spec: `docs/engineering/onboarding.md`.

**Requisito EARS propuesto:** Una persona nueva podrá identificar la arquitectura vigente, ejecutar checks seguros y encontrar evidencia sin confundirla con planes históricos.

**Pasos, en orden:**

1. Reescribir README según runtime real npm start/server.js y pines, con comandos seguros por SO y enlace a matriz de modos.
2. Taxonomía docs/adr decisiones, docs/spec requisitos, docs/operations runbooks, docs/audits evidencia inmutable, docs/archive material sustituido; metadatos owner/estado/fecha/sucesor.
3. Actualizar memory-bank con estado probado separado de pendientes/manual/hipótesis; ningún DONE sustentado solo en chequeo de fuente.
4. Crear linter enlaces/rutas/fragmentos y sesión de onboarding desde limpio sin acceso a credenciales productivas; publicar solo información adecuada al repositorio público.

**Aceptación verificable:**

- Instrucciones de inicio resuelven binarios/paths reales sin secretos.
- Plan histórico no contradice estado vivo sin marca de sucesión.
- Código de ejemplo/comandos propuestos claramente diferenciados de existentes.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Revertir documentos movidos conservando enlaces redirect/sucesor; no borrar auditorías históricas.

**Límite de autorización:** Reglas permanentes o publicación de información operativa sensible requieren revisión humana.

## REP-05 — Dependencias, assets, licencias y tamaño

**Prioridad:** P2 · **Fase orientativa:** 4 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** REP-01, SEC-08, UX-03.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `pubspec.yaml`.
- Existente: `pubspec.lock`.
- Existente: `backend/package.json`.
- Existente: `package.json`.
- Existente: `assets`.
- Existente: `skills-lock.json`.
- Propuesto, crear solo tras spec: `docs/engineering/dependency-register.csv`.
- Propuesto, crear solo tras spec: `docs/engineering/asset-register.csv`.

**Requisito EARS propuesto:** Cada dependencia o binario versionado tendrá uso verificado, licencia, responsable y política de actualización.

**Pasos, en orden:**

1. Comparar imports directos/dinámicos, plugins/codegen y scripts con dependencias declaradas; no quitar librerías por una búsqueda textual negativa aislada.
2. Resolver librerías solapadas solo con ahorro y coste medidos; fijar intl y herramientas según compatibilidad SDK real, no versiones inventadas.
3. Registrar licencias de charts/fuentes/mapas/Three.js/IA y requerimientos de atribución; validar derechos con responsable competente si hay duda.
4. Medir tamaño APK/AAB/backend/Git; LFS solo para binarios necesarios tras comparar costes y distribución. No hacer migración histórica/rewrite por limpieza.

**Aceptación verificable:**

- Instalación limpia/build no depende de transitive imports accidentales.
- SBOM/licencias/atribuciones actualizados y tamaño explicado.
- No assets duplicados/inútiles probados; excepciones justificadas.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Reponer dependencia+lock+asset en el mismo commit si consumidor legítimo aparece; no tocar historial Git.

**Límite de autorización:** Decisiones comerciales/licencias/LFS y borrado de binarios requieren aprobación de propietario.

## CLOSE-01 — Cierre integral desde checkout limpio y entrega

**Prioridad:** P0 · **Fase orientativa:** 5 · **Esfuerzo:** M · **Estado:** TODO

**Dependencias:** FND-01, FND-02, FND-03, FND-04, FND-05, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, DATA-01, FIN-01, FIN-02, FIN-03, FIN-04, FIN-05, FIN-06, CACHE-01, CACHE-02, CACHE-03, PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06, ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, UX-01, UX-02, UX-03, QA-01, QA-02, QA-03, QA-04, QA-05, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, REP-01, REP-02, REP-03, REP-04, REP-05.

**Responsabilidad:** Un maker del área; verificador independiente.

**Entrada verificable:** cerrar dependencias con SHA y evidencia; leer los siguientes archivos reales y delimitar el diff de un slice. Las rutas de directorio son scope de descubrimiento, no permiso para reescritura total.

- Existente: `AGENTS.md`.
- Existente: `docs`.
- Existente: `lib`.
- Existente: `backend`.
- Existente: `.github/workflows`.
- Propuesto, crear solo tras spec: `docs/audits/professionalization-execution-report.md`.

**Requisito EARS propuesto:** El proyecto solo se declarará profesionalizado en el alcance acordado cuando cada requisito obligatorio tenga evidencia independiente vigente.

**Pasos, en orden:**

1. Recapturar inventario y comparar clasificación por carpeta; revisar que no haya tmp/log/dumps/artefactos privados nuevos y que checkout no dependa de archivos locales ignorados.
2. Ejecutar gates aplicables del capítulo06 en commit exacto: análisis/tests/contratos/build/security/arquitectura/DB2 TEST/campo/staging; no sustituir faltantes por estimaciones.
3. Revisor independiente comprueba casos financieros, scope, estado de tareas y rollback; Politec documenta propósito, organización, legibilidad, integración, tests, eficiencia/errores y seguridad.
4. Entregar índice de archivos modificados, commits/PR autorizados, evidencia y riesgo residual; promoción solo tras gates humanos, publicar plan no equivale a desplegar producto.

**Aceptación verificable:**

- Backlog sin TODO obligatorio ni BLOCKED oculto; excepciones opcionales justificadas.
- Ningún PASS basado en test no ejecutado o reporte de otro SHA.
- Repositorio limpio en checkout de entrega; trabajo local ajeno se conserva fuera del alcance.

**Comprobación de ejecución:** aplicar la receta de la familia en el capítulo 06; registrar comandos concretos y paths de test antes del maker. Cualquier test/archivo propuesto aquí debe existir y estar revisado antes de invocarlo. No ejecutar comandos con placeholders.

**Salida del paquete:** diff del slice, spec aprobada, pruebas/cwd/exit reales, evidencia redactada y dictamen del verificador. Si falta una dependencia externa: BLOCKED con causa, propietario y siguiente acción; no DONE.

**Reversión:** Si falla un gate, volver al paquete dueño del fallo hasta3iteraciones y parar tras2sin progreso; no rollback destructivo automático.

**Límite de autorización:** Commit/push/PR y despliegue requieren autorización vigente; /adelante-production+TTL para producción.
