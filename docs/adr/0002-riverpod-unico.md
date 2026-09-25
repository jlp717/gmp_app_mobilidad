# ADR 0002: Riverpod único — Notifier / AsyncNotifier + Provider / FutureProvider

- Estado: Aceptado
- Fecha: 2026-09-25
- Suplementa (no reescribe): `docs/adr/0001-state-management-riverpod.md`
- Task: `gmp-riverpod-unico-test-001` (WS-D, solo docs, cero código)

## Decisión

Riverpod es el único framework de estado e inyección para Flutter nuevo:

- Estado: `Notifier` / `AsyncNotifier` + `NotifierProvider` / `AsyncNotifierProvider`.
  Con parámetro: `NotifierProvider.family.autoDispose`.
- Dependencias / derivados: `Provider` / `FutureProvider` (`Provider.family` / `FutureProvider.family`).
- `ChangeNotifierProvider` prohibido para código nuevo.
- `setState` limitado a estado efímero de UI (controllers, tabs, animaciones).
- GetIt / injectable retirados: no se añaden `get_it`, `injectable`, `injectable_generator`.

## Contexto y antecedentes

- `docs/adr/0001-state-management-riverpod.md`: Riverpod 2.5 único para estado nuevo,
  `ChangeNotifier` congelado, migraciones incrementales sin cambio observable.
- `docs/performance-baseline.md:172-173`: `get_it` + `injectable` marcados
  "Possibly unused — No `@injectable` annotations found in scanned files".
- `docs/audits/preprod-2026-06-11/flutter-audit.md:20`: regla inviolable —
  NO se añadió `autoDispose` a `pedidosProvider` (global).
- `docs/audits/preprod-2026-06-11/flutter-audit.md:66` (Pilar 6):
  `ChangeNotifierProvider.family.autoDispose` + recarga fire-and-forget
  exigió flag `_disposed` + override `notifyListeners()`. La lección se
  generaliza aquí: el patrón canónico nuevo usa `ref.mounted` / `ref.onDispose`
  en `Notifier`, no flags manuales.

## Alcance

Solo docs. Cero código. Este ADR declara el estado final ya existente en rama
`test` y congela reglas para PRs futuros.

## Estado verificado (5 archivos con estado)

| # | Archivo | Estado | Evidencia |
|---|---------|--------|-----------|
| 1 | `lib/core/theme/theme_provider.dart` | Migrado | L39 `class ThemeProvider extends Notifier<ThemeState>`, L132 `NotifierProvider<ThemeProvider, ThemeState>` |
| 2 | `lib/features/bolsa/providers/bolsa_provider.dart` | Migrado (alcance amplio) | L6 "Migrado a Notifier + NotifierProvider (Riverpod puro, sin ChangeNotifier)", L21 `NotifierProvider<BolsaProvider, BolsaState>` |
| 3 | `lib/features/cobros/providers/cobros_provider.dart` | Migrado (alcance amplio) | L1 "100% Riverpod (NotifierProvider.family.autoDispose)", L949 `NotifierProvider.family.autoDispose<CobrosNotifier, CobrosState, CobrosParams>`, guards `if (!ref.mounted) return` en toda mutación async |
| 4 | `lib/features/warehouse/application/load_planner_provider.dart` | Migrado (alcance amplio) | L10 `NotifierProvider<LoadPlannerProvider, LoadPlannerState>`, `ref.onDispose(() => _autoSaveTimer?.cancel())` L144 |
| 5 | `lib/features/pedidos/providers/pedidos_provider.dart` | Legado en fases (único `ChangeNotifier` vivo) | L95 `ChangeNotifierProvider<PedidosProvider>`, L101 `class PedidosProvider with ChangeNotifier`, guard `_disposed` L228 + `_notify()` L232-245 |

Referencias canónicas adicionales (ya Riverpod, no cuentan como legado):

- `lib/core/providers/auth_notifier.dart:430,1253` — `AsyncNotifier<AuthState>` + `AsyncNotifierProvider`.
- `lib/core/providers/dashboard_notifier.dart:113,372` — `AsyncNotifier<DashboardState>` + `AsyncNotifierProvider`.
- `lib/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart:594` — `NotifierProvider<RepartidorFinanzasNotifier, RepartidorFinanzasState>`; L671-732 `FutureProvider.family` (daily summary, ledger, vencimientos, commissions).

## GetIt / injectable retirados

- `pubspec.yaml` (v4.1.36+92): contiene `flutter_riverpod: ^2.5.1` (L30),
  `riverpod_annotation: ^2.3.5` (L50), `riverpod_generator: ^2.4.0` (L79).
  NO contiene `get_it`, `injectable`, `injectable_generator` en `dependencies`
  ni `dev_dependencies` (verificado por lectura directa del archivo).
- `lib/core/di/injection.dart` (4 líneas): vaciado, pendiente borrado físico:
  `// TODO(WS-A): archivo vaciado… Borrar fisicamente este archivo en WS-B (requiere shell rm).`
  No se borra en este WS-D (solo docs, sin shell).
- Grep post `get_it|injectable` en repo: solo 2 matches, ambos en
  `docs/performance-baseline.md:172-173` (tabla histórica). Cero matches en `lib/`.
