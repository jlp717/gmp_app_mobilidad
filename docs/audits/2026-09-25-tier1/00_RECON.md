# 00_RECON — Fase 0: Reconocimiento y Contrato de Trabajo (2026-09-25, Europe/Madrid)

## 0. Insumos previos absorbidos

| Hallazgo previo | Ref | Estado actual | Acción propuesta | Justificación |
|---|---|---|---|---|
| H30 QO-04 — backend/package.json:20 `jest --passWithNoTests --forceExit` | QO-04 | ABIERTO | Lote tooling, quitar passWithNoTests | Verificado en código actual esta sesión |
| H14 BD-14 / H49 REP-09 — residuales tracked: backend/routes/repartidor-finanzas.js.tmp2, backend/repositories/reparto-finance-db2-repository.js.repaired, backend/repositories/reparto-finance-db2-repository.js.fromgit | BD-14/REP-09 | ABIERTO | Lote limpieza (REP-02) | Residuales tracked confirmados esta sesión |
| FND-02 — engines node >=20 (raíz) / >=20.6.0 (backend); Node 20 EOL según 10-sources.md | FND-02 | ABIERTO | Bump Node 24 LTS + lockfiles | Node 20 EOL; runtime desactualizado |
| npm audit 4 moderate + 1 low (09-verification-report) | SEC-audit | PARCIALMENTE RESUELTO | Re-auditar en Lote 1 | Commit ca4f0fd (qs 6.16.0, joi 17.13.8, csv-parse 7.0.2, express 4.22.3, body-parser 1.20.8) |
| REP cleanup scripts | REP | PARCIAL | Completar limpieza de residuales | Commit e28072e (inventory 340 + archive 192 + tools 77); quedan .tmp2/.repaired/.fromgit |
| Flutter test fallando: "serializa cobro+notificaciones" occurredAt futuro (09) | FND-04 | ABIERTO | Fix test rojo conocido | Test rojo conocido asignado a FND-04 |
| dart analyze: 0 errores / 4 warnings / 6551 infos (09) | LINT | ABIERTO | Plan de deuda lint masiva | 6551 infos = deuda técnica de estilo |
| H1 BD-01 / H2 BD-02 — convivencia JS+TS+DDD por flags, pool TS con BEGIN WORK | BD-01/BD-02 | ABIERTO | Consolidar CommonJS canónico y retirar pool TS alternativo | Decisión 02-architecture.md: CommonJS canónico |
| H52 SEC-01 — verifyToken tras rutas auth legacy (app.js:783) | SEC-01 | ABIERTO | Refactor de orden de rutas en app.js (rodear, no editar auth.js) ✋ | auth.js intocable: requiere Javier manual o refactor de orden |
| H3/H5/H9/H11/H15/H35/H53/H59 — marcados "conservar" por la auditoría | varios | RESUELTO-POR-DISEÑO | No tocar; documentar como invariantes | Decisión de auditoría previa |
| Resto de hallazgos H4..H63 no verificados individualmente hoy | H4..H63 | PENDIENTE-VERIFICACIÓN | Verificar uno a uno en 01_AUDIT.md (Fase 1) | Sin verificación individual en esta sesión |

Fuente: auditoría docs/audits/2026-09-18-professionalization/ (10 docs leídos íntegros esta sesión). 63 hallazgos extraídos (H1..H63) + backlog 57 paquetes (FND/SEC/FIN/CACHE/PERF/ARCH/UX/QA/OPS/REP/CLOSE).

Contradicciones detectadas en auditoría previa (resolver en Fase 1): C1 spec kernel vs .gitignore (REP-01); C2 README runtime TS ≠ npm start real (REP-03); C3 backend-ci publica en main vs rama test (REP-11); C4 CI tolera fallos (QO-04/QO-08); C5 CommonJS canónico vs pool TS coexistente (BD-01/BD-02).

## 1. Contrato de trabajo
- Repo: github.com/jlp717/gmp_app_mobilidad, local C:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad (el path sin "Desktop" indicado en el encargo NO existe; se usa el real).
- Rama: test (actual, confirmada). Sin PRs, sin ramas nuevas. Commits Conventional Commits atómicos por lote.
- Cero código parcial, cero alucinación, cero any/disable sin justificación, cero secretos, cero console.log fuera de logger.
- Intocables: backend/config/db.js, backend/middleware/auth.js (guardrail físico); UI muerta albaran_detail_page.dart.
- Artefactos en docs/audits/2026-09-25-tier1/.

