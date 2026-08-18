---
name: flutter-offline
description: Flutter offline-first architecture — local-first reads, sync queue with retry, Hive/sqflite storage, connectivity detection, TTL cache invalidation, repository pattern with Riverpod. Use when building apps that must work without internet or tolerate unreliable connections.
---

# Flutter Offline-First Architecture — Professional Guide

## Overview
Offline-first means the app reads from local cache by default, writes to a sync queue, and reconciles with the server in the background. Users get instant feedback (optimistic UI) and the app degrades gracefully when connectivity is lost.

---

## When to Use
- App must be usable without an internet connection
- Users are on slow / intermittent networks (mobile data, tunnels, rural areas)
- Data freshness can tolerate a few seconds (or minutes) of lag
- Background sync is acceptable (non-financial mutations)

## When NOT to Use
- Do NOT apply optimistic UI to financial or irreversible operations — require server confirmation
- Do NOT use `shared_preferences` for structured data — use Hive or sqflite
- Do NOT ignore conflict resolution — always define a strategy upfront

---

## Storage Options

| Package | Best For | Notes |
|---|---|---|
| `hive` | Fast key-value / document cache | Dart objects, no SQL, very fast reads |
| `sqflite` | Relational data, complex queries | Full SQL, good for joins and filters |
| `shared_preferences` | Simple settings/flags only | Never for lists or domain objects |

---

## Step-by-Step Process

### 1. Packages

```yaml
# pubspec.yaml
dependencies:
  hive_flutter: ^1.1.0
  connectivity_plus: ^6.0.0
  riverpod_annotation: ^2.3.0  # or flutter_riverpod
  uuid: ^4.0.0
```

### 2. Repository Pattern

```dart
// lib/features/products/data/product_repository.dart
import '../../../core/network/connectivity_service.dart';
import 'local/product_local_datasource.dart';
import 'remote/product_remote_datasource.dart';
import '../domain/product.dart';

class ProductRepository {
  final ProductLocalDataSource  _local;
  final ProductRemoteDataSource _remote;
  final ConnectivityService     _connectivity;

  const ProductRepository({
    required ProductLocalDataSource  local,
    required ProductRemoteDataSource remote,
    required ConnectivityService     connectivity,
  })  : _local        = local,
        _remote       = remote,
        _connectivity = connectivity;

  // Always return cached data; refresh in background if online
  Stream<List<Product>> watchProducts() async* {
    yield await _local.getAll();                     // immediate cache hit

    if (await _connectivity.isOnline) {
      try {
        final fresh = await _remote.fetchProducts();
        await _local.saveAll(fresh);
        yield fresh;
      } catch (_) { /* network error — cached data already yielded */ }
    }
  }

  Future<void> createProduct(Product product) async {
    await _local.save(product.copyWith(syncStatus: SyncStatus.pending));
    if (await _connectivity.isOnline) {
      await _syncProduct(product);
    }
    // else: will be picked up by SyncQueue on next connectivity event
  }

  Future<void> _syncProduct(Product product) async {
    final saved = await _remote.create(product);
    await _local.save(saved.copyWith(syncStatus: SyncStatus.synced));
  }
}
```

### 3. Hive Local Data Source with TTL Cache Invalidation

```dart
// lib/features/products/data/local/product_local_datasource.dart
import 'package:hive_flutter/hive_flutter.dart';
import '../../domain/product.dart';

const _boxName    = 'products';
const _metaBox    = 'products_meta';
const _ttlSeconds = 300; // 5 minutes

class ProductLocalDataSource {
  Box<Map> get _box     => Hive.box<Map>(_boxName);
  Box      get _metaBox => Hive.box(_metaBox);

  Future<void> init() async {
    await Hive.openBox<Map>(_boxName);
    await Hive.openBox(_metaBox);
  }

  Future<List<Product>> getAll() async {
    final cachedAt = _metaBox.get('products_cached_at') as int?;
    if (cachedAt != null) {
      final age = DateTime.now().millisecondsSinceEpoch - cachedAt;
      if (age > _ttlSeconds * 1000) await _box.clear(); // TTL expired
    }
    return _box.values
        .map((e) => Product.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<void> saveAll(List<Product> products) async {
    await _box.clear();
    final map = { for (final p in products) p.id: p.toJson() };
    await _box.putAll(map);
    await _metaBox.put('products_cached_at', DateTime.now().millisecondsSinceEpoch);
  }

  Future<void> save(Product product) =>
      _box.put(product.id, product.toJson());
}
```

