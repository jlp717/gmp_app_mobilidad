// ignore_for_file: argument_type_not_assignable, invalid_assignment, return_of_invalid_type
import 'dart:async';
import 'dart:convert';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'vector_store_hnsw.dart';

/// **AgentDB - Backend Unificado de Memoria**
///
/// Sistema centralizado que unifica:
/// - Hive (persistencia estructurada)
/// - SharedPreferences (configuración simple)
/// - State global (estado en memoria)
/// - Drafts offline (cola de sincronización)
/// - Vector search (búsqueda semántica HNSW)
///
/// Arquitectura inspirada en Claude-Flow v3 AgentDB
class AgentDatabase {
  static AgentDatabase? _instance;

  // Cajas Hive unificadas
  static const String _persistentBoxName = 'agentdb_persistent';
  static const String _stateBoxName = 'agentdb_state';
  static const String _syncQueueBoxName = 'agentdb_sync_queue';
  static const String _vectorsBoxName = 'agentdb_vectors';

  Box<dynamic>? _persistentBox;
  Box<dynamic>? _stateBox;
  Box<dynamic>? _syncQueueBox;
  Box<dynamic>? _vectorsBox;

  // Vector store para búsqueda semántica
  late HNSWVectorStore _vectorStore;

  // Memoria de trabajo (RAM)
  final Map<String, dynamic> _workingMemory = {};
  final Map<String, DateTime> _memoryTimestamps = {};

  // Cola de operaciones pendientes
  final List<SyncOperation> _pendingSyncQueue = [];

  // Callbacks de sincronización
  Function(SyncOperation)? _onSyncOperation;

  AgentDatabase._();

  /// Singleton instance
  static AgentDatabase get instance {
    _instance ??= AgentDatabase._();
    return _instance!;
  }

  /// Inicializa AgentDB
  static Future<void> initialize() async {
    await Hive.initFlutter();

    final db = instance;
    final key = _generateEncryptionKey();
    final cipher = HiveAesCipher(key);

    // Abrir cajas Hive con encriptación
    db._persistentBox =
        await Hive.openBox(_persistentBoxName, encryptionCipher: cipher);
    db._stateBox = await Hive.openBox(_stateBoxName, encryptionCipher: cipher);
    db._syncQueueBox =
        await Hive.openBox(_syncQueueBoxName, encryptionCipher: cipher);
    db._vectorsBox =
        await Hive.openBox(_vectorsBoxName, encryptionCipher: cipher);

    // Inicializar vector store
    db._vectorStore = HNSWVectorStore();

    // Cargar vectores existentes
    await db._loadVectors();

    // Cargar cola de sincronización
    await db._loadSyncQueue();

    // Limpieza de memoria expirada
    db._startMemoryCleanup();
  }

