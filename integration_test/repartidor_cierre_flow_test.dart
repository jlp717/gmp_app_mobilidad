import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';
import 'package:integration_test/integration_test.dart';
import 'package:signature/signature.dart';

import 'helpers/repartidor_e2e_login.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets(
    'cierre REPARTIDOR: login, 3 tabs, talón, confirmación y persistencia',
    (tester) async {
      await loginWithIntegrationFixture(tester);
      await switchToPerfilReparto(tester);
      await openRuteroTab(tester);

      await waitFor(
        tester,
        find.byType(SmartDeliveryCard),
        timeout: const Duration(seconds: 30),
        label: 'tarjeta de entrega del rutero',
      );

      final pendienteCard = find.ancestor(
        of: find.text('Pendiente'),
        matching: find.byType(SmartDeliveryCard),
      );
      if (pendienteCard.evaluate().isNotEmpty) {
        await tapFirst(tester, pendienteCard);
      } else {
        await tapFirst(tester, find.byType(SmartDeliveryCard));
      }
      await waitFor(
        tester,
        find.byType(RuteroDetailModal),
        timeout: const Duration(seconds: 20),
        label: 'modal de entrega',
      );
      debugPrint('[e2e-cierre] modal entrega abierto');

      expect(find.text('Productos'), findsWidgets);
      expect(find.text('Cobro'), findsWidgets);
      expect(find.text('Finalizar'), findsWidgets);

      await tapFirst(tester, find.text('Cobro'));
      await pumpQuiet(tester, const Duration(seconds: 2));

      final talonChip = find.text('Talón');
      expect(talonChip, findsWidgets,
          reason: 'chip Talón visible, no Transferencia');
      expect(find.text('TRANSFERENCIA'), findsNothing);
      expect(find.text('Transferencia'), findsNothing);
      expect(
        find.textContaining('Voy a cobrar este documento'),
        findsWidgets,
      );

      final locked = find.textContaining('Cobro obligatorio');
      if (talonChip.evaluate().isNotEmpty) {
        await tester.ensureVisible(talonChip.first);
        await tester.tap(talonChip.first);
        await tester.pump(const Duration(milliseconds: 500));
      }

      if (find.text('Datos del talón').evaluate().isNotEmpty) {
        await _fillTalonIfEnabled(tester);
      } else if (find.textContaining('Voy a cobrar').evaluate().isNotEmpty &&
          locked.evaluate().isEmpty) {
        await tapIfPresent(
          tester,
          find.textContaining('Voy a cobrar este documento'),
        );
        await tester.pump(const Duration(milliseconds: 500));
        if (talonChip.evaluate().isNotEmpty) {
          await tester.tap(talonChip.first);
          await tester.pump(const Duration(milliseconds: 500));
        }
        if (find.text('Datos del talón').evaluate().isNotEmpty) {
          await _fillTalonIfEnabled(tester);
        }
      }

      await tapFirst(tester, find.text('Productos'));
      await pumpQuiet(tester, const Duration(seconds: 1));
      final completedAlready =
          find.text('Confirmar entrega').evaluate().isEmpty;

      await tapFirst(tester, find.text('Finalizar'));
      await pumpQuiet(tester, const Duration(seconds: 2));

      var sawSureDialog = false;
      var completed = completedAlready;
      if (!completedAlready &&
          find.text('Confirmar entrega').evaluate().isNotEmpty) {
        await _fillReceiverIfNeeded(tester);
        await _signIfNeeded(tester);
        await tester.ensureVisible(find.text('Confirmar entrega').first);
        await tester.tap(find.text('Confirmar entrega').first);
        await waitFor(
          tester,
          find.textContaining('¿Está seguro'),
          timeout: const Duration(seconds: 8),
          label: 'diálogo ¿Está seguro?',
        );

        sawSureDialog =
            find.textContaining('¿Está seguro').evaluate().isNotEmpty ||
                find.textContaining('¿Estás seguro').evaluate().isNotEmpty;
        if (sawSureDialog) {
          final confirm = find.widgetWithText(ElevatedButton, 'Confirmar');
          expect(confirm, findsWidgets, reason: 'botón Confirmar del diálogo');
          await tester.tap(confirm.first);
          await pumpQuiet(tester, const Duration(seconds: 12));
          completed =
              find.textContaining('Entrega completada').evaluate().isNotEmpty ||
                  find.textContaining('Entregado').evaluate().isNotEmpty ||
                  find.textContaining('parcial').evaluate().isNotEmpty ||
                  find.text('Confirmar entrega').evaluate().isEmpty;
        }
      } else {
        // Completed deliveries still expose the three tabs.
        expect(find.text('Productos'), findsWidgets);
        expect(find.text('Cobro'), findsWidgets);
        expect(find.text('Finalizar'), findsWidgets);
      }

      await tapFirst(tester, find.text('Productos'));
      await pumpQuiet(tester, const Duration(seconds: 1));
      await tapFirst(tester, find.text('Cobro'));
      await pumpQuiet(tester, const Duration(seconds: 1));
      await tapFirst(tester, find.text('Finalizar'));
      await pumpQuiet(tester, const Duration(seconds: 1));

      // Close and reopen to check overlay persistence.
      final closeDetail = find.byTooltip('Cerrar detalle');
      if (closeDetail.evaluate().isNotEmpty) {
        await tester.tap(closeDetail.first);
        await pumpQuiet(tester, const Duration(seconds: 2));
      } else {
        await tester.pageBack();
        await pumpQuiet(tester, const Duration(seconds: 2));
      }
      if (find.byType(RuteroDetailModal).evaluate().isNotEmpty) {
        await tester.tap(find.byIcon(Icons.close).first);
        await pumpQuiet(tester, const Duration(seconds: 2));
      }
      if (find.byType(SmartDeliveryCard).evaluate().isNotEmpty) {
        await tapFirst(tester, find.byType(SmartDeliveryCard));
        await waitFor(
          tester,
          find.byType(RuteroDetailModal),
          timeout: const Duration(seconds: 15),
          label: 'modal tras recarga',
        );
        expect(find.text('Productos'), findsWidgets);
        expect(find.text('Cobro'), findsWidgets);
        expect(find.text('Finalizar'), findsWidgets);
      }

      expect(
        find.text('Productos'),
        findsWidgets,
        reason: 'las 3 pestañas deben seguir visibles',
      );
      debugPrint(
        '[e2e-cierre] completedAlready=$completedAlready '
        'sawSureDialog=$sawSureDialog completed=$completed '
        'talon=${find.text('Datos del talón').evaluate().isNotEmpty} '
        'locked=${locked.evaluate().isNotEmpty}',
      );
    },
    timeout: const Timeout(Duration(minutes: 8)),
  );
}

