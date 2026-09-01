/// REPARTIDOR DATA SERVICE
/// Cliente de API para obtener datos de cobros, comisiones e histórico desde backend
/// OPTIMIZED: Full caching support with intelligent TTLs
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

typedef HistoryDocumentsPage = ({
  List<HistoryDocument> documents,
  bool hasMore,
});

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

/// Backend acknowledgement for WhatsApp delivery.
/// [localShare]=true means OS share sheet; [sent]=true means Cloud bot delivered.
class LocalDocumentShare {
  const LocalDocumentShare({
    required this.localShare,
    required this.sent,
    this.whatsappUrl,
    this.shareMode,
    this.messageId,
  });

  final bool localShare;
  final bool sent;

  /// Optional WhatsApp deep link; opening it never means the attachment was sent.
  final String? whatsappUrl;

  /// LOCAL_USER_ACTION | CLOUD_API
  final String? shareMode;
  final String? messageId;

  bool get deliveredByBot => sent && !localShare;
}

/// Complete recipient identity captured on a previous delivery for the same
/// client and driver. The API only returns a suggestion; the driver can edit
/// every field before confirming a different recipient.
class RepartoRecipientSuggestion {
  const RepartoRecipientSuggestion({
    required this.nombre,
    required this.apellidos,
    required this.dni,
  });

  factory RepartoRecipientSuggestion.fromJson(Map<String, dynamic> json) {
    return RepartoRecipientSuggestion(
      nombre: json['nombre']?.toString().trim() ?? '',
      apellidos: json['apellidos']?.toString().trim() ?? '',
      dni: json['dni']?.toString().trim().toUpperCase() ?? '',
    );
  }

  final String nombre;
  final String apellidos;
  final String dni;

  bool get isComplete =>
      nombre.isNotEmpty && apellidos.isNotEmpty && dni.isNotEmpty;
}

class RepartoReceiptEmailResult {
  const RepartoReceiptEmailResult({
    required this.success,
    required this.messageId,
    required this.ledgerWritten,
  });
  factory RepartoReceiptEmailResult.fromResponse(Map<String, dynamic> json) =>
      RepartoReceiptEmailResult(
        success: json['success'] == true,
        messageId: json['messageId']?.toString().trim() ?? '',
        ledgerWritten: json['ledgerWritten'] == true,
      );
  final bool success;
  final String messageId;
  final bool ledgerWritten;
  bool get delivered => success && messageId.isNotEmpty && ledgerWritten;
}

bool isValidRepartoReceiptEmailAddress(String value) =>
    RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value.trim());

String requireConcreteRepartoOwner(String? value) {
  if (value == null || !isValidRepartoOwnerId(value)) {
    throw const RepartidorDataException(
      'Selecciona un repartidor concreto.',
      statusCode: 422,
      code: 'REPARTIDOR_OWNER_REQUIRED',
    );
  }

  return value.trim();
}

@visibleForTesting
String repartoSignatureCacheKey({
  required String repartidorId,
  required int ejercicio,
  required String serie,
  required int terminal,
  required int numero,
}) =>
    'repartidor_signature_${repartidorId}_${ejercicio}_${serie}_${terminal}_$numero';

const Set<String> _repartoDeliveryReadCachePrefixes = <String>{
  'repartidor_docs_',
  'repartidor_clients_',
  'repartidor_signature_',
};

