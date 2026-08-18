---
name: gmp-mobilidad-flutter
description: GMP App Mobilidad — Flutter + Riverpod + Dio + Material 3 + IBM Db2 for i. Use when working on gmp_app_mobilidad. Covers architecture, providers, navigation, DB2 queries, and project-specific rules.
---

# GMP App Mobilidad — Flutter Project Skill

## Overview

GMP App Mobilidad is a Flutter mobile app for commercial/logistics management. Roles: JEFE_VENTAS, COMERCIAL, REPARTIDOR. Backend is Node.js/Express + IBM DB2 (DO NOT MODIFY backend/config/database.js or backend/middleware/authMiddleware.js).

## Stack

- Flutter 3 + Riverpod 2.5 + Dio + Material 3 + GetIt/Injectable + Freezed
- Backend: Node.js/Express + IBM Db2 for i (DSN='GMP', schema JAVIER) — READ ONLY
- Navigation: GoRouter via main_shell.dart (custom, not GoRouter)

## Critical Rules

1. NUNCA modificar `backend/config/database.js` ni `backend/middleware/authMiddleware.js`
2. NUNCA editar `albaran_detail_page.dart` (UI muerta). Para bugs de repartidor usar `rutero_detail_modal.dart`
3. Vendor code `'ALL'` = query TODOS los vendors, NO `WHERE VENDEDOR='ALL'`
4. `RUTERO_CONFIG` queries filtran `ORDEN >= 0`
5. `JAVIER.COMMISSION_EXCEPTIONS.HIDE_COMMISSIONS` controla pestaña Comisiones
6. NO añadir `autoDispose` a `pedidosProvider` (tiene timers + 39 ref.read())
7. Usar `select()` en consumers para evitar rebuilds

## Commands

```bash
flutter pub get
flutter analyze
flutter build apk --release
dart run build_runner build --delete-conflicting-outputs
cd backend && npx jest
```

## Architecture

- `lib/features/<feature>/presentation/pages/` + `providers/` + `widgets/`
- Tabs: main_shell.dart (`_getNavItems` + `_buildCurrentPage`)
- State: Riverpod 2.5 AsyncNotifier (no Provider legacy)
- HTTP: Dio con interceptors (auth/refresh token)
- Colors: `lib/core/theme/app_colors.dart` (40+ colors centralized)

## DB2 Access

- Schemas: JAVIER, DSEDAC, DSEMAC, DSEO, CLI, LINDTO, ART, CVC, VDC, RUT, APPUSUARIOS
- Siempre cualificar: `SCHEMA.TABLA`
- Queries parametrizadas SIEMPRE
- Plan EXPLAIN antes de queries grandes
- Usar `SYSIXADV` para sugerencias de índices

## Cache

Cache stack tiene 14 archivos (deuda técnica). NO consolidar sin auditoría explícita.
