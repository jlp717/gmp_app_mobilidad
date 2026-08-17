/// REPARTIDOR DATA SERVICE
/// Cliente de API para obtener datos de cobros, comisiones e histórico desde backend
/// OPTIMIZED: Full caching support with intelligent TTLs
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

class RepartidorDataException implements Exception {
  const RepartidorDataException(
    this.message, {
    this.statusCode,
    this.code,
  });

  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => code == null ? message : '[$code] $message';
}

/// Backend acknowledgement that a document may be passed to the operating
/// system share sheet. It deliberately does not represent an external send.
class LocalDocumentShare {
  const LocalDocumentShare({required this.localShare, required this.sent});

  final bool localShare;
  final bool sent;
}

/// Resultado del resumen de cobros
class CollectionsSummary {
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
      overallPercentage:
          ((summary['overallPercentage'] ?? 0) as num).toDouble(),
      thresholdMet: (summary['thresholdMet'] as bool?) ?? false,
      clientCount: (summary['clientCount'] as int?) ?? 0,
      clients: clientsList,
    );
  }
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
}

/// Datos de cobranza por cliente
class ClientCollectionData {
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
      clientName: (json['clientName'] as String?) ??
          (json['clientId'] as String?) ??
          '',
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
}

/// Acumulado diario
class DailyCollection {
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
  final int day;
  final String date;
  final double collectable;
  final double collected;
}

/// Cliente del historial
class HistoryClient {
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
  final String id;
  final String name;
  final String address;
  final int totalDocuments;
  final double totalAmount;
  final String? lastVisit;
  final String? repCode;
  final String? repName;
}

typedef HistoryClientsPage = ({List<HistoryClient> clients, bool hasMore});

/// Documento del historial
class HistoryDocument {
  HistoryDocument({
    required this.id,
    required this.type,
    required this.number,
    required this.date,
    required this.amount,
    required this.pending,
    required this.status,
    required this.hasSignature,
    this.albaranNumber,
    this.facturaNumber,
    this.serieFactura,
    this.ejercicioFactura,
    this.serie = 'A',
    this.ejercicio = 0,
    this.terminal = 0,
    this.signaturePath,
    this.deliveryDate,
    this.deliveryRepartidor,
    this.deliveryObs,
    this.time,
    this.legacySignatureName,
    this.hasLegacySignature = false,
    this.legacyDate,
    this.confirmationId,
  });

  factory HistoryDocument.fromJson(Map<String, dynamic> json) {
    int asInt(dynamic value, [int fallback = 0]) {
      if (value is int) return value;
      if (value is num) return value.toInt();
      return int.tryParse(value?.toString() ?? '') ?? fallback;
    }

    double asDouble(dynamic value) {
      if (value is num) return value.toDouble();
      return double.tryParse(value?.toString() ?? '') ?? 0;
    }

    bool asBool(dynamic value) {
      if (value is bool) return value;
      final normalized = value?.toString().toLowerCase();
      return normalized == 'true' || normalized == '1' || normalized == 'yes';
    }

    return HistoryDocument(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString() ?? 'albaran',
      number: asInt(json['number']),
      albaranNumber:
          json['albaranNumber'] == null ? null : asInt(json['albaranNumber']),
      facturaNumber:
          json['facturaNumber'] == null ? null : asInt(json['facturaNumber']),
      serieFactura: json['serieFactura']?.toString(),
      ejercicioFactura: json['ejercicioFactura'] == null
          ? null
          : asInt(json['ejercicioFactura']),
      serie: json['serie']?.toString() ?? 'A',
      ejercicio: asInt(json['ejercicio']),
      terminal: asInt(json['terminal']),
      date: json['date']?.toString() ?? '',
      amount: asDouble(json['amount']),
      pending: asDouble(json['pending']),
      status: json['status']?.toString() ?? 'notDelivered',
      hasSignature: asBool(json['hasSignature']),
      signaturePath: json['signaturePath']?.toString(),
      deliveryDate: json['deliveryDate']?.toString(),
      deliveryRepartidor: json['deliveryRepartidor']?.toString(),
      deliveryObs: json['deliveryObs']?.toString(),
      time: json['time']?.toString(),
      legacySignatureName: json['legacySignatureName']?.toString(),
      hasLegacySignature: asBool(json['hasLegacySignature']),
      legacyDate: json['legacyDate']?.toString(),
      confirmationId: json['confirmationId']?.toString(),
    );
  }
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
  final String? confirmationId;
}