- Grafo único vivo: `repartidor_finanzas_providers.dart:569-592`
  (`repartidorFinanzasServiceProvider`, `repartidorFinanzasRepositoryProvider`,
  `getDailySummaryUseCaseProvider`, `submitLiquidacionUseCaseProvider`).

## Equivalencia LazySingleton vs Provider

| GetIt (retirado) | Riverpod (canónico) | Notas |
|---|---|---|
| `registerLazySingleton<Service>(() => Service())` | `final serviceProvider = Provider<Service>((ref) => Service())` | Singleton por `ProviderContainer`; lazy por defecto; testeable con `overrideWithValue` |
| `registerLazySingleton<Repo>(() => RepoImpl(get()))` | `final repoProvider = Provider<Repo>((ref) => RepoImpl(ref.watch(serviceProvider)))` | `ref.watch` resuelve grafo; ver `repartidorFinanzasRepositoryProvider` L574-579 |
| `registerFactory<UseCase>(() => UseCase(get()))` | `final useCaseProvider = Provider<UseCase>((ref) => UseCase(ref.watch(repoProvider)))` | Ver `getDailySummaryUseCaseProvider` L581-585, `submitLiquidacionUseCaseProvider` L587-592 |
| `getIt<Service>()` en lógica | `ref.read(serviceProvider)` / `ref.watch(serviceProvider)` | `read` en callbacks/acciones, `watch` en `build`/derivados |
| `getIt.reset()` en tests | `ProviderContainer(overrides: [...])` | Sin service locator global |

## Reglas

1. Nuevo estado → `Notifier`/`AsyncNotifier`. Nuevo derivado → `Provider`/`FutureProvider`.
   Con parámetro efímero → `.family.autoDispose` (patrón cobros).
2. `ChangeNotifierProvider` prohibido nuevo. Único vivo: `pedidosProvider`
   hasta migración por fases.
3. `StateNotifierProvider` existente (`lib/core/providers/pending_client_provider.dart:4`)
   no se replica; si se toca, se migra a `NotifierProvider`.
4. Async en `Notifier`: verificar `ref.mounted` tras cada `await` antes de
   `state = ...`; registrar `ref.onDispose` para timers/subscripciones/caches
   (patrón `loadPlannerProvider`, `cobrosProvider`).
5. `ref.watch` solo en `build`/providers derivados; en callbacks usar `ref.read`.
6. Una feature por PR, sin cambio observable (misma regla de 0001).
   Migración de pedidos por fases: carrito → catálogo → órdenes, cada fase
   con tests verdes antes/después.
7. Sin `get_it`/`injectable` nuevos. `injection.dart` no se importa; su borrado
   físico queda fuera de este WS (requiere shell).

## Greps post como evidencia (2026-09-25, rama test)

- `ChangeNotifierProvider` → 4 matches: 1 vivo en
  `lib/features/pedidos/providers/pedidos_provider.dart:95`; resto en
  `docs/flutter-bug-patterns.md:173` y `docs/audits/preprod-2026-06-11/flutter-audit.md:20,66`
  (histórico). Cero nuevos.
- `extends ChangeNotifier|with ChangeNotifier` en `lib/` → 1 vivo:
  `pedidos_provider.dart:101` (+3 comentarios "Replaces … ChangeNotifier" en
  `auth_notifier.dart:3`, `dashboard_notifier.dart:3`, `bolsa_provider.dart:6`).
- `NotifierProvider|AsyncNotifier|FutureProvider` → 20+ declaraciones vivas
  (theme, bolsa, cobros, planner, auth, dashboard, repartidor_finanzas,
  sales_history, chatbot, entregas, rutero_tracking, filter).
- `GetIt|LazySingleton` en `lib/` → 0 matches.
- `get_it|injectable` en repo → solo `docs/performance-baseline.md:172-173`.

## Consecuencias

- PRs nuevos que introduzcan `ChangeNotifierProvider`, `get_it` o
  `@injectable` se rechazan por este ADR + 0001.
- Pedidos sigue global sin `autoDispose` hasta su migración; cualquier
  `notifyListeners()` nuevo en ese archivo debe respetar el guard `_disposed`.
- Limpieza pendiente (fuera de WS-D): `rm lib/core/di/injection.dart`,
  `StateNotifierProvider` residual, código muerto listado en
  `flutter-audit.md` §7 #5.

## Enlaces exactos

- `docs/adr/0001-state-management-riverpod.md` (base, no reescrita)
- `docs/performance-baseline.md:172` (get_it unused)
- `docs/audits/preprod-2026-06-11/flutter-audit.md:66` (autoDispose) y `:20` (pedidos global)
- `pubspec.yaml:30,50,79` (Riverpod presente; GetIt ausente)
- `lib/core/di/injection.dart:1-4`
- `lib/core/theme/theme_provider.dart:39,132`
- `lib/features/bolsa/providers/bolsa_provider.dart:6,21`
- `lib/features/cobros/providers/cobros_provider.dart:1,949`
- `lib/features/warehouse/application/load_planner_provider.dart:10-13,144`
- `lib/features/pedidos/providers/pedidos_provider.dart:95,101,228-245`
- `lib/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart:569-592,594,671-732`
- `lib/core/providers/auth_notifier.dart:430,1253`
- `lib/core/providers/dashboard_notifier.dart:113,372`
