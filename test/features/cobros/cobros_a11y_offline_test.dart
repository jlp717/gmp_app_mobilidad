/// Cobros a11y + offline (Tier-1 P9).
///
/// Verifica:
/// - Semantics en espanol en acciones principales (chip tiers commissions,
///   dialogo PDF commissions, banner offline).
/// - Estado offline en espanol con reintento al simular desconexion
///   (patron test/core/widgets/offline_state_widget_test.dart:
///   override de connectivityStatusProvider).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/widgets/offline_state_widget.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/widgets/commission_tier_chip.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/widgets/pdf_range_dialog.dart';

Widget _wrap({required Widget child, List<Override> overrides = const []}) {
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp(home: Scaffold(body: child)),
  );
}

void main() {
  group('cobros/commissions a11y (Semantics en espanol)', () {
    testWidgets('tier chip expone Semantics con franja y tarifa',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const CommissionTierChip(
            tier: 'F1',
            range: '100-103%',
            rate: '1.0%',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Semantics &&
              (w.properties.label ?? '') == 'F1 100-103% 1.0%',
        ),
        findsOneWidget,
      );
      expect(find.text('F1'), findsOneWidget);
    });

    testWidgets('dialogo PDF expone acciones con label en espanol',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const SingleChildScrollView(
            child: PdfRangeDialog(vendorCode: '72'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Semantics &&
              (w.properties.label ?? '') ==
                  'Generar informe PDF de comisiones',
        ),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Semantics &&
              (w.properties.label ?? '') ==
                  'Cancelar generación del informe PDF',
        ),
        findsOneWidget,
      );
    });
  });

  group('offline cobros (patron pedidos/OfflineBanner)', () {
    testWidgets('banner muestra Sin conexión al simular desconexion',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          child: const Column(children: [OfflineBanner(), Text('Contenido')]),
          overrides: [
            connectivityStatusProvider.overrideWith(
              (ref) async* {
                yield ConnectivityStatus.offline;
              },
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Sin conexión'), findsOneWidget);
      expect(find.text('Contenido'), findsOneWidget);
      expect(find.byTooltip('Reintentar conexión'), findsOneWidget);
    });

    testWidgets('estado offline cobros muestra mensaje y reintento',
        (tester) async {
      var retried = false;
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(
        _wrap(
          child: OfflineStateWidget(
            message: 'Sin conexión',
            detail:
                'No se pudieron cargar los cobros. Se mostrarán los últimos datos guardados al reconectar.',
            onRetry: () => retried = true,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Sin conexión'), findsOneWidget);
      expect(
        find.textContaining('No se pudieron cargar los cobros'),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel(
          'Sin conexión. No se pudieron cargar los cobros. '
          'Se mostrarán los últimos datos guardados al reconectar.',
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();
      expect(retried, isTrue);
      handle.dispose();
    });
  });
}
