import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_panel_page.dart';

void main() {
  group('deliveryCompletionPercent', () {
    test('computes 8/2734 instead of reading a missing pctEntrega as 0', () {
      final pct = deliveryCompletionPercent(
        entregados: 8,
        totalAlbaranes: 2734,
      );
      expect(pct.toStringAsFixed(1), '0.3');
      expect(pct, greaterThan(0));
    });

    test('prefers delivered/total even if backend sent 0.0', () {
      expect(
        deliveryCompletionPercent(
          entregados: 8,
          totalAlbaranes: 2734,
          pctEntrega: 0,
        ).toStringAsFixed(1),
        '0.3',
      );
    });

    test('returns 0 when there are no albaranes', () {
      expect(
        deliveryCompletionPercent(entregados: 0, totalAlbaranes: 0),
        0,
      );
    });
  });
}
