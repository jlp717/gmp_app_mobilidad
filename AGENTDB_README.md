# AgentDB - Sistema Unificado de Memoria GMP App

## Visión General

**AgentDB** es el sistema unificado de memoria para GMP App Mobilidad, inspirado en la arquitectura Claude-Flow v3. Integra todos los sistemas de persistencia y estado en un único backend coherente con capacidades de búsqueda semántica y aprendizaje adaptativo.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UNIFIED MEMORY LAYER                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    UnifiedMemoryLayer (Fachada)                  │    │
│  │  - Global State  - Entity Management  - Cache                   │    │
│  │  - Offline Sync  - Vector Search      - Recommendations         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│         ┌──────────────────────────┼──────────────────────────┐         │
│         │                          │                          │         │
│         ▼                          ▼                          ▼         │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │  AgentDatabase  │     │ ReasoningBank   │     │  HNSWVectorStore│   │
│  │  (Backend)      │     │ (Adaptive Learn)│     │  (Semantic Srch)│   │
│  │                 │     │                 │     │                 │   │
│  │ - Persistent    │     │ - Embeddings    │     │ - Grafo HNSW    │   │
│  │ - State         │     │ - Preferencias  │     │ - Búsqueda ANN  │   │
│  │ - Sync Queue    │     │ - Patrones      │     │ - Similaridad   │   │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘   │
│           │                       │                       │            │
└───────────┼───────────────────────┼───────────────────────┼────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐       ┌───────────────┐       ┌──────────────┐
    │  Hive Boxes   │       │  Learning     │       │  Vector      │
    │  (Encriptado) │       │  Data         │       │  Metadata    │
    │  - persistent │       │  - Perfiles   │       │  - Embeddings│
    │  - state      │       │  - Patrones   │       │  - Index     │
    │  - sync_queue │       │  - Scores     │       │              │
    └───────────────┘       └───────────────┘       └──────────────┘
```

## Componentes

### 1. AgentDatabase

Backend unificado que reemplaza:
- ✅ Hive directo
- ✅ SharedPreferences
- ✅ State global
- ✅ Drafts offline

**Características:**
- Encriptación AES-256 automática
- TTL para datos temporales
- Cola de sincronización integrada
- Memoria de trabajo (RAM) con cleanup

**Uso básico:**
```dart
// Inicializar
await AgentDatabase.initialize();

// Guardar dato persistente
await AgentDatabase.instance.setPersistent(
  key: 'user:settings',
  value: {'theme': 'dark', 'language': 'es'},
  type: MemoryType.config,
);

// Guardar estado temporal (con TTL)
await AgentDatabase.instance.setState(
  key: 'cart:current',
  value: cartData,
  ttl: Duration(minutes: 30),
);

// Encolar para sync offline
await AgentDatabase.instance.enqueueSync(
  operationType: 'create',
  entityType: 'pedido',
  entityId: 'order_123',
  data: orderData,
);
```

### 2. HNSWVectorStore

Sistema de búsqueda semántica aproximada (Approximate Nearest Neighbor).

**Características:**
- Complejidad O(log n) para búsquedas
- Múltiples capas de navegación
- Distancia coseno para similitud
- Ideal para: productos similares, búsqueda semántica

**Uso:**
```dart
final vectorStore = HNSWVectorStore(
  maxConnections: 16,
  maxLayers: 8,
);

// Insertar vector
vectorStore.insert(
  id: 'product:P001',
  vector: [0.1, 0.9, 0.3, ...], // 128 dimensiones
  metadata: {'name': 'Producto A', 'price': 100},
);

// Búsqueda similar
final results = vectorStore.search(
  queryVector: queryEmbedding,
  k: 10,
  threshold: 0.7,
);
```

### 3. ReasoningBank

Sistema de aprendizaje adaptativo para catálogo y pedidos.

**Características:**
- Embeddings semánticos de productos
- Learning de preferencias de usuario
- Recomendaciones personalizadas
- Pattern mining de pedidos
- Adaptive scoring

**Uso:**
```dart
final reasoningBank = ReasoningBank(db);

// Indexar producto
await reasoningBank.indexProduct(
  productCode: 'P001',
  productName: 'Producto Premium',
  family: 'Electrónica',
  price: 299.99,
);

