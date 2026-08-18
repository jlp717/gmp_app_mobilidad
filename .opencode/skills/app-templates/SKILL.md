---
name: app-templates
description: Catalogo de scaffolds reutilizables para apps nuevas: Flutter (features+core), Node/Express (routes/services/repositories), DB2 (esquema JAVIER), CI/CD y Docker staging. Cada template con tests base, ADR y observabilidad.
---
# App Templates (Scaffolds Reutilizables)

## Templates disponibles
- flutter-app: lib/core + lib/features/<feature>/{data,domain,providers,presentation}, AppColors, Riverpod/ChangeNotifier, GoRouter.
- node-api: routes/ (validan+delegan), services/ (reglas de negocio), repositories/ (DB2), errores tipados, Sentry, Prometheus.
- db2-schema: tablas JAVIER con naming, ROW_NUMBER dedup, VISTA_DEUDA_BASE cuando aplique, rollback.
- full-stack: combinacion con openapi.yaml (api-spec-first) y tests de contrato.

## Reglas
- Cada template incluye: tests base, ADR, observabilidad (Sentry/Prometheus//api/ready), Dockerfile, CI workflow.
- Scaffold SIEMPRE via greenfield-pipeline; nunca copiar a mano.
- Flutter nunca habla directo a DB2; frontera cliente-servidor intacta.
- Offline-first en apps moviles: cache local primero, sync con idempotencia.

## Uso
- /greenfield 'app' usa el template apropiado segun stack.
