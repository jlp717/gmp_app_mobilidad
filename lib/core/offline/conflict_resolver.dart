import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/memory/agent_database.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart' as sync_service; // Using prefix to avoid conflict

/// Estrategia de resolución de conflictos
enum ConflictResolutionStrategy {
  /// El último cambio gana (útil para campos como notas o comentarios)
  lastWriteWins,
  
  /// El primer cambio gana (útil para operaciones críticas como confirmaciones)
  firstWriteWins,
  
  /// Fusionar cambios (útil para objetos complejos con múltiples campos)
  mergeChanges,
  
  /// Manual - requiere intervención del usuario
  manualResolution,
  
  /// Aplicar ambos cambios si son complementarios
  applyBoth,
}

/// Tipo de conflicto detectado
enum ConflictType {
  /// Conflicto de versión - el servidor tiene datos diferentes
  versionConflict,
  
  /// Conflicto de recursos - se intenta crear un recurso duplicado
  resourceConflict,
  
  /// Conflicto de dependencias - el recurso dependiente cambió
  dependencyConflict,
  
  /// Conflicto de estado - se intenta cambiar el estado de forma incompatible
  stateConflict,
}

/// Representa un conflicto detectado durante la sincronización
class SyncConflict {
  final String id;
  final String operationId;
  final String entityType;
  final String entityId;
  final String endpoint;
  final String method;
  final Map<String, dynamic> localChanges;
  final Map<String, dynamic>? serverData;
  final ConflictType conflictType;
  final DateTime detectedAt;
  final int retryCount;

  const SyncConflict({
    required this.id,
    required this.operationId,
    required this.entityType,
    required this.entityId,
    required this.endpoint,
    required this.method,
    required this.localChanges,
    this.serverData,
    required this.conflictType,
    required this.detectedAt,
    this.retryCount = 0,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'operationId': operationId,
        'entityType': entityType,
        'entityId': entityId,
        'endpoint': endpoint,
        'method': method,
        'localChanges': localChanges,
        'serverData': serverData,
        'conflictType': conflictType.toString(),
        'detectedAt': detectedAt.toIso8601String(),
        'retryCount': retryCount,
      };

  factory SyncConflict.fromJson(Map<String, dynamic> json) => SyncConflict(
        id: json['id'] as String,
        operationId: json['operationId'] as String,
        entityType: json['entityType'] as String,
        entityId: json['entityId'] as String,
        endpoint: json['endpoint'] as String,
        method: json['method'] as String,
        localChanges: Map<String, dynamic>.from(json['localChanges'] as Map),
        serverData: json['serverData'] != null
            ? Map<String, dynamic>.from(json['serverData'] as Map)
            : null,
        conflictType: _parseConflictType(json['conflictType'] as String),
        detectedAt: DateTime.parse(json['detectedAt'] as String),
        retryCount: json['retryCount'] as int? ?? 0,
      );

  static ConflictType _parseConflictType(String typeStr) {
    return ConflictType.values.firstWhere(
      (e) => e.toString() == typeStr,
      orElse: () => ConflictType.versionConflict,
    );
  }
}

/// Sistema de resolución de conflictos para operaciones offline
class ConflictResolver {
  static final ConflictResolver _instance = ConflictResolver._internal();
  factory ConflictResolver() => _instance;
  ConflictResolver._internal();

  static const String _conflictsBoxName = 'sync_conflicts';

