# Flutter Storage Unification Strategy

## Current Storage Layers

| Layer | Package | Location | Encryption | Use Case |
|-------|---------|----------|------------|----------|
| **Hive (Cache)** | `hive_flutter` | `lib/core/cache/` | AES (HiveAesCipher) | API response caching, TTL-based data |
| **Hive (AgentDB)** | `hive_flutter` | `lib/core/memory/` | AES (HiveAesCipher) | Persistent entities, state, sync queue, vectors |
| **SharedPreferences** | `shared_preferences` | Multiple files | None | Simple app preferences, non-sensitive config |
| **SecureStorage** | `flutter_secure_storage` | `lib/core/services/` | OS-level (Keychain/Keystore) | JWT tokens, passwords, sensitive credentials |

## Data Placement Decision Matrix

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| JWT tokens, passwords | **SecureStorage** | OS-level encryption, hardware-backed |
| User credentials, API keys | **SecureStorage** | Must never be plaintext |
| App theme, language, filters | **SharedPreferences** | Simple key-value, rarely changes |
| Printer MAC addresses | **SharedPreferences** | Non-sensitive device config |
| API responses (dashboard, clients, rutero) | **Hive Cache** (`lib/core/cache/`) | TTL-based, needs invalidation |
| Business entities (pedidos, clientes) | **AgentDB** (`lib/core/memory/`) | Persistent, queryable, offline sync |
| Draft orders | **AgentDB** | Survives app restart, sync queue |
| User preferences (persisted) | **AgentDB** | Structured, typed storage |
| Vector embeddings | **AgentDB** (vectors box) | HNSW semantic search |
| Hot/frequently accessed data | **In-memory cache** (Map) | Sub-millisecond access, LRU eviction |

## Migration Guidelines

### 1. Consolidate Hive Boxes

Currently there are **two separate Hive initialization flows**:
- `CacheService.init()` → opens `app_cache` + `cache_metadata` (or `app_cache_v2` + `cache_metadata_v2`)
- `AgentDatabase.initialize()` → opens `agentdb_persistent`, `agentdb_state`, `agentdb_sync_queue`, `agentdb_vectors`

**Recommendation**: Keep both but clarify boundaries:
- `CacheService` = **ephemeral** API response cache (TTL-driven, safe to clear)
- `AgentDatabase` = **persistent** application data (entities, drafts, sync queue)

### 2. Migrate SharedPreferences to AgentDB (Where Appropriate)

Files currently using SharedPreferences:
- `auth_provider.dart` — non-sensitive user data (vendor code, last login)
- `network_service.dart` — connectivity state, last sync timestamp
- `filter_provider.dart` — user filter preferences
- `theme_provider.dart` — theme mode preference
- `zebra_print_service.dart` — printer MAC addresses

**Migration priority**:
1. **HIGH**: `auth_provider.dart` user data → AgentDB (structured, typed)
2. **MEDIUM**: `filter_provider.dart` → AgentDB (user preferences)
3. **LOW**: `theme_provider.dart` → Keep SharedPreferences (simple bool/string)
4. **LOW**: `zebra_print_service.dart` → Keep SharedPreferences (device config)
5. **LOW**: `network_service.dart` → Keep SharedPreferences (transient state)

### 3. Unified Initialization Order

```dart
// In main() before runApp():
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 1. Secure storage (always available, no init needed)
  
  // 2. Initialize AgentDB (persistent data)
  await AgentDatabase.initialize();
  
  // 3. Initialize CacheService (ephemeral cache)
  await CacheServiceOptimized.init();
  
  // 4. Load persistent state into memory
  await UnifiedMemoryLayer.instance.loadPersistentState();
  
  runApp(const MyApp());
}
```

## Code Examples

### Writing Data

```dart
// Sensitive data → SecureStorage
await SecureStorage.writeSecureData('jwt_token', token);

// Simple preferences → SharedPreferences
final prefs = await SharedPreferences.getInstance();
await prefs.setString('theme_mode', 'dark');

// API response cache → CacheService (with TTL)
await CacheServiceOptimized.set(
  CacheKeys.dashboardMetrics,
  metricsData,
  ttl: CacheServiceOptimized.shortTTL,
);

// Business entity → AgentDB
await AgentDatabase.instance.setPersistent(
  key: 'entity:client:CLI001',
  value: client.toJson(),
  type: MemoryType.entity,
);

// Draft order → AgentDB (with sync queue)
await UnifiedMemoryLayer.instance.saveOrderDraft(
  clientCode: 'CLI001',
  userId: 'VEN001',
  orderData: order.toJson(),
);
```

### Reading Data

```dart
// Sensitive data
final token = await SecureStorage.readSecureData('jwt_token');

// Simple preferences
final prefs = await SharedPreferences.getInstance();
final theme = prefs.getString('theme_mode') ?? 'light';

// Cached API response (with memory fallback)
final metrics = CacheServiceOptimized.getWithMemory<Map<String, dynamic>>(
  CacheKeys.dashboardMetrics,
);

// Persistent entity
final clientData = AgentDatabase.instance.getPersistent('entity:client:CLI001');

// Unified access via UnifiedMemoryLayer
final draft = UnifiedMemoryLayer.instance.loadOrderDraft('CLI001', 'VEN001');
```

### Cache Invalidation

```dart
// Invalidate single entry
await CacheServiceOptimized.invalidate(CacheKeys.dashboardMetrics);

// Invalidate by prefix (e.g., all client data for a vendor)
await CacheServiceOptimized.invalidateByPrefix(CacheKeys.clientsListPrefix);

// Clear all ephemeral cache (safe, doesn't affect persistent data)
await CacheServiceOptimized.clearAll();

// Clear user data on logout
await UnifiedMemoryLayer.instance.clearUserData(userId);
await SecureStorage.deleteAllSecureData();
await CacheServiceOptimized.clearMemoryCache();
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (Providers, Pages, Widgets)                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              UnifiedMemoryLayer (Facade)                     │
│  - Global state management                                   │
│  - Entity CRUD                                               │
│  - Offline sync queue                                        │
│  - Vector search / recommendations                           │
└───────┬──────────────┬──────────────┬────────────────────────┘
        │              │              │
┌───────▼──────┐ ┌────▼─────┐ ┌─────▼────────┐
│ AgentDatabase │ │ CacheSvc │ │ SecureStorage│
│  (Hive)       │ │ (Hive)   │ │ (OS Keychain)│
│               │ │          │ │              │
│ ├ persistent  │ │ ├ cache  │ │ ├ JWT tokens │
│ ├ state       │ │ └ memory │ │ ├ passwords  │
│ ├ sync_queue  │ │          │ │ └ API keys   │
│ └ vectors     │ │          │ │              │
└───────┬───────┘ └────┬─────┘ └──────────────┘
        │              │
┌───────▼──────────────▼──────┐
│     SharedPreferences       │
│  - Theme, filters, printer  │
│  - Network state            │
└─────────────────────────────┘
```

## Key Principles

1. **Security first**: Anything sensitive → SecureStorage, never SharedPreferences
2. **TTL for cache**: All cached API responses must have explicit TTL
3. **Offline-first**: Business entities go through AgentDB with sync queue
4. **Single source of truth**: Each data type has exactly one storage layer
5. **Clear on logout**: Cache cleared, user data removed, tokens deleted
6. **No duplication**: Don't store the same data in multiple layers unless intentionally cached
