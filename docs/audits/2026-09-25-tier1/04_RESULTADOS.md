# 04_RESULTADOS — Métricas antes/después (2026-09-28)

| Métrica | Antes | Después | Evidencia |
|---|---|---|---|
| Tests backend | 3281 passed (L1a) | 3338 passed, 0 failed, 284 suites | `jest --ci --runInBand --forceExit` exit 0 |
| Tests Flutter nuevos | 0 | +~120 (money 14, liquidación +6 grupos, TLS 3+12 existentes, a11y/offline 4, rutero_quantity 6, warehouse 15, cobros business 25, tanda5 2; variance N/A es backend) | suites por feature |
| `flutter analyze` errores | 27 | 0 | `flutter analyze --no-pub`, 0 líneas error |
| `dart` infos | 6551 (auditoría previa) | 7290 | deuda estilo documentada, no bloqueante |
| `eslint` raíz | 8311 errores, exit≠0 | exit 0, 0 errores, 7323 warnings | ratchet: 31 ficheros regulados 0/0, legacy en warn |
| `console.log` backend prod | 7 | 0 | winston |
| Residuales tracked (`.tmp2` / `.repaired` / `.fromgit`) | 3 | 0 | — |
| `src/` TS zombie | ~90 ficheros | 22 borrados verificados | matriz en handoff L5a; resto referenciado por runtime/jest, documentado |
| SELECT inline routes | 203 | `analytics.js` 0 (7/7 handlers delegan); commissions/objectives: 5+1 handlers delegan, resto documentado pendiente | delegación a services |
| Doubles dinero | 90 hits | núcleo Money (céntimos) aditivo + serialización idéntica | swap total pendiente documentado |
| Outbox variance | sin lease | claim+token (paridad liquidación) + 5 tests carrera | tests concurrencia |
| Shapes error API | 3 | 1 canónico `{success:false,code,error,requestId}` | aditivo, conserva campo `error` |
| `requestId` | 3 generadores | canónico `addRequestId` | TS legacy documentado para retirada |
| Versiones Flutter CI | 3.24.0 vs 3.35.6 | 3.35.6 única | workflow único |
| `jest passWithNoTests` | sí | no | — |
| `jest forceExit` | — | mantenido con justificación (pool ODBC sin teardown) + `test:diagnose` | — |
| ADRs | numbering duplicado | ADR-0001..0019 + índice | `docs/adr/README.md` |
| CHANGELOG | inexistente | raíz Keep a Changelog | — |
| GDPR | inexistente | registro tratamiento + política retención | propuesta pendiente validación legal |
| Sentry | opcional | obligatorio en prod (fail-fast sin DSN) | L10 |
| Alertas Prometheus | 0 | 4 reglas + exposition válida + `rule_files` | `observability/` |
| Cleartext prod en APK | `192.168.1.230` permitido | eliminado (solo loopback/emulador) | transporte release HTTPS verificado |
| Chatbot | sin schema | zod strict + ownership cartera | — |
| Cert bypass dev | sin guard | gate `kDebugMode` + 3 tests | — |
| Retry Dio | fijo 1s | backoff exponencial + jitter (respeta `Retry-After`) | — |
| N+1 writes rutero | fila a fila | batch chunks 100 (rollback all-or-nothing preservado) | — |
| Listados sin límite | sin caps | caps (cobros 50000 safety, commissions agregados `FETCH FIRST 1`, targets 60) | — |
| Rebuilds Flutter | 4 providers + 3 páginas | `select()` / Consumers | 4 hallazgos P2 resultaron falsos positivos ya resueltos — corrección a la auditoría |
| Deps muertas syncfusion (0 imports) | presentes | eliminadas de `pubspec` | 0 imports verificado |
| Cobros a11y | 1 Semantics | acciones + offline explícito + 4 widget tests | — |
| CI honesta | — | `skip_tests` restringido a dispatch, release exit 1 en tags, audit sin `\|\| true`, coverage placeholder borrado, `rollback.sh` seguro (solo restart), Makefile clean/volumes separados, E2E nightly schedule (emulador existe) | workflows |
| Commits | — | 12 atómicos Conventional Commits en `test`, todos pushed (`0d0d806` wip, `0ad5cea` F0+F1, `81b91cf` L1, `a8610f5` L2, `b151931` L3, `0fda5e6` L4, `ff63d61`+`11f6633` L5, `b298ea7` L6, `429eb33` L7, `c013542` L8, `8928af9` L9, `0be5498` L10, `8231924` lint) | `git log test` |
| Incidentes | — | 1 (stash pop aplicó stash antiguo de Javier; resuelto con `reset --hard` a `0be5498`; `stash@{0}` intacto; lección: jamás stash/pop con stashes legacy) | — |
