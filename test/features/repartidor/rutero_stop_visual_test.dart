import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_stop_visual.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';
import 'package:intl/date_symbol_data_local.dart';

AlbaranEntrega _stop({
  bool esCTR = false,
  bool puedeCobrarse = false,
  EstadoEntrega estado = EstadoEntrega.pendiente,
  bool cobrado = false,
}) {
  return AlbaranEntrega(
    id: '2026-P-15-2296-C1',
    numeroAlbaran: 2296,
    ejercicio: 2026,
    serie: 'P',
    terminal: 15,
    codigoCliente: 'C1',
    nombreCliente: 'Cliente',
    fecha: '2026-10-05',
    importeTotal: 20.7,
    esCTR: esCTR,
    puedeCobrarse: puedeCobrarse,
    estado: estado,
    cobrado: cobrado,
    importeCobrado: cobrado ? 20.7 : null,
  );
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });

  test('el rojo es solo el cobro obligatorio pendiente', () {
    final visual = ruteroRowVisual(_stop(esCTR: true, puedeCobrarse: true));
    expect(visual.tone, RuteroRowTone.cobroObligatorio);
    expect(visual.label, 'Cobro obligatorio');
  });

  test('entrega pendiente sin cobro obligatorio no usa el tono rojo', () {
    final visual = ruteroRowVisual(_stop());
    expect(visual.tone, RuteroRowTone.entregaPendiente);
    expect(visual.label, 'Entrega pendiente');
    expect(visual.tone, isNot(RuteroRowTone.cobroObligatorio));
  });

  test('cobro opcional se distingue de la entrega pendiente', () {
    final visual = ruteroRowVisual(_stop(puedeCobrarse: true));
    expect(visual.tone, RuteroRowTone.cobroOpcional);
    expect(visual.label, contains('cobro opcional'));
  });

  test('un cobro ya registrado deja de marcarse como obligatorio', () {
    final visual = ruteroRowVisual(
      _stop(esCTR: true, estado: EstadoEntrega.entregado, cobrado: true),
    );
    expect(visual.tone, RuteroRowTone.entregado);
  });

  testWidgets(
      'la fila muestra etiqueta e icono, y el rojo solo si el cobro es obligatorio',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              SmartDeliveryCard(albaran: _stop(), onTap: () {}),
              SmartDeliveryCard(
                albaran: _stop(esCTR: true, puedeCobrarse: true),
                onTap: () {},
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Entrega pendiente'), findsWidgets);
    expect(find.text('Cobro obligatorio'), findsWidgets);
    expect(find.byIcon(Icons.local_shipping_outlined), findsOneWidget);
    expect(find.byIcon(Icons.priority_high), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
