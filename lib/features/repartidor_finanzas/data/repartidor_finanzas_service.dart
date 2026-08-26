// ignore_for_file: public_member_api_docs

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

typedef OfflineFinancePost = Future<Map<String, dynamic>> Function(
  String endpoint,
  Map<String, dynamic> data, {
  String? syncType,
  String? cacheKey,
});
typedef PendingFinanceOperations = List<SyncOperation> Function();
typedef EnqueueFinanceOperation = Future<void> Function(
  SyncOperation operation,
);

class LiquidacionTransportResponse {
  const LiquidacionTransportResponse({
    required this.statusCode,
    required this.body,
  });

  final int statusCode;
  final Map<String, dynamic> body;
}

typedef LiquidacionPost = Future<LiquidacionTransportResponse> Function(
  String endpoint,
  Map<String, dynamic> data,
);
typedef LiquidacionGet = Future<Map<String, dynamic>> Function(
  String endpoint, {
  Map<String, String>? queryParameters,
});

class RepartidorLiquidacionInputException implements Exception {
  const RepartidorLiquidacionInputException(this.code, this.message);
  final String code;
  final String message;
  @override
  String toString() => 'RepartidorLiquidacionInputException($code)';
}

/// Immutable PDF returned by the server for a closed daily settlement.
class RepartidorLiquidacionPdf {
  const RepartidorLiquidacionPdf({
    required this.bytes,
    required this.fileName,
  });

  final Uint8List bytes;
  final String fileName;
}

class RepartidorFinanzasService {
  RepartidorFinanzasService({
    OfflineFinancePost? offlinePost,
    PendingFinanceOperations? pendingOperations,
    EnqueueFinanceOperation? enqueueOperation,
    LiquidacionPost? liquidacionPost,
    LiquidacionGet? liquidacionGet,
  })  : _offlinePost = offlinePost ?? OfflineAwareApi.post,
        _pendingOperations =
            pendingOperations ?? (() => SyncQueueService.instance.pending),
        _enqueueOperation =
            enqueueOperation ?? SyncQueueService.instance.enqueue,
        _liquidacionPost = liquidacionPost ?? _postLiquidacion,
        _liquidacionGet = liquidacionGet ?? (ApiClient.get);

  static const _prefix = 'repartidor_finanzas';
  static const _vencimientoCobroEndpoint = '/repartidor-finanzas/cobros';

  final OfflineFinancePost _offlinePost;
  final PendingFinanceOperations _pendingOperations;
  final EnqueueFinanceOperation _enqueueOperation;
  final LiquidacionPost _liquidacionPost;
  final LiquidacionGet _liquidacionGet;
  final Set<String> _vencimientoSubmissionsInFlight = <String>{};
  final Map<
      String,
      ({
        String fingerprint,
        Future<RepartidorLiquidacionEntryResult> future
      })> _liquidacionEntrySubmissionsInFlight = {};

