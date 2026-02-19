/// REPARTIDOR DATA SERVICE
/// Cliente de API para obtener datos de cobros, comisiones e histórico desde backend
/// OPTIMIZED: Full caching support with intelligent TTLs

import '../../../../core/api/api_client.dart';
import '../../../../core/cache/cache_service.dart';

/// Resultado del resumen de cobros
class CollectionsSummary {
  final String repartidorId;
  final int year;
  final int month;
  final double totalCollectable;
  final double totalCollected;
  final double totalCommission;
  final double overallPercentage;
  final bool thresholdMet;
  final int clientCount;
  final List<ClientCollectionData> clients;

  CollectionsSummary({
    required this.repartidorId,
    required this.year,
    required this.month,
    required this.totalCollectable,
    required this.totalCollected,
    required this.totalCommission,
    required this.overallPercentage,
    required this.thresholdMet,
    required this.clientCount,
    required this.clients,
  });

  factory CollectionsSummary.fromJson(Map<String, dynamic> json) {
    final summary = Map<String, dynamic>.from((json['summary'] as Map?) ?? {});
    final clientsList = (json['clients'] as List? ?? [])
        .map((c) => ClientCollectionData.fromJson(c as Map<String, dynamic>))
        .toList();
    
    return CollectionsSummary(
      repartidorId: (json['repartidorId'] as String?) ?? '',
      year: (json['period']?['year'] as int?) ?? DateTime.now().year,
      month: (json['period']?['month'] as int?) ?? DateTime.now().month,
      totalCollectable: ((summary['totalCollectable'] ?? 0) as num).toDouble(),
      totalCollected: ((summary['totalCollected'] ?? 0) as num).toDouble(),
      totalCommission: ((summary['totalCommission'] ?? 0) as num).toDouble(),
      overallPercentage: ((summary['overallPercentage'] ?? 0) as num).toDouble(),
      thresholdMet: (summary['thresholdMet'] as bool?) ?? false,
      clientCount: (summary['clientCount'] as int?) ?? 0,
      clients: clientsList,
    );
  }
}

/// Datos de cobranza por cliente
class ClientCollectionData {
  final String clientId;
  final String clientName;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;
  final double thresholdProgress;
  final double commission;
  final int tier;
  final String paymentType;
  final int numDocuments;

  ClientCollectionData({
    required this.clientId,
    required this.clientName,
    required this.collectable,
    required this.collected,
    required this.percentage,
    required this.thresholdMet,
    required this.thresholdProgress,
    required this.commission,
    required this.tier,
    required this.paymentType,
    required this.numDocuments,
  });

  factory ClientCollectionData.fromJson(Map<String, dynamic> json) {
    return ClientCollectionData(
      clientId: (json['clientId'] as String?) ?? '',
      clientName: (json['clientName'] as String?) ?? (json['clientId'] as String?) ?? '',
      collectable: ((json['collectable'] ?? 0) as num).toDouble(),
      collected: ((json['collected'] ?? 0) as num).toDouble(),
      percentage: ((json['percentage'] ?? 0) as num).toDouble(),
      thresholdMet: (json['thresholdMet'] as bool?) ?? false,
      thresholdProgress: ((json['thresholdProgress'] ?? 0) as num).toDouble(),
      commission: ((json['commission'] ?? 0) as num).toDouble(),
      tier: (json['tier'] as int?) ?? 0,
      paymentType: (json['paymentType'] as String?) ?? 'Otro',
      numDocuments: (json['numDocuments'] as int?) ?? 0,
    );
  }
}

/// Acumulado diario
class DailyCollection {
  final int day;
  final String date;
  final double collectable;
  final double collected;

  DailyCollection({
    required this.day,
    required this.date,
    required this.collectable,
    required this.collected,
  });

  factory DailyCollection.fromJson(Map<String, dynamic> json) {
    return DailyCollection(
      day: (json['day'] as int?) ?? 0,
      date: (json['date'] as String?) ?? '',
      collectable: ((json['collectable'] ?? 0) as num).toDouble(),
      collected: ((json['collected'] ?? 0) as num).toDouble(),
    );
  }
}

/// Cliente del historial
class HistoryClient {
  final String id;
  final String name;
  final String address;
  final int totalDocuments;
  final double totalAmount;
  final String? lastVisit;
  final String? repCode;
  final String? repName;

  HistoryClient({
    required this.id,
    required this.name,
    required this.address,
    required this.totalDocuments,
    this.totalAmount = 0,
    this.lastVisit,
    this.repCode,
    this.repName,
  });