### 4. Sync Queue with Exponential Backoff

```dart
// lib/core/sync/sync_queue.dart
import 'dart:async';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:uuid/uuid.dart';

class SyncOperation {
  final String id;
  final String type;        // 'create_product', 'update_order', etc.
  final Map<String, dynamic> payload;
  int attempts;
  SyncOperation({ required this.id, required this.type, required this.payload, this.attempts = 0 });
}

class SyncQueue {
  static const _maxAttempts = 5;
  final Box _box = Hive.box('sync_queue');
  final _uuid = const Uuid();

  Future<void> enqueue(String type, Map<String, dynamic> payload) =>
      _box.put(_uuid.v4(), {'type': type, 'payload': payload, 'attempts': 0});

  Future<void> flush(Future<void> Function(SyncOperation) handler) async {
    for (final key in _box.keys.toList()) {
      final raw = Map<String, dynamic>.from(_box.get(key) as Map);
      final op  = SyncOperation(
        id:       key as String,
        type:     raw['type'] as String,
        payload:  Map<String, dynamic>.from(raw['payload'] as Map),
        attempts: raw['attempts'] as int,
      );

      if (op.attempts >= _maxAttempts) {
        await _box.delete(key); // dead-letter: remove after max retries
        continue;
      }

      try {
        await handler(op);
        await _box.delete(key); // success
      } catch (_) {
        final delay = Duration(seconds: (1 << op.attempts).clamp(1, 60)); // 1,2,4,8,16,60s
        await Future.delayed(delay);
        await _box.put(key, { ...raw, 'attempts': op.attempts + 1 });
      }
    }
  }
}
```

### 5. Connectivity-Aware Riverpod Provider

```dart
// lib/core/network/connectivity_service.dart
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ConnectivityService {
  Stream<bool> get onlineStream => Connectivity()
      .onConnectivityChanged
      .map((r) => r != ConnectivityResult.none);

  Future<bool> get isOnline async {
    final result = await Connectivity().checkConnectivity();
    return result != ConnectivityResult.none;
  }
}

// Riverpod: triggers sync queue flush when connectivity is restored
final connectivityProvider = StreamProvider<bool>((ref) {
  final svc = ConnectivityService();
  svc.onlineStream.listen((online) {
    if (online) ref.read(syncQueueProvider).flush(ref.read(syncHandlerProvider));
  });
  return svc.onlineStream;
});
```

### 6. Error Handling Strategy

```dart
// Distinguish network errors (retry) from server errors (surface to user)
Future<T> safeRemoteCall<T>(Future<T> Function() call) async {
  try {
    return await call();
  } on SocketException {
    throw const NetworkException('No internet connection'); // retry silently
  } on TimeoutException {
    throw const NetworkException('Request timed out');
  } on HttpException catch (e) {
    throw ServerException(e.message); // surface to user — do not retry
  }
}
```

---

## Verification Checklist

- [ ] All reads go through local cache first — no loading spinner for cached data
- [ ] `SyncStatus.pending` tracked on local models — UI reflects unsynced state
- [ ] Sync queue uses exponential backoff with a maximum attempt cap
- [ ] Dead-letter operations are logged or surfaced to the user after max retries
- [ ] TTL timestamp stored alongside cached data — stale cache is cleared on next fetch
- [ ] `ConnectivityService` flushes sync queue on transition to online
- [ ] `SocketException` / `TimeoutException` trigger retry; `HttpException` surfaces to user
- [ ] Financial or irreversible mutations require server confirmation before UI update
- [ ] Hive boxes are opened once at app startup (`Hive.openBox`) not per-call
- [ ] Conflict resolution strategy defined (last-write-wins via `updated_at` timestamp)
