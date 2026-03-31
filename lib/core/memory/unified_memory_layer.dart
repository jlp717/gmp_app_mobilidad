import 'agent_database.dart';
import 'reasoning_bank.dart';
import 'vector_store_hnsw.dart';

/// **Unified Memory Layer - Capa de Abstracción Unificada**
///
/// Fachada de alto nivel que unifica todos los sistemas de memoria:
/// - AgentDB (backend persistente)
/// - ReasoningBank (aprendizaje adaptativo)
/// - Vector Store (búsqueda semántica)
///
/// Proporciona una API coherente para:
/// - Gestión de estado global
/// - Persistencia de entidades
/// - Caché inteligente
/// - Offline-first con sync queue
/// - Búsqueda semántica
/// - Recomendaciones personalizadas
class UnifiedMemoryLayer {
  static UnifiedMemoryLayer? _instance;
  
  late final AgentDatabase _db;
  late final ReasoningBank _reasoningBank;
  
  // Estado global en memoria
  final Map<String, dynamic> _globalState = {};
  final List<Function(String, dynamic)> _stateListeners = [];
  
  UnifiedMemoryLayer._() {
    _db = AgentDatabase.instance;
    _reasoningBank = ReasoningBank(_db);
  }
  
  /// Singleton instance
  static UnifiedMemoryLayer get instance {
    _instance ??= UnifiedMemoryLayer._();
    return _instance!;
  }
  
  /// Inicializa la capa de memoria unificada
  static Future<void> initialize() async {
    await AgentDatabase.initialize();
  }
  
  // ==================== GLOBAL STATE ====================
  
  /// Obtiene estado global
  T getState<T>(String key, {T? defaultValue}) {
    final value = _globalState[key];
    if (value == null) return defaultValue as T;
    return value as T;
  }
  
  /// Establece estado global y notifica listeners
  void setState<T>(String key, T value, {bool persist = false}) {
    _globalState[key] = value;
    
    if (persist) {
      _db.setPersistent(key: key, value: value, type: MemoryType.state);
    }
    
    // Notificar listeners
    for (final listener in _stateListeners) {
      listener(key, value);
    }
  }
  
  /// Suscribe al cambio de estado
  void subscribeToState(Function(String, dynamic) listener) {
    _stateListeners.add(listener);
  }
  
  /// Carga estado persistente al iniciar
  Future<void> loadPersistentState() async {
    // Cargar configuración
    final config = _db.getPersistent('config');
    if (config != null) {
      _globalState['config'] = config;
    }
    
    // Cargar preferencias de usuario
    final preferences = _db.getPersistent('user_preferences');
    if (preferences != null) {
      _globalState['user_preferences'] = preferences;
    }
  }
  
  // ==================== ENTITY MANAGEMENT ====================
  
  /// Guarda entidad con metadata
  Future<void> saveEntity<T>({
    required String entityType,
    required String entityId,
    required T data,
    Map<String, dynamic>? metadata,
  }) async {
    final key = 'entity:$entityType:$entityId';
    
    final entry = EntityEntry(
      entityType: entityType,
      entityId: entityId,
      data: data,
      metadata: {
        'updatedAt': DateTime.now().toIso8601String(),
        ...?metadata,
      },
    );
    
    await _db.setPersistent(
      key: key,
      value: entry.toJson(),
      type: MemoryType.entity,
    );
  }
  
  /// Obtiene entidad
  T? getEntity<T>(String entityType, String entityId) {
    final key = 'entity:$entityType:$entityId';
    final data = _db.getPersistent(key);
    
    if (data == null) return null;
    
    if (data is Map<String, dynamic>) {
      final entry = EntityEntry.fromJson(data);
      return entry.data as T;
    }
    
    return data as T;
  }
  
  /// Elimina entidad
  Future<void> deleteEntity(String entityType, String entityId) async {
    final key = 'entity:$entityType:$entityId';
    await _db.deletePersistent(key);
  }
  
  /// Lista entidades por tipo
  List<T> listEntities<T>(String entityType) {
    final prefix = 'entity:$entityType:';
    final entities = <T>[];
    
    // Nota: Hive no soporta query por prefijo directamente
    // En implementación real, usar índice separado
    final stats = _db.stats;
    
    return entities;
  }
  
  // ==================== CACHE MANAGEMENT ====================
  
  /// Guarda en caché con TTL
  Future<void> cacheSet({
    required String key,
    required dynamic value,
    Duration ttl = const Duration(minutes: 30),
  }) async {
    await _db.setState(key: key, value: value, ttl: ttl);
  }
  
  /// Obtiene de caché
  dynamic cacheGet(String key) {
    return _db.getState(key);
  }
  
  /// Verifica si existe en caché
  bool cacheExists(String key) {
    return _db.getState(key) != null;
  }
  
  /// Invalida caché
  Future<void> cacheInvalidate(String key) async {
    await _db.deleteState(key);
  }
  