  /// Procesa conflictos detectados durante la sincronización
  Future<ConflictResolutionResult> resolveConflicts(
    List<sync_service.SyncOperation> pendingOperations,  // Using prefixed import
  ) async {
    debugPrint('[ConflictResolver] Processing ${pendingOperations.length} pending operations');

    final conflicts = <SyncConflict>[];
    final resolvedOperations = <sync_service.SyncOperation>[];  // Using prefixed import
    final failedOperations = <sync_service.SyncOperation>[];    // Using prefixed import

    for (final operation in pendingOperations) {
      try {
        final conflict = await _detectConflict(operation);
        if (conflict != null) {
          conflicts.add(conflict);
          
          // Resolver el conflicto basado en estrategia
          final resolution = await _resolveSingleConflict(conflict);
          if (resolution.resolved) {
            resolvedOperations.addAll(resolution.operations);
          } else {
            failedOperations.add(operation);
          }
        } else {
          // No hay conflicto, operación puede proceder normalmente
          resolvedOperations.add(operation);
        }
      } catch (e) {
        debugPrint('[ConflictResolver] Error processing operation ${operation.id}: $e');
        failedOperations.add(operation);
      }
    }

    return ConflictResolutionResult(
      conflicts: conflicts,
      resolvedOperations: resolvedOperations,
      failedOperations: failedOperations,
      success: conflicts.isEmpty || resolvedOperations.length == pendingOperations.length,
    );
  }

  /// Detecta si una operación tiene conflicto con el estado actual del servidor
  Future<SyncConflict?> _detectConflict(sync_service.SyncOperation operation) async {  // Using prefixed import
    try {
      // Determinar tipo de conflicto basado en operación
      switch (operation.method) {
        case 'PUT':
        case 'PATCH':
          return await _detectVersionConflict(operation);
        case 'POST':
          return await _detectResourceConflict(operation);
        case 'DELETE':
          return await _detectDependencyConflict(operation);
        default:
          return null;
      }
    } catch (e) {
      debugPrint('[ConflictResolver] Error detecting conflict for ${operation.id}: $e');
      return null;
    }
  }

  /// Detecta conflictos de versión (datos modificados desde que se realizó offline)
  Future<SyncConflict?> _detectVersionConflict(sync_service.SyncOperation operation) async {  // Using prefixed import
    try {
      // Extraer entidad y ID del endpoint
      final entityInfo = _extractEntityInfo(operation.endpoint);
      if (entityInfo == null) return null;

      // Obtener estado actual del servidor
      final currentServerData = await ApiClient.get(entityInfo.$1)
          .catchError((_) => null);

      if (currentServerData != null) {
        // Comparar con los datos locales que se intentan aplicar
        final hasVersionConflict = _hasSignificantChanges(
          currentServerData,
          operation.payload,
        );

        if (hasVersionConflict) {
          return SyncConflict(
            id: 'conflict_${DateTime.now().millisecondsSinceEpoch}_${operation.id}',
            operationId: operation.id,
            entityType: entityInfo.$2,
            entityId: entityInfo.$3,
            endpoint: operation.endpoint,
            method: operation.method,
            localChanges: operation.payload,
            serverData: currentServerData,
            conflictType: ConflictType.versionConflict,
            detectedAt: DateTime.now(),
          );
        }
      }

      return null;
    } catch (e) {
      debugPrint('[ConflictResolver] Error in version conflict detection: $e');
      return null;
    }
  }

  /// Detecta conflictos de recursos (intentar crear algo que ya existe)
  Future<SyncConflict?> _detectResourceConflict(sync_service.SyncOperation operation) async {  // Using prefixed import
    try {
      // Para operaciones POST, verificar si el recurso ya existe
      if (operation.method != 'POST') return null;

      final entityInfo = _extractEntityInfo(operation.endpoint);
      if (entityInfo == null) return null;

      // Extraer ID o clave única del payload si está presente
      final uniqueKey = _extractUniqueKey(operation.payload, entityInfo.$2);
      if (uniqueKey != null) {
        // Intentar encontrar el recurso existente
        try {
          final existingResource = await _findExistingResource(
            entityInfo.$1,
            uniqueKey,
          );
          
          if (existingResource != null) {
            return SyncConflict(
              id: 'conflict_${DateTime.now().millisecondsSinceEpoch}_${operation.id}',
              operationId: operation.id,
              entityType: entityInfo.$2,
              entityId: existingResource['id']?.toString() ?? uniqueKey,
              endpoint: operation.endpoint,
              method: operation.method,
              localChanges: operation.payload,
              serverData: existingResource,
              conflictType: ConflictType.resourceConflict,
              detectedAt: DateTime.now(),
            );
          }
        } catch (e) {
          // Si no podemos verificar, asumimos que no hay conflicto
        }
      }

      return null;
    } catch (e) {
      debugPrint('[ConflictResolver] Error in resource conflict detection: $e');
      return null;
    }
  }

