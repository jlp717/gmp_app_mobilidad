// ignore_for_file: public_member_api_docs

import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

class RepartidorFinanzasService {
  const RepartidorFinanzasService();

  static const _prefix = 'repartidor_finanzas';

  static String _isoDate(DateTime value) {
    return value.toIso8601String().substring(0, 10);
  }

  static String dailyLiquidacionCacheKey(String repartidorId, String date) =>
      '${_prefix}_liquidacion_${repartidorId}_$date';

  static String vencimientosCacheKey({
    required String repartidorId,
    required String from,
    required String to,
    String? clientCode,
    String? estado,
  }) =>
      '${_prefix}_vencimientos_${repartidorId}_${from}_$to'
      '_${clientCode ?? 'all'}_${estado ?? 'all'}';

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
    int? year,
    String? clientId,
  }) =>
      '${_prefix}_objectives_detail_${repartidorId}_${year ?? 'current'}_'
      '${clientId ?? 'all'}';

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
    required double totalEfectivo,
    required double totalCheques,
    required double totalTarjeta,
    required double totalPostdatados,
    required double saldoActual,
    required double totalCobrosDia,
    required double totalAIngresar,
    required double ingresoBanco,
    required double gastos,
    required double efectivo2,
    required double entregado2,
  }) async {
    final response = await ApiClient.post(
      '/repartidor-finanzas/liquidaciones',
      {
        'repartidorId': repartidorId,
        'date': _isoDate(date),
        'idempotencyToken': idempotencyToken,
        'sendEmails': true,
        'totals': {
          'totalEfectivo': totalEfectivo,
          'totalCheques': totalCheques,
          'totalTarjeta': totalTarjeta,
          'totalPostdatados': totalPostdatados,
          'saldoActual': saldoActual,
          'totalCobrosDia': totalCobrosDia,
          'totalAIngresar': totalAIngresar,
          'ingresoBanco': ingresoBanco,
          'gastos': gastos,
          'efectivo2': efectivo2,
          'entregado2': entregado2,
        },
      },
    );

    await invalidateAllForRepartidor(repartidorId);
    return RepartidorLiquidacionResult.fromJson(response);
  }

  Future<List<RepartidorVencimiento>> getVencimientos({
    required String repartidorId,
    required DateTime from,
    required DateTime to,
    String? clientCode,
    String? estado,
    int limit = 200,
    bool forceRefresh = false,
  }) async {
    final fromIso = _isoDate(from);
    final toIso = _isoDate(to);
    final response = await ApiClient.get(
      '/repartidor-finanzas/vencimientos/$repartidorId',
      queryParameters: {
        'from': fromIso,
        'to': toIso,
        'limit': limit.toString(),
        if (clientCode != null && clientCode.isNotEmpty)
          'clientCode': clientCode,
        if (estado != null && estado.isNotEmpty) 'estado': estado,
      },
      cacheKey: vencimientosCacheKey(
        repartidorId: repartidorId,
        from: fromIso,
        to: toIso,
        clientCode: clientCode,
        estado: estado,
      ),
      cacheTTL: const Duration(minutes: 2),
      forceRefresh: forceRefresh,
    );

    return _mapList(response['vencimientos'], RepartidorVencimiento.fromJson);
  }

  Future<void> registerVencimientoCobro({
    required String repartidorId,
    required String codigoCliente,
    required String nombreCliente,
    required String tipoDocumento,
    required String documento,
    required JsonMap keys,
    required double importeCobrado,
    required double importePendiente,
    required String formaPago,
  }) async {
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

    final safeRep = repartidorId.replaceAll(RegExp('[^A-Za-z0-9_-]'), '_');
    final token = 'vto_${safeRep}_${DateTime.now().microsecondsSinceEpoch}';
    await ApiClient.post(
      '/repartidor-finanzas/cobros',
      {
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
        'idempotencyToken': token,
        'notas': 'Abono vencimiento $documento',
      },
    );

    await invalidateAllForRepartidor(repartidorId);
  }

  /// Req #16 (devoluciones): anula un cobro registrado por el repartidor.
  /// El backend valida que el cobro no esté liquidado y que el repartidor
  /// solicitante sea el dueño (o JEFE/ADMIN).
  Future<Map<String, dynamic>> reverseCobro({
    required String repartidorId,
    required String idempotencyToken,
    required String reason,
  }) async {
    final response = await ApiClient.post(
      '/repartidor-finanzas/cobros/reverse',
      {
        'repartidorId': repartidorId,
        'idempotencyToken': idempotencyToken,
        'reason': reason,
      },
    );
    await invalidateAllForRepartidor(repartidorId);
    return Map<String, dynamic>.from(response);
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
    final queryParams = <String, dynamic>{
      if (repartidorId != null) 'repartidorId': repartidorId,
      if (dateFrom != null) 'dateFrom': dateFrom,
      if (dateTo != null) 'dateTo': dateTo,
      if (year != null) 'year': year.toString(),
    };

    final response = await ApiClient.get(
      '/repartidor/history/documents/$clientId',
      queryParameters: queryParams,
      cacheKey: clientDocumentsCacheKey(
        clientId: clientId,
        repartidorId: repartidorId,
        dateFrom: dateFrom,
        dateTo: dateTo,
        year: year,
      ),
      cacheTTL: const Duration(minutes: 15),
      forceRefresh: forceRefresh,
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
    bool forceRefresh = false,
  }) async {
    final queryParams = <String, dynamic>{
      if (year != null) 'year': year.toString(),
      if (clientId != null) 'clientId': clientId,
    };

    final response = await ApiClient.get(
      '/repartidor/history/objectives-detail/$repartidorId',
      queryParameters: queryParams,
      cacheKey: objectivesDetailCacheKey(
        repartidorId: repartidorId,
        year: year,
        clientId: clientId,
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
  }) {
    if (type == 'albaran') {
      return ApiClient.getBytes(
        '/repartidor/document/albaran/$year/$serie/$terminal/$number/pdf',
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
      CacheService.invalidate(
        objectivesDetailCacheKey(
          repartidorId: repartidorId,
          year: year,
          clientId: clientId,
        ),
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