  /// Limpia toda la caché
  Future<void> cacheClear() async {
    await _db.clearState();
  }
  
  // ==================== OFFLINE SYNC ====================
  
  /// Encola operación para sync offline
  Future<void> enqueueSyncOperation({
    required String operationType,
    required String entityType,
    required String entityId,
    required Map<String, dynamic> data,
  }) async {
    await _db.enqueueSync(
      operationType: operationType,
      entityType: entityType,
      entityId: entityId,
      data: data,
    );
  }
  
  /// Obtiene operaciones pendientes
  List<SyncOperation> getPendingSyncOperations() {
    return _db.getPendingSyncs();
  }
  
  /// Procesa operación de sync
  Future<void> processSyncOperation(
    String operationId,
    Future<bool> Function(SyncOperation) processor,
  ) async {
    final operations = _db.getPendingSyncs();
    final operation = operations.firstWhere(
      (op) => op.id == operationId,
      orElse: () => SyncOperation.empty(),
    );
    
    if (operation.id.isEmpty) return;
    
    final success = await processor(operation);
    
    if (success) {
      await _db.markSyncComplete(operationId);
    } else {
      await _db.incrementSyncRetry(operationId);
    }
  }
  
  /// Sincroniza todas las operaciones pendientes
  Future<SyncResult> syncAllPending(
    Future<bool> Function(SyncOperation) processor,
  ) async {
    final operations = _db.getPendingSyncs();
    int successCount = 0;
    int failureCount = 0;
    
    for (final operation in operations) {
      try {
        final success = await processor(operation);
        if (success) {
          await _db.markSyncComplete(operation.id);
          successCount++;
        } else {
          await _db.incrementSyncRetry(operation.id);
          failureCount++;
        }
      } catch (e) {
        await _db.incrementSyncRetry(operation.id);
        failureCount++;
      }
    }
    
    return SyncResult(
      successCount: successCount,
      failureCount: failureCount,
      total: operations.length,
    );
  }
  
  // ==================== VECTOR SEARCH ====================
  
  /// Indexa producto para búsqueda semántica
  Future<void> indexProduct({
    required String productCode,
    required String productName,
    String? family,
    String? brand,
    double? price,
    String? category,
  }) async {
    await _reasoningBank.indexProduct(
      productCode: productCode,
      productName: productName,
      family: family,
      brand: brand,
      price: price,
      category: category,
    );
  }
  
  /// Busca productos similares por embedding
  List<ProductSimilarityResult> searchSimilarProducts({
    required List<double> queryEmbedding,
    int k = 10,
    double threshold = 0.7,
  }) {
    return _db.searchVectors(
      queryEmbedding: queryEmbedding,
      k: k,
      threshold: threshold,
    ).where((r) => r.metadata?['type'] == 'product').map((r) {
      return ProductSimilarityResult(
        productCode: r.metadata?['code'] ?? r.id,
        productName: r.metadata?['name'] ?? '',
        similarity: r.distance,
        metadata: r.metadata,
      );
    }).toList();
  }
  
  /// Obtiene productos similares a uno dado
  List<ProductSimilarityResult> findSimilarToProduct({
    required String productCode,
    int k = 10,
    double threshold = 0.7,
  }) {
    return _reasoningBank.findSimilarProducts(
      productCode: productCode,
      k: k,
      threshold: threshold,
    );
  }
  
  // ==================== REASONING BANK ====================
  
  /// Registra interacción de usuario
  Future<void> recordUserInteraction({
    required String userId,
    required String productCode,
    required InteractionType type,
    double? quantity,
    double? price,
  }) async {
    await _reasoningBank.recordUserInteraction(
      userId: userId,
      productCode: productCode,
      type: type,
      quantity: quantity,
      price: price,
    );
  }
  
  /// Obtiene recomendaciones para usuario
  List<RecommendationResult> getRecommendations({
    required String userId,
    int k = 20,
    String? categoryFilter,
  }) {
    return _reasoningBank.getRecommendations(
      userId: userId,
      k: k,
      categoryFilter: categoryFilter,
    );
  }
  
  /// Analiza patrón de pedido
  Future<void> analyzeOrderPattern({
    required String orderId,
    required String userId,
    required List<OrderItem> items,
  }) async {
    await _reasoningBank.analyzeOrderPattern(
      orderId: orderId,
      userId: userId,
      items: items,
    );
  }
  
  /// Obtiene productos comprados juntos frecuentemente
  List<String> getFrequentlyBoughtTogether({
    required String userId,
    required String productCode,
    int k = 5,
  }) {
    return _reasoningBank.getFrequentlyBoughtTogether(
      userId: userId,
      productCode: productCode,
      k: k,
    );
  }
  
  /// Calcula score adaptativo de producto
  double calculateProductScore({
    required String userId,
    required String productCode,
  }) {
    return _reasoningBank.calculateAdaptiveScore(
      userId: userId,
      productCode: productCode,
    );
  }
  