  /// Detecta conflictos de dependencias (recurso dependiente cambiado)
  Future<SyncConflict?> _detectDependencyConflict(sync_service.SyncOperation operation) async {  // Using prefixed import
    // Para DELETE, verificar si el recurso aún existe o si tiene dependencias
    if (operation.method != 'DELETE') return null;

    final entityInfo = _extractEntityInfo(operation.endpoint);
    if (entityInfo == null) return null;

    try {
      // Intentar obtener el recurso - si no existe, podría ser un conflicto
      final currentResource = await ApiClient.get(entityInfo.$1)
          .catchError((_) => null);

      if (currentResource == null) {
        // El recurso ya no existe, probablemente fue eliminado por otro cliente
        return SyncConflict(
          id: 'conflict_${DateTime.now().millisecondsSinceEpoch}_${operation.id}',
          operationId: operation.id,
          entityType: entityInfo.$2,
          entityId: entityInfo.$3,
          endpoint: operation.endpoint,
          method: operation.method,
          localChanges: operation.payload,
          serverData: null,
          conflictType: ConflictType.dependencyConflict,
          detectedAt: DateTime.now(),
        );
      }
    } catch (e) {
      debugPrint('[ConflictResolver] Error in dependency conflict detection: $e');
    }

    return null;
  }

  /// Resuelve un único conflicto basado en estrategia
  Future<ConflictResolution> _resolveSingleConflict(SyncConflict conflict) async {
    final strategy = _determineResolutionStrategy(conflict);
    
    switch (strategy) {
      case ConflictResolutionStrategy.lastWriteWins:
        // Aplicar el cambio local (el más reciente)
        return ConflictResolution(
          resolved: true,
          operations: [_createUpdatedOperation(conflict)],
        );
        
      case ConflictResolutionStrategy.firstWriteWins:
        // Mantener el cambio del servidor, descartar local
        return ConflictResolution(
          resolved: true,
          operations: [], // No aplicar operación local
        );
        
      case ConflictResolutionStrategy.mergeChanges:
        // Fusionar cambios locales con los del servidor
        final mergedPayload = _mergeChanges(conflict.localChanges, conflict.serverData ?? {});
        final mergedOp = sync_service.SyncOperation(  // Using prefixed import
          id: '${conflict.operationId}_merged',
          type: conflict.entityType,
          endpoint: conflict.endpoint,
          method: conflict.method,
          payload: mergedPayload,
          createdAt: DateTime.now(),
        );
        return ConflictResolution(
          resolved: true,
          operations: [mergedOp],
        );
        
      case ConflictResolutionStrategy.applyBoth:
        // Aplicar ambos cambios si son complementarios
        final serverOp = _createServerOperation(conflict);
        final localOp = _createUpdatedOperation(conflict);
        return ConflictResolution(
          resolved: true,
          operations: serverOp != null ? [serverOp, localOp] : [localOp],
        );
        
      case ConflictResolutionStrategy.manualResolution:
        // Registrar conflicto para resolución manual
        await _storeManualConflict(conflict);
        return ConflictResolution(
          resolved: false,
          operations: [],
        );
    }
  }

