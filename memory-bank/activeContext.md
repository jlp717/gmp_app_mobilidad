# Active Context — actualizado 2026-09-15

## Foco actual
Cierre del backlog de optimización 2026-09-14 (41 tareas). PRs abiertos contra `test`, **sin merge y sin deploy**. Informe: `docs/audits/2026-09-14-optimization-audit/04-execution-report.md`.

Cierre de este turno (no rehacer #5–#34):
- APP-09 #35 SWR liquidación/rutero; POST liquidación **no** cacheado; saldo cobrable = CPC documento.
- REL-03 #36 R8+obfuscate+plist/gradle.
- APP-10 #37 dispose + dead UI (se conserva `albaran_detail_page.dart`).
- SEC-02 #38 vendor-scope analytics/KPI (80 ALL → equipo, no 403).
- SEC-04 #39 precio de línea en servidor (sin cambiar CPC/cobros).
- SEC-05 #40 KPI etl/debug JEFE + SQL parametrizado (PARTIAL: algunos `IN` concatenados).
- SEC-06 **BLOCKED PR**: bump multer/nodemailer/js-yaml commit `b23aa20` en `origin/test`.
- SEC-03 **SKIP** hasta rotar PIN. No se tocó `_deploy_finance_fix.sh`.

Latencias de producto: **no verificado en campo**.

## Últimos cambios relevantes (2026-09-15)
- Informe de ejecución de las 41 tareas + este memory-bank.
- Accidente de proceso: SEC-06 se empujó a `test` (HEAD era `test` al commit). Pendiente decisión Javier; no force-push.

## Gates verificados
- Suites Jest/flutter analyze de paquetes grandes: hang → kill + chequeo de fuentes (documentado en el informe).
- `npm audit --omit=dev` SEC-06: 0 high/critical `[lab]`.
- Disco C: ~3,4 GB; no se limpió `build/`.

## Siguientes pasos sugeridos
1. Javier decide destino de `b23aa20` en `origin/test` (SEC-06).
2. Rotar PIN antes de SEC-03.
3. P0-03/P0-05/SRV-01/SRV-02/sonda túnel/DB-01 `spec_approved` / `SENTRY_DSN`.
4. Merge de PRs cuando Javier diga. No mergear desde el ejecutor.

## Decisiones vivas
- DINERO: saldo cobrable = CPC del documento; no cachear POST de liquidación; no cambiar semántica de importes.
- Comercial 80 ALL = equipo 72/73/81/83, no 403.
- Código actual gana sobre `01-executor-tasks.md` desfasado/ausente en `test`.
- Overlay load-env acotado a capability flags routing; NUNCA esquemas FINANCE.
- Fail-closed > fallback silencioso en IDs de tracking.

## Contexto previo (2026-08-31, aún vigente)
Rutero GPS tracking completado (gates verdes en su día). Pendiente en 230: `REPARTIDOR_TRACKING_ENABLED=true` + `pm2 restart gmp-api` con permiso Javier. Tabla `JAVIER.REPARTIDOR_RUTERO_TRACKING` verificada (0 filas).