// Registrar interacción
await reasoningBank.recordUserInteraction(
  userId: 'user_123',
  productCode: 'P001',
  type: InteractionType.purchase,
  quantity: 2,
);

// Obtener recomendaciones
final recommendations = reasoningBank.getRecommendations(
  userId: 'user_123',
  k: 20,
);

// Productos comprados juntos
final together = reasoningBank.getFrequentlyBoughtTogether(
  userId: 'user_123',
  productCode: 'P001',
);
```

### 4. UnifiedMemoryLayer

Fachada de alto nivel que unifica todos los sistemas.

**Uso recomendado:**
```dart
// Inicializar
await UnifiedMemoryLayer.initialize();

// Estado global
memory.setState('filter:vendor', 'V001', persist: true);
final vendor = memory.getState<String>('filter:vendor');

// Entidades
await memory.saveEntity(
  entityType: 'cliente',
  entityId: 'C001',
  data: clienteData,
);

// Caché
await memory.cacheSet(
  key: 'products:list',
  value: products,
  ttl: Duration(minutes: 15),
);

// Drafts
await memory.saveOrderDraft(
  clientCode: 'C001',
  userId: 'U001',
  orderData: order,
);

// Búsqueda semántica
final similar = memory.findSimilarToProduct(
  productCode: 'P001',
  k: 5,
);

// Sync offline
await memory.enqueueSyncOperation(
  operationType: 'update',
  entityType: 'pedido',
  entityId: 'order_123',
  data: orderData,
);

// Procesar sync
await memory.syncAllPending((operation) async {
  // Lógica de sincronización
  return await api.sync(operation);
});
```

## Migración de Datos

### Ejecutar Migración

```dart
// En main.dart, después de initialize()
await configureAgentDBDependencies();

// Verificar estado
final status = checkMigrationStatus();
print('Legacy data: ${status.hasLegacyData}');

// Ejecutar migración
final result = await migrateLegacyData();

if (result.success) {
  print('Migrados ${result.totalItems} items');
  
  // Limpiar datos legacy
  await cleanupLegacyData();
} else {
  print('Errores: ${result.errors}');
}
```

### Datos Migrados

| Sistema Legacy | Destino AgentDB |
|---------------|-----------------|
| Hive `pedidos_drafts` | AgentDB drafts |
| Hive `pedidos_favorites` | AgentDB favorites |
| Hive `pedidos_sync_queue` | AgentDB sync_queue |
| Hive `app_cache` | AgentDB cache |
| SharedPreferences | AgentDB state/config |

## Patrones de Uso

### 1. Repository Pattern con AgentDB

```dart
class PedidosRepositoryImpl implements PedidosRepository {
  final PedidosLocalDatasourceAgentDB _localDatasource;
  final PedidosRemoteDatasource _remoteDatasource;

  Future<List<Product>> getProducts() async {
    // Intentar caché primero
    final cached = _localDatasource.getFromCache('products:list');
    if (cached != null) return cached;

    // Fetch from API
    final products = await _remoteDatasource.getProducts();

    // Cachear
    await _localDatasource.saveToCache('products:list', products);

    return products;
  }

  Future<void> addToCart(Product product) async {
    // Guardar localmente
    await _localDatasource.addToCart(product);

    // Encolar sync si offline
    if (!await networkService.isConnected()) {
      await _localDatasource.enqueueSync(
        operationType: 'create',
        entityType: 'cart_item',
        data: product.toJson(),
      );
    }
  }
}
```

### 2. Offline-First con Sync Queue

```dart
class OfflineSyncService {
  final UnifiedMemoryLayer _memory;
  final ApiClient _api;

  Future<void> syncPendingOrders() async {
    final result = await _memory.syncAllPending((operation) async {
      try {
        switch (operation.operationType) {
          case 'create':
            await _api.createOrder(operation.data);
            break;
          case 'update':
            await _api.updateOrder(operation.entityId, operation.data);
            break;
          case 'delete':
            await _api.deleteOrder(operation.entityId);
            break;
        }
        return true; // Success
      } catch (e) {
        return false; // Will retry
      }
    });

    print('Sync: ${result.successCount}/${result.total} exitosos');
  }
}
```

### 3. Recomendaciones en Tiempo Real

```dart
class ProductRecommendationsWidget extends StatelessWidget {
  final String userId;
  final String currentProductCode;