  factory HistoryClient.fromJson(Map<String, dynamic> json) {
    return HistoryClient(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? (json['id'] as String?) ?? '',
      address: (json['address'] as String?) ?? '',
      totalDocuments: (json['totalDocuments'] as int?) ?? 0,
      totalAmount: ((json['totalAmount'] ?? 0) as num).toDouble(),
      lastVisit: json['lastVisit'] as String?,
      repCode: json['repCode'] as String?,
      repName: json['repName'] as String?,
    );
  }
}

/// Documento del historial
class HistoryDocument {
  final String id;
  final String type; // 'albaran' o 'factura'
  final int number;
  final int? albaranNumber;
  final int? facturaNumber;
  final String? serieFactura;
  final int? ejercicioFactura;
  final String serie;
  final int ejercicio;
  final int terminal;
  final String date;
  final double amount;
  final double pending;
  final String status; // 'delivered', 'partial', 'notDelivered'
  final bool hasSignature;
  final String? signaturePath;
  final String? deliveryDate;
  final String? deliveryRepartidor;
  final String? deliveryObs;
  final String? time;
  // Legacy signature fields (from CACFIRMAS)
  final String? legacySignatureName;
  final bool hasLegacySignature;
  final String? legacyDate;

  HistoryDocument({
    required this.id,
    required this.type,
    required this.number,
    this.albaranNumber,
    this.facturaNumber,
    this.serieFactura,
    this.ejercicioFactura,
    this.serie = 'A',
    this.ejercicio = 0,
    this.terminal = 0,
    required this.date,
    required this.amount,
    required this.pending,
    required this.status,
    required this.hasSignature,
    this.signaturePath,
    this.deliveryDate,
    this.deliveryRepartidor,
    this.deliveryObs,
    this.time,
    this.legacySignatureName,
    this.hasLegacySignature = false,
    this.legacyDate,
  });

  factory HistoryDocument.fromJson(Map<String, dynamic> json) {
    return HistoryDocument(
      id: (json['id'] as String?) ?? '',
      type: (json['type'] as String?) ?? 'albaran',
      number: (json['number'] as int?) ?? 0,
      albaranNumber: json['albaranNumber'] as int?,
      facturaNumber: json['facturaNumber'] as int?,
      serieFactura: json['serieFactura'] as String?,
      ejercicioFactura: json['ejercicioFactura'] as int?,
      serie: (json['serie'] as String?) ?? 'A',
      ejercicio: (json['ejercicio'] as int?) ?? 0,
      terminal: (json['terminal'] as int?) ?? 0,
      date: (json['date'] as String?) ?? '',
      amount: ((json['amount'] ?? 0) as num).toDouble(),
      pending: ((json['pending'] ?? 0) as num).toDouble(),
      status: (json['status'] as String?) ?? 'notDelivered',
      hasSignature: (json['hasSignature'] as bool?) ?? false,
      signaturePath: json['signaturePath'] as String?,
      deliveryDate: json['deliveryDate'] as String?,
      deliveryRepartidor: json['deliveryRepartidor'] as String?,
      deliveryObs: json['deliveryObs'] as String?,
      time: json['time'] as String?,
      legacySignatureName: json['legacySignatureName'] as String?,
      hasLegacySignature: (json['hasLegacySignature'] as bool?) ?? false,
      legacyDate: json['legacyDate'] as String?,
    );
  }
}

/// Objetivo mensual
class MonthlyObjective {
  final String month;
  final int year;
  final int monthNum;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;

  MonthlyObjective({
    required this.month,
    required this.year,
    required this.monthNum,
    required this.collectable,
    required this.collected,
    required this.percentage,
    required this.thresholdMet,
  });

  factory MonthlyObjective.fromJson(Map<String, dynamic> json) {
    return MonthlyObjective(
      month: (json['month'] as String?) ?? '',
      year: (json['year'] as int?) ?? DateTime.now().year,
      monthNum: (json['monthNum'] as int?) ?? 1,
      collectable: ((json['collectable'] ?? 0) as num).toDouble(),
      collected: ((json['collected'] ?? 0) as num).toDouble(),
      percentage: ((json['percentage'] ?? 0) as num).toDouble(),
      thresholdMet: (json['thresholdMet'] as bool?) ?? false,
    );
  }
}

/// Resultado del cálculo de comisión
class CommissionResult {
  final double collectable;
  final double collected;
  final double percentageCollected;
  final bool thresholdMet;
  final double thresholdProgress;
  final int currentTier;
  final double commissionEarned;
  final String tierLabel;

