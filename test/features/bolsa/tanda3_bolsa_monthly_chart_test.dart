/// Tanda 3 — REQ-16 widget test `BolsaMonthlyChart` (sin red ni DB2).
/// - 12 puntos: mes actual visible en primer frame (scroll inicial al final),
///   scroll revela meses previos.
/// - <12 puntos: sin crash.
/// - Vacío: sin crash (shrink).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/presentation/widgets/bolsa_monthly_chart.dart';

const _months = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/// 12 puntos cronológicos antiguo→reciente terminando en mes actual.
List<BolsaMonthlyPoint> _twelvePoints() {
  final now = DateTime.now();
  // Primer punto = hace 11 meses, último = mes actual.
  var cursor = DateTime(now.year, now.month - 11, 1);
  return List<BolsaMonthlyPoint>.generate(12, (i) {
    final p = BolsaMonthlyPoint(
      ejercicio: cursor.year,
      mes: cursor.month,
      acumulado: 100 + i * 10,
      consumido: 20 + i * 2,
      saldoDisponible: 80 + i * 8,
    );
    cursor = DateTime(cursor.year, cursor.month + 1, 1);
    return p;
  });
}

Future<void> _pumpChart(
  WidgetTester tester,
  List<BolsaMonthlyPoint> history,
) async {
  // Ancho test estándar (800): serie 12×72=864px desborda → scroll real,
  // cabecera y stats caben como en producción (320px rompería el header).
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: BolsaMonthlyChart(history: history)),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('REQ-16 BolsaMonthlyChart 12 puntos', () {
    testWidgets('mes actual visible en primer frame (scroll al final)',
        (tester) async {
      final points = _twelvePoints();
      await _pumpChart(tester, points);

      expect(find.text('Histórico 12 meses'), findsOneWidget);
      final now = DateTime.now();
      expect(find.text(_months[now.month - 1]), findsOneWidget);

      final sv = tester.widget<SingleChildScrollView>(
        find.byType(SingleChildScrollView).first,
      );
      final pos = sv.controller!.position;
      // Viewport inicial anclado al final = mes actual visible sin scroll.
      expect(pos.maxScrollExtent, greaterThan(0));
      expect(pos.pixels, pos.maxScrollExtent);
    });

    testWidgets('scroll revela meses previos', (tester) async {
      final points = _twelvePoints();
      await _pumpChart(tester, points);

      final svBefore = tester.widget<SingleChildScrollView>(
        find.byType(SingleChildScrollView).first,
      );
      final startPixels = svBefore.controller!.position.pixels;
      expect(startPixels, greaterThan(0));

      await tester.drag(
        find.byType(SingleChildScrollView),
        const Offset(500, 0),
      );
      await tester.pumpAndSettle();

      final svAfter = tester.widget<SingleChildScrollView>(
        find.byType(SingleChildScrollView).first,
      );
      expect(
        svAfter.controller!.position.pixels,
        lessThan(startPixels),
      );
      // Mes más antiguo existe en la serie tras revelar inicio.
      expect(find.text(_months[points.first.mes - 1]), findsWidgets);
    });

    testWidgets('<12 puntos sin crash', (tester) async {
      await _pumpChart(tester, _twelvePoints().sublist(8));
      expect(find.text('Histórico 12 meses'), findsOneWidget);
    });

    testWidgets('vacío sin crash', (tester) async {
      await _pumpChart(tester, const []);
      expect(find.text('Histórico 12 meses'), findsNothing);
    });
  });
}