  static List<int> _generateEncryptionKey() {
    final seed = 'agentdb_unified_memory_encryption_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  // ==================== PERSISTENT MEMORY ====================

  /// Guarda dato persistente (sobrevive a reinicios)
  Future<void> setPersistent({
    required String key,
    required dynamic value,
    MemoryType type = MemoryType.general,
  }) async {
    final safeKey = _sanitizeKey(key);
    final data = MemoryEntry(
      key: safeKey,
      value: value,
      type: type,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    );

    await _persistentBox?.put(safeKey, data.toJson());
    _workingMemory[safeKey] = value;
    _memoryTimestamps[safeKey] = DateTime.now();
  }

  /// Obtiene dato persistente
  dynamic getPersistent(String key) {
    final safeKey = _sanitizeKey(key);
    final cached = _workingMemory[safeKey];
    if (cached != null) return cached;

    final data = _persistentBox?.get(safeKey);
    if (data == null) return null;

    final entry = MemoryEntry.fromJson(data);
    _workingMemory[safeKey] = entry.value;
    return entry.value;
  }

  /// Elimina dato persistente
  Future<void> deletePersistent(String key) async {
    final safeKey = _sanitizeKey(key);
    await _persistentBox?.delete(safeKey);
    _workingMemory.remove(safeKey);
    _memoryTimestamps.remove(safeKey);
  }

  // ==================== STATE MEMORY ====================

  /// Guarda estado temporal (sesión actual)
  Future<void> setState({
    required String key,
    required dynamic value,
    Duration? ttl,
  }) async {
    final safeKey = _sanitizeKey(key);
    final expiry =
        ttl != null ? DateTime.now().add(ttl).millisecondsSinceEpoch : null;

    final data = MemoryEntry(
      key: safeKey,
      value: value,
      type: MemoryType.state,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      expiresAt: expiry,
    );

    await _stateBox?.put(safeKey, data.toJson());
    _workingMemory[safeKey] = value;
    _memoryTimestamps[safeKey] = DateTime.now();
  }

  /// Obtiene estado
  dynamic getState(String key) {
    final safeKey = _sanitizeKey(key);
    final cached = _workingMemory[safeKey];
    if (cached != null) return cached;

    final data = _stateBox?.get(safeKey);
    if (data == null) return null;

    final entry = MemoryEntry.fromJson(data);

    // Verificar expiración
    if (entry.expiresAt != null &&
        DateTime.now().millisecondsSinceEpoch > entry.expiresAt!) {
      deleteState(key);
      return null;
    }

    _workingMemory[safeKey] = entry.value;
    return entry.value;
  }

  /// Elimina estado
  Future<void> deleteState(String key) async {
    final safeKey = _sanitizeKey(key);
    await _stateBox?.delete(safeKey);
    _workingMemory.remove(safeKey);
    _memoryTimestamps.remove(safeKey);
  }

  // ==================== SYNC QUEUE (OFFLINE) ====================

  /// Encola operación para sincronización posterior
  Future<void> enqueueSync({
    required String operationType,
    required String entityType,
    required String entityId,
    required Map<String, dynamic> data,
    int? retryCount,
  }) async {
    final operation = SyncOperation(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      operationType: operationType,
      entityType: entityType,
      entityId: entityId,
      data: data,
      createdAt: DateTime.now(),
      retryCount: retryCount ?? 0,
    );

    await _syncQueueBox?.put(operation.id, operation.toJson());
    _pendingSyncQueue.add(operation);

    _onSyncOperation?.call(operation);
  }

  /// Obtiene operaciones pendientes
  List<SyncOperation> getPendingSyncs() {
    return List.unmodifiable(_pendingSyncQueue);
  }

  /// Marca operación como completada
  Future<void> markSyncComplete(String operationId) async {
    await _syncQueueBox?.delete(operationId);
    _pendingSyncQueue.removeWhere((op) => op.id == operationId);
  }

  /// Incrementa contador de reintentos
  Future<void> incrementSyncRetry(String operationId) async {
    final operation = _pendingSyncQueue.firstWhere(
      (op) => op.id == operationId,
      orElse: () => SyncOperation.empty(),
    );

    if (operation.id.isEmpty) return;

    operation.retryCount++;
    await _syncQueueBox?.put(operationId, operation.toJson());
  }

  void setSyncCallback(Function(SyncOperation) callback) {
    _onSyncOperation = callback;
  }

  // ==================== VECTOR SEARCH ====================

  /// Inserta vector para búsqueda semántica
  Future<void> insertVector({
    required String id,
    required List<double> embedding,
    required Map<String, dynamic> metadata,
    MemoryType type = MemoryType.semantic,
  }) async {
    _vectorStore.insert(
      id: id,
      vector: embedding,
      metadata: metadata,
    );

    // Persistir vector
    await _vectorsBox?.put(id, {
      'embedding': embedding,
      'metadata': metadata,
      'type': type.index,
      'insertedAt': DateTime.now().toIso8601String(),
    });
  }

  /// Búsqueda semántica por similitud
  List<VectorSearchResult> searchVectors({
    required List<double> queryEmbedding,
    int k = 10,
    double? threshold,
    MemoryType? filterByType,
  }) {
    return _vectorStore.search(
      queryVector: queryEmbedding,
      k: k,
      threshold: threshold,
    );
  }

  /// Elimina vector
  Future<void> removeVector(String id) async {
    _vectorStore.remove(id);
    await _vectorsBox?.delete(id);
  }

  Future<void> _loadVectors() async {
    for (final key in _vectorsBox?.keys ?? []) {
      final data = _vectorsBox?.get(key);
      if (data != null && data is Map) {
        final embedding = List<double>.from(data['embedding'] ?? []);
        final metadata = Map<String, dynamic>.from(data['metadata'] ?? {});
        final type = MemoryType.values[data['type'] ?? 0];

        _vectorStore.insert(
          id: key.toString(),
          vector: embedding,
          metadata: {
            ...metadata,
            'type': type.name,
          },
        );
      }
    }
  }

  // ==================== WORKING MEMORY ====================

  /// Guarda en memoria de trabajo (RAM, no persistente)
  void setWorking(String key, dynamic value, {Duration? ttl}) {
    final safeKey = _sanitizeKey(key);
    _workingMemory[safeKey] = value;
    if (ttl != null) {
      _memoryTimestamps[safeKey] = DateTime.now().add(ttl);
    } else {
      _memoryTimestamps[safeKey] = DateTime.now();
    }
  }

  /// Obtiene de memoria de trabajo
  dynamic getWorking(String key) {
    final safeKey = _sanitizeKey(key);
    return _workingMemory[safeKey];
  }

  /// Limpia memoria de trabajo expirada
  void _startMemoryCleanup() {
    Timer.periodic(const Duration(minutes: 5), (_) {
      final now = DateTime.now();
      final expired = _memoryTimestamps.entries
          .where((e) => e.value.isBefore(now))
          .map((e) => e.key)
          .toList();

      for (final key in expired) {
        _workingMemory.remove(key);
        _memoryTimestamps.remove(key);
      }
    });
  }

  // ==================== BATCH OPERATIONS ====================

  /// Ejecuta múltiples operaciones en lote
  Future<void> batchSet(Map<String, dynamic> entries,
      {MemoryType type = MemoryType.general}) async {
    for (final entry in entries.entries) {
      await setPersistent(key: entry.key, value: entry.value, type: type);
    }
  }

  /// Ejecuta múltiples lecturas en lote
  Map<String, dynamic> batchGet(Iterable<String> keys) {
    final results = <String, dynamic>{};
    for (final key in keys) {
      results[key] = getPersistent(key);
    }
    return results;
  }

  // ==================== UTILITIES ====================

  String _sanitizeKey(String key) {
    return key.replaceAll(RegExp(r'[^a-zA-Z0-9_]'), '_');
  }

  Future<void> _loadSyncQueue() async {
    _pendingSyncQueue.clear();
    for (final key in _syncQueueBox?.keys ?? []) {
      final data = _syncQueueBox?.get(key);
      if (data != null) {
        _pendingSyncQueue.add(SyncOperation.fromJson(data));
      }
    }
  }

  /// Limpia toda la base de datos
  Future<void> clearAll() async {
    await _persistentBox?.clear();
    await _stateBox?.clear();
    await _syncQueueBox?.clear();
    await _vectorsBox?.clear();
    _workingMemory.clear();
    _memoryTimestamps.clear();
    _pendingSyncQueue.clear();
    _vectorStore.clear();
  }

  /// Limpia solo estado temporal
  Future<void> clearState() async {
    await _stateBox?.clear();
    _workingMemory.clear();
    _memoryTimestamps.clear();
  }

  /// Estadísticas de uso
  MemoryStats get stats => MemoryStats(
        persistentCount: _persistentBox?.length ?? 0,
        stateCount: _stateBox?.length ?? 0,
        syncQueueCount: _pendingSyncQueue.length,
        vectorCount: _vectorStore.size,
        workingMemoryCount: _workingMemory.length,
      );

  /// Cierra conexiones
  Future<void> close() async {
    await _persistentBox?.close();
    await _stateBox?.close();
    await _syncQueueBox?.close();
    await _vectorsBox?.close();
  }
}

// ==================== MODELOS ====================

/// Tipos de memoria
enum MemoryType {
  general, // Datos generales
  state, // Estado de sesión
  semantic, // Vectores semánticos
  draft, // Borradores offline
  cache, // Caché temporal
  config, // Configuración
  user, // Datos de usuario
  entity, // Entidades de negocio
}

/// Entrada de memoria
class MemoryEntry {
  final String key;
  final dynamic value;
  final MemoryType type;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int? expiresAt;

