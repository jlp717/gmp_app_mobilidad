---
name: flutter-codegen-expert
description: Expert in Flutter code generation: freezed, json_serializable, riverpod_generator. Handles build_runner workflows, sealed classes, data classes, and codegen debugging.
---

# Flutter Code Generation Expert

## When to Use
- Creating data models with freezed
- Adding JSON serialization
- Creating Riverpod providers with code generation
- Debugging build_runner errors
- Migrating from manual to generated code

## Freezed Patterns

### Data Class
```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'model.freezed.dart';
part 'model.g.dart';

@freezed
class Pedido with _$Pedido {
  const factory Pedido({
    required String id,
    required String cliente,
    required DateTime fecha,
    @Default(0.0) double importe,
    @Default(PedidoStatus.pendiente) PedidoStatus status,
  }) = _Pedido;

  factory Pedido.fromJson(Map<String, dynamic> json) =>
      _$PedidoFromJson(json);
}

enum PedidoStatus { pendiente, confirmado, entregado, cancelado }
```

### Union/Sealed Class
```dart
@freezed
class Result<T> with _$Result<T> {
  const factory Result.success(T data) = Success;
  const factory Result.error(String message) = Error;
  const factory Result.loading() = Loading;
}
```

## Riverpod Generator Patterns

### AsyncNotifier
```dart
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'provider.g.dart';

@riverpod
Future<List<Pedido>> pedidos(PedidosRef ref) async {
  final api = ref.watch(apiProvider);
  return api.getPedidos();
}

@riverpod
class CobrosNotifier extends _$CobrosNotifier {
  @override
  Future<List<Cobro>> build() async {
    return ref.watch(cobrosRepositoryProvider).getAll();
  }

  Future<void> markAsPaid(String id) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await ref.read(cobrosRepositoryProvider).markPaid(id);
      return ref.read(cobrosRepositoryProvider).getAll();
    });
  }
}
```

### Provider with Dependencies
```dart
@riverpod
ApiService apiService(ApiServiceRef ref) {
  final dio = ref.watch(dioProvider);
  final auth = ref.watch(authProvider);
  return ApiService(dio, auth);
}
```

## Build_runner Commands

```bash
# First time or after adding dependencies
dart run build_runner build

# After modifying models/providers
dart run build_runner build --delete-conflicting-outputs

# Watch mode (auto-regenerate on save)
dart run build_runner watch --delete-conflicting-outputs

# Clean build cache (if stuck)
rm -rf .dart_tool/build
dart run build_runner build --delete-conflicting-outputs
```

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `part files must be generated` | build_runner not run | `dart run build_runner build` |
| `conflicting outputs` | Old generated files | `--delete-conflicting-outputs` |
| `could not resolve annotation` | Missing `part` directive | Add `part 'file.freezed.dart'` |
| `type 'X' is not a subtype of 'Y'` | Type mismatch in JSON | Check `@JsonKey` annotations |
| `build_runner stuck` | Corrupted cache | Delete `.dart_tool/build` |

## Project-Specific Rules (gmp_app_mobilidad)

- All models in `lib/data/models/` use freezed + json_serializable
- All providers in `lib/features/*/presentation/providers/` use riverpod_generator
- NEVER manually edit `.freezed.dart` or `.g.dart` files
- ALWAYS run `dart run build_runner build --delete-conflicting-outputs` after model changes
- Use `@Default()` for optional fields with defaults
- Use `@JsonKey(name: 'DB_COLUMN_NAME')` for DB column mapping
