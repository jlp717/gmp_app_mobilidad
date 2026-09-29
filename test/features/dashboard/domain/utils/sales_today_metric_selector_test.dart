import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/utils/sales_today_metric_selector.dart';

void main() {
  group('selectSalesTodayMetric', () {
    test('selecciona el bruto contractual y documentos completos', () {
      final selected = selectSalesTodayMetric({
        'todaySalesGross': 57442.76,
        'todayDocumentsGross': 346,
        'todaySales': 48928.95,
        'totalOrders': 312,
      });

      expect(selected.usesGross, isTrue);
      expect(selected.amount, 57442.76);
      expect(selected.documents, 346);
    });

    test('usa legacy si falta el bruto', () {
      final selected = selectSalesTodayMetric({
        'todaySales': 48928.95,
        'totalOrders': 312,
        'todayDocumentsGross': 346,
      });

      expect(selected.usesGross, isFalse);
      expect(selected.amount, 48928.95);
      expect(selected.documents, 312);
    });

    test('usa legacy con bruto no finito', () {
      final selected = selectSalesTodayMetric({
        'todaySalesGross': double.nan,
        'todayDocumentsGross': 346,
        'todaySales': '48928.95',
        'totalOrders': '312',
      });

      expect(selected.usesGross, isFalse);
      expect(selected.amount, 48928.95);
      expect(selected.documents, 312);
    });

    test('usa legacy con contador negativo o no entero', () {
      for (final invalid in [-1, 2.5, double.infinity]) {
        final selected = selectSalesTodayMetric({
          'todaySalesGross': 57442.76,
          'todayDocumentsGross': invalid,
          'todaySales': 48928.95,
          'totalOrders': 312,
        });
        expect(selected.usesGross, isFalse);
      }
    });
  });
}