/// Objetivo mensual
class MonthlyObjective {
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
  final String month;
  final int year;
  final int monthNum;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;
}

/// Resultado del cálculo de comisión
class CommissionResult {
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
        collectable: 0,
        collected: 0,
        percentageCollected: 0,
        thresholdMet: false,
        thresholdProgress: 0,
        currentTier: 0,
        commissionEarned: 0,
        tierLabel: 'Sin cobros',
      );
  final double collectable;
  final double collected;
  final double percentageCollected;
  final bool thresholdMet;
  final double thresholdProgress;
  final int currentTier;
  final double commissionEarned;
  final String tierLabel;
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
      final cacheKey =
          'repartidor_summary_${repartidorId}_${year ?? 'current'}_${month ?? 'current'}';

      final response = await ApiClient.get(
        '/repartidor/collections/summary/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL:
            CacheService.shortTTL, // 5 minutes - collections change frequently
      );

      return CollectionsSummary.fromJson(response);
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar el resumen de cobros',
      );
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

      final cacheKey =
          'repartidor_daily_${repartidorId}_${year ?? 'current'}_${month ?? 'current'}';

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
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar el acumulado diario',
      );
    }
  }

  /// Obtener una página de clientes atendidos.
  static Future<HistoryClientsPage> getHistoryClients({
    required String repartidorId,
    String? search,
    int limit = 100,
    int offset = 0,
    bool forceRefresh = false,
  }) async {
    if (repartidorId.trim().isEmpty ||
        limit < 1 ||
        limit > 100 ||
        offset < 0 ||
        offset > 1000000) {
      throw const RepartidorDataException(
        'Parámetros de clientes no válidos',
      );
    }
    try {
      final normalizedRepartidorId = repartidorId.trim();
      final normalizedSearch = search?.trim();
      final searchScope = normalizedSearch == null || normalizedSearch.isEmpty
          ? 'all'
          : normalizedSearch;
      final queryParams = <String, String>{
        'limit': limit.toString(),
        'offset': offset.toString(),
      };
      if (normalizedSearch != null && normalizedSearch.isNotEmpty) {
        queryParams['search'] = normalizedSearch;
      }

      final cachePrefix =
          'repartidor_clients_${normalizedRepartidorId}_${searchScope}_';
      if (forceRefresh) {
        await CacheService.invalidateByPrefix(cachePrefix);
      }
      final cacheKey = '${cachePrefix}${limit}$offset';
      final response = await ApiClient.get(
        '/repartidor/history/clients/$normalizedRepartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.defaultTTL,
        forceRefresh: forceRefresh,
      );

      final clients = (response['clients'] as List? ?? [])
          .map(
            (client) => HistoryClient.fromJson(
              Map<String, dynamic>.from(client as Map),
            ),
          )
          .toList();
      final pagination = response['pagination'];
      final hasMore = pagination is Map && pagination['hasMore'] == true;
      return (clients: clients, hasMore: hasMore);
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar el historial de clientes',
      );
    }
  }

  /// Obtener documentos de un cliente
  static Future<List<HistoryDocument>> getClientDocuments({
    required String clientId,
    required String repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
    int limit = 100,
    int offset = 0,
  }) async {
    if (repartidorId.trim().isEmpty) {
      throw const RepartidorDataException('Falta el repartidor del historial');
    }
    if (limit < 1 || limit > 100 || offset < 0 || offset > 100) {
      throw const RepartidorDataException('Paginación de historial no válida');
    }
    try {
      final queryParams = <String, String>{
        'repartidorId': repartidorId,
        'limit': limit.toString(),
        'offset': offset.toString(),
      };
      if (dateFrom != null) queryParams['dateFrom'] = dateFrom;
      if (dateTo != null) queryParams['dateTo'] = dateTo;
      if (year != null) queryParams['year'] = year.toString();

      final cacheKey =
          'repartidor_docs_${clientId}_${repartidorId}_${year ?? 'multi'}_${dateFrom ?? ''}_${dateTo ?? ''}_${limit}_$offset';

      final response = await ApiClient.get(
        '/repartidor/history/documents/$clientId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15),
        forceRefresh: true,
      );

      final docs = (response['documents'] as List? ?? [])
          .map(
            (d) =>
                HistoryDocument.fromJson(Map<String, dynamic>.from(d as Map)),
          )
          .toList();

      return docs;
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar el historial de documentos',
      );
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

      final cacheKey =
          'repartidor_objectives_${repartidorId}_${clientId ?? 'all'}';

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
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudieron cargar los objetivos',
      );
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

      final cacheKey =
          'repartidor_objectives_detail_${repartidorId}_${year ?? 'current'}_${clientId ?? 'all'}';

      final response = await ApiClient.get(
        '/repartidor/history/objectives-detail/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.defaultTTL,
      );

      return response;
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar el desglose de ventas',
      );
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
        endpoint =
            '/repartidor/document/albaran/$year/$serie/$terminal/$number/pdf';
      } else {
        // For facturas: use factura-specific fields if available
        final fNum = facturaNumber ?? number;
        final fSerie = serieFactura ?? serie;
        final fYear = ejercicioFactura ?? year;
        // Build query params for albaran fallback
        final queryParams = <String, String>{};
        if (albaranNumber != null)
          queryParams['albaranNumber'] = albaranNumber.toString();
        if (albaranSerie != null) queryParams['albaranSerie'] = albaranSerie;
        if (albaranTerminal != null)
          queryParams['albaranTerminal'] = albaranTerminal.toString();
        if (albaranYear != null)
          queryParams['albaranYear'] = albaranYear.toString();
        final qs = queryParams.isNotEmpty
            ? '?${queryParams.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&')}'
            : '';
        endpoint = '/repartidor/document/invoice/$fYear/$fSerie/$fNum/pdf$qs';
      }

      final response = await ApiClient.getBytes(endpoint);
      return response;
    } on ApiException catch (error) {
      throw mapDocumentDownloadError(error);
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo descargar el documento',
      );
    }
  }

  @visibleForTesting
  static RepartidorDataException mapDocumentDownloadError(
    ApiException error,
  ) {
    final message = switch (error.statusCode) {
      401 =>
        'La sesión ha caducado. Inicia sesión para descargar el documento.',
      403 => 'No tienes permiso para descargar este documento.',
      404 => 'El documento ya no está disponible.',
      409 =>
        'El documento está cambiando. Actualiza el histórico antes de descargarlo.',
      503 => 'La descarga no está disponible temporalmente.',
      0
          when error.message.toLowerCase().contains('tardando') ||
              error.message.toLowerCase().contains('timeout') =>
        'La descarga ha superado el tiempo de espera.',
      0 => 'No se pudo conectar para descargar el documento.',
      _ => 'No se pudo descargar el documento.',
    };
    return RepartidorDataException(
      message,
      statusCode: error.statusCode,
      code: error.code,
    );
  }

  /// PDF de la nota de entrega canónica (líneas y firma persistidas).
  static Future<List<int>> downloadDeliveryNotePdf({
    required String confirmationId,
  }) async {
    try {
      final response = await ApiClient.get(
        RepartoCanonicalReceiptRequest(confirmationId).endpoint,
        forceRefresh: true,
        allowStale: false,
        receiveTimeout: const Duration(seconds: 20),
      );
      return base64Decode(RepartoReceiptPdf.fromResponse(response).base64);
    } on RepartoReceiptUnavailableException {
      throw const RepartidorDataException(
        'La nota de entrega no está disponible.',
        statusCode: 503,
      );
    } on ApiException catch (error) {
      throw mapDocumentDownloadError(error);
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo descargar la nota de entrega',
      );
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
        cacheKey:
            'repartidor_signature_${ejercicio}_${serie}_${terminal}_$numero',
        cacheTTL: const Duration(hours: 6),
      );

      if (response['signature'] != null) {
        return Map<String, dynamic>.from(response['signature'] as Map);
      }
      return null;
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar la firma',
      );
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

      final cacheKey =
          'repartidor_delivery_summary_${repartidorId}_${year ?? 'current'}_${month ?? 'current'}';

      final response = await ApiClient.get(
        '/repartidor/history/delivery-summary/$repartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 10),
      );

      return response;
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo cargar el resumen de entregas',
      );
    }
  }

  /// Enviar documento por email (Server-side)
  static Future<Map<String, dynamic>> sendEmail({
    required int year,
    required String serie,
    required int number,
    required String type, // 'factura' o 'albaran'
    required String destinatario,
    bool canEmailDocuments = false,
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
    if (canEmailDocuments != true) {
      throw const RepartidorDataException(
        'El envío por email no está habilitado.',
        statusCode: 503,
        code: 'EMAIL_DOCUMENT_CAPABILITY_REQUIRED',
      );
    }
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
      throw const RepartidorDataException(
        'El envío por email no está disponible',
      );
    } on ApiException catch (error) {
      // The backend must own delivery tracking. Never turn a 503 capability
      // response into a successful-looking email send or retry it blindly.
      if (error.statusCode == 503 &&
          error.code == 'EMAIL_DELIVERY_LEDGER_REQUIRED') {
        throw const RepartidorDataException(
          'Email delivery is unavailable until its delivery ledger is enabled.',
          statusCode: 503,
          code: 'EMAIL_DELIVERY_LEDGER_REQUIRED',
        );
      }
      throw RepartidorDataException(
        'Email delivery is unavailable.',
        statusCode: error.statusCode,
        code: error.code,
      );
    } catch (_) {
      throw const RepartidorDataException(
        'El envío por email no está disponible',
      );
    }
  }

  static Future<void> sendCommercialDocumentEmail({
    required String serie,
    required int numero,
    required int ejercicio,
    required String destinatario,
    String? documentType,
    int? terminal,
    String? clienteNombre,
  }) async {
    try {
      final response = await ApiClient.post('/facturas/send-email', {
        'serie': serie,
        'numero': numero,
        'ejercicio': ejercicio,
        'destinatario': destinatario,
        if (terminal != null) 'terminal': terminal,
        if (documentType != null) 'documentType': documentType,
        if (clienteNombre != null) 'clienteNombre': clienteNombre,
      });
      if (response['success'] == true) return;
      throw const RepartidorDataException(
        'El envío por email no está disponible',
      );
    } on RepartidorDataException {
      rethrow;
    } catch (_) {
      throw const RepartidorDataException(
        'El envío por email no está disponible',
      );
    }
  }

  static Future<void> emailDeliveryNote({
    required String confirmationId,
    required String destinatario,
  }) async {
    try {
      final response = await ApiClient.post(
        '/repartidor-finanzas/rutero/confirmations/$confirmationId/receipt/email',
        {'destinatario': destinatario},
      );
      if (response['success'] == true) return;
      throw const RepartidorDataException(
        'No se pudo enviar la nota de entrega',
      );
    } on RepartidorDataException {
      rethrow;
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo enviar la nota de entrega',
      );
    }
  }

  /// Requests permission to present the operating-system share sheet.
  /// This operation never means that GMP sent a WhatsApp message.
  static Future<LocalDocumentShare> shareWhatsApp({
    required int year,
    required String serie,
    required int number,
    required String type,
    required String telefono,
    String? clienteNombre,
    int terminal = 0,
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
      final response =
          await ApiClient.post('/repartidor/document/share/whatsapp', {
        'ejercicio': year,
        'serie': serie,
        'numero': number,
        'type': type,
        'telefono': telefono,
        'terminal': terminal,
        'clienteNombre': clienteNombre,
        'facturaNumber': facturaNumber,
        'serieFactura': serieFactura,
        'ejercicioFactura': ejercicioFactura,
        'albaranNumber': albaranNumber,
        'albaranSerie': albaranSerie,
        'albaranTerminal': albaranTerminal,
        'albaranYear': albaranYear,
      });

      final localShare = response['localShare'] == true;
      final sent = response['sent'] == true;
      if (response['success'] == true && localShare && !sent) {
        return const LocalDocumentShare(localShare: true, sent: false);
      }
      throw const RepartidorDataException(
        'No se pudo preparar el uso compartido local',
      );
    } on ApiException catch (error) {
      throw RepartidorDataException(
        'No se pudo preparar el uso compartido local.',
        statusCode: error.statusCode,
        code: error.code,
      );
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo preparar el uso compartido local',
      );
    }
  }

  /// Obtener evolución de ventas y productos top
  static Future<Map<String, dynamic>> getEvolution(String repartidorId) async {
    try {
      final response = await ApiClient.get(
        '/repartidor-finanzas/evolution/$repartidorId',
        cacheKey: 'repartidor_evolution_$repartidorId',
        cacheTTL: const Duration(hours: 1), // Long cache for evolution
      );
      return response;
    } catch (_) {
      throw const RepartidorDataException('No se pudo cargar la evolución');
    }
  }
}