  static Future<LiquidacionTransportResponse> _postLiquidacion(
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await ApiClient.dio.post<dynamic>(
        endpoint,
        data: data,
        options: Options(extra: const <String, dynamic>{'idempotent': true}),
      );
      if (response.statusCode == null || response.data is! Map) {
        throw const RepartidorLiquidacionContractException(
          'LIQUIDACION_TRANSPORT_RESPONSE_INVALID',
          'Respuesta de transporte de liquidacion invalida',
        );
      }
      return LiquidacionTransportResponse(
        statusCode: response.statusCode!,
        body: Map<String, dynamic>.from(response.data as Map),
      );
    } on DioException catch (error) {
      throw _mapLiquidacionTransportError(error);
    }
  }

  static ApiException _mapLiquidacionTransportError(DioException error) {
    final statusCode = error.response?.statusCode;
    if (statusCode != null && statusCode > 0) {
      return ApiException(
        switch (statusCode) {
          409 => 'Conflicto con el estado actual de la liquidacion.',
          >= 500 => 'El servidor no puede procesar la liquidacion ahora.',
          _ => 'La liquidacion no se ha podido procesar.',
        },
        statusCode: statusCode,
        code: switch (statusCode) {
          409 => 'LIQUIDACION_CONFLICT',
          >= 500 => 'LIQUIDACION_SERVER_UNAVAILABLE',
          _ => 'LIQUIDACION_HTTP_ERROR',
        },
      );
    }
    return switch (error.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.sendTimeout =>
        ApiException(
          'La solicitud de liquidacion ha agotado el tiempo de espera.',
          statusCode: 0,
          code: 'LIQUIDACION_TIMEOUT',
        ),
      DioExceptionType.cancel => ApiException(
          'La solicitud de liquidacion se ha cancelado.',
          statusCode: 0,
          code: 'LIQUIDACION_CANCELLED',
        ),
      _ => ApiException(
          'No se ha podido conectar para registrar la liquidacion.',
          statusCode: 0,
          code: 'LIQUIDACION_NETWORK',
        ),
    };
  }

  static String _isoDate(DateTime value) {
    // Calendar date in local components — never UTC-shift via toIso8601String.
    final year = value.year.toString().padLeft(4, '0');
    final month = value.month.toString().padLeft(2, '0');
    final day = value.day.toString().padLeft(2, '0');
    return '$year-$month-$day';
  }

  static String dailyLiquidacionCacheKey(String repartidorId, String date) =>
      '${_prefix}_liquidacion_${repartidorId}_$date';

  static String monthlyLiquidacionSummaryCacheKey(
    String repartidorId,
    int year,
    int month,
  ) =>
      '${_prefix}_monthly_liquidacion_${repartidorId}_${year}_$month';

  static String vencimientosCacheKey({
    required String repartidorId,
    required String from,
    required String to,
    required int limit,
    String? cursor,
    String? clientCode,
    String? search,
    String? estado,
  }) =>
      '${_prefix}_vencimientos_${repartidorId}_${from}_$to'
      '_${clientCode ?? 'all'}_${search ?? 'all'}_${estado ?? 'all'}_${limit}_'
      '${cursor ?? 'first'}';

  static String evolutionCacheKey(String repartidorId) =>
      '${_prefix}_evolution_$repartidorId';

  static String commissionSummaryCacheKey({
    required String repartidorId,
    required String from,
    required String to,
  }) =>
      '${_prefix}_commission_summary_${repartidorId}_${from}_$to';

  static const commissionTiersCacheKey = '${_prefix}_commission_tiers';

  static String collectionSummaryCacheKey(
    String repartidorId,
    int? year,
    int? month,
  ) =>
      '${_prefix}_summary_${repartidorId}_${year ?? 'current'}_'
      '${month ?? 'current'}';

  static String dailyCollectionsCacheKey(
    String repartidorId,
    int? year,
    int? month,
  ) =>
      '${_prefix}_daily_${repartidorId}_${year ?? 'current'}_'
      '${month ?? 'current'}';

  static String historyClientsCacheKey(String repartidorId, String? search) =>
      '${_prefix}_clients_${repartidorId}_${search ?? 'all'}';

  static String clientDocumentsCacheKey({
    required String clientId,
    String? repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
  }) =>
      '${_prefix}_docs_${clientId}_${repartidorId ?? 'all'}_'
      '${year ?? 'multi'}_${dateFrom ?? ''}_${dateTo ?? ''}';

  static String monthlyObjectivesCacheKey({
    required String repartidorId,
    String? clientId,
  }) =>
      '${_prefix}_objectives_${repartidorId}_${clientId ?? 'all'}';

  static String objectivesDetailCacheKey({
    required String repartidorId,
    required int limit,
    required int offset,
    int? year,
    String? clientId,
  }) =>
      '${_prefix}_objectives_detail_${repartidorId}_${year ?? 'current'}_'
      '${clientId ?? 'all'}_${limit}_$offset';

  static String deliverySummaryCacheKey(
    String repartidorId,
    int? year,
    int? month,
  ) =>
      '${_prefix}_delivery_${repartidorId}_${year ?? 'current'}_'
      '${month ?? 'current'}';

  Future<RepartidorCollectionSummary> getCollectionSummary({
    required String repartidorId,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) async {
    final queryParams = <String, dynamic>{
      if (year != null) 'year': year.toString(),
      if (month != null) 'month': month.toString(),
    };
    final cacheKey = collectionSummaryCacheKey(repartidorId, year, month);

    final result = await OfflineAwareApi.get(
      '/repartidor/collections/summary/$repartidorId',
      queryParameters: queryParams,
      cacheKey: cacheKey,
      cacheTTL: CacheService.shortTTL,
      forceRefresh: forceRefresh,
    );

    return RepartidorCollectionSummary.fromJson(result.data);
  }

  Future<RepartidorMonthlySummary> getMonthlySummary({
    required String repartidorId,
    required int year,
    required int month,
    bool forceRefresh = false,
  }) async {
    final result = await OfflineAwareApi.get(
      '/repartidor-finanzas/summary/$repartidorId',
      queryParameters: {
        'year': year.toString(),
        'month': month.toString(),
      },
      cacheKey: monthlyLiquidacionSummaryCacheKey(
        repartidorId,
        year,
        month,
      ),
      cacheTTL: CacheService.shortTTL,
      forceRefresh: forceRefresh,
    );
    return RepartidorMonthlySummary.fromJson(result.data);
  }

  Future<RepartidorDailySummary> getDailySummary({
    required String repartidorId,
    required DateTime date,
    bool forceRefresh = false,
  }) async {
    final isoDate = _isoDate(date);
    final cacheKey = dailyLiquidacionCacheKey(repartidorId, isoDate);

    // Offline-first: try cache first, then network, fall back to stale
    final result = await OfflineAwareApi.get(
      '/repartidor-finanzas/daily-summary/$repartidorId',
      queryParameters: {'date': isoDate},
      cacheKey: cacheKey,
      cacheTTL: const Duration(minutes: 2),
      forceRefresh: forceRefresh,
    );

    final summary = RepartidorDailySummary.fromJson(result.data);
    return summary;
  }

  Future<RepartidorLiquidacionResult> closeLiquidacion({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  }) async {
    final payload = <String, dynamic>{
      'repartidorId': repartidorId,
      'date': _isoDate(date),
      'idempotencyToken': idempotencyToken,
      'sendEmails': sendEmails,
      if (matricula != null && matricula.trim().isNotEmpty)
        'matricula': matricula.trim(),
      if (codigoVehiculo != null && codigoVehiculo.trim().isNotEmpty)
        'codigoVehiculo': codigoVehiculo.trim(),
    };
    // A daily close cannot be queued: it changes financial state and the
    // caller must receive a verified created/replay response before success.
    final response = await _liquidacionPost(
      '/repartidor-finanzas/liquidaciones',
      payload,
    );
    if (response.body['queued'] == true) {
      throw const FormatException(
        'La liquidacion requiere confirmacion del servidor',
      );
    }

    _validateLiquidacionTransport(
      response,
      created: response.body['created'],
    );
    final result = RepartidorLiquidacionResult.fromJson(response.body);
    await invalidateAllForRepartidor(repartidorId);
    return result;
  }

  /// Retrieves the immutable server PDF for an already closed settlement.
  Future<RepartidorLiquidacionPdf> getClosedLiquidacionPdf({
    required RepartidorLiquidacionResult liquidacion,
    required String idempotencyToken,
  }) async {
    final resultId = liquidacion.id.trim();
    final token = idempotencyToken.trim();
    final repartidorId = liquidacion.repartidorId.trim();
    final date = liquidacion.date.trim();
    if (resultId.isEmpty ||
        !RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(token) ||
        liquidacion.status != 'CLOSED' ||
        !RegExp(r'^\d{1,20}$').hasMatch(repartidorId) ||
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date)) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_PDF_IDENTITY_INVALID',
        'La liquidacion cerrada no tiene una identidad valida para su PDF',
      );
    }

    final response = await _liquidacionGet(
      '/repartidor-finanzas/liquidaciones/'
      '${Uri.encodeComponent(token)}/pdf',
      queryParameters: {'repartidorId': repartidorId},
    );
    final returnedId = response['liquidacionId']?.toString().trim();
    final returnedRepartidor = response['repartidorId']?.toString().trim();
    final returnedDate = response['date']?.toString().trim();
    final returnedStatus = response['status']?.toString().trim().toUpperCase();
    final encoded = response['pdfBase64'];
    if (response['success'] != true ||
        returnedId != resultId ||
        returnedRepartidor != repartidorId ||
        returnedDate != date ||
        returnedStatus != 'CLOSED' ||
        encoded is! String ||
        encoded.isEmpty ||
        encoded.length > 20000000) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_PDF_RESPONSE_INVALID',
        'El servidor devolvio un PDF de liquidacion incompleto o no verificable',
      );
    }

    Uint8List bytes;
    try {
      bytes = Uint8List.fromList(base64Decode(encoded));
    } on FormatException {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_PDF_BASE64_INVALID',
        'El contenido del PDF de liquidacion no es valido',
      );
    }
    if (bytes.length < 5 ||
        bytes[0] != 0x25 ||
        bytes[1] != 0x50 ||
        bytes[2] != 0x44 ||
        bytes[3] != 0x46 ||
        bytes[4] != 0x2d) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_PDF_SIGNATURE_INVALID',
        'El servidor no devolvio un documento PDF valido',
      );
    }

    final requestedFileName = response['fileName']?.toString().trim() ?? '';
    final fileName =
        RegExp(r'^[A-Za-z0-9_.-]{1,120}\.pdf$').hasMatch(requestedFileName)
            ? requestedFileName
            : 'Liquidacion_$resultId.pdf';
    return RepartidorLiquidacionPdf(bytes: bytes, fileName: fileName);
  }

  Future<RepartidorLiquidacionLedger> getLiquidacionLedger({
    required String repartidorId,
    required DateTime date,
  }) async {
    _validateLiquidacionIdentity(repartidorId, date);
    FormatException? lastError;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final response = await _liquidacionGet(
          '/repartidor-finanzas/liquidaciones/$repartidorId/desglose',
          queryParameters: {'date': _isoDate(date)},
        );
        final ledger = response['ledger'];
        if (response['success'] != true || ledger is! Map) {
          throw const FormatException(
            'Respuesta de desglose de liquidacion invalida',
          );
        }
        return RepartidorLiquidacionLedger.fromJson(
          Map<String, dynamic>.from(ledger),
          expectedRepartidorId: repartidorId,
          expectedDate: _isoDate(date),
        );
      } catch (error) {
        lastError = error is FormatException
            ? error
            : FormatException(error.toString());
        if (attempt == 1) {
          if (error is FormatException) rethrow;
          throw lastError;
        }
        await Future<void>.delayed(const Duration(milliseconds: 400));
      }
    }
    throw lastError ??
        const FormatException('Respuesta de desglose de liquidacion invalida');
  }

  Future<RepartidorLiquidacionEntryResult> createLiquidacionExpense({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String category,
    required String idempotencyToken,
    String? observation,
  }) =>
      _createLiquidacionEntry(
        endpoint: '/repartidor-finanzas/liquidaciones/gastos',
        repartidorId: repartidorId,
        date: date,
        amount: amount,
        idempotencyToken: idempotencyToken,
        detailKey: 'category',
        detail: category,
        observation: observation,
        type: 'EXPENSE',
      );

  Future<RepartidorLiquidacionEntryResult> createLiquidacionAdjustment({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String reason,
    required String idempotencyToken,
    String? observation,
  }) =>
      _createLiquidacionEntry(
        endpoint: '/repartidor-finanzas/liquidaciones/ajustes',
        repartidorId: repartidorId,
        date: date,
        amount: amount,
        idempotencyToken: idempotencyToken,
        detailKey: 'reason',
        detail: reason,
        observation: observation,
        type: 'ADJUSTMENT',
      );

  Future<RepartidorLiquidacionEntryResult> createLiquidacionBankDeposit({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String reference,
    required String idempotencyToken,
    String? observation,
  }) =>
      _createLiquidacionEntry(
        endpoint: '/repartidor-finanzas/liquidaciones/ingresos-bancarios',
        repartidorId: repartidorId,
        date: date,
        amount: amount,
        idempotencyToken: idempotencyToken,
        detailKey: 'reference',
        detail: reference,
        observation: observation,
        type: 'BANK_DEPOSIT',
      );

  Future<RepartidorLiquidacionEntryResult> _createLiquidacionEntry({
    required String endpoint,
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String idempotencyToken,
    required String detailKey,
    required String detail,
    required String type,
    String? observation,
  }) async {
    final isoDate = _validateLiquidacionIdentity(repartidorId, date);
    final detailLimit = switch (type) {
      'EXPENSE' => 40,
      'ADJUSTMENT' => 120,
      'BANK_DEPOSIT' => 80,
      _ => 0,
    };
    final normalizedDetail = detail.trim();
    final normalizedObservation = observation?.trim();
    final validSign = type == 'ADJUSTMENT' ? amount != 0 : amount > 0;
    if (detailLimit == 0 ||
        !amount.isFinite ||
        !validSign ||
        amount.abs() > 99999999 ||
        ((amount * 100).round() - amount * 100).abs() > 0.000001 ||
        normalizedDetail.isEmpty ||
        normalizedDetail.length > detailLimit) {
      throw const RepartidorLiquidacionInputException(
        'INVALID_LIQUIDACION_ENTRY',
        'Importe o detalle de liquidacion invalido',
      );
    }
    if (normalizedObservation != null &&
        (normalizedObservation.isEmpty || normalizedObservation.length > 250)) {
      throw const RepartidorLiquidacionInputException(
        'INVALID_LIQUIDACION_OBSERVATION',
        'Observacion de liquidacion invalida',
      );
    }
    if (!RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(idempotencyToken)) {
      throw const RepartidorLiquidacionInputException(
        'INVALID_LIQUIDACION_IDEMPOTENCY_TOKEN',
        'Token de idempotencia invalido',
      );
    }
    final payload = <String, dynamic>{
      'repartidorId': repartidorId,
      'date': isoDate,
      'amount': amount,
      'idempotencyToken': idempotencyToken,
      detailKey: normalizedDetail,
      if (normalizedObservation != null) 'observation': normalizedObservation,
    };
    final fingerprint = buildLiquidacionEntryFingerprint(
      repartidorId,
      date,
      type,
      amount: amount,
      detail: normalizedDetail,
      observation: normalizedObservation,
    );
    final active = _liquidacionEntrySubmissionsInFlight[idempotencyToken];
    if (active != null) {
      if (active.fingerprint != fingerprint) {
        throw const RepartidorLiquidacionInputException(
          'LIQUIDACION_LOCAL_IDEMPOTENCY_MISMATCH',
          'El token activo pertenece a otro movimiento',
        );
      }
      return active.future;
    }
    final future = _submitLiquidacionEntry(
      endpoint: endpoint,
      payload: payload,
      type: type,
      repartidorId: repartidorId,
      isoDate: isoDate,
    );
    _liquidacionEntrySubmissionsInFlight[idempotencyToken] = (
      fingerprint: fingerprint,
      future: future,
    );
    try {
      return await future;
    } finally {
      final current = _liquidacionEntrySubmissionsInFlight[idempotencyToken];
      if (identical(current?.future, future)) {
        _liquidacionEntrySubmissionsInFlight.remove(idempotencyToken);
      }
    }
  }

  Future<RepartidorLiquidacionEntryResult> _submitLiquidacionEntry({
    required String endpoint,
    required Map<String, dynamic> payload,
    required String type,
    required String repartidorId,
    required String isoDate,
  }) async {
    final response = await _liquidacionPost(endpoint, payload);
    _validateLiquidacionTransport(
      response,
      created: response.body['created'],
    );
    final result = RepartidorLiquidacionEntryResult.fromJson(
      response.body,
      expectedType: type,
      expectedRepartidorId: repartidorId,
      expectedDate: isoDate,
    );
    await invalidateAllForRepartidor(repartidorId);
    return result;
  }

  static void _validateLiquidacionTransport(
    LiquidacionTransportResponse response, {
    required Object? created,
  }) {
    final isExpected = (response.statusCode == 201 && created == true) ||
        (response.statusCode == 200 && created == false);
    if (!isExpected) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_TRANSPORT_STATUS_MISMATCH',
        'Estado HTTP y created de liquidacion no coinciden',
      );
    }
  }

  static String _validateLiquidacionIdentity(
    String repartidorId,
    DateTime date,
  ) {
    final normalizedId = repartidorId.trim();
    final isoDate = _isoDate(date);
    final parsed = DateTime.tryParse('${isoDate}T00:00:00.000Z');
    if (normalizedId != repartidorId ||
        !RegExp(r'^\d{1,20}$').hasMatch(normalizedId) ||
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(isoDate) ||
        parsed == null ||
        parsed.toIso8601String().substring(0, 10) != isoDate) {
      throw const RepartidorLiquidacionInputException(
        'INVALID_LIQUIDACION_IDENTITY',
        'Repartidor o fecha de liquidacion invalido',
      );
    }
    return isoDate;
  }

  Future<RepartidorVencimientosBatch> getVencimientos({
    required String repartidorId,
    required DateTime from,
    required DateTime to,
    String? clientCode,
    String? search,
    String? estado,
    String? cursor,
    int limit = 50,
    bool forceRefresh = false,
  }) async {
    if (to.isBefore(from)) {
      throw ArgumentError.value(to, 'to', 'Debe ser igual o posterior a from');
    }
    final boundedLimit = limit.clamp(1, 100);
    final fromIso = _isoDate(from);
    final toIso = _isoDate(to);
    final response = await ApiClient.get(
      '/repartidor-finanzas/vencimientos/$repartidorId',
      queryParameters: {
        'from': fromIso,
        'to': toIso,
        'limit': boundedLimit.toString(),
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
        if (clientCode != null && clientCode.isNotEmpty)
          'clientCode': clientCode,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (estado != null && estado.isNotEmpty) 'estado': estado,
      },
      cacheKey: vencimientosCacheKey(
        repartidorId: repartidorId,
        from: fromIso,
        to: toIso,
        limit: boundedLimit,
        cursor: cursor,
        clientCode: clientCode,
        search: search,
        estado: estado,
      ),
      cacheTTL: const Duration(minutes: 2),
      forceRefresh: forceRefresh,
    );

    return RepartidorVencimientosBatch.fromJson(response);
  }

  PendingVencimientoCobroIntent? findPendingVencimientoCobro({
    required String repartidorId,
    required String codigoCliente,
    required String tipoDocumento,
    required JsonMap keys,
  }) {
    final expectedPayload = _buildVencimientoCobroPayload(
      repartidorId: repartidorId,
      codigoCliente: codigoCliente,
      nombreCliente: '',
      tipoDocumento: tipoDocumento,
      documento: '',
      keys: keys,
      importeCobrado: 0,
      importePendiente: 0,
      formaPago: '',
      idempotencyToken: '',
    );
    final obligationKey = _vencimientoObligationKey(expectedPayload);
    for (final operation in _pendingOperations()) {
      if (operation.type != 'register_cobro' ||
          operation.endpoint != _vencimientoCobroEndpoint ||
          _vencimientoObligationKey(operation.payload) != obligationKey) {
        continue;
      }
      final token = operation.payload['idempotencyToken']?.toString().trim();
      if (token == null || token.isEmpty) continue;
      return PendingVencimientoCobroIntent(
        idempotencyToken: token,
        syncId: operation.id,
        requiresManualReview: operation.isFailed,
      );
    }
    return null;
  }

  Future<VencimientoCobroSubmissionResult> registerVencimientoCobro({
    required String repartidorId,
    required String codigoCliente,
    required String nombreCliente,
    required String tipoDocumento,
    required String documento,
    required JsonMap keys,
    required double importeCobrado,
    required double importePendiente,
    required String formaPago,
    required String idempotencyToken,
  }) async {
    final payload = _buildVencimientoCobroPayload(
      repartidorId: repartidorId,
      codigoCliente: codigoCliente,
      nombreCliente: nombreCliente,
      tipoDocumento: tipoDocumento,
      documento: documento,
      keys: keys,
      importeCobrado: importeCobrado,
      importePendiente: importePendiente,
      formaPago: formaPago,
      idempotencyToken: idempotencyToken,
    );
    final obligationKey = _vencimientoObligationKey(payload);
    final existing = findPendingVencimientoCobro(
      repartidorId: repartidorId,
      codigoCliente: codigoCliente,
      tipoDocumento: tipoDocumento,
      keys: keys,
    );
    if (existing != null) {
      return VencimientoCobroSubmissionResult(
        state: existing.requiresManualReview
            ? VencimientoCobroSubmissionState.manualReview
            : VencimientoCobroSubmissionState.alreadyPending,
        idempotencyToken: existing.idempotencyToken,
        syncId: existing.syncId,
      );
    }
    if (!_vencimientoSubmissionsInFlight.add(obligationKey)) {
      return VencimientoCobroSubmissionResult(
        state: VencimientoCobroSubmissionState.inFlight,
        idempotencyToken: idempotencyToken,
      );
    }

    try {
      final response = await _offlinePost(
        _vencimientoCobroEndpoint,
        payload,
        syncType: 'register_cobro',
      );
      final queued = response['queued'] == true;
      if (!queued) {
        await invalidateAllForRepartidor(repartidorId);
      }
      return VencimientoCobroSubmissionResult(
        state: queued
            ? VencimientoCobroSubmissionState.queued
            : VencimientoCobroSubmissionState.confirmed,
        idempotencyToken: idempotencyToken,
        syncId: response['syncId']?.toString(),
      );
    } on ApiException catch (error) {
      if (error.statusCode == 409) {
        final now = DateTime.now();
        final failedPayload = Map<String, dynamic>.from(payload)
          ..putIfAbsent('clientRequestId', () => idempotencyToken);
        await _enqueueOperation(
          SyncOperation(
            id: 'review_$idempotencyToken',
            type: 'register_cobro',
            endpoint: _vencimientoCobroEndpoint,
            method: 'POST',
            payload: failedPayload,
            attempts: 1,
            createdAt: now,
            failedAt: now,
            lastError: 'HTTP 409: requiere revision manual',
          ),
        );
      }
      rethrow;
    } finally {
      _vencimientoSubmissionsInFlight.remove(obligationKey);
    }
  }

  static Map<String, dynamic> _buildVencimientoCobroPayload({
    required String repartidorId,
    required String codigoCliente,
    required String nombreCliente,
    required String tipoDocumento,
    required String documento,
    required JsonMap keys,
    required double importeCobrado,
    required double importePendiente,
    required String formaPago,
    required String idempotencyToken,
  }) {
    String keyString(String key, [String fallback = '']) {
      final value = keys[key];
      return value == null ? fallback : value.toString();
    }

    int keyInt(String key, [int fallback = 0]) {
      final value = keys[key];
      if (value is int) return value;
      if (value is num) return value.toInt();
      return int.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return {
      'codigoCliente': codigoCliente,
      'nombreCliente': nombreCliente,
      'codigoRepartidor': repartidorId,
      'tipoDocumento': keyString('tipoDocumento', tipoDocumento),
      'origenDocumento': keyString('origenDocumento', 'B'),
      'subempresaDocumento': keyString('subempresaDocumento', 'GMP'),
      'ejercicioDocumento': keyInt('ejercicioDocumento'),
      'serieDocumento': keyString('serieDocumento'),
      'terminalDocumento': keyInt('terminalDocumento'),
      'numeroDocumento': keyInt('numeroDocumento'),
      'xdeDocumento': keyInt('xdeDocumento', 1),
      'dexDocumento': keyInt('dexDocumento', 1),
      'importeCobrado': importeCobrado,
      'importePendiente': importePendiente < 0 ? 0 : importePendiente,
      'formaPago': formaPago,
      'pantallaOrigen': 'VENCIMIENTOS',
      'idempotencyToken': idempotencyToken,
      'notas': documento.isEmpty ? null : 'Abono vencimiento $documento',
    };
  }

  static String _vencimientoObligationKey(Map<String, dynamic> payload) {
    String text(String key, [String fallback = '']) =>
        (payload[key]?.toString() ?? fallback).trim().toUpperCase();
    int integer(String key, [int fallback = 0]) {
      final value = payload[key];
      if (value is num) return value.toInt();
      return int.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return <Object>[
      text('codigoRepartidor'),
      text('codigoCliente'),
      text('tipoDocumento'),
      text('origenDocumento', 'B'),
      text('subempresaDocumento', 'GMP'),
      integer('ejercicioDocumento'),
      text('serieDocumento'),
      integer('terminalDocumento'),
      integer('numeroDocumento'),
      integer('xdeDocumento', 1),
      integer('dexDocumento', 1),
    ].join('|');
  }

  /// Req #16 (devoluciones): anula un cobro registrado por el repartidor.
  /// El backend valida que el cobro no esté liquidado y que el repartidor
  /// solicitante sea el dueño (o JEFE/ADMIN).
  Future<Map<String, dynamic>> reverseCobro({
    required String repartidorId,
    required String idempotencyToken,
    required String reason,
  }) async {
    final response = await OfflineAwareApi.post(
      '/repartidor-finanzas/cobros/reverse',
      {
        'repartidorId': repartidorId,
        'idempotencyToken': idempotencyToken,
        'reason': reason,
      },
      syncType: 'reverse_cobro',
    );
    await invalidateAllForRepartidor(repartidorId);
    return Map<String, dynamic>.from(response);
  }

  Future<RepartidorEvolutionData> getEvolution({
    required String repartidorId,
    bool forceRefresh = false,
  }) async {
    final response = await ApiClient.get(
      '/repartidor-finanzas/evolution/$repartidorId',
      cacheKey: evolutionCacheKey(repartidorId),
      cacheTTL: const Duration(hours: 1),
      forceRefresh: forceRefresh,
    );
    return RepartidorEvolutionData.fromJson(response);
  }

  Future<RepartidorCommissionSummary> getCommissionSummary({
    required String repartidorId,
    required DateTime from,
    required DateTime to,
    bool forceRefresh = false,
  }) async {
    final fromIso = _isoDate(from);
    final toIso = _isoDate(to);
    final response = await ApiClient.get(
      '/repartidor-finanzas/commissions/summary/$repartidorId',
      queryParameters: {'from': fromIso, 'to': toIso},
      cacheKey: commissionSummaryCacheKey(
        repartidorId: repartidorId,
        from: fromIso,
        to: toIso,
      ),
      cacheTTL: const Duration(minutes: 5),
      forceRefresh: forceRefresh,
    );

    return RepartidorCommissionSummary.fromJson(response);
  }

  Future<List<RepartidorCommissionTier>> getCommissionTiers({
    bool forceRefresh = false,
  }) async {
    final response = await ApiClient.get(
      '/repartidor-finanzas/commissions/tiers',
      cacheKey: commissionTiersCacheKey,
      cacheTTL: const Duration(minutes: 10),
      forceRefresh: forceRefresh,
    );

    return _mapList(response['tiers'], RepartidorCommissionTier.fromJson);
  }

  Future<List<RepartidorCommissionTier>> saveCommissionTiers(
    List<RepartidorCommissionTier> tiers,
  ) async {
    final response = await ApiClient.put(
      '/repartidor-finanzas/commissions/tiers',
      data: {
        'tiers': tiers.map((tier) => tier.toJson()).toList(),
      },
    );
    await CacheService.invalidate(commissionTiersCacheKey);
    await CacheService.invalidateByPrefix('${_prefix}_commission_summary_');
    return _mapList(response['tiers'], RepartidorCommissionTier.fromJson);
  }

  Future<List<DailyCollectionSnapshot>> getDailyCollections({
    required String repartidorId,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) async {
    final queryParams = <String, dynamic>{
      if (year != null) 'year': year.toString(),
      if (month != null) 'month': month.toString(),
    };

    final response = await ApiClient.get(
      '/repartidor/collections/daily/$repartidorId',
      queryParameters: queryParams,
      cacheKey: dailyCollectionsCacheKey(repartidorId, year, month),
      cacheTTL: const Duration(minutes: 10),
      forceRefresh: forceRefresh,
    );

    return _mapList(response['daily'], DailyCollectionSnapshot.fromJson);
  }

  Future<List<RepartidorHistoryClient>> getHistoryClients({
    required String repartidorId,
    String? search,
    bool forceRefresh = false,
  }) async {
    final queryParams = <String, dynamic>{
      if (search != null && search.isNotEmpty) 'search': search,
    };

    final response = await ApiClient.get(
      '/repartidor/history/clients/$repartidorId',
      queryParameters: queryParams,
      cacheKey: historyClientsCacheKey(repartidorId, search),
      cacheTTL: CacheService.defaultTTL,
      forceRefresh: forceRefresh,
    );

    return _mapList(response['clients'], RepartidorHistoryClient.fromJson);
  }

  Future<List<RepartidorHistoryDocument>> getClientDocuments({
    required String clientId,
    String? repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
    bool forceRefresh = false,
  }) async {
    final resolvedDateFrom =
        dateFrom ?? (year == null ? '${DateTime.now().year - 2}-01-01' : null);
    final queryParams = <String, dynamic>{
      if (repartidorId != null) 'repartidorId': repartidorId,
      if (resolvedDateFrom != null) 'dateFrom': resolvedDateFrom,
      if (dateTo != null) 'dateTo': dateTo,
      if (year != null) 'year': year.toString(),
      'limit': '50',
      'offset': '0',
    };

    final response = await ApiClient.get(
      '/repartidor/history/documents/$clientId',
      queryParameters: queryParams,
      cacheKey: clientDocumentsCacheKey(
        clientId: clientId,
        repartidorId: repartidorId,
        dateFrom: resolvedDateFrom,
        dateTo: dateTo,
        year: year,
      ),
      cacheTTL: const Duration(minutes: 15),
      forceRefresh: forceRefresh,
      receiveTimeout: const Duration(seconds: 25),
    );

    return _mapList(response['documents'], RepartidorHistoryDocument.fromJson);
  }

  Future<List<RepartidorMonthlyObjective>> getMonthlyObjectives({
    required String repartidorId,
    String? clientId,
    bool forceRefresh = false,
  }) async {
    final queryParams = <String, dynamic>{
      if (clientId != null) 'clientId': clientId,
    };

    final response = await ApiClient.get(
      '/repartidor/history/objectives/$repartidorId',
      queryParameters: queryParams,
      cacheKey: monthlyObjectivesCacheKey(
        repartidorId: repartidorId,
        clientId: clientId,
      ),
      cacheTTL: CacheService.defaultTTL,
      forceRefresh: forceRefresh,
    );

    return _mapList(
      response['objectives'],
      RepartidorMonthlyObjective.fromJson,
    );
  }

  Future<RepartidorObjectivesDetail> getObjectivesDetail({
    required String repartidorId,
    int? year,
    String? clientId,
    int limit = 100,
    int offset = 0,
    bool forceRefresh = false,
  }) async {
    if (limit < 1 || limit > 100 || offset < 0) {
      throw const FormatException('Paginacion de objetivos invalida');
    }
    final queryParams = <String, dynamic>{
      if (year != null) 'year': year.toString(),
      if (clientId != null) 'clientId': clientId,
      'limit': limit.toString(),
      'offset': offset.toString(),
    };

    final response = await ApiClient.get(
      '/repartidor/history/objectives-detail/$repartidorId',
      queryParameters: queryParams,
      cacheKey: objectivesDetailCacheKey(
        repartidorId: repartidorId,
        year: year,
        clientId: clientId,
        limit: limit,
        offset: offset,
      ),
      cacheTTL: CacheService.defaultTTL,
      forceRefresh: forceRefresh,
    );

    return RepartidorObjectivesDetail.fromJson(response);
  }

  Future<RepartidorDeliverySummary> getDeliverySummary({
    required String repartidorId,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) async {
    final queryParams = <String, dynamic>{
      if (year != null) 'year': year.toString(),
      if (month != null) 'month': month.toString(),
    };

    final response = await ApiClient.get(
      '/repartidor/history/delivery-summary/$repartidorId',
      queryParameters: queryParams,
      cacheKey: deliverySummaryCacheKey(repartidorId, year, month),
      cacheTTL: const Duration(minutes: 10),
      forceRefresh: forceRefresh,
    );

    return RepartidorDeliverySummary.fromJson(response);
  }

  Future<RepartidorDocumentSignature?> getSignature({
    required int ejercicio,
    required String serie,
    required int terminal,
    required int numero,
  }) async {
    final response = await ApiClient.get(
      '/repartidor/history/signature',
      queryParameters: {
        'ejercicio': ejercicio.toString(),
        'serie': serie,
        'terminal': terminal.toString(),
        'numero': numero.toString(),
      },
      cacheKey:
          '${_prefix}_signature_${ejercicio}_${serie}_${terminal}_$numero',
      cacheTTL: const Duration(hours: 6),
    );

    if (response['hasSignature'] != true && response['signature'] == null) {
      return null;
    }
    return RepartidorDocumentSignature.fromJson(response);
  }

  Future<List<int>> downloadDocument({
    required int year,
    required String serie,
    required int number,
    required String type,
    int terminal = 0,
    int? facturaNumber,
    String? serieFactura,
    int? ejercicioFactura,
    int? albaranNumber,
    String? albaranSerie,
    int? albaranTerminal,
    int? albaranYear,
    String? repartidorId,
  }) {
    final ownerHint = (repartidorId ?? '').trim();
    if (type == 'albaran') {
      final qs = ownerHint.isEmpty
          ? ''
          : '?repartidorId=${Uri.encodeComponent(ownerHint)}';
      return ApiClient.getBytes(
        '/repartidor/document/albaran/$year/$serie/$terminal/$number/pdf$qs',
      );
    }

    final invoiceNumber = facturaNumber ?? number;
    final invoiceSerie = serieFactura ?? serie;
    final invoiceYear = ejercicioFactura ?? year;
    final queryParams = <String, String>{
      if (albaranNumber != null) 'albaranNumber': albaranNumber.toString(),
      if (albaranSerie != null) 'albaranSerie': albaranSerie,
      if (albaranTerminal != null)
        'albaranTerminal': albaranTerminal.toString(),
      if (albaranYear != null) 'albaranYear': albaranYear.toString(),
      if (ownerHint.isNotEmpty) 'repartidorId': ownerHint,
    };
    final queryString = queryParams.isEmpty
        ? ''
        : '?${queryParams.entries.map(_encodedQueryEntry).join('&')}';

    return ApiClient.getBytes(
      '/repartidor/document/invoice/$invoiceYear/$invoiceSerie/'
      '$invoiceNumber/pdf$queryString',
    );
  }

  Future<RepartidorDocumentEmailResult> sendDocumentEmail({
    required int year,
    required String serie,
    required int number,
    required String type,
    required String destinatario,
    int terminal = 0,
    String? asunto,
    String? cuerpo,
    int? facturaNumber,
    String? serieFactura,
    int? ejercicioFactura,
    int? albaranNumber,
    String? albaranSerie,
    int? albaranTerminal,
    int? albaranYear,
  }) async {
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

    return RepartidorDocumentEmailResult.fromJson(response);
  }

  Future<String?> shareDocumentWhatsApp({
    required int year,
    required String serie,
    required int number,
    required String type,
    required String telefono,
    String? clienteNombre,
    int terminal = 0,
    int? facturaNumber,
    String? serieFactura,
    int? ejercicioFactura,
    int? albaranNumber,
    String? albaranSerie,
    int? albaranTerminal,
    int? albaranYear,
  }) async {
    final response = await ApiClient.post(
      '/repartidor/document/share/whatsapp',
      {
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
      },
    );

    if (response['success'] == true) {
      return response['whatsappUrl']?.toString();
    }
    return null;
  }

  Future<void> invalidatePeriod({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    await Future.wait<void>([
      CacheService.invalidate(
        collectionSummaryCacheKey(repartidorId, year, month),
      ),
      CacheService.invalidate(
        dailyCollectionsCacheKey(repartidorId, year, month),
      ),
      CacheService.invalidate(
        deliverySummaryCacheKey(repartidorId, year, month),
      ),
    ]);
  }

  Future<void> invalidateClientDocuments({
    required String clientId,
    String? repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
  }) async {
    await CacheService.invalidate(
      clientDocumentsCacheKey(
        clientId: clientId,
        repartidorId: repartidorId,
        dateFrom: dateFrom,
        dateTo: dateTo,
        year: year,
      ),
    );
  }

  Future<void> invalidateObjectives({
    required String repartidorId,
    int? year,
    String? clientId,
  }) async {
    await Future.wait<void>([
      CacheService.invalidate(
        monthlyObjectivesCacheKey(
          repartidorId: repartidorId,
          clientId: clientId,
        ),
      ),
      CacheService.invalidateByPrefix(
        '${_prefix}_objectives_detail_${repartidorId}_'
        '${year ?? 'current'}_${clientId ?? 'all'}_',
      ),
    ]);
  }

  Future<void> invalidateAllForRepartidor(String repartidorId) async {
    await CacheService.invalidateByPrefix('${_prefix}_summary_$repartidorId');
    await CacheService.invalidateByPrefix('${_prefix}_daily_$repartidorId');
    await CacheService.invalidateByPrefix('${_prefix}_clients_$repartidorId');
    await CacheService.invalidateByPrefix(
      '${_prefix}_objectives_$repartidorId',
    );
    await CacheService.invalidateByPrefix(
      '${_prefix}_objectives_detail_$repartidorId',
    );
    await CacheService.invalidateByPrefix('${_prefix}_delivery_$repartidorId');
    await CacheService.invalidateByPrefix(
      '${_prefix}_liquidacion_$repartidorId',
    );
    await CacheService.invalidateByPrefix(
      '${_prefix}_vencimientos_$repartidorId',
    );
    await CacheService.invalidateByPrefix(
      '${_prefix}_commission_summary_$repartidorId',
    );
  }
}

List<T> _mapList<T>(dynamic value, T Function(JsonMap json) parser) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map) parser(Map<String, dynamic>.from(item)),
  ];
}

String _encodedQueryEntry(MapEntry<String, String> entry) {
  return '${entry.key}=${Uri.encodeComponent(entry.value)}';
}
