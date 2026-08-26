# Pirámide de testing — GMP App Mobilidad

> Prompt 15 · 2026-08-26. Fuente de ejecución: `scripts/test-coverage.ps1`.

## Forma actual de la pirámide (84 ficheros de test, 639 tests)

| Capa | Dónde | Ficheros | Ejecución | Tiempo aprox. |
|------|-------|----------|-----------|---------------|
| Unit (domain/lógica pura) | `test/features/**/domain`, `test/models`, `test/helpers` | ~35 | Runner Linux, cada push | ~2 min |
| Widget (pantallas/estados) | `test/widgets`, `test/features/**/presentation` | ~40 | Runner Linux, cada push | incluido arriba |
| Golden (solo design system) | `test/goldens/goldens/*.png` | 1 fichero / 4 goldens | Runner Linux, cada push | ~3 s |
| Integration E2E | `integration_test/app_flow_test.dart` | 1 | Manual/emulador (`workflow_dispatch`) | requiere dispositivo |

**Suite completa unit+widget+golden: 03:11 en local Windows** (`flutter test --coverage`), 639/639 PASS.

## Cobertura real (lcov, excluye `*.g.dart` y `*.freezed.dart`)

| Capa | Líneas ejecutables | Cubiertas | % |
|------|-------------------|-----------|---|
| `features/*/domain` | 1119 | 563 | **50.31%** |
| Global | 27449 | 9743 | **35.49%** |

Umbrales actuales = baseline anti-regresión: `domain >= 50%`, `global >= 35%`
(parámetros `-MinDomain/-MinGlobal`). Objetivo a futuro: domain 85% / global 60%;
subir el umbral cuando la cobertura suba, nunca bajarlo para hacer pasar un cambio.

## Pantallas clave cubiertas con estados loading/exito/error

- **Liquidación Diaria**: `comercial_liquidacion_diaria_page_states_test.dart`
  (pendiente/cuadrada/descuadre/revisar/guardado OK/error en submit).
  Dominio extraído a `lib/features/liquidacion_comercial/domain/liquidacion_domain.dart`.
- **Vencimientos**: `vencimientos_page_states_test.dart`
  (loading spinner/exito agrupado/error+reintentar/sin repartidor).
- **Comisiones**: `commissions_page_states_test.dart` (loading skeletons/error).
  ⚠️ Exito no testeable sin refactor: CommissionsPage es un monolito de 4229 líneas
  que consume `CommissionsService` estático; refactor pendiente a ViewModel inyectable.

## Reglas aplicadas

- Goldens SOLO de componentes reutilizables (`ErrorStateWidget`,
  `EmptyStateWidget`); prohibidos de pantallas completas.
- Skeleton/shimmer excluidos de goldens: animación infinita no determinista.
- Un test que no puede fallar no cuenta: todos los asserts usan valores exactos.
- CI Linux (`.github/workflows/flutter-tests.yml`) ejecuta unit+widget+goldens;
  integration solo manual contra staging con credenciales en secrets.

## Deudas conocidas (ponytail)

- Patrol diferido: requiere config nativa android/app + patrol_cli; el flujo
  crítico login→rutero→liquidación usa `integration_test` puro.
- Alchemist retirado tras conflicto de layout con Flutter 3.35; goldens nativos
  `matchesGoldenFile`. Volver si se necesita matriz de variantes.
- Tests flaky detectados (2 en primera pasada, verdes en repetición): revisar
  timing en `smart_product_image_test` y `widget_test.dart`.