  const CommissionResult({
    required this.collectable,
    required this.collected,
    required this.percentageCollected,
    required this.thresholdMet,
    required this.thresholdProgress,
    required this.currentTier,
    required this.commissionEarned,
    required this.tierLabel,
  });

  factory CommissionResult.empty() => const CommissionResult(
    collectable: 0.0,
    collected: 0.0,
    percentageCollected: 0.0,
    thresholdMet: false,
    thresholdProgress: 0.0,
    currentTier: 0,
    commissionEarned: 0.0,
    tierLabel: 'Sin cobros',
  );
}

/// Servicio de datos para repartidor
class RepartidorDataService {
  
  /// Obtener resumen de cobros/comisiones del mes
  static Future<CollectionsSummary> getCollectionsSummary({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();
      
      // Cache key based on repartidor + period
      final cacheKey = 'repartidor_summary_${repartidorId}_${year ?? 'current'}_${month ?? 'current'}';
      
      final response = await ApiClient.get(
        '/repartidor/collections/summary/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.shortTTL, // 5 minutes - collections change frequently
      );
      
      return CollectionsSummary.fromJson(response);
    } catch (e) {
      throw Exception('Error cargando resumen de cobros: $e');
    }
  }

  /// Obtener acumulado diario
  static Future<List<DailyCollection>> getDailyCollections({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();
      
      final cacheKey = 'repartidor_daily_${repartidorId}_${year ?? 'current'}_${month ?? 'current'}';
      
      final response = await ApiClient.get(
        '/repartidor/collections/daily/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 10), // 10 minutes
      );
      
      final dailyList = (response['daily'] as List? ?? [])
          .map((d) => DailyCollection.fromJson(d as Map<String, dynamic>))
          .toList();
          
      return dailyList;
    } catch (e) {
      throw Exception('Error cargando acumulado diario: $e');
    }
  }

  /// Obtener lista de clientes atendidos
  static Future<List<HistoryClient>> getHistoryClients({
    required String repartidorId,
    String? search,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (search != null && search.isNotEmpty) {
        queryParams['search'] = search;
      }
      
      // Longer cache for client list - 30 min
      final cacheKey = 'repartidor_clients_${repartidorId}_${search ?? 'all'}';
      
      final response = await ApiClient.get(
        '/repartidor/history/clients/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.defaultTTL, // 30 minutes - client list stable
      );
      
      final clients = (response['clients'] as List? ?? [])
          .map((c) => HistoryClient.fromJson(Map<String, dynamic>.from(c as Map)))
          .toList();
          
      return clients;
    } catch (e) {
      throw Exception('Error cargando clientes: $e');
    }
  }

  /// Obtener documentos de un cliente
  static Future<List<HistoryDocument>> getClientDocuments({
    required String clientId,
    String? repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (repartidorId != null) {
        queryParams['repartidorId'] = repartidorId;
      }
      if (dateFrom != null) queryParams['dateFrom'] = dateFrom;
      if (dateTo != null) queryParams['dateTo'] = dateTo;
      if (year != null) queryParams['year'] = year.toString();

      final cacheKey = 'repartidor_docs_${clientId}_${repartidorId ?? 'all'}_${year ?? 'multi'}_${dateFrom ?? ''}_${dateTo ?? ''}';

      final response = await ApiClient.get(
        '/repartidor/history/documents/$clientId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15),
        forceRefresh: true, // Always fresh for history
      );
      
      final docs = (response['documents'] as List? ?? [])
          .map((d) => HistoryDocument.fromJson(Map<String, dynamic>.from(d as Map)))
          .toList();
          
      return docs;
    } catch (e) {
      throw Exception('Error cargando documentos: $e');
    }
  }

  /// Obtener objetivos mensuales (30% tracking)
  static Future<List<MonthlyObjective>> getMonthlyObjectives({
    required String repartidorId,
    String? clientId,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (clientId != null) {
        queryParams['clientId'] = clientId;
      }
      
      final cacheKey = 'repartidor_objectives_${repartidorId}_${clientId ?? 'all'}';
      
      final response = await ApiClient.get(
        '/repartidor/history/objectives/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.defaultTTL, // 30 minutes - objectives stable
      );
      
      final objectives = (response['objectives'] as List? ?? [])
          .map((o) => MonthlyObjective.fromJson(o as Map<String, dynamic>))
          .toList();
          
      return objectives;
    } catch (e) {
      throw Exception('Error cargando objetivos: $e');
    }
  }