  MemoryEntry({
    required this.key,
    required this.value,
    required this.type,
    required this.createdAt,
    required this.updatedAt,
    this.expiresAt,
  });

  Map<String, dynamic> toJson() => {
        'key': key,
        'value': value,
        'type': type.index,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'expiresAt': expiresAt,
      };

  factory MemoryEntry.fromJson(Map<String, dynamic> json) => MemoryEntry(
        key: json['key'] ?? '',
        value: json['value'],
        type: MemoryType.values[json['type'] ?? 0],
        createdAt: DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
        updatedAt: DateTime.tryParse(json['updatedAt'] ?? '') ?? DateTime.now(),
        expiresAt: json['expiresAt'],
      );
}

/// Operación de sincronización
class SyncOperation {
  final String id;
  final String operationType; // create, update, delete
  final String entityType; // pedido, producto, cliente
  final String entityId;
  final Map<String, dynamic> data;
  final DateTime createdAt;
  int retryCount;

  SyncOperation({
    required this.id,
    required this.operationType,
    required this.entityType,
    required this.entityId,
    required this.data,
    required this.createdAt,
    this.retryCount = 0,
  });

  SyncOperation.empty()
      : id = '',
        operationType = '',
        entityType = '',
        entityId = '',
        data = {},
        createdAt = DateTime.now(),
        retryCount = 0;

  Map<String, dynamic> toJson() => {
        'id': id,
        'operationType': operationType,
        'entityType': entityType,
        'entityId': entityId,
        'data': data,
        'createdAt': createdAt.toIso8601String(),
        'retryCount': retryCount,
      };

  factory SyncOperation.fromJson(Map<String, dynamic> json) => SyncOperation(
        id: json['id'] ?? '',
        operationType: json['operationType'] ?? '',
        entityType: json['entityType'] ?? '',
        entityId: json['entityId'] ?? '',
        data: Map<String, dynamic>.from(json['data'] ?? {}),
        createdAt: DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
        retryCount: json['retryCount'] ?? 0,
      );
}

/// Estadísticas de memoria
class MemoryStats {
  final int persistentCount;
  final int stateCount;
  final int syncQueueCount;
  final int vectorCount;
  final int workingMemoryCount;

  MemoryStats({
    required this.persistentCount,
    required this.stateCount,
    required this.syncQueueCount,
    required this.vectorCount,
    required this.workingMemoryCount,
  });

  @override
  String toString() =>
      'MemoryStats(persistent: $persistentCount, state: $stateCount, '
      'sync: $syncQueueCount, vectors: $vectorCount, working: $workingMemoryCount)';
}
