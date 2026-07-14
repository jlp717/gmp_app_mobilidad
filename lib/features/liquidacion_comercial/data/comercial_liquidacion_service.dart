// ignore_for_file: public_member_api_docs

import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/comercial_liquidacion_models.dart';

class ComercialLiquidacionException implements Exception {
  const ComercialLiquidacionException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ComercialLiquidacionService {
  const ComercialLiquidacionService();

  static const _dailySummaryPath = '/comercial-liquidaciones/daily-summary';
  static const _closePath = '/comercial-liquidaciones';

  static String dailySummaryPath(String vendorCode) =>
      '$_dailySummaryPath/${Uri.encodeComponent(vendorCode)}';

  static String get closePath => _closePath;

  static String _isoDate(DateTime value) =>
      value.toIso8601String().substring(0, 10);

  static String dailySummaryCacheKey(String vendorCode, String dateIso) =>
      'comercial_liquidacion_summary_${vendorCode}_$dateIso';

  static String idempotencyToken(String vendorCode, DateTime date) {
    final compactDate = _isoDate(date).replaceAll('-', '');
    final safeVendor = vendorCode.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'liq-comercial-$compactDate-$safeVendor';
  }

  Future<ComercialLiquidacionSummary> fetchDailySummary({
    required String vendorCode,
    required String dateIso,
    bool forceRefresh = false,
  }) async {
    final result = await getDailySummary(
      vendorCode: vendorCode,
      date: DateTime.parse(dateIso),
      forceRefresh: forceRefresh,
    );
    return result.summary;
  }

  Future<ComercialLiquidacionDailyResult> getDailySummary({
    required String vendorCode,
    required DateTime date,
    bool forceRefresh = false,
  }) async {
    final isoDate = _isoDate(date);
    final response = await OfflineAwareApi.get(
      dailySummaryPath(vendorCode),
      queryParameters: {
        'date': isoDate,
      },
      cacheKey: dailySummaryCacheKey(vendorCode, isoDate),
      cacheTTL: const Duration(minutes: 2),
      forceRefresh: forceRefresh,
    );

    final payload = response.data;
    if (payload['success'] == false) {
      throw ComercialLiquidacionException(
        payload['error']?.toString() ?? 'No se pudo cargar la liquidación',
      );
    }

    return ComercialLiquidacionDailyResult.fromJson(payload);
  }

  Future<ComercialLiquidacionCloseResult> submitLiquidacion({
    required ComercialLiquidacionDraft draft,
  }) {
    final summary = draft.summary;
    if (summary == null) {
      throw const ComercialLiquidacionException(
        'Resumen de liquidación no disponible para guardar',
      );
    }
    final token = idempotencyToken(draft.employeeCode, draft.date);
    return closeLiquidacion(
      draft: draft,
      summary: summary,
      idempotencyToken: token,
      sendEmails: true,
    );
  }

  Future<ComercialLiquidacionCloseResult> closeLiquidacion({
    required ComercialLiquidacionDraft draft,
    required ComercialLiquidacionSummary summary,
    required String idempotencyToken,
    bool sendEmails = true,
  }) async {
    final vendorCode = draft.employeeCode.trim();
    final dateIso = _isoDate(draft.date);
    final payload = <String, dynamic>{
      'vendedorId': vendorCode,
      'date': dateIso,
      'idempotencyKey': idempotencyToken,
      'ingresoBanco': draft.ingresoBanco,
      'entregado': draft.entregado,
      'sendEmail': sendEmails,
      'totals': {
        'efectivo': summary.totalEfectivo,
        'tarjeta': summary.totalTarjeta,
        'totalCobros': summary.totalCobrosDia,
        'cheques': summary.totalCheques,
        'postdatados': summary.totalPostdatados,
        'saldoActual': summary.saldoActual,
        'totalAIngresar': summary.totalAIngresar,
      },
    };

    final response = await OfflineAwareApi.post(
      _closePath,
      payload,
      syncType: 'close_comercial_liquidacion',
    );

    if (response['success'] != true && response['queued'] != true) {
      throw ComercialLiquidacionException(
        response['error']?.toString() ?? 'No se pudo guardar la liquidación',
      );
    }

    await CacheService.invalidate(dailySummaryCacheKey(vendorCode, dateIso));
    return ComercialLiquidacionCloseResult.fromJson(response);
  }
}
