import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/memory/agent_database.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart'; // Fixed import
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';

/// Servicio de precarga de datos críticos para disponibilidad offline
/// 
/// Este servicio se encarga de pre-cargar datos esenciales cuando hay conectividad
/// para garantizar que estén disponibles durante periodos offline
class DataPreloaderService {
  static final DataPreloaderService _instance = DataPreloaderService._internal();
  factory DataPreloaderService() => _instance;
  DataPreloaderService._internal();

  bool _isLoading = false;
  DateTime? _lastFullSync;
  final List<String> _criticalEndpoints = [
    '/vendedores',
    '/clientes',
    '/products',
    '/dashboard/metrics',
    '/dashboard/recent-sales',
    '/rutero/week',
  ];

  /// Precarga datos críticos cuando hay conectividad
  Future<PreloadResult> preloadCriticalData({
    String? vendorCode,
    bool forceRefresh = false,
  }) async {
    if (_isLoading) {
      debugPrint('[DataPreloader] Preload already in progress, skipping');
      return PreloadResult(
        success: false,
        message: 'Preload already in progress',
        criticalDataLoaded: false,
      );
    }

    _isLoading = true;
    
    // Variable declarations moved outside try block to avoid scope issues
    final results = <String, bool>{};
    var successCount = 0;

    try {
      // Solo precargar si hay conectividad real
      if (ConnectivityService.instance.currentStatus != ConnectivityStatus.online) {
        debugPrint('[DataPreloader] No real connectivity, skipping preload');
        return PreloadResult(
          success: false,
          message: 'No real connectivity',
          criticalDataLoaded: false,
        );
      }

      debugPrint('[DataPreloader] Starting critical data preload for vendor: $vendorCode');

      // Reiniciar contadores
      results.clear();
      successCount = 0;

      // Precargar datos críticos
      for (final endpoint in _criticalEndpoints) {
        try {
          final cacheKey = _generateCacheKey(endpoint, vendorCode);
          
          // Intentar obtener datos frescos
          final result = await OfflineAwareApi.get(
            endpoint,
            queryParameters: _getQueryParams(endpoint, vendorCode),
            cacheKey: cacheKey,
            forceRefresh: forceRefresh,
          );

          results[endpoint] = result.error == null;
          if (result.error == null) {
            successCount++;
            
            // Para clientes, también precargar datos relacionados
            if (endpoint.contains('/clientes')) {
              await _preloadRelatedClientData(result.data, vendorCode);
            }
          }

          // FIXED: Corrected string interpolation to avoid syntax errors
          if (result.error == null) {
            debugPrint('[DataPreloader] $endpoint: SUCCESS');
          } else {
            debugPrint('[DataPreloader] $endpoint: FAILED (${result.error})');
          }
        } catch (e) {
          results[endpoint] = false;
          debugPrint('[DataPreloader] Error preloading $endpoint: $e');
        }
      }

      // Actualizar marca de tiempo de última sincronización
      _lastFullSync = DateTime.now();
      
      // Guardar estado en AgentDB para persistencia
      await AgentDatabase.instance.setPersistent(
        key: 'preload:last_sync:${vendorCode ?? "all"}',
        value: _lastFullSync?.toIso8601String(),
        type: MemoryType.state,
      );

      final allSuccess = successCount == _criticalEndpoints.length;
      
      debugPrint('[DataPreloader] Completed: $successCount/${_criticalEndpoints.length} endpoints successful');

      return PreloadResult(
        success: allSuccess,
        message: 'Preloaded $successCount/${_criticalEndpoints.length} critical endpoints',
        criticalDataLoaded: successCount > 0,
        successCount: successCount,
        totalCount: _criticalEndpoints.length,
        results: results,
      );
    } finally {
      _isLoading = false;
    }
  }

