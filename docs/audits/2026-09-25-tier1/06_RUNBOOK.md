# 06_RUNBOOK — operar GMP App Movilidad

## 1) Levantar local

Prerrequisitos: Node 20 o superior, Flutter 3.35.6, ODBC DSN GMP, Redis.

| Pieza | Comando |
|---|---|
| Backend prod-like | `cd backend && npm start` |
| Backend dev | `cd backend && npm run dev` |
| Flutter | `flutter run` |
| Tests backend | `cd backend && npm test` |
| Diagnose handles | `cd backend && npm run test:diagnose` |
| Analisis Flutter | `flutter analyze` |
| Tests Flutter por feature | `flutter test test/<feature>_test.dart` |

## 2) Desplegar

Cadena PROD obligatoria:

1. staging hacia QA PASS hacia AppSec PASS hacia health.
2. Health: `curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready`.
3. Interrupt humano /adelante (token con TTL).
4. Deploy (unicas mutaciones permitidas): git pull origin test + pm2 restart gmp-api.
5. Post-checks: `pm2 list` online, logs sin error fresco, `/api/ready` healthy.

> REQUISITO NUEVO L10: SENTRY_DSN debe existir en entorno prod o el arranque falla a proposito.

| Caso | Accion |
|---|---|
| Verificar DSN | comprobar variable SENTRY_DSN en entorno prod antes del deploy |
| Arranque tumbado por falta de DSN | fijar variable + pm2 restart gmp-api, verificar `/api/ready` |

## 3) Revertir

Script: `backend/scripts/tools/rollback.sh`.

- Pide confirmacion interactiva.
- Crea backup en rama `pre-rollback`.
- Ejecuta git reset --hard SHA mas restart.
- NUNCA toca entorno (no edita env, no rota secretos, no ALTER/DDL).

## 4) Diagnosticar

| Senal | Uso |
|---|---|
| requestId | cabecera `X-Request-ID` en cada respuesta error + logs; correlaciona cliente y servidor |
| Shape error | `{success:false,code,error,requestId}`; 5xx opacos |
| Health vivo vs listo | `/health/live` vs `/api/ready` |
| Backend tests | `cd backend && npm test` |
| Handles abiertos | `cd backend && npm run test:diagnose` |
| Flutter | `flutter analyze`; tests por feature |

## 5) Fallos comunes

| Sintoma | Causa | Fix |
|---|---|---|
| Arranque backend cae sin error de codigo | Falta SENTRY_DSN en prod (fail-fast L10) | fijar variable + restart |
| Jest no sale (cuelgue al final) | Pool ODBC sin teardown | forceExit mantenido + test:diagnose para cazar handles |
| Test latencia flaky bajo carga | carga del runner | reintentar aislado con runInBand |
| Build .dill / track lock | cache test_cache corrupta | limpiar test_cache y reintentar |
| Schedule CI corre en default branch | workflows programados corren en rama por defecto | esperado; no forzar en test |

## 6) Contactos / escalado

Javier aprueba explicitamente: deploys, ALTER/DDL, secretos, force-push.

- Purga AAB con filter-repo + force-push: COORDINADO con Javier (B-P2-1).
- GDPR: validacion legal por asesoria antes de borrar nada (B-P0-2).
- SENTRY_DSN prod: fijar ANTES del proximo deploy (B-P0-1).

