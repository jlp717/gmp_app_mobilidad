# Living Spec — gmp_app_mobilidad

> Fuente de verdad viva. Actualizada por docs-agent en cada feature (Sec 7.5). Cierra spec-code drift (5.4).

## Cabecera Proyecto (Sec 12)
```
Proyecto: gmp_app_mobilidad
Stack: Flutter 3.24+ / Dart 3, Riverpod 2.5, Dio 5.4, Node.js CommonJS+Express, DB2 for i DSN GMP (schemas JAVIER/DSEDAC), PM2 3335 en 192.168.1.230:/opt/gmp-api, ODBC, Redis/KPI, Sentry, Prometheus, Hive offline-first
Repositorio: C:\Users\Javier\Desktop\Repositorios\gmp_app_mobilidad
Datos regulados: SI — financieros (cobros, deuda VISTA_DEUDA_BASE, comisiones, objetivos R1_T8CDVD, Proxenos) + datos personales CLI + audit trail
Nivel autonomia inicial: conservador (todo no-bajo requiere confirmacion hasta Fase 2)
Agentes que aplican: todos — orquestador, backend, frontend, security-reviewer, performance-reviewer, test-engineer, db-migration-agent, code-reviewer, docs-agent, release-agent, compliance-agent (parcial financiero/GDPR)
```

## Arquitectura por capas
- `lib/core/` transversal (api, cache, storage, offline, seguridad, navegacion, tema)
- `lib/features/<feature>/{data,domain,providers,presentation}` — nunca Dart suelto directo bajo feature
- `backend/routes` validan/delegan; `services` reglas; `repositories/adapters` DB2; nunca SQL en routes nuevas

## Contratos criticos
- Auth: session_cookie + roles JEFE_VENTAS/COMERCIAL/REPARTIDOR
- DB2: host 192.168.1.22, DSN GMP, VISTA_DEUDA_BASE preferida, CPC ROW_NUMBER()
- Runtime: PM2 gmp-api en 3335, liveness /api/health, readiness /api/ready con UA GMP-SRE-HealthCheck/1.0 via SSH localhost
- Imagenes: 192.168.1.191/movilidad/...
- Offline-first: lecturas cache-first + refresh remoto; escrituras criticas offline => borrador pendiente + sync con idempotencia

## Estado fases (Sec 10)
- F0 Auditoria: COMPLETADA (este doc + inventario)
- F1 Diagnostico: ver `docs/equipo-agentico/fase1-diagnostico.md`
- F2 Decisiones: ver `docs/equipo-agentico/fase2-decisiones.md`
- F3 Plan: ver `docs/equipo-agentico/fase3-plan.md`