## 2. Stack detectado
- Frontend: Flutter SDK >=3.0.0 <4.0.0, app v4.1.36+92. Riverpod 2.5.1 + riverpod_annotation/generator, Dio 5.4, Hive 2.2.3 + hive_flutter + flutter_secure_storage 10.2, freezed, go_router 13.2, syncfusion charts/calendar 28.1.33, sentry_flutter 8.14.2, webview_flutter, workmanager, flutter_bluetooth_printer (ZPL). very_good_analysis 6.0. 333 ficheros .dart en lib/, 141 tests en test/.
- Backend: Node CommonJS + Express 4.22.3 (main server.js, `npm start` = node server.js), odbc 2.5 (DB2 for i), redis 4.6, joi 17.13.8 + zod 3.25 + express-validator (3 validadores coexisten), helmet, express-rate-limit, jsonwebtoken, bcrypt 6, winston, @sentry/node 10.62, baileys (WhatsApp), pdfkit, sequelize-cli presente en scripts (db:migrate/db:seed — candidato a retirar, DB2 no usa sequelize). TS legacy en src/ (ts-node-dev, tsc) coexistiendo con CommonJS. 914 ficheros .js en backend/, 31 tests.
- Raíz: tooling DX (husky 9, lint-staged, commitlint, eslint 9, prettier 3). Engines node >=20.
- CI: 14 workflows (.github/workflows/): api-docs, backend-ci, ci-cd, ci-self-heal, commit-message-lint-test, flutter-ci, flutter-release, flutter-tests, knowledge-sync, opencode-governance, opencode, quality-gates, security + dependabot.yml.
- Infra: PM2 gmp-api :3335 en 192.168.1.230, DB2 for i DSN GMP (192.168.1.22), Redis, observability/ (prometheus, loki, tempo, grafana — placeholders según H37).
- Métricas: 914 JS backend / 333 Dart lib / 31 tests backend / 141 tests flutter. Cobertura: desconocida (collectCoverage=false, H29).

## 3. Suposiciones (y validación)
1. CommonJS es el runtime canónico (decisión 02-architecture.md); TS src/ es legado a retirar → validar en Fase 1 mapeando qué usa PM2 realmente (ecosystem.config.js).
2. Los 242 ficheros dirty son trabajo previo no commiteado → validar con Javier (pregunta B1).
3. Secu sequelize-cli es residuo sin uso real → validar grep de models/migrations en Fase 1.
4. La app en producción se sirve desde rama test vía git pull origin test → hecho conocido del workspace.
5. Cobertura real baja (31 tests backend para 914 ficheros) → validar ejecutando jest --coverage en Fase 1.

## 4. Preguntas bloqueantes (máx 5)
- B1. HAY 242 FICHEROS DIRTY EN EL WORKTREE (148 modificados, 91 sin trackear, 2 staged). Los lotes atómicos exigen base limpia. ¿Commiteo el trabajo pendiente primero, lo stasho, o trabajo encima asumiendo mezcla? BLOQUEANTE.
- B2. ¿Confirmas entrega de artefactos en docs/audits/2026-09-25-tier1/?
- B3. TS legacy backend/src/: ¿autorizas su retirada tras verificar que PM2 solo usa CommonJS? (C5 de la auditoría).
- B4. Alcance de sesión: ¿ejecuto P0 completo (FND+SEC+FIN, ~21 paquetes) y dejo P1/P2 en 05_BACKLOG_PENDIENTE.md, o intento más?
- B5. ¿Autorizas commits directos en test por lote (sin PR), según tu encargo?

## 5. Riesgos
- Datos en producción: DB2 DSEDAC lectura; escrituras solo TEST (JAVIER.TEST_*). Riesgo ALTO si un lote toca repositorios sin guard.
- Breaking changes: API consumida por app móvil en campo (repartidores). Compat N/N-1 obligatoria (decisión 02).
- Dependencias externas críticas: DB2 for i (ODBC), Redis, baileys/WhatsApp, Sentry, impresoras ZPL BT.
- Worktree sucio (242 ficheros): riesgo de mezclar cambios ajenos en lotes atómicos.
- auth.js/db.js intocables: limita opciones de refactor de seguridad (SEC-01 exige rodear, no editar).

## 6. Alcance estimado (unidades de trabajo por fase)
- Fase 1 (auditoría 12 pilares): 3 U (verificar 63 hallazgos + pilares nuevos 9/11/12 apenas cubiertos por auditoría previa).
- Fase 2 lotes P0: tooling (2U), limpieza (1U), seguridad (4U), dinero/idempotencia (4U), caché (2U), QA suites (3U).
- Fase 2 lotes P1: perf (3U), arch (5U), observabilidad (3U), UX/a11y (2U).
- Fase 3: 2 U. Total estimado: ~29 U; cabe parcial en sesión → priorización Severidad×Impacto.