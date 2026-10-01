import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/utils/sales_today_metric_selector.dart';

void main() {
  group('selectSalesTodayMetric', () {
    test('pinta la venta comercial del día aunque la hoja sea mayor', () {
      final selected = selectSalesTodayMetric({
        'todaySalesGross': 57442.76,
        'todayDocumentsGross': 346,
        'todaySales': 48928.95,
        'todayDocumentsFiltered': 326,
        'totalOrders': 312,
      });

      expect(selected.usesGross, isFalse);
      expect(selected.amount, 48928.95);
      expect(selected.documents, 326);
    });

    test('usa el contador de pedidos si falta el recuento filtrado', () {
      final selected = selectSalesTodayMetric({
        'todaySales': 48928.95,
        'totalOrders': 312,
        'todayDocumentsGross': 346,
      });

      expect(selected.usesGross, isFalse);
      expect(selected.amount, 48928.95);
      expect(selected.documents, 312);
    });

    test('parsea el importe comercial cuando llega como texto', () {
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

    test('ignora un recuento filtrado negativo o no entero', () {
      for (final invalid in [-1, 2.5, double.infinity]) {
        final selected = selectSalesTodayMetric({
          'todaySalesGross': 57442.76,
          'todayDocumentsFiltered': invalid,
          'todaySales': 48928.95,
          'totalOrders': 312,
        });
        expect(selected.documents, 312);
        expect(selected.amount, 48928.95);
      }
    });
  });

  group('salesTodayTitle', () {
    test('escribe el día de Madrid en la tarjeta', () {
      expect(salesTodayTitle('2026-10-01'), 'Ventas hoy (01/10/2026)');
    });

    test('no inventa una fecha si el contrato no la trae', () {
      expect(salesTodayTitle(null), 'Ventas hoy');
      expect(salesTodayTitle('01/10/2026'), 'Ventas hoy');
    });
  });
}