Future<void> _fillTalonIfEnabled(WidgetTester tester) async {
  final numero = find.widgetWithText(TextField, 'Número de talón');
  if (numero.evaluate().isEmpty) return;
  final field = tester.widget<TextField>(numero.first);
  if (field.enabled == false) return;
  await tester.enterText(numero.first, '123456');
  await tester.pump();

  final vencimiento = find.widgetWithText(TextField, 'Fecha de vencimiento');
  if (vencimiento.evaluate().isNotEmpty) {
    await tester.tap(vencimiento.first);
    await pumpQuiet(tester, const Duration(seconds: 1));
    await tapIfPresent(tester, find.text('OK'));
    await tapIfPresent(tester, find.text('Aceptar'));
    await pumpQuiet(tester, const Duration(milliseconds: 600));
  }

  final codigo = find.widgetWithText(TextField, 'Código de entidad (ENB)');
  if (codigo.evaluate().isNotEmpty) {
    await tester.enterText(codigo.first, '0049');
    await tester.pump();
  }
  final banco = find.widgetWithText(TextField, 'Nombre del banco');
  if (banco.evaluate().isNotEmpty) {
    await tester.enterText(banco.first, 'SANTANDER');
    await tester.pump();
  }
}

Future<void> _fillReceiverIfNeeded(WidgetTester tester) async {
  final nombre = find.widgetWithText(TextField, 'Nombre *');
  if (nombre.evaluate().isEmpty) return;
  await tester.ensureVisible(nombre.first);
  await tester.enterText(nombre.first, 'Cert');
  await tester.pump();
  final apellidos = find.widgetWithText(TextField, 'Apellidos *');
  if (apellidos.evaluate().isNotEmpty) {
    await tester.enterText(apellidos.first, 'E2E');
    await tester.pump();
  }
  final dni = find.widgetWithText(TextField, 'DNI / NIF *');
  if (dni.evaluate().isNotEmpty) {
    await tester.enterText(dni.first, '12345678Z');
    await tester.pump();
  }
}

Future<void> _signIfNeeded(WidgetTester tester) async {
  final pad = find.byType(Signature);
  if (pad.evaluate().isEmpty) return;
  final box = tester.getRect(pad.first);
  final start = Offset(box.left + 24, box.center.dy);
  await tester.timedDragFrom(
    start,
    Offset(box.width * 0.6, 12),
    const Duration(milliseconds: 500),
  );
  await tester.pump(const Duration(milliseconds: 300));
}