  // ==================== USER PREFERENCES ====================
  
  /// Guarda preferencia de usuario
  Future<void> setUserPreference({
    required String userId,
    required String key,
    required dynamic value,
  }) async {
    final prefKey = 'user_pref:$userId:$key';
    await _db.setPersistent(key: prefKey, value: value, type: MemoryType.user);
  }
  
  /// Obtiene preferencia de usuario
  dynamic getUserPreference(String userId, String key) {
    final prefKey = 'user_pref:$userId:$key';
    return _db.getPersistent(prefKey);
  }
  
  /// Guarda configuración global
  Future<void> setConfig(Map<String, dynamic> config) async {
    await _db.setPersistent(
      key: 'config',
      value: config,
      type: MemoryType.config,
    );
    _globalState['config'] = config;
  }
  
  /// Obtiene configuración
  Map<String, dynamic>? getConfig() {
    final config = _db.getPersistent('config');
    if (config != null) {
      _globalState['config'] = config;
    }
    return config;
  }
  
  // ==================== DRAFTS ====================
  
  /// Guarda borrador de pedido
  Future<void> saveOrderDraft({
    required String clientCode,
    required String userId,
    required Map<String, dynamic> orderData,
  }) async {
    final draftKey = 'draft:order:$clientCode:$userId';
    
    await _db.setPersistent(
      key: draftKey,
      value: {
        'clientCode': clientCode,
        'userId': userId,
        'orderData': orderData,
        'savedAt': DateTime.now().toIso8601String(),
      },
      type: MemoryType.draft,
    );
  }
  
  /// Carga borrador de pedido
  Map<String, dynamic>? loadOrderDraft(String clientCode, String userId) {
    final draftKey = 'draft:order:$clientCode:$userId';
    return _db.getPersistent(draftKey);
  }
  
  /// Elimina borrador
  Future<void> deleteOrderDraft(String clientCode, String userId) async {
    final draftKey = 'draft:order:$clientCode:$userId';
    await _db.deletePersistent(draftKey);
  }
  
  // ==================== FAVORITES ====================
  
  /// Agrega producto a favoritos
  Future<void> addToFavorites({
    required String userId,
    required String productCode,
  }) async {
    final favKey = 'favorites:$userId';
    Set<String> favorites = Set<String>.from(
      _db.getPersistent(favKey) ?? [],
    );
    favorites.add(productCode);
    
    await _db.setPersistent(
      key: favKey,
      value: favorites.toList(),
      type: MemoryType.user,
    );
  }
  
  /// Elimina de favoritos
  Future<void> removeFromFavorites({
    required String userId,
    required String productCode,
  }) async {
    final favKey = 'favorites:$userId';
    List<String> favorites = List<String>.from(
      _db.getPersistent(favKey) ?? [],
    );
    favorites.remove(productCode);
    
    await _db.setPersistent(
      key: favKey,
      value: favorites,
      type: MemoryType.user,
    );
  }
  
  /// Obtiene favoritos
  List<String> getFavorites(String userId) {
    final favKey = 'favorites:$userId';
    return List<String>.from(_db.getPersistent(favKey) ?? []);
  }
  
  // ==================== UTILITIES ====================
  
  /// Estadísticas de memoria
  MemoryStats get stats => _db.stats;
  
  /// Limpia datos de usuario
  Future<void> clearUserData(String userId) async {
    await _reasoningBank.clearLearningData(userId: userId);
    
    // Limpiar favoritos
    await _db.deletePersistent('favorites:$userId');
    
    // Limpiar preferencias
    // (requeriría listar keys por prefijo)
  }
  
  /// Reset completo (solo desarrollo)
  Future<void> resetAll() async {
    await _db.clearAll();
    _globalState.clear();
    _reasoningBank.clearLearningData();
  }
  
  /// Cierra conexiones
  Future<void> close() async {
    await _db.close();
  }
}

// ==================== MODELOS ====================

class EntityEntry {
  final String entityType;
  final String entityId;
  final dynamic data;
  final Map<String, dynamic> metadata;
  
  EntityEntry({
    required this.entityType,
    required this.entityId,
    required this.data,
    required this.metadata,
  });
  
  Map<String, dynamic> toJson() => {
        'entityType': entityType,
        'entityId': entityId,
        'data': data,
        'metadata': metadata,
      };
  
  factory EntityEntry.fromJson(Map<String, dynamic> json) => EntityEntry(
        entityType: json['entityType'] ?? '',
        entityId: json['entityId'] ?? '',
        data: json['data'],
        metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
      );
}

class SyncResult {
  final int successCount;
  final int failureCount;
  final int total;
  
  SyncResult({
    required this.successCount,
    required this.failureCount,
    required this.total,
  });
  
  bool get allSuccess => failureCount == 0 && total > 0;
  bool get hasFailures => failureCount > 0;
  double get successRate => total == 0 ? 0 : successCount / total;
}