  /// Determina la estrategia de resolución basada en el tipo de conflicto y entidad
  ConflictResolutionStrategy _determineResolutionStrategy(SyncConflict conflict) {
    // Reglas específicas por tipo de entidad
    switch (conflict.entityType) {
      case 'pedido':
        // Para pedidos, priorizar últimos cambios excepto para estado crítico
        if (conflict.localChanges.containsKey('estado') && 
            conflict.localChanges['estado'] == 'CONFIRMADO') {
          return ConflictResolutionStrategy.lastWriteWins;
        }
        return ConflictResolutionStrategy.mergeChanges;
        
      case 'cliente':
        // Para clientes, fusionar cambios menores, mantener último para críticos
        if (conflict.localChanges.keys.any((k) => ['nombre', 'direccion', 'telefono'].contains(k))) {
          return ConflictResolutionStrategy.lastWriteWins;
        }
        return ConflictResolutionStrategy.mergeChanges;
        
      case 'cobro':
        // Para cobros, usar el último cambio
        return ConflictResolutionStrategy.lastWriteWins;
        
      default:
        // Por defecto, fusionar cambios
        return ConflictResolutionStrategy.mergeChanges;
    }
  }

  /// Fusiona cambios locales con datos del servidor
  Map<String, dynamic> _mergeChanges(
    Map<String, dynamic> localChanges,
    Map<String, dynamic> serverData,
  ) {
    final merged = Map<String, dynamic>.from(serverData);
    
    for (final entry in localChanges.entries) {
      // Reglas específicas de fusión
      if (_shouldOverwriteField(entry.key)) {
        merged[entry.key] = entry.value;
      } else {
        // Para listas o colecciones, combinar si es posible
        if (entry.value is List && merged[entry.key] is List) {
          final localList = List<dynamic>.from(entry.value as List);
          final serverList = List<dynamic>.from(merged[entry.key] as List);
          merged[entry.key] = List.from({...serverList, ...localList});
        } else {
          merged[entry.key] = entry.value;
        }
      }
    }
    
    return merged;
  }

  /// Determina si un campo debe sobrescribirse en lugar de fusionarse
  bool _shouldOverwriteField(String fieldName) {
    // Campos que deben sobrescribirse (no fusionarse)
    const overwriteFields = {
      'estado',
      'fecha',
      'hora',
      'activo',
      'bloqueado',
    };
    
    return overwriteFields.contains(fieldName);
  }

  /// Extrae información de entidad del endpoint
  (String endpoint, String entityType, String entityId)? _extractEntityInfo(String endpoint) {
    // Patrones comunes: /clientes/C001, /pedidos/P001/edit, etc.
    final regExp = RegExp(r'^\/(\w+)\/([^\/]+)(?:\/.*)?$');
    final match = regExp.firstMatch(endpoint);
    
    if (match != null && match.groupCount >= 2) {
      final entityType = match.group(1)!;
      final entityId = match.group(2)!;
      return (endpoint, entityType, entityId);
    }
    
    return null;
  }

  /// Extrae clave única del payload para detección de duplicados
  String? _extractUniqueKey(Map<String, dynamic> payload, String entityType) {
    switch (entityType) {
      case 'pedido':
        return payload['numeroPedido']?.toString();
      case 'cliente':
        return payload['codigoCliente']?.toString();
      case 'producto':
        return payload['codigoProducto']?.toString();
      default:
        return payload['id']?.toString();
    }
  }

  /// Busca recurso existente por clave única
  Future<Map<String, dynamic>?> _findExistingResource(String endpoint, String uniqueKey) async {
    try {
      // Esta implementación dependería de la API específica
      // Por ahora, simplemente intentamos obtener el endpoint base con el ID
      final baseEndpoint = endpoint.split('/')[1]; // Extraer base (ej: 'clientes')
      final response = await ApiClient.get('/$baseEndpoint');
      
      if (response is Map && response.containsKey('data')) {
        final data = response['data'];
        if (data is List) {
          // Buscar en la lista
          for (final item in data) {
            if (item is Map<String, dynamic>) {
              final id = item['id']?.toString() ?? 
                         item['codigoCliente']?.toString() ?? 
                         item['numeroPedido']?.toString();
              if (id == uniqueKey) {
                return item;
              }
            }
          }
        }
      }
    } catch (e) {
      debugPrint('[ConflictResolver] Error finding existing resource: $e');
    }
    
    return null;
  }

