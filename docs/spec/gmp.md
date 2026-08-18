# Living Spec - GMP App Mobilidad

> Fuente de verdad viva del proyecto. Se actualiza en cada tarea (skill living-spec).

## Vision
App de movilidad para GMP: roles JEFE_VENTAS, COMERCIAL, REPARTIDOR. Flutter + Node/Express + IBM DB2 for i.

## Arquitectura
- Frontend: Flutter (lib/core infraestructura, lib/features/<feature>/ con data/domain/providers/presentation).
- Backend: Node CommonJS (routes validan/delegan, services reglas de negocio, repositories DB2) en servidor aplicaciones /opt/gmp-api, PM2 puerto 3335.
- DB2: DSN GMP, schemas JAVIER y DSEDAC, servidor DB2.
- Imagenes: servidor imagenes (ImagenesGestorDocumentalNuevo).
- Frontera cliente-servidor: Flutter NUNCA habla directo a DB2.

## Features
- auth, dashboard, pedidos, reparto, cobros, commissions, warehouse, bolsa.
- UI repartidor: rutero_detail_modal.dart (NO albaran_detail_page.dart).
- Tabs nuevas: actualizar _getNavItems Y _buildCurrentPage en main_shell.dart.

## Contratos
- api-spec-first: openapi.yaml pendiente de generar (docs/spec/gmp/openapi.yaml).

## Estado de fases
- Produccion activa (gmp-api en PM2 3335).
- Ready: /api/ready con User-Agent GMP-SRE-HealthCheck/1.0.

## Decisiones (ADRs)
- Ver .opencode/memory/decisions.jsonl.

## Reglas del proyecto
- AGENTS.md, CLAUDE.md, .opencode/rules.json (108 reglas), chief-protocol.yaml (16 pasos).
