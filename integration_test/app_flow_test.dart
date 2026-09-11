import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'helpers/repartidor_e2e_login.dart';

// ponytail: flujo critico contra backend real (staging). Patrol difiere:
// requiere config nativa android/app + patrol_cli. upgrade: migrar finders a
// patrol ($) cuando el setup nativo entre en CI.
//
// Ejecutar con dispositivo/emulador y credenciales de staging:
//   INTEGRATION_USER=xxx INTEGRATION_PASS=xxx flutter test integration_test
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('flujo critico: login -> rutero -> liquidacion diaria',
      (tester) async {
    await loginWithIntegrationFixture(tester);

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
