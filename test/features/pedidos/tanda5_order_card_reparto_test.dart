import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_card.dart';

OrderSummary orderWith({
  String fechaRepartoFormatted = '24/09/2026',
  String repartidorCode = '07',
  String repartidorNombre = 'Repartidor Siete',
  String repartidorTelefono = '600112233',
}) {
  return OrderSummary(
    id: 1,
    numeroPedido: 12,
    clienteCode: 'C001',
    clienteName: 'Cliente Uno',
    vendedorCode: '01',
    fecha: '24/09/2026',
    estado: 'CONFIRMADO',
    tipoVenta: 'CC',
    total: 100,
    fechaRepartoFormatted: fechaRepartoFormatted,
    repartidorCode: repartidorCode,
    repartidorNombre: repartidorNombre,
    repartidorTelefono: repartidorTelefono,
  );
}

void main() {
  testWidgets('muestra dia reparto + quien reparte + botones contacto', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: OrderCard(order: orderWith(), onTap: () {})),
      ),
    );
    expect(find.textContaining('Reparto:'), findsOneWidget);
    expect(find.textContaining('07'), findsWidgets);
    expect(find.text('Llamar'), findsOneWidget);
    expect(find.text('SMS'), findsOneWidget);
  });

  testWidgets('sin telefono verificado botones deshabilitados con label', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OrderCard(order: orderWith(repartidorTelefono: ''), onTap: () {}),
        ),
      ),
    );
    final disabledTaps = tester
        .widgetList<InkWell>(find.byType(InkWell))
        .where((w) => w.onTap == null)
        .length;
    expect(disabledTaps, greaterThanOrEqualTo(2));
  });
}