  /// Precarga datos relacionados con clientes (créditos, deudas, etc.)
  Future<void> _preloadRelatedClientData(Map<String, dynamic> clientData, String? vendorCode) async {
    try {
      if (clientData.containsKey('data') && clientData['data'] is List) {
        final clients = List<Map<String, dynamic>>.from(clientData['data']);
        
        // Tomar solo los primeros N clientes para evitar sobrecarga
        final sampleClients = clients.take(20).where((client) => 
          client.containsKey('codigoCliente') && client['codigoCliente'] != null
        ).toList();

        for (final client in sampleClients) {
          final clientCode = client['codigoCliente'].toString();
          
          // Precargar datos específicos del cliente
          await Future.wait([
            _preloadClientSpecificData(clientCode, vendorCode),
          ], eagerError: true);
        }
      }
    } catch (e) {
      debugPrint('[DataPreloader] Error preloading related client data: $e');
    }
  }

  /// Precarga datos específicos de un cliente
  Future<void> _preloadClientSpecificData(String clientCode, String? vendorCode) async {
    try {
      final endpoints = [
        '/clientes/$clientCode/deuda',
        '/clientes/$clientCode/credito',
        '/clientes/$clientCode/history',
      ];

      for (final endpoint in endpoints) {
        try {
          final cacheKey = _generateCacheKey(endpoint, vendorCode);
          await OfflineAwareApi.get(
            endpoint,
            cacheKey: cacheKey,
            forceRefresh: false,
          );
        } catch (e) {
          debugPrint('[DataPreloader] Failed to preload $endpoint: $e');
        }
      }
    } catch (e) {
      debugPrint('[DataPreloader] Error in _preloadClientSpecificData: $e');
    }
  }

  /// Genera una clave de caché basada en endpoint y vendor
  String _generateCacheKey(String endpoint, String? vendorCode) {
    final baseKey = endpoint.replaceAll('/', '_').replaceAll('-', '_');
    return 'preload:${baseKey}_${vendorCode ?? "all"}';
  }

  /// Genera parámetros de consulta basados en endpoint y vendor
  Map<String, dynamic> _getQueryParams(String endpoint, String? vendorCode) {
    final params = <String, dynamic>{};
    
    // Añadir vendorCode si es necesario
    if (vendorCode != null && 
        !endpoint.contains('/clientes/') && 
        !endpoint.contains('/products/')) {
      params['vendorCode'] = vendorCode;
    }
    
    return params;
  }

  /// Verifica si los datos críticos están disponibles offline
  bool areCriticalDataAvailable(String? vendorCode) {
    for (final endpoint in _criticalEndpoints) {
      final cacheKey = _generateCacheKey(endpoint, vendorCode);
      if (!CacheService.hasValidCache(cacheKey)) {
        return false;
      }
    }
    return true;
  }

  /// Obtiene estadísticas de precarga
  Future<PreloadStats> getStats(String? vendorCode) async {
    final lastSyncRaw = await AgentDatabase.instance.getPersistent('preload:last_sync:${vendorCode ?? "all"}');
    final lastSync = lastSyncRaw != null ? DateTime.tryParse(lastSyncRaw) : null;

    int validCacheCount = 0;
    for (final endpoint in _criticalEndpoints) {
      final cacheKey = _generateCacheKey(endpoint, vendorCode);
      if (CacheService.hasValidCache(cacheKey)) {
        validCacheCount++;
      }
    }

    return PreloadStats(
      lastSync: lastSync,
      validCacheCount: validCacheCount,
      totalEndpoints: _criticalEndpoints.length,
      dataAvailability: validCacheCount / _criticalEndpoints.length,
    );
  }

  /// Limpia datos de precarga antiguos
  Future<void> clearStaleData() async {
    debugPrint('[DataPreloader] Clearing stale preload data');
    await CacheService.invalidateByPrefix('preload:');
  }
}

/// Resultado de operación de precarga
class PreloadResult {
  final bool success;
  final String message;
  final bool criticalDataLoaded;
  final int? successCount;
  final int? totalCount;
  final Map<String, bool>? results;

  const PreloadResult({
    required this.success,
    required this.message,
    required this.criticalDataLoaded,
    this.successCount,
    this.totalCount,
    this.results,
  });
}

/// Estadísticas de precarga
class PreloadStats {
  final DateTime? lastSync;
  final int validCacheCount;
  final int totalEndpoints;
  final double dataAvailability;

  const PreloadStats({
    required this.lastSync,
    required this.validCacheCount,
    required this.totalEndpoints,
    required this.dataAvailability,
  });
}