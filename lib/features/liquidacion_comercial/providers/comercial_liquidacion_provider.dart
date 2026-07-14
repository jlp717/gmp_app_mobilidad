// ignore_for_file: public_member_api_docs

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/data/comercial_liquidacion_service.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/comercial_liquidacion_models.dart';

typedef ComercialLiquidacionQuery = ({
  String vendorCode,
  String dateIso,
});

final comercialLiquidacionServiceProvider =
    Provider<ComercialLiquidacionService>(
  (ref) => const ComercialLiquidacionService(),
);

final comercialLiquidacionSummaryProvider = FutureProvider.autoDispose
    .family<ComercialLiquidacionSummary, ComercialLiquidacionQuery>(
  (ref, query) {
    return ref.read(comercialLiquidacionServiceProvider).fetchDailySummary(
          vendorCode: query.vendorCode,
          dateIso: query.dateIso,
        );
  },
);

final comercialLiquidacionActionsProvider =
    Provider<ComercialLiquidacionActions>((ref) {
  return ComercialLiquidacionActions(ref);
});

class ComercialLiquidacionActions {
  ComercialLiquidacionActions(this._ref);

  final Ref _ref;

  Future<ComercialLiquidacionCloseResult> submit({
    required ComercialLiquidacionDraft draft,
  }) async {
    final result = await _ref
        .read(comercialLiquidacionServiceProvider)
        .submitLiquidacion(draft: draft);
    final query = (
      vendorCode: draft.employeeCode,
      dateIso: draft.date.toIso8601String().substring(0, 10),
    );
    _ref.invalidate(comercialLiquidacionSummaryProvider(query));
    return result;
  }
}