  /// Compara si hay cambios significativos entre dos conjuntos de datos
  bool _hasSignificantChanges(Map<String, dynamic> serverData, Map<String, dynamic> localChanges) {
    for (final entry in localChanges.entries) {
      final serverValue = serverData[entry.key];
      if (!_valuesEqual(serverValue, entry.value)) {
        return true;
      }
    }
    return false;
  }

  /// Compara dos valores para igualdad
  bool _valuesEqual(dynamic a, dynamic b) {
    if (a.runtimeType != b.runtimeType) return false;
    
    if (a is Map && b is Map) {
      return mapEquals(a, b);
    } else if (a is List && b is List) {
      return listEquals(a, b);
    } else {
      return a == b;
    }
  }

  /// Crea una operación actualizada con la estrategia ganadora
  sync_service.SyncOperation _createUpdatedOperation(SyncConflict conflict) {  // Using prefixed import
    return sync_service.SyncOperation(  // Using prefixed import
      id: '${conflict.operationId}_resolved',
      type: conflict.entityType,
      endpoint: conflict.endpoint,
      method: conflict.method,
      payload: conflict.localChanges,
      createdAt: DateTime.now(),
    );
  }

  /// Crea operación con datos del servidor (para first-write-wins)
  sync_service.SyncOperation? _createServerOperation(SyncConflict conflict) {  // Using prefixed import
    if (conflict.serverData == null) return null;
    
    return sync_service.SyncOperation(  // Using prefixed import
      id: '${conflict.operationId}_server',
      type: conflict.entityType,
      endpoint: conflict.endpoint,
      method: 'PUT', // Actualizar con datos del servidor
      payload: conflict.serverData!,
      createdAt: DateTime.now(),
    );
  }

  /// Almacena conflicto para resolución manual
  Future<void> _storeManualConflict(SyncConflict conflict) async {
    try {
      await AgentDatabase.instance.setPersistent(
        key: 'conflict:${conflict.id}',
        value: conflict.toJson(),
        type: MemoryType.draft,
      );
      
      debugPrint('[ConflictResolver] Stored conflict ${conflict.id} for manual resolution');
    } catch (e) {
      debugPrint('[ConflictResolver] Error storing manual conflict: $e');
    }
  }

  /// Obtiene conflictos pendientes de resolución manual
  Future<List<SyncConflict>> getManualConflicts() async {
    final conflicts = <SyncConflict>[];
    
    // Buscar en AgentDB todos los conflictos marcados para resolución manual
    // Esta es una implementación simplificada
    try {
      // Recuperar conflictos almacenados
      // En una implementación completa, buscaría por patrón de clave
    } catch (e) {
      debugPrint('[ConflictResolver] Error getting manual conflicts: $e');
    }
    
    return conflicts;
  }

  /// Resuelve un conflicto manualmente
  Future<bool> resolveManualConflict(String conflictId, Map<String, dynamic> resolvedData) async {
    try {
      // En una implementación completa:
      // 1. Obtener conflicto por ID
      // 2. Aplicar resolución manual
      // 3. Eliminar conflicto de la cola
      // 4. Añadir operación resuelta a la cola de sincronización
      
      await AgentDatabase.instance.deletePersistent('conflict:$conflictId');
      
      debugPrint('[ConflictResolver] Manual conflict $conflictId resolved');
      return true;
    } catch (e) {
      debugPrint('[ConflictResolver] Error resolving manual conflict: $e');
      return false;
    }
  }
}

/// Resultado de resolución de conflictos
class ConflictResolution {
  final bool resolved;
  final List<sync_service.SyncOperation> operations;  // Using prefixed import

  const ConflictResolution({
    required this.resolved,
    required this.operations,
  });
}

/// Resultado del proceso de resolución de conflictos
class ConflictResolutionResult {
  final List<SyncConflict> conflicts;
  final List<sync_service.SyncOperation> resolvedOperations;  // Using prefixed import
  final List<sync_service.SyncOperation> failedOperations;    // Using prefixed import
  final bool success;

  const ConflictResolutionResult({
    required this.conflicts,
    required this.resolvedOperations,
    required this.failedOperations,
    required this.success,
  });
}