@visibleForTesting
Future<void> invalidateRepartoDeliveryReadCachesWith(
  Future<void> Function(String prefix) invalidateByPrefix,
) =>
    Future.wait<void>(
      _repartoDeliveryReadCachePrefixes.map(invalidateByPrefix),
    );

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
    this.collectionAvailability = 'COMPLETE',
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
      collectionAvailability:
          (json['collectionAvailability'] as String?)?.toUpperCase() ??
              'COMPLETE',
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
  final String collectionAvailability;

  bool get isPartial => collectionAvailability == 'PARTIAL';
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
    this.preparationOrderNumber,
    this.preparationOrderYear,
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
    this.cobroId,
    this.cobrado = false,
    this.importeCobrado,
    this.importePendienteCobro,
    this.formaPagoCobro,
    this.cobroParcial = false,
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

    double? asNullableDouble(dynamic value) {
      if (value == null) return null;
      if (value is num) return value.toDouble();
      return double.tryParse(value.toString());
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
      preparationOrderNumber: json['preparationOrderNumber'] == null
          ? null
          : asInt(json['preparationOrderNumber']),
      preparationOrderYear: json['preparationOrderYear'] == null
          ? null
          : asInt(json['preparationOrderYear']),
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
      cobroId: json['cobroId']?.toString(),
      cobrado: asBool(json['cobrado']),
      importeCobrado: asNullableDouble(json['importeCobrado']),
      importePendienteCobro: asNullableDouble(json['importePendienteCobro']),
      formaPagoCobro: json['formaPagoCobro']?.toString(),
      cobroParcial: asBool(json['cobroParcial']),
    );
  }
  final String id;
  final String type; // 'albaran' o 'factura'
  final int number;
  final int? albaranNumber;
  final int? facturaNumber;
  final String? serieFactura;
  final int? ejercicioFactura;
  final int? preparationOrderNumber;
  final int? preparationOrderYear;
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
  final String? cobroId;
  final bool cobrado;
  final double? importeCobrado;
  final double? importePendienteCobro;
  final String? formaPagoCobro;
  final bool cobroParcial;

  bool get hasAppCobro =>
      cobrado && (importeCobrado != null && importeCobrado! > 0.004);
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
  /// Returns true only when a canonical delivery note is genuinely absent.
  /// Callers must use this only for errors raised by a canonical-note request;
  /// a commercial document 404 must never be treated as a note fallback.
  static bool isDeliveryNoteNotFound(Object error) {
    if (error is RepartidorDataException) {
      return error.code == 'REPARTO_RECEIPT_NOT_FOUND';
    }
    if (error is ApiException) {
      return error.statusCode == 404 ||
          error.code == 'REPARTO_RECEIPT_NOT_FOUND';
    }
    return false;
  }

  @visibleForTesting
  static RepartidorDataException mapDeliveryNoteError(ApiException error) {
    final message = switch (error.statusCode) {
      401 => 'La sesión ha caducado. Inicia sesión para acceder a la nota.',
      403 => 'No tienes permiso para acceder a esta nota de entrega.',
      404 => 'La nota de entrega no existe para esta entrega.',
      409 =>
        'La entrega todavía no tiene un estado válido para emitir la nota.',
      422 => 'La identidad de la nota de entrega no es válida.',
      503 => 'La nota de entrega no está disponible temporalmente.',
      504 => 'La nota de entrega ha superado el tiempo de espera.',
      _ => 'No se pudo procesar la nota de entrega.',
    };
    return RepartidorDataException(
      message,
      statusCode: error.statusCode,
      code: error.code,
    );
  }

  /// Resolves one user action against the canonical note first. The commercial
  /// document is a fallback only when the canonical note is absent.
  static Future<T> resolveDeliveryNoteWithFallback<T>({
    required String? confirmationId,
    required Future<T> Function(String confirmationId) canonical,
    required Future<T> Function() commercial,
  }) async {
    final confirmation = confirmationId?.trim() ?? '';
    if (confirmation.isEmpty) return commercial();
    try {
      return await canonical(confirmation);
    } on ApiException catch (error) {
      if (isDeliveryNoteNotFound(error)) return commercial();
      rethrow;
    } on RepartidorDataException catch (error) {
      if (isDeliveryNoteNotFound(error)) return commercial();
      rethrow;
    }
  }

  /// Confirmation changes document state/signature, so stale history must not
  /// survive the server acknowledgement boundary.
  static Future<void> invalidateDeliveryReadCaches() async {
    try {
      await invalidateRepartoDeliveryReadCachesWith(
        CacheService.invalidateByPrefix,
      );
    } catch (error, stackTrace) {
      // A cache is an optimization: journal acknowledgement remains durable.
      debugPrint(
        '[RepartidorDataService] delivery cache invalidation failed: $error\n$stackTrace',
      );
    }
  }

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
    CancelToken? cancelToken,
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
      final cacheKey = '$cachePrefix$limit$offset';
      final response = await ApiClient.get(
        '/repartidor/history/clients/$normalizedRepartidorId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: CacheService.defaultTTL,
        forceRefresh: forceRefresh,
        cancelToken: cancelToken,
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

  /// Best-effort lookup used when opening a delivery. It is deliberately not
  /// cached for long: the previous recipient must be fresh after a delivery,
  /// while the request remains a single bounded read per opened client.
  static Future<RepartoRecipientSuggestion?> getRecipientSuggestion({
    required String clientCode,
    required String repartidorId,
  }) async {
    final client = clientCode.trim();
    final owner = requireConcreteRepartoOwner(repartidorId);
    if (client.isEmpty || client.length > 40) {
      throw const RepartidorDataException(
        'El cliente de la entrega no es válido.',
        statusCode: 422,
        code: 'CLIENTE_INVALID',
      );
    }

    final response = await ApiClient.get(
      '/repartidor/recipient-suggestion',
      queryParameters: <String, String>{
        'cliente': client,
        'repartidorId': owner,
      },
      cacheResponse: false,
      forceRefresh: true,
      allowStale: false,
      receiveTimeout: const Duration(seconds: 8),
    );
    final rawSuggestion = response['suggestion'];
    if (rawSuggestion is! Map) return null;
    final suggestion = RepartoRecipientSuggestion.fromJson(
      Map<String, dynamic>.from(rawSuggestion),
    );
    return suggestion.isComplete ? suggestion : null;
  }

  /// Obtener documentos de un cliente
  static Future<List<HistoryDocument>> getClientDocuments({
    required String clientId,
    required String repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
    int limit = 50,
    int offset = 0,
    CancelToken? cancelToken,
  }) async =>
      (await getClientDocumentsPage(
        clientId: clientId,
        repartidorId: repartidorId,
        dateFrom: dateFrom,
        dateTo: dateTo,
        year: year,
        limit: limit,
        offset: offset,
        cancelToken: cancelToken,
      ))
          .documents;

  static Future<HistoryDocumentsPage> getClientDocumentsPage({
    required String clientId,
    required String repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
    int limit = 50,
    int offset = 0,
    CancelToken? cancelToken,
  }) async {
    final owner = requireConcreteRepartoOwner(repartidorId);
    if (repartidorId.trim().isEmpty) {
      throw const RepartidorDataException('Falta el repartidor del historial');
    }
    if (limit < 1 || limit > 100 || offset < 0 || offset > 1000000) {
      throw const RepartidorDataException('Paginación de historial no válida');
    }
    try {
      // "Últimos 3 años" must never hit the unbounded CPC scan that timed
      // out at ~29s on production (503 REPARTIDOR_DOCUMENTS_FAILED).
      final resolvedDateFrom = dateFrom ??
          (year == null ? '${DateTime.now().year - 2}-01-01' : null);
      final queryParams = <String, String>{
        'repartidorId': owner,
        'limit': limit.toString(),
        'offset': offset.toString(),
      };
      if (resolvedDateFrom != null) queryParams['dateFrom'] = resolvedDateFrom;
      if (dateTo != null) queryParams['dateTo'] = dateTo;
      if (year != null) queryParams['year'] = year.toString();

      final cacheKey =
          'repartidor_docs_${clientId}_${owner}_${year ?? 'multi'}_${resolvedDateFrom ?? ''}_${dateTo ?? ''}_${limit}_$offset';

      final response = await ApiClient.get(
        '/repartidor/history/documents/$clientId',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15),
        forceRefresh: false,
        cancelToken: cancelToken,
        receiveTimeout: const Duration(seconds: 25),
      );

      final docs = (response['documents'] as List? ?? [])
          .map(
            (d) =>
                HistoryDocument.fromJson(Map<String, dynamic>.from(d as Map)),
          )
          .toList();

      final pagination = response['pagination'];
      final hasMore = pagination is Map && pagination['hasMore'] == true;
      return (documents: docs, hasMore: hasMore);
    } on ApiException catch (error) {
      if (error.statusCode == 503) {
        throw const RepartidorDataException(
          'El historial de documentos tarda demasiado. Prueba un año concreto.',
          statusCode: 503,
          code: 'REPARTIDOR_DOCUMENTS_FAILED',
        );
      }
      throw RepartidorDataException(
        'No se pudo cargar el historial de documentos',
        statusCode: error.statusCode,
        code: error.code,
      );
    } catch (error) {
      if (error is RepartidorDataException) rethrow;
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
    int limit = 100,
    int offset = 0,
  }) async {
    if (limit < 1 || limit > 100 || offset < 0) {
      throw const RepartidorDataException(
        'Paginacion de objetivos invalida',
        statusCode: 422,
      );
    }
    try {
      final queryParams = <String, String>{
        'limit': limit.toString(),
        'offset': offset.toString(),
      };
      if (year != null) queryParams['year'] = year.toString();
      if (clientId != null) queryParams['clientId'] = clientId;

      final cacheKey =
          'repartidor_objectives_detail_${repartidorId}_${year ?? 'current'}_${clientId ?? 'all'}_${limit}_$offset';

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
    String? repartidorId,
  }) async {
    requireConcreteRepartoOwner(repartidorId);
    final rawOwner = repartidorId;
    if (rawOwner != null && !isValidRepartoOwnerId(rawOwner)) {
      throw const RepartidorDataException(
        'Selecciona un repartidor concreto para el documento.',
        statusCode: 422,
      );
    }
    try {
      final ownerHint = rawOwner?.trim() ?? '';
      final String endpoint;
      if (type == 'albaran') {
        final qs = ownerHint.isEmpty
            ? ''
            : '?repartidorId=${Uri.encodeComponent(ownerHint)}';
        endpoint =
            '/repartidor/document/albaran/$year/$serie/$terminal/$number/pdf$qs';
      } else {
        // For facturas: use factura-specific fields if available
        final fNum = facturaNumber ?? number;
        final fSerie = serieFactura ?? serie;
        final fYear = ejercicioFactura ?? year;
        // Build query params for albaran fallback
        final queryParams = <String, String>{};
        if (albaranNumber != null) {
          queryParams['albaranNumber'] = albaranNumber.toString();
        }
        if (albaranSerie != null) queryParams['albaranSerie'] = albaranSerie;
        if (albaranTerminal != null) {
          queryParams['albaranTerminal'] = albaranTerminal.toString();
        }
        if (albaranYear != null) {
          queryParams['albaranYear'] = albaranYear.toString();
        }
        if (ownerHint.isNotEmpty) queryParams['repartidorId'] = ownerHint;
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
    required String repartidorId,
  }) async {
    final owner = requireConcreteRepartoOwner(repartidorId);
    try {
      final response = await ApiClient.get(
        RepartoCanonicalReceiptRequest(
          confirmationId,
          repartidorId: owner,
        ).endpoint,
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
    required String repartidorId,
  }) async {
    final owner = requireConcreteRepartoOwner(repartidorId);
    try {
      final response = await ApiClient.get(
        '/repartidor/history/signature',
        queryParameters: {
          'ejercicio': ejercicio.toString(),
          'serie': serie,
          'terminal': terminal.toString(),
          'numero': numero.toString(),
          'repartidorId': owner,
        },
        cacheKey: repartoSignatureCacheKey(
          repartidorId: owner,
          ejercicio: ejercicio,
          serie: serie,
          terminal: terminal,
          numero: numero,
        ),
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
    required String repartidorId,
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
    final email = destinatario.trim();
    final owner = repartidorId.trim();
    if (email.length > 180 ||
        !isValidRepartoReceiptEmailAddress(email) ||
        !isValidRepartoOwnerId(owner)) {
      throw const RepartidorDataException(
        'Email o repartidor no válido.',
        statusCode: 422,
      );
    }
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
        'destinatario': email,
        'repartidorId': owner,
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

      final messageId = response['messageId']?.toString().trim() ?? '';
      if (response['success'] != true || messageId.isEmpty) {
        throw const RepartidorDataException(
          'El proveedor no confirmó el envío.',
          statusCode: 503,
          code: 'DOCUMENT_EMAIL_MESSAGE_ID_REQUIRED',
        );
      }
      if (response['ledgerWritten'] != true) {
        throw const RepartidorDataException(
          'El envío no quedó registrado.',
          statusCode: 503,
          code: 'EMAIL_DELIVERY_LEDGER_REQUIRED',
        );
      }
      return response;
    } on RepartidorDataException {
      rethrow;
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

  static Future<RepartoReceiptEmailResult> emailDeliveryNote({
    required String confirmationId,
    required String destinatario,
    required String repartidorId,
  }) async {
    final email = destinatario.trim();
    final owner = repartidorId.trim();
    final confirmation = confirmationId.trim();
    if (email.length > 180 ||
        !isValidRepartoReceiptEmailAddress(email) ||
        !isValidRepartoOwnerId(owner) ||
        !isValidRepartoServerId(confirmation)) {
      throw const RepartidorDataException(
        'Invalid email or delivery owner.',
        statusCode: 422,
        code: 'REPARTO_RECEIPT_INVALID_LOOKUP',
      );
    }
    try {
      final response = await ApiClient.post(
        '/repartidor-finanzas/rutero/confirmations/$confirmation/receipt/email',
        {'destinatario': email, 'repartidorId': owner},
      );
      final result = RepartoReceiptEmailResult.fromResponse(response);
      if (result.delivered) return result;
      throw const RepartidorDataException(
        'Receipt email was not fully acknowledged.',
        code: 'EMAIL_DELIVERY_LEDGER_REQUIRED',
      );
    } on RepartidorDataException {
      rethrow;
    } on ApiException catch (error) {
      throw mapDeliveryNoteError(error);
    } catch (_) {
      throw const RepartidorDataException('Receipt email delivery failed.');
    }
  }

  /// Requests WhatsApp delivery of the canonical delivery-note PDF.
  /// A local result means the caller must attach the PDF and open [whatsappUrl].
  static Future<LocalDocumentShare> shareDeliveryNoteViaWhatsApp({
    required String confirmationId,
    required String telefono,
    required String repartidorId,
    String? clienteNombre,
    String? mensaje,
  }) async {
    final owner = repartidorId.trim();
    final confirmation = confirmationId.trim();
    if (!isValidRepartoOwnerId(owner) ||
        !isValidRepartoServerId(confirmation)) {
      throw const RepartidorDataException(
        'La entrega no tiene una identidad canónica válida.',
        statusCode: 422,
        code: 'REPARTO_RECEIPT_INVALID_LOOKUP',
      );
    }
    try {
      final response = await ApiClient.post(
        '/repartidor-finanzas/rutero/confirmations/$confirmation/receipt/whatsapp',
        {
          'telefono': telefono,
          'repartidorId': owner,
          if (clienteNombre != null) 'clienteNombre': clienteNombre,
          if (mensaje != null && mensaje.trim().isNotEmpty)
            'mensaje': mensaje.trim(),
        },
      );
      final localShare = response['localShare'] == true;
      final sent = response['sent'] == true;
      if (response['success'] == true && sent && !localShare) {
        return LocalDocumentShare(
          localShare: false,
          sent: true,
          shareMode: response['shareMode']?.toString() ?? 'BOT_GATEWAY',
          messageId: response['messageId']?.toString(),
        );
      }
      if (response['success'] == true && localShare && !sent) {
        final url = response['whatsappUrl']?.toString().trim();
        return LocalDocumentShare(
          localShare: true,
          sent: false,
          whatsappUrl: url == null || url.isEmpty ? null : url,
          shareMode: response['shareMode']?.toString() ?? 'LOCAL_USER_ACTION',
        );
      }
      throw const RepartidorDataException(
        'No se pudo preparar el envío de la nota por WhatsApp.',
      );
    } on RepartidorDataException {
      rethrow;
    } on ApiException catch (error) {
      if (error.code == 'WHATSAPP_BAILEYS_NOT_PAIRED') {
        throw const RepartidorDataException(
          'WhatsApp corporativo no vinculado. Un jefe debe emparejar el móvil de empresa (QR).',
          statusCode: 503,
          code: 'WHATSAPP_BAILEYS_NOT_PAIRED',
        );
      }
      throw RepartidorDataException(
        'No se pudo preparar el envío de la nota por WhatsApp.',
        statusCode: error.statusCode,
        code: error.code,
      );
    }
  }

  /// Requests WhatsApp delivery.
  /// When Cloud API is configured server-side, returns [LocalDocumentShare.deliveredByBot].
  /// Otherwise returns a local share intent (OS sheet) — never implies GMP sent the message.
  static Future<LocalDocumentShare> shareWhatsApp({
    required int year,
    required String serie,
    required int number,
    required String type,
    required String telefono,
    required String repartidorId,
    String? clienteNombre,
    String? mensaje,
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
    final owner = repartidorId.trim();
    if (!isValidRepartoOwnerId(owner)) {
      throw const RepartidorDataException(
        'Selecciona un repartidor concreto para compartir.',
        statusCode: 422,
      );
    }
    try {
      final response =
          await ApiClient.post('/repartidor/document/share/whatsapp', {
        'ejercicio': year,
        'serie': serie,
        'numero': number,
        'type': type,
        'telefono': telefono,
        'terminal': terminal,
        'repartidorId': owner,
        'clienteNombre': clienteNombre,
        if (mensaje != null && mensaje.trim().isNotEmpty)
          'mensaje': mensaje.trim(),
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
      final shareMode = response['shareMode']?.toString();
      final messageId = response['messageId']?.toString();

      if (response['success'] == true && sent && !localShare) {
        return LocalDocumentShare(
          localShare: false,
          sent: true,
          shareMode: shareMode ?? 'BOT_GATEWAY',
          messageId: messageId,
        );
      }

      if (response['success'] == true && localShare && !sent) {
        final url = response['whatsappUrl']?.toString().trim();
        return LocalDocumentShare(
          localShare: true,
          sent: false,
          whatsappUrl: url == null || url.isEmpty ? null : url,
          shareMode: shareMode ?? 'LOCAL_USER_ACTION',
        );
      }
      throw const RepartidorDataException(
        'No se pudo preparar el envío por WhatsApp.',
      );
    } on ApiException catch (error) {
      if (error.code == 'WHATSAPP_BAILEYS_NOT_PAIRED') {
        throw const RepartidorDataException(
          'WhatsApp corporativo no vinculado. Un jefe debe emparejar el móvil de empresa (QR).',
          statusCode: 503,
          code: 'WHATSAPP_BAILEYS_NOT_PAIRED',
        );
      }
      throw RepartidorDataException(
        'No se pudo preparar el envío por WhatsApp.',
        statusCode: error.statusCode,
        code: error.code,
      );
    } catch (_) {
      throw const RepartidorDataException(
        'No se pudo preparar el envío por WhatsApp.',
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
