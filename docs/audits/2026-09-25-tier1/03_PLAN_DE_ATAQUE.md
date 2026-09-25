# 03_PLAN_DE_ATAQUE — Lotes de Ejecución (2026-09-25)

Reglas: 1 writer por lote; lote autocontenido (compila+tests+linter); commit atómico Conventional Commits en rama test; reversible; intocables auth.js/db.js/albaran_detail_page.dart; escrituras DB2 solo TEST. Referencia backlog previo: mapeo a paquetes FND/SEC/FIN/QA/OPS/REP de 05-implementation-backlog.md.

## L1 — chore(tooling): señal CI honesta [P0] (refs FND-02/03/04, QO-03/04/05/06/07/08/10, QO-14, matriz #2/#3/#11/#22)
DoD: npm test sin passWithNoTests (suites vacías fallan); jest forceExit eliminado o justificado con cierre pool; FLUTTER_VERSION única en workflows; skip_tests restringido a dispatch aprobado; flutter-release exit 1 si tag sin credenciales; npm audit sin || true; coverage threshold enforced o step borrado; rollback.sh sin sed .env ni pm2 start; Makefile clean vs clean-volumes separados; test flutter FND-04 verde (inyección clock); engines Node 24 LTS decidido (bump o justificación). Verificación: cd backend && npm test exit 0; flutter test test/<afectado> exit 0; yamllint workflows.

## L2 — fix(seguridad): frontera y transporte [P0] (refs SEC-04/07, matriz #1/#4/#5/#9/#10)
DoD: network_security_config sin IP prod cleartext; chatbot zod strict + ownership clientCode; bypass cert envuelto kDebugMode; MANAGE_EXTERNAL_STORAGE eliminado (verificar PDFs siguen abriendo); cobros.js VALUES CTE → binds; whitelist identificadores objectives/warehouse/clients/dashboard + test estático; zod params facturas/entregas. Verificación: jest seguridad exit 0; flutter analyze 0 err; test estático whitelist verde.

## L3 — fix(errores): shape API único [P0] (matriz #8)
DoD: serializador error único {success:false,code,error,requestId}; app.js handler delega en errorHandler; requestId generador único; sanitizeForLog recursivo con lista DNI/email. Verificación: jest contratos error exit 0; sin regresión tests existentes.

## L4 — fix(dinero): outbox lease + contrato caché [P0] (refs FIN-03/04, CACHE-01, matriz #6/#20)
DoD: outbox variance con claim+token (patrón liquidación) + test carrera; contrato invalidación HTTP↔query cache documentado + test; sin cambio comportamiento observable. Verificación: jest finanzas exit 0.
NOTA: migración double→céntimos (matriz #7) NO en este lote: va a L8 por tamaño.

## L5 — refactor(estructura): limpieza base [P0] (refs REP-02, matriz #12/#16/#21 parcial)
DoD: 3 residuales (.tmp2/.repaired/.fromgit) borrados; backend/tmp/ purgado o archivado; scripts sequelize-cli eliminados de package.json; src/ TS zombie borrado conservando src/modules DDD (verificar jest + arranque node -e require app); 7 console.log → logger; ADRs renumerados + índice. Verificación: npm test exit 0; node --check app.js; flutter analyze 0 err.

## L6 — fix(rendimiento): flutter rebuilds + deps + backend N+1 [P1] (matriz #14/#17/#18/#19)
DoD: 4 providers con select(); liquidacion_diaria/main_shell/cobros_page Consumers por sección; ListView→OptimizedListView en 6 sitios; syncfusion x2 fuera de pubspec; retry Dio backoff+jitter; batch INSERT rutero reorden+day-move; FETCH FIRST en cobros/commissions listados. Verificación: flutter analyze 0 err + flutter test afectados; jest afectados.

## L7 — fix(ux): cobros a11y + offline [P1] (matriz #15, preferencias Javier)
DoD: Semantics en acciones cobros (registrar, filtros, export); estado offline explícito cobros_page (patrón pedidos); commissions acciones con Semantics. Verificación: flutter test widget cobros exit 0.

## L8 — feat(dominio): dinero céntimos + split god-files [P1, grande] (matriz #7/#13)
DoD: tipo Money (céntimos int) en dominio repartidor_finanzas/liquidacion con doble solo en render; pedidos/index.js split por casos de uso (slices); routes analytics/commissions/objectives delegan en services. CAMBIO DE CONTRATO: ninguno externo (serialización API idéntica). Verificación: suite completa verde + tests carrera dinero.

## L9 — chore(gobernanza): GDPR + docs + repo [P2] (matriz #23/#24/#25)
DoD: registro tratamiento DNI/firma + política retención documentada; XLSX fuera de docs/; CHANGELOG root; AAB purgados de historial (filter-repo, coordinar con Javier por force-push); gitignore AAB. Verificación: repo clonado limpio baja de tamaño.

## L10 — feat(observabilidad): stack real [P2]
DoD: Sentry obligatorio o eliminado (decisión); OTEL con deps reales o eliminado; alertas Prometheus + reglas; stack instalado vía cadena PROD con /adelante.

## Verificación global Fase 3
npm run lint && cd backend && npm test (exit 0) && flutter analyze (0 err) && flutter test (exit 0) → 04_RESULTADOS.md con métricas antes/después.

## Fuera de alcance declarado
- i18n ARB (YAGNI confirmado P9).
- Migración masiva joi→zod completa (solo rutas tocadas por otros lotes; resto incremental).
- Reescritura arquitectura hexagonal completa: monolito modular con puertos en familia dinero es el patrón; extensión gradual (decisión 02-architecture.md previa ratificada).
- Rutas /v1/: se crean cuando llegue primer cambio incompatible (ADR ya existe).