  /// Obtener desglose jerárquico de ventas: Cliente → FI1 → FI2 → FI3 → FI4 → Productos
  static Future<Map<String, dynamic>> getObjectivesDetail({
    required String repartidorId,
    int? year,
    String? clientId,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (year != null) queryParams['year'] = year.toString();
      if (clientId != null) queryParams['clientId'] = clientId;

      final cacheKey = 'repartidor_objectives_detail_${repartidorId}_${year ?? 'current'}_${clientId ?? 'all'}';

      final response = await ApiClient.get(
        '/repartidor/history/objectives-detail/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.defaultTTL,
      );

      return response;
    } catch (e) {
      throw Exception('Error cargando desglose de ventas: $e');
    }
  }

  /// Descargar documento PDF
  static Future<List<int>> downloadDocument({
    required int year,
    required String serie,
    required int number,
    required String type, // 'factura' o 'albaran'
    int terminal = 0,
    // Factura-specific fields (for invoice endpoint)
    int? facturaNumber,
    String? serieFactura,
    int? ejercicioFactura,
    // Albaran fallback fields (sent as query params to invoice endpoint)
    int? albaranNumber,
    String? albaranSerie,
    int? albaranTerminal,
    int? albaranYear,
  }) async {
    try {
      final String endpoint;
      if (type == 'albaran') {
        endpoint = '/repartidor/document/albaran/$year/$serie/$terminal/$number/pdf';
      } else {
        // For facturas: use factura-specific fields if available
        final fNum = facturaNumber ?? number;
        final fSerie = serieFactura ?? serie;
        final fYear = ejercicioFactura ?? year;
        // Build query params for albaran fallback
        final queryParams = <String, String>{};
        if (albaranNumber != null) queryParams['albaranNumber'] = albaranNumber.toString();
        if (albaranSerie != null) queryParams['albaranSerie'] = albaranSerie;
        if (albaranTerminal != null) queryParams['albaranTerminal'] = albaranTerminal.toString();
        if (albaranYear != null) queryParams['albaranYear'] = albaranYear.toString();
        final qs = queryParams.isNotEmpty
            ? '?${queryParams.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&')}'
            : '';
        endpoint = '/repartidor/document/invoice/$fYear/$fSerie/$fNum/pdf$qs';
      }

      final response = await ApiClient.getBytes(endpoint);
      return response;
    } catch (e) {
      throw Exception('Error descargando documento: $e');
    }
  }

  /// Obtener firma real de un albarán
  static Future<Map<String, dynamic>?> getSignature({
    required int ejercicio,
    required String serie,
    required int terminal,
    required int numero,
  }) async {
    try {
      final response = await ApiClient.get(
        '/repartidor/history/signature',
        queryParameters: {
          'ejercicio': ejercicio.toString(),
          'serie': serie,
          'terminal': terminal.toString(),
          'numero': numero.toString(),
        },
      );

      if (response['hasSignature'] == true && response['signature'] != null) {
        return Map<String, dynamic>.from(response['signature'] as Map);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /// Obtener resumen de entregas
  static Future<Map<String, dynamic>> getDeliverySummary({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{};
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();

      final cacheKey = 'repartidor_delivery_summary_${repartidorId}_${year ?? 'current'}_${month ?? 'current'}';

      final response = await ApiClient.get(
        '/repartidor/history/delivery-summary/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 10),
      );

      return response;
    } catch (e) {
      return {'summary': {}, 'daily': []};
    }
  }

  /// Enviar documento por email (Server-side)
  static Future<Map<String, dynamic>> sendEmail({
    required int year,
    required String serie,
    required int number,
    required String type, // 'factura' o 'albaran'
    required String destinatario,
    int terminal = 0,
    String? asunto,
    String? cuerpo,
    // Factura specific
    int? facturaNumber,
    String? serieFactura,
    int? ejercicioFactura,
    // Albaran specific
    int? albaranNumber,
    String? albaranSerie,
    int? albaranTerminal,
    int? albaranYear,
  }) async {
    try {
      final response = await ApiClient.post('/repartidor/document/send-email', {
        'ejercicio': year,
        'serie': serie,
        'numero': number,
        'type': type,
        'destinatario': destinatario,
        'terminal': terminal,
        'asunto': asunto,
        'cuerpo': cuerpo,
        'facturaNumber': facturaNumber,
        'serieFactura': serieFactura,
        'ejercicioFactura': ejercicioFactura,
        'albaranNumber': albaranNumber,
        'albaranSerie': albaranSerie,
        'albaranTerminal': albaranTerminal,
        'albaranYear': albaranYear,
      });

      if (response['success'] == true) {
        return response;
      }
      throw Exception(response['error'] ?? 'Error enviando email');
    } catch (e) {
      throw Exception('Error enviando email: $e');
    }
  }
}
