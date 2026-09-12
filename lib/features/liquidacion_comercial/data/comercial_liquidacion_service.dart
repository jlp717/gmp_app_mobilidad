import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/liquidacion_domain.dart';
import 'package:intl/intl.dart';

/// Loads commercial daily settlement totals including merchandise returns.
class ComercialLiquidacionService {
  /// Creates a reader of the commercial settlement API.
  const ComercialLiquidacionService();

  /// Fetches cobros + returns for [employeeCode] on [date].
  Future<ComercialLiquidacionDailySnapshot> fetchDaily({
    required String employeeCode,
    DateTime? date,
    bool forceRefresh = false,
  }) async {
    final day = date ?? DateTime.now();
    final fecha = DateFormat('yyyy-MM-dd').format(day);
    final vendors = employeeCode
        .split(',')
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .join(',');
    final body = await ApiClient.get(
      '/comercial-liquidacion/resumen-diario',
      queryParameters: {
        'vendedor': vendors,
        'fecha': fecha,
      },
      cacheKey: 'comercial-liquidacion:$vendors:$fecha',
      cacheTTL: const Duration(minutes: 2),
      forceRefresh: forceRefresh,
    );
    return ComercialLiquidacionDailySnapshot.fromJson(body);
  }

  /// Persists bank + handed-over amounts in isolated TEST.
  Future<void> saveDaily(ComercialLiquidacionDraft draft) async {
    final fecha = DateFormat('yyyy-MM-dd').format(draft.date);
    final vendors = draft.employeeCode
        .split(',')
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .join(',');
    await ApiClient.post(
      '/comercial-liquidacion/guardar',
      {
        'vendedor': vendors,
        'fecha': fecha,
        'ingresoBanco': draft.ingresoBanco,
        'entregado': draft.entregado,
        'expectedTotal': draft.expectedTotal,
        'idempotencyToken': 'liq-$vendors-$fecha-${draft.registrado}',
      },
    );
    await CacheService.invalidateByPrefix(
      'comercial-liquidacion:$vendors:$fecha',
    );
  }

  /// Registers a TEST-only merchandise return overlay.
  Future<ComercialDevolucionItem> registerReturn({
    required String employeeCode,
    required String clientCode,
    required double amount,
    DateTime? date,
    String? documentoOrigen,
    bool yaCobrada = true,
    String? formaPago,
    String? albaranOrigen,
    String? vencimiento,
  }) async {
    final day = date ?? DateTime.now();
    final fecha = DateFormat('yyyy-MM-dd').format(day);
    final vendors = employeeCode
        .split(',')
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .join(',');
    final body = await ApiClient.post(
      '/comercial-liquidacion/devoluciones',
      {
        'vendedor': vendors,
        'fecha': fecha,
        'cliente': clientCode,
        'importe': amount,
        'documentoOrigen': documentoOrigen,
        'yaCobrada': yaCobrada,
        if (formaPago != null && formaPago.isNotEmpty) 'formaPago': formaPago,
        if (albaranOrigen != null && albaranOrigen.isNotEmpty)
          'albaranOrigen': albaranOrigen,
        if (vencimiento != null && vencimiento.isNotEmpty)
          'vencimiento': vencimiento,
        'impactoLqd': yaCobrada ? 'YA_COBRADOS' : 'NO_COBRADA',
        'idempotencyToken':
            'dev-$vendors-$fecha-$clientCode-${amount.toStringAsFixed(2)}',
      },
    );
    await CacheService.invalidateByPrefix(
      'comercial-liquidacion:$vendors:$fecha',
    );
    final itemJson = (body['return'] as Map?)?.cast<String, dynamic>() ?? body;
    return ComercialLiquidacionDailySnapshot.itemFromJson(itemJson);
  }

  /// Lists CVC pagarés already collected so Devuelve can adjust LIQ.Vd.
  Future<List<Map<String, dynamic>>> listPgCollected({
    required String employeeCode,
    String? clientCode,
  }) async {
    final vendors = employeeCode
        .split(',')
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .join(',');
    final body = await ApiClient.get(
      '/comercial-liquidacion/ya-cobrados-pg',
      queryParameters: {
        'vendedor': vendors,
        if (clientCode != null && clientCode.isNotEmpty) 'cliente': clientCode,
      },
      cacheKey: 'comercial-liquidacion-pg:$vendors:${clientCode ?? ''}',
      cacheTTL: const Duration(minutes: 2),
    );
    final docs = (body['documents'] as List?) ?? const [];
    return docs.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }
}

/// API payload for one commercial settlement day.
class ComercialLiquidacionDailySnapshot {
  /// Creates a daily snapshot of cobros and returns.
  const ComercialLiquidacionDailySnapshot({
    required this.summary,
    this.returns = const [],
    this.date,
    this.savedDraft,
  });

  /// Parses the backend JSON contract.
  factory ComercialLiquidacionDailySnapshot.fromJson(
    Map<String, dynamic> json,
  ) {
    final summaryJson = (json['summary'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};
    final returnsJson = (json['returns'] as List?) ?? const [];
    final savedJson = (json['savedDraft'] as Map?)?.cast<String, dynamic>();
    return ComercialLiquidacionDailySnapshot(
      date: json['date']?.toString(),
      summary: ComercialLiquidacionSummary(
        totalEfectivo: _num(summaryJson['totalEfectivo']),
        totalCheques: _num(summaryJson['totalCheques']),
        totalPostdatados: _num(summaryJson['totalPostdatados']),
        saldoActual: _num(summaryJson['saldoActual']),
        devolucionesYaCobradas:
            _num(summaryJson['devolucionesYaCobradas']).abs(),
        totalAIngresar: summaryJson['totalAIngresar'] == null
            ? null
            : _num(summaryJson['totalAIngresar']),
        source: (summaryJson['source'] ?? 'COBROS').toString(),
      ),
      returns: returnsJson
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .map(itemFromJson)
          .toList(),
      savedDraft: savedJson == null
          ? null
          : ComercialLiquidacionDraft(
              employeeCode: (savedJson['vendedor'] ?? '').toString(),
              date: DateTime.tryParse(savedJson['date']?.toString() ?? '') ??
                  DateTime.now(),
              expectedTotal: _num(
                savedJson['totalEsperado'] ?? savedJson['totalAIngresar'],
              ),
              ingresoBanco: _num(savedJson['ingresoBanco']),
              entregado: _num(savedJson['entregado']),
            ),
    );
  }

  /// Settlement totals already adjusted for already-collected returns.
  final ComercialLiquidacionSummary summary;

  /// Merchandise return documents of the day.
  final List<ComercialDevolucionItem> returns;

  /// Last TEST-persisted bank/hand-over draft, if any.
  final ComercialLiquidacionDraft? savedDraft;

  /// Business date of the snapshot.
  final String? date;

  /// Parses one return row from the API.
  static ComercialDevolucionItem itemFromJson(Map<String, dynamic> item) {
    return ComercialDevolucionItem(
      documento: (item['documento'] ?? '').toString(),
      cliente: (item['cliente'] ?? '').toString(),
      amount: _num(item['amount']),
      date: item['date']?.toString(),
      vendedor: (item['vendedor'] ?? '').toString(),
      yaCobrada:
          item['yaCobrada'] == true || item['yaCobrada']?.toString() == '1',
      formaPago: item['formaPago']?.toString(),
      impactoLqd: item['impactoLqd']?.toString(),
    );
  }

  static double _num(Object? value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }
}
