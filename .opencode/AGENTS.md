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
- Backend tests: 204/204 ✅
- Flutter navigation tests: 11/11 ✅
- Widget tests: ~60+ ✅ (OrderStatusBadge, SmartProductImage, ComingSoonPlaceholder, SkeletonWidgets, KPICard)

## Agentes Recomendados Para Este Proyecto
- `@flutter-architect` → Decisiones Riverpod, Clean Architecture, estructura de features
- `@flutter-ui-dev` → Widgets Material 3, animaciones, theming
- `@flutter-state-dev` → Providers, AsyncNotifier, state machines
- `@flutter-api-dev` → Dio, HTTP, servicios, integración backend
- `@flutter-test-dev` → Tests widget, unit tests, integration
- `@backend-architect` → Diseño APIs Node.js (solo diseño, nunca implementar)
- `@security-sentinel` → Revisión de seguridad queries DB2, auth flows

## Prevención de Alucinaciones (Proyecto-Específico)

- Antes de usar cualquier widget Flutter, verifica en `context7` que existe en la versión del SDK del proyecto (`flutter --version`).
- Antes de añadir dependencias a `pubspec.yaml`, verifica versión en pub.dev con `pub-mcp` o `context7`.
- Los schemas DB2 accesibles son: JAVIER, DSEDAC, DSEMAC, DSEO, CLI, LINDTO, ART, CVC, VDC, RUT, APPUSUARIOS. Si necesitas otro, verifica con `ibm-db2-mcp` antes de citarlo.
- Riverpod 2.5: verifica sintaxis con `context7` si usas `riverpod_generator` — el API cambia entre versiones.

## Protocolo de Fallback para Este Proyecto

Si una tarea Flutter falla (build error, analyzer error):
1. Ejecuta `flutter analyze` y reporta el output completo.
2. Si hay errores de codegen: `dart run build_runner build --delete-conflicting-outputs`.
3. Si persiste tras 2 intentos → escala al @orchestrator con el error exacto.

Si una query DB2 falla:
1. Verifica que el schema está cualificado (`SCHEMA.TABLA`).
2. Verifica que la query usa parámetros, no string concat.
3. Si persiste → escala al @ibm-i-db2-specialist.

## Registro de Decisiones (Formato Requerido)

Para decisiones que afecten arquitectura Flutter, DB2 o contratos de API en este proyecto:

```
DECISIÓN: [qué se decide]
POR QUÉ: [razonamiento técnico concreto]
ALTERNATIVAS DESCARTADAS: [opción B — por qué no]
RIESGOS: [qué puede salir mal y cómo se mitiga]
```

Ejemplos de decisiones que requieren este formato:
- Nuevo provider o cambio en jerarquía de providers Riverpod
- Nuevo endpoint o cambio en contrato de API existente
- Query DB2 que toca tablas de producción (DSEDAC, DSEMAC, etc.)
- Cambio en estrategia de caché (14 archivos detectados — deuda técnica activa)

## Herramientas Instaladas (Mayo 2026)

### Beads Issue Tracker
- Proyecto usa **bd (beads)** para issue tracking. Ver referencias en AGENTS.md raíz.
- CLI: `bd ready` (buscar trabajo), `bd show <id>`, `bd close <id>`, `bd dolt push`
- MCP beads habilitado para integración nativa.

### OpenSpec (Spec-Driven Development)
- Workflow: `/opsx-propose "idea"` → genera spec → implementar → `/opsx-apply` → `/opsx-archive`
- Skills: openspec-propose, openspec-explore, openspec-apply-change, openspec-archive-change

### Task Master (on-demand, requiere TASK_MASTER_API_KEY)
- `task-master-mcp` para gestión estructurada de tareas con dependencias.

### Skill Seekers (CLI)
- Convierte documentación web/GitHub/PDFs en skills: `skill-seekers create <url> --target opencode`

## Knowledge Base Persistente (Sistema de Memoria)

**⚠️ IMPORTANTE**: OpenCode Go se resetea cada 24h, borrando toda la memoria del MCP.
Para que el equipo NO OLVIDE nada, existe un sistema de persistencia multicapa.

### Arquitectura
```
.opencode/knowledge/*.md    ← Source of truth (git-tracked, sobrevive a resets)
         ↓ sync en cada sesión
Memory Graph (MCP RAM)      ← Cache rápida para la sesión actual
```

### Protocolo de Inicio de Sesión (OBLIGATORIO)
Al iniciar cualquier sesión en este proyecto, el orchestrator DEBE:

1. **Leer** todos los archivos en `.opencode/knowledge/`
2. **Cargar** el conocimiento en el memory graph vía `memory_create_entities`
3. **Verificar** que los datos críticos están presentes (business_rules, architecture, db_schema)
4. **Reportar** "Knowledge base loaded: [N] entities from [N] files"

### Comandos Disponibles

| Comando | Función |
|---------|---------|
| `/knowledge-bootstrap` | Carga todos los archivos knowledge en el memory graph |
| `/knowledge-sync` | Sync bidireccional memory ↔ files (files ganan) |
| `/knowledge-save` | Volcar memory graph actual a archivos |
| `/health` | Auditoría completa del proyecto + update PROJECT_STATE.md |

### Archivos Knowledge (9 total)
- `BUSINESS_RULES.md` — Reglas de negocio
- `ARCHITECTURE.md` — Arquitectura del sistema
- `DB_SCHEMA.md` — Conocimiento de base de datos
- `USER_PATTERNS.md` — Preferencias del usuario (Javier)
- `TEAM_CAPABILITIES.md` — Roster de agentes y capacidades
- `PROJECT_STATE.md` — Estado actual del proyecto (auto-actualizado)
- `DECISIONS.md` — Architecture Decision Records
- `SESSION_LOG.md` — Último resumen de sesión
- `README.md` — Documentación del sistema

### Reglas de Persistencia
1. Los archivos SON la fuente de verdad. En conflicto, files > memory.
2. Al final de cada sesión, el orchestrator actualiza `SESSION_LOG.md`
3. Cuando se toma una decisión arquitectónica, se añade a `DECISIONS.md`
4. Cuando cambia el estado del proyecto, se actualiza `PROJECT_STATE.md`

### Tests (actualizado Mayo 2026)
- Backend tests: 204/204 ✅
- Flutter navigation tests: 11/11 ✅
- Widget tests: ~60+ ✅
