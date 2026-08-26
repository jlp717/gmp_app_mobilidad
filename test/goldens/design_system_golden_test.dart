import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/empty_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/error_state_widget.dart';

// ponytail: alchemist sustituido por matchesGoldenFile nativo — su layout de
// escenarios rompe constraints con Flutter 3.35 y aportaba solo wrappers.
// ShimmerSkeleton excluido: animacion infinita no determinista.
// upgrade: volver a alchemist si se necesita multi-variant/host material.

Future<void> _pumpGolden(
  WidgetTester tester,
  Widget child,
  String name,
) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = const Size(560, 640);
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(),
      home: MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: Scaffold(
          body: Center(
            child: SizedBox(
              width: 520,
              height: 560,
              child: Card(
                color: const Color(0xFF1E1F25),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: child,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));

  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('goldens/$name.png'),
  );
}

void main() {
  testWidgets('golden ErrorStateWidget con reintento', (tester) async {
    await _pumpGolden(
      tester,
      ErrorStateWidget(
        message: 'No se pudieron cargar los vencimientos',
        onRetry: () {},
      ),
      'error_state_widget_retry',
    );
  });

  testWidgets('golden ErrorStateWidget sin reintento', (tester) async {
    await _pumpGolden(
      tester,
      const ErrorStateWidget(message: 'Fallo inesperado'),
      'error_state_widget_plain',
    );
  });

  testWidgets('golden EmptyStateWidget con accion', (tester) async {
    await _pumpGolden(
      tester,
      EmptyStateWidget(
        title: 'Sin datos',
        subtitle: 'Aun no hay registros para este periodo',
        actionLabel: 'Refrescar',
        onAction: () {},
      ),
      'empty_state_widget_action',
    );
  });

  testWidgets('golden EmptyStateWidget simple', (tester) async {
    await _pumpGolden(
      tester,
      const EmptyStateWidget(title: 'Nada por aqui'),
      'empty_state_widget_simple',
    );
  });
}
