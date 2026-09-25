# 02_MATRIZ_RIESGOS — Priorización Severidad × Impacto × Esfuerzo (2026-09-25)

| # | Riesgo | Pilar | Sev | Impacto | Esfuerzo | Score | Lote |
|---|---|---|---|---|---|---|---|
| 1 | Cleartext HTTP a IP prod en APK (network_security_config.xml:8) | P5 | CRÍTICO | Robo sesiones/datos en red | S | 100 | L2 seguridad |
| 2 | Test flutter rojo FND-04 (reloj) + jest forceExit/passWithNoTests → señal CI no fiable | P8 | ALTA | Todo lo demás se construye sobre arena | S-M | 95 | L1 tooling |
| 3 | Drift versiones Flutter entre workflows + skip_tests + release exit0 + audit \|\| true | P10 | ALTA | CI permite código roto a prod | S | 90 | L1 tooling |
| 4 | Chatbot sin schema (prompt-injection, cross-tenant) | P5 | ALTO | Datos clientes ajenos | S | 88 | L2 seguridad |
| 5 | Bypass cert dev sin guard kDebugMode | P5 | ALTO | MITM si release lo activa | S | 86 | L2 seguridad |
| 6 | Outbox variance sin lease → emails duplicados | P4 | ALTA | Spam operaciones/repartidor | M | 82 | L4 dinero |
| 7 | double en dominio dinero (90 casos, 18 ficheros) | P4 | ALTA | Descuadres liquidación | L | 80 | L4 dinero |
| 8 | 3 shapes error API distintos | P6 | ALTA | App no puede manejar errores uniforme | M | 78 | L3 errores |
| 9 | MANAGE_EXTERNAL_STORAGE (Play Policy riesgo rechazo) | P5/P11 | ALTO | Bloqueo publicación | M | 76 | L2 seguridad |
| 10 | SQL interpolado (cobros VALUES CTE, identificadores dinámicos) | P5 | MEDIO | SQLi acotado | S-M | 72 | L2 seguridad |
| 11 | rollback.sh edita .env + pm2 start (prohibido) | P10 | ALTA | Incidente en rollback real | M | 70 | L1 tooling |
| 12 | src/ TS zombie ~90 ficheros | P1 | ALTO | Confusión, tests fantasma | M | 68 | L5 estructura |
| 13 | Lógica negocio en routes (203 SELECT inline) + god-files (pedidos 7122, commissions 3073) | P1 | ALTO | Mantenibilidad | XL | 65 | L8 dominio (P1) |
| 14 | Rebuilds Flutter (4 providers sin select + 3 páginas) | P2 | ALTA | Jank en campo | S-M | 62 | L6 perf flutter |
| 15 | Cobros sin Semantics ni estado offline | P9 | ALTA | Preferencia Javier explícita | M | 60 | L7 UX |
| 16 | Dualidad joi/zod | P1/P5 | MEDIO | Inconsistencia validación | M | 55 | L5 estructura |
| 17 | Retry Dio sin backoff/jitter + sin circuit breaker Flutter | P3 | MEDIA | Tormentas reintentos | S-M | 52 | L6 perf flutter |
| 18 | syncfusion deps muertas (varios MB) | P2 | MEDIA | Bundle pesado | S | 50 | L6 perf flutter |
| 19 | N+1 writes rutero + digest recipients | P2 | MEDIA | Latencia rutero | S-M | 48 | L6 perf backend |
| 20 | Solape HTTP/query cache sin contrato | P2/P4 | MEDIA | Datos stale dinero | M | 46 | L4 dinero |
| 21 | JSDoc ausente + 6551 infos lint + analyzer ignores | P7 | MEDIA | Deuda compuesta | M-L | 44 | L5 estructura |
| 22 | Tags mutables docker/GHCR + Makefile down -v | P10 | MEDIA | Despliegues no reproducibles | S | 42 | L1 tooling |
| 23 | GDPR: DNI/firma sin retención/borrado | P11 | MEDIA | Riesgo legal | L | 40 | L9 cumplimiento |
| 24 | XLSX datos en docs/ + ADRs duplicados + sin CHANGELOG | P12 | MEDIA | Gobernanza | S | 38 | L9 docs |
| 25 | AAB 66MB x2 en historial git | P10 | MEDIA | Repo pesado | M | 36 | L9 limpieza |
| 26 | i18n YAGNI (confirmado, no actuar) | P9 | BAJA | — | — | 10 | cerrado |

Score = Severidad(40/30/20/10) + Impacto(40/30/20/10) − Esfuerzo(S=0,M=5,L=15,XL=25).
