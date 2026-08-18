---
name: flutter-provider
description: State management con Provider: watch/read, MultiProvider.
---

# Skill: flutter-provider — Riverpod 2.5 en gmp_app_mobilidad

> **Nota**: El proyecto usa **Riverpod 2.5** (no Provider legacy). Esta skill documenta ambos, con énfasis en Riverpod.

## Riverpod 2.5 — Patrones Actuales

### @riverpod annotation (generación de código)
```dart
// providers/products_provider.dart
import 'package:riverpod_annotation/riverpod_annotation.dart';
part 'products_provider.g.dart';

@riverpod
class ProductsNotifier extends _$ProductsNotifier {
  @override
  Future<List<Product>> build() async {
    return ref.watch(productRepositoryProvider).getAll();
  }

  Future<void> addProduct(Product product) async {
    await ref.read(productRepositoryProvider).add(product);
    ref.invalidateSelf(); // refetch
  }
}

// Genera: productsNotifierProvider automáticamente
```

### Consumir en Widget
```dart
// watch: reactive rebuild cuando cambia
class ProductListPage extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(productsNotifierProvider);

    return switch (products) {
      AsyncData(:final value) => ProductList(products: value),
      AsyncError(:final error) => ErrorView(error: error.toString()),
      AsyncLoading() => const LoadingSkeletons(),
      _ => const SizedBox.shrink(),
    };
  }
}
```

### select() para optimizar rebuilds
```dart
// Solo rebuild cuando cambia el campo 'estado'
final estado = ref.watch(
  pedidoProvider(pedidoId).select((p) => p.value?.estado)
);
```

## Regla Crítica: pedidosProvider
```dart
// ⚠️ NO agregar autoDispose a pedidosProvider
// Tiene 39 ref.read() en el codebase y timers activos.
// Requiere refactor completo antes de autoDispose.

@riverpod  // ← NO usar @riverpod(keepAlive: false) ni autoDispose
class PedidosNotifier extends _$PedidosNotifier {
  Timer? _refreshTimer;

  @override
  Future<List<Pedido>> build() async {
    ref.onDispose(() => _refreshTimer?.cancel()); // cleanup del timer
    _startPeriodicRefresh();
    return _fetchPedidos();
  }
}
```

## ref.watch vs ref.read
```dart
// ref.watch → en build() — reactivo, causa rebuild
final products = ref.watch(productsProvider);

// ref.read → en callbacks/métodos — no reactivo, no causa rebuild
onPressed: () => ref.read(cartProvider.notifier).addItem(product),
```

## Family Providers (parametrizados)
```dart
@riverpod
Future<Pedido> pedidoDetail(Ref ref, String pedidoId) async {
  return ref.watch(pedidoRepositoryProvider).getById(pedidoId);
}

// Uso: ref.watch(pedidoDetailProvider('ABC123'))
```

## Migración de Provider Legacy → Riverpod
```dart
// ANTES (Provider legacy — no usar en nuevas features)
ChangeNotifierProvider<CartNotifier>(create: (_) => CartNotifier())

// DESPUÉS (Riverpod 2.5)
@riverpod
class CartNotifier extends _$CartNotifier {
  @override
  List<CartItem> build() => [];

  void addItem(CartItem item) {
    state = [...state, item];
  }
}
```

## Build Runner (OBLIGATORIO tras cambios)
```bash
dart run build_runner build --delete-conflicting-outputs
```
