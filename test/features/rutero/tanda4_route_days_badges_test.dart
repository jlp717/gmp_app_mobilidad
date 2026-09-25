import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_client_list_item.dart';

/// REQ-24 tanda4: badges Ruta/Visita/Reparto en rutero; vacío oculta.
void main() {
  Widget wrap(Map<String, dynamic> client) {
    return MaterialApp(
      home: Scaffold(
        body: RuteroClientListItem(
          client: client,
          index: 1,
          formatCurrency: (v) => '${v.toStringAsFixed(2)} €',
          formatVariation: (v) => '${v.toStringAsFixed(1)}%',
          onTap: () {},
          onMapTap: () {},
          onCallTap: () {},
        ),
      ),
    );
  }

  testWidgets('renderiza mismos literales que lista clientes', (tester) async {
    await tester.pumpWidget(wrap({
      'name': 'Bar Pepe',
      'code': '430001',
      'address': 'Calle Mayor 1',
      'city': 'Lorca',
      'status': {'ytdSales': 100.0, 'isPositive': true},
      'route': 'R7',
      'visitDaysShort': 'L,X',
      'deliveryDaysShort': 'J',
    }));
    await tester.pumpAndSettle();
    expect(find.text('Ruta R7'), findsOneWidget);
    expect(find.text('Visita: L,X'), findsOneWidget);
    expect(find.text('Reparto: J'), findsOneWidget);
  });

  testWidgets('sin días → sin badges, sin crash', (tester) async {
    await tester.pumpWidget(wrap({
      'name': 'Bar Sin Ruta',
      'code': '430002',
      'status': {'ytdSales': 0.0, 'isPositive': false},
    }));
    await tester.pumpAndSettle();
    expect(find.textContaining('Ruta '), findsNothing);
    expect(find.textContaining('Visita:'), findsNothing);
    expect(find.textContaining('Reparto:'), findsNothing);
  });
}
