import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/presentation/widgets/bolsa_movement_type_filters.dart';

void main() {
  const sizes = [
    Size(360, 640),
    Size(430, 932),
    Size(800, 1280),
    Size(1024, 1366),
  ];

  for (final portrait in sizes) {
    for (final size in [portrait, Size(portrait.height, portrait.width)]) {
      for (final scale in [1.0, 1.5, 2.0]) {
        testWidgets('Filtros visibles y seleccionables a $size × $scale',
            (tester) async {
          tester.view
            ..physicalSize = size
            ..devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);

          BolsaMovimientoTipo? selected;
          final selections = <BolsaMovimientoTipo?>[];
          await tester.pumpWidget(
            MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(scale),
                ),
                child: child!,
              ),
              home: Scaffold(
                body: Align(
                  alignment: Alignment.topLeft,
                  child: StatefulBuilder(
                    builder: (context, setState) => BolsaMovementTypeFilters(
                      selectedType: selected,
                      totalCount: 12,
                      counts: const {
                        BolsaMovimientoTipo.acumulacion: 5,
                        BolsaMovimientoTipo.consumo: 7,
                      },
                      onSelected: (type) {
                        selections.add(type);
                        setState(() => selected = type);
                      },
                    ),
                  ),
                ),
              ),
            ),
          );

          for (final label in [
            'Todos · 12',
            'Acumulación · 5',
            'Consumo · 7',
            'Ajustes · 0',
          ]) {
            final button = find.ancestor(
              of: find.text(label),
              matching:
                  find.byWidgetPredicate((widget) => widget is OutlinedButton),
            );
            expect(button, findsOneWidget);
            expect(tester.getSize(button).height, greaterThanOrEqualTo(56));
            expect(tester.getSize(button).width, lessThanOrEqualTo(size.width));
            await tester.ensureVisible(button);
            await tester.pumpAndSettle();
            expect(find.text(label).hitTestable(), findsOneWidget);
          }

          final all = find.byKey(const ValueKey('bolsa-type-all'));
          final consumption = find.byKey(const ValueKey('bolsa-type-consumo'));
          expect(tester.widget<Semantics>(all).properties.selected, isTrue);

          await tester.ensureVisible(consumption);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Consumo · 7'));
          await tester.pumpAndSettle();
          expect(
            tester.widget<Semantics>(consumption).properties.selected,
            isTrue,
          );
          expect(
            find.descendant(
              of: consumption,
              matching: find.byIcon(Icons.check_rounded),
            ),
            findsOneWidget,
          );

          await tester.ensureVisible(all);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Todos · 12'));
          await tester.pumpAndSettle();
          expect(selections, [BolsaMovimientoTipo.consumo, null]);
          expect(tester.widget<Semantics>(all).properties.selected, isTrue);
          expect(tester.takeException(), isNull);
        });
      }
    }
  }
}
