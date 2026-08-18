---
name: flutter-riverpod-gmp
description: Riverpod 2.5 patterns specific to gmp_app_mobilidad. Covers provider architecture, select() optimization, autoDispose rules, and project-specific provider patterns.
---

# Riverpod Patterns — GMP App Movilidad

## Project Architecture

```
lib/
├── features/
│   ├── dashboard/
│   │   └── presentation/
│   │       ├── pages/main_shell.dart    # Navigation hub
│   │       └── providers/
│   ├── pedidos/
│   │   └── presentation/
│   │       ├── pages/pedidos_page.dart
│   │       └── providers/
│   ├── cobros/
│   │   └── presentation/
│   │       ├── pages/cobros_page.dart
│   │       └── providers/
│   └── repartidor/
│       └── presentation/
│           ├── pages/repartidor_rutero_page.dart
│           ├── widgets/rutero_detail_modal.dart  # REAL delivery UI
│           └── providers/
└── core/
    └── providers/                        # Global providers
        ├── auth_provider.dart
        └── dio_provider.dart
```

## Provider Patterns

### Auth Provider (Global, NO autoDispose)
```dart
final authProvider = StateNotifierProvider<AuthNotifier, AsyncValue<User?>>((ref) {
  return AuthNotifier(ref.watch(dioProvider));
});

// Usage with select() for performance
class RepartidorRuteroPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // ONLY rebuild when user changes, not on loading/error
    final user = ref.watch(authProvider.select((s) => s.value));
    // ...
  }
}
```

### PedidosProvider (NO autoDispose — has timers + 39 ref.read())
```dart
// ⚠️ DO NOT add autoDispose to this provider
// It uses addListener/removeListener pattern with periodic timers
// 39 ref.read() calls in pedidos_page.dart would break with autoDispose
final pedidosProvider = StateNotifierProvider<PedidosNotifier, AsyncValue<List<Pedido>>>((ref) {
  final notifier = PedidosNotifier(ref.watch(dioProvider));
  // Timer setup that keeps provider alive
  return notifier;
});
```

### AsyncNotifier Pattern (Standard)
```dart
@riverpod
class CobrosNotifier extends _$CobrosNotifier {
  @override
  Future<List<Cobro>> build() async {
    final api = ref.watch(apiProvider);
    return api.getCobros();
  }

  Future<void> markAsPaid(String id) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await ref.read(apiProvider).markPaid(id);
      return ref.read(apiProvider).getCobros();
    });
  }
}
```

### Provider with select() — Performance Optimization
```dart
// repartidor_rutero_page.dart — 10 select() calls
class RepartidorRuteroPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Each select() creates a separate subscription
    // Only rebuilds when THAT specific field changes
    final isLoading = ref.watch(entregasProvider.select((p) => p.isLoading));
    final error = ref.watch(entregasProvider.select((p) => p.error));
    final albaranes = ref.watch(entregasProvider.select((p) => p.albaranes));
    final resumenTotal = ref.watch(entregasProvider.select((p) => p.resumenTotal));
    final filterStatus = ref.watch(entregasProvider.select((p) => p.filterStatus));
    final sortBy = ref.watch(entregasProvider.select((p) => p.sortBy));
    // ... more selects

    return Scaffold(/* ... */);
  }
}
```

### cobrosProvider — select() for Summary
```dart
// cobros_page.dart
final pendingSummary = ref.watch(cobrosProvider.select((p) => p.pendingSummary));
```

## Critical Rules

### DO NOT use autoDispose for:
- `pedidosProvider` — has timers, 39 ref.read() calls
- Any provider with periodic polling
- Any provider that maintains state across navigation

### DO use autoDispose for:
- Form state providers
- Temporary UI state
- Single-screen data that's not needed after navigation

### ALWAYS use select() when:
- Watching a provider that changes frequently
- Only needing one field from a large state object
- Building widgets that should not rebuild on unrelated state changes

### Provider Location Rules:
- Feature-specific providers → `lib/features/<feature>/presentation/providers/`
- Global providers → `lib/core/providers/`
- Repository providers → `lib/data/repositories/`

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| `ref.watch(provider)` in build | Rebuilds on ANY state change | Use `select()` for specific fields |
| `autoDispose` on pedidosProvider | Breaks timers and ref.read() | Remove autoDispose |
| `ref.read()` in build method | Anti-pattern, causes stale reads | Use `ref.watch()` in build |
| Provider in wrong location | Hard to find, circular deps | Follow location rules |
| Not disposing controllers | Memory leaks | Use `ref.onDispose()` |

## Dio Integration
```dart
// dio_provider.dart
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(
    baseUrl: const String.fromEnvironment('API_URL'),
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
  ));

  // Auth interceptor
  dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) {
      final token = ref.read(authTokenProvider);
      if (token != null) {
        options.headers['Authorization'] = 'Bearer $token';
      }
      handler.next(options);
    },
    onError: (error, handler) async {
      if (error.response?.statusCode == 401) {
        // Trigger token refresh
        await ref.read(authProvider.notifier).refreshToken();
        // Retry original request
        final response = await dio.fetch(error.requestOptions);
        return handler.resolve(response);
      }
      handler.next(error);
    },
  ));

  return dio;
});
```

## Testing Providers
```dart
test('CobrosNotifier marks cobro as paid', () async {
  final container = ProviderContainer(
    overrides: [
      apiProvider.overrideWith((ref) => MockApi()),
    ],
  );
  addTearDown(container.dispose);

  final notifier = container.read(cobrosProvider.notifier);
  await notifier.markAsPaid('C001');

  final state = container.read(cobrosProvider);
  expect(state.hasValue, true);
  expect(state.value!.any((c) => c.id == 'C001' && c.paid), true);
});
```
