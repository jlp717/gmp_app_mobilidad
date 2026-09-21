# CI de cierre: FAIL

Se consultaron las ejecuciones del commit `59191131ed44648af5f8614c75def293f9b47461` el 21/09/2026. Los commits finales posteriores sólo añaden documentación; estos fallos no están corregidos. Las pruebas locales aprobadas no equivalen a CI verde.

| Workflow | Evidencia | Resultado |
|---|---|---|
| CI/CD Pipeline | [Run 35601433736](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35601433736) | FAIL pre-flight: Politec espera `requireInternalMetricsAccess` en `/api/ready`. El código actual usa `publicReadyPayload` y `canSeeInternalDetails`; falta reconciliar contrato y gate. No se demuestra una exposición sólo con la expresión regular fallida. |
| security | [Run 35601433846](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35601433846) | Gitleaks PASS; npm audit exit1: 7 vulnerabilidades, 1 high, 5 moderate, 1 low. |
| flutter-tests | [Run 35601433857](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35601433857) | FAIL `flutter pub get`: el SDK estable descargado3.47.5 exige matcher0.12.20; hive_generator2.0.1 limita analyzer<7 y bloquea la resolución con test. El SDK local con el que pasan tests/build es3.35.6. |
| API Docs | [Run 35601433840](https://github.com/jlp717/gmp_app_mobilidad/actions/runs/35601433840) | FAIL drift de colección Postman; Spectral2 errores y3 warnings: ejemplo login sin user, nullable sin type y respuestas/contact incompletos. |

La revisión independiente de seguridad identifica el único HIGH en `js-yaml3.15.1`, bajo Jest/Istanbul, dependencia de desarrollo ([GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)). `npm audit --audit-level=high --omit=dev --json` ejecutado en backend devuelve exit0: cero high/critical de runtime, pero conserva cinco moderate/low. Afecta a csv-parse, qs y Joi; CI también lista morgan como moderado. Esto es un gate de seguridad global pendiente, no un PASS general de dependencias.

`git diff ba8af0f6 HEAD -- package.json package-lock.json backend/package.json backend/package-lock.json .github/workflows scripts/politec-quality-gate.ps1 docs/openapi docs/postman` no mostró cambios de esta sesión en esos archivos. No se ejecutó `npm audit fix`, no se relajaron los gates y no se introdujeron actualizaciones de dependencias sin validarlas.

Clasificación: **P1 — CI de entrega no aprobado**. Los riesgos runtime moderate/low quedan **P2**, pendientes de revisar alcance y actualización. Las fuentes de log completas quedan localmente como `ci-preflight-final.log`, `ci-flutter-final.log` y `ci-api-docs-final.log`; `ci-final-runs.json` conserva estado y URL de los cuatro runs.