  @override
  Widget build(BuildContext context) {
    final memory = UnifiedMemoryLayer.instance;

    // Productos similares (vector search)
    final similar = memory.findSimilarToProduct(
      productCode: currentProductCode,
      k: 5,
    );

    // Recomendaciones personalizadas
    final personalized = memory.getRecommendations(
      userId: userId,
      k: 10,
    );

    // Comprados juntos frecuentemente
    final together = memory.getFrequentlyBoughtTogether(
      userId: userId,
      productCode: currentProductCode,
    );

    return Column(
      children: [
        _buildSection('Similares', similar),
        _buildSection('Para ti', personalized),
        _buildSection('Comprados juntos', together),
      ],
    );
  }
}
```

### 4. Adaptive Product Scoring

```dart
class ProductListProvider extends ChangeNotifier {
  final String userId;
  List<Product> _products = [];

  Future<void> loadProducts() async {
    final products = await _repository.getProducts();

    // Calcular scores adaptativos
    for (final product in products) {
      product.adaptiveScore = UnifiedMemoryLayer.instance
          .calculateProductScore(
            userId: userId,
            productCode: product.code,
          );
    }

    // Ordenar por score
    products.sort((a, b) => b.adaptiveScore.compareTo(a.adaptiveScore));

    _products = products;
    notifyListeners();
  }
}
```

## Configuración en main.dart

```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Cache legacy (si aún se usa)
  await CacheService.init();

  // 2. API Client
  await ApiClient.initialize();

  // 3. AgentDB (NUEVO)
  await configureAgentDBDependencies();

  // 4. GetIt dependencies
  configureDependencies();

  runApp(...);
}
```

## Tests

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/memory/memory.dart';

void main() {
  test('HNSW busca vectores similares', () {
    final store = HNSWVectorStore();
    
    store.insert(id: 'a', vector: [1.0, 0.0], metadata: {'label': 'A'});
    store.insert(id: 'b', vector: [0.9, 0.1], metadata: {'label': 'B'});
    
    final results = store.search(
      queryVector: [0.95, 0.05],
      k: 1,
    );
    
    expect(results.first.id, isIn(['a', 'b']));
  });

  test('ReasoningBank aprende preferencias', () async {
    final db = AgentDatabase.instance;
    final reasoningBank = ReasoningBank(db);
    
    await reasoningBank.recordUserInteraction(
      userId: 'user1',
      productCode: 'prod1',
      type: InteractionType.purchase,
    );
    
    final profile = reasoningBank.getUserProfile('user1');
    expect(profile, isNotNull);
  });
}
```

## Métricas y Debug

```dart
// Estadísticas de memoria
final stats = UnifiedMemoryLayer.instance.stats;
print('Persistent: ${stats.persistentCount}');
print('State: ${stats.stateCount}');
print('Sync Queue: ${stats.syncQueueCount}');
print('Vectors: ${stats.vectorCount}');

// Debug completo
printMemoryStats();
```

## Consideraciones de Seguridad

- ✅ Todos los datos Hive están encriptados con AES-256
- ✅ La clave se deriva de seed determinístico
- ✅ flutter_secure_storage para tokens sensibles
- ✅ No guardar datos críticos en working memory

## Migración Gradual

Se recomienda migración por fases:

1. **Fase 1**: AgentDB como secundario (lectura/escritura dual)
2. **Fase 2**: AgentDB como primario (Hive como fallback)
3. **Fase 3**: AgentDB único (eliminar Hive legacy)

## Referencias

- `lib/core/memory/agent_database.dart` - Backend principal
- `lib/core/memory/vector_store_hnsw.dart` - Búsqueda vectorial
- `lib/core/memory/reasoning_bank.dart` - Aprendizaje adaptativo
- `lib/core/memory/unified_memory_layer.dart` - Fachada unificada
- `lib/core/memory/data_migration.dart` - Migración legacy
- `lib/src/di/agentdb_injection.dart` - Inyección de dependencias
