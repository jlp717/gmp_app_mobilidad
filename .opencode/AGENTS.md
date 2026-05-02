# GMP APP MOVILIDAD — Project Briefing

## Identidad del Proyecto
- **Nombre**: GMP App Movilidad — aplicación móvil para gestión comercial/logística
- **Stack**: Flutter 3 + Riverpod 2.5 + Dio + Material 3 + GetIt/Injectable + Freezed
- **Backend**: Node.js/Express + IBM DB2 (DSN='GMP', schema JAVIER) — **NO TOCAR**
- **Roles de usuario**: JEFE_VENTAS, COMERCIAL, REPARTIDOR

## Reglas Críticas
- 🚫 NUNCA modificar `backend/config/database.js` ni `backend/middleware/authMiddleware.js`
- 🚫 NUNCA hardcodear API keys ni credentials
- 🚫 NUNCA editar `albaran_detail_page.dart` para bugs de repartidor — usar `rutero_detail_modal.dart`
- ✅ Después de modificar modelos/providers: `dart run build_runner build --delete-conflicting-outputs`
- ✅ Después de nuevas dependencias: `flutter pub get`
- ✅ `flutter analyze` antes de commits
- ✅ Vendor code 'ALL' = query todos los vendors, NO `WHERE VENDEDOR='ALL'`

## Arquitectura Flutter
- `lib/features/<feature>/presentation/pages/` + `providers/` + `widgets/`
- Navegación: `main_shell.dart` — nuevas tabs en `_getNavItems` Y `_buildCurrentPage`
- State: Riverpod 2.5 (AsyncNotifier pattern, no Provider legacy)
- HTTP: Dio con interceptors para auth/refresh token

## Comandos de Desarrollo
```bash
# Flutter
flutter pub get
flutter analyze
flutter build apk --release
dart run build_runner build --delete-conflicting-outputs

# Backend (referencia, no modificar)
cd backend && node server.js
cd backend && npx jest
```

## Notas de Rendimiento
- NO añadir `autoDispose` a `pedidosProvider` — tiene timers y 39 `ref.read()` (requiere refactor mayor)
- Usar `select()` en consumers para evitar rebuilds (ya aplicado en repartidor_rutero_page.dart)
- `rutero_detail_modal.dart` (3517 líneas) — pendiente extracción de widgets

## Archivos Clave
- Navegación: `lib/features/dashboard/presentation/pages/main_shell.dart`
- Delivery detail: `rutero_detail_modal.dart` (NO albaran_detail_page.dart)
- Colores: `lib/core/theme/app_colors.dart` (40+ colores centralizados)
- DB queries: `backend/services/` (DSN='GMP', queries parametrizadas siempre)

## Tests Existentes
- 11/11 Flutter navigation tests ✅
- 76/76 Backend tests ✅
- Widget tests: OrderStatusBadge, SmartProductImage, ComingSoonPlaceholder, SkeletonWidgets, KPICard

## Agentes Recomendados Para Este Proyecto
- `@flutter-architect` → Decisiones Riverpod, Clean Architecture, estructura de features
- `@flutter-ui-dev` → Widgets Material 3, animaciones, theming
- `@flutter-state-dev` → Providers, AsyncNotifier, state machines
- `@flutter-api-dev` → Dio, HTTP, servicios, integración backend
- `@flutter-test-dev` → Tests widget, unit tests, integration
- `@backend-architect` → Diseño APIs Node.js (solo diseño, nunca implementar)
- `@security-sentinel` → Revisión de seguridad queries DB2, auth flows
