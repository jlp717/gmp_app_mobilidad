import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';
import 'package:gmp_app_mobilidad/main.dart' as app;
import 'package:integration_test/integration_test.dart';

// ponytail: flujo critico contra backend real (staging). Patrol difiere:
// requiere config nativa android/app + patrol_cli. upgrade: migrar finders a
// patrol ($) cuando el setup nativo entre en CI.
//
// Ejecutar con dispositivo/emulador y credenciales de staging:
//   INTEGRATION_USER=xxx INTEGRATION_PASS=xxx flutter test integration_test
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  final user = Platform.environment['INTEGRATION_USER'];
  final pass = Platform.environment['INTEGRATION_PASS'];

  testWidgets('flujo critico: login -> rutero -> liquidacion diaria',
      (tester) async {
    if (user == null || pass == null || user.isEmpty || pass.isEmpty) {
      // Sin credenciales no hay E2E real: falla rapida y explicita, nunca PASS falso.
      fail(
        'INTEGRATION_USER/INTEGRATION_PASS no definidas: '
        'este test requiere staging real.',
      );
    }

    app.main();
    await tester.pumpAndSettle(const Duration(seconds: 5));

    // 1) Login
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Tu código de acceso'),
      user,
    );
    await tester.pump();
    await tester.enterText(
      find.widgetWithText(TextFormField, '••••••••'),
      pass,
    );
    await tester.pump();
    await tester.tap(find.text('Iniciar Sesión'));
    await tester.pumpAndSettle(const Duration(seconds: 10));

    expect(find.byType(MainShell), findsOneWidget);

    // 2) Rutero: navegar a la tab del rutero
    final ruteroTab = find.textContaining('Rutero');
    expect(ruteroTab, findsWidgets);
    await tester.tap(ruteroTab.first);
    await tester.pumpAndSettle(const Duration(seconds: 8));

    // 3) Abrir una liquidacion desde el shell (entrada comercial)
    final liquidacionEntry = find.textContaining('Liquidación').first;
    await tester.scrollUntilVisible(
      liquidacionEntry,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(liquidacionEntry);
    await tester.pumpAndSettle(const Duration(seconds: 5));

    expect(find.textContaining('Total a ingresar'), findsOneWidget);
  });
}
