import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/widgets/date_range_picker.dart';

void main() {
  testWidgets('date range dialog stays inside a 320px phone', (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: Size(320, 568)),
          child: Scaffold(
            body: DateRangePicker(
              onDateRangeSelected: _noopRange,
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('Seleccionar rango de fechas'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Rango de Fechas'), findsOneWidget);
    expect(find.text('Desde'), findsOneWidget);
    expect(find.text('Hasta'), findsOneWidget);
    expect(find.text('Aplicar'), findsOneWidget);
  });
}

void _noopRange(DateTime? start, DateTime? end) {}
