import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_client_list_item.dart';

void main() {
  Widget buildItem(Map<String, dynamic> client) {
    return MaterialApp(
      theme: AppTheme.darkTheme,
      home: Scaffold(
        body: SizedBox(
          width: 420,
          child: RuteroClientListItem(
            client: client,
            index: 1,
            formatCurrency: (value) => '${value.toStringAsFixed(2)} EUR',
            formatVariation: (value) => value.toStringAsFixed(1),
            onTap: () {},
            onMapTap: () {},
            onCallTap: () {},
            selectedYear: 2026,
            completedWeeks: 1,
          ),
        ),
      ),
    );
  }

  Map<String, dynamic> clientWithOrderState(String? state) {
    return {
      'code': '4300000001',
      'name': 'Cliente Demo',
      'address': 'Calle Principal',
      'city': 'Madrid',
      'phones': const <Map<String, dynamic>>[],
      'status': const <String, dynamic>{
        'ytdSales': 100,
        'ytdPrevYear': 50,
        'prevYearTotal': 500,
        'yoyVariation': 20,
        'isPositive': true,
      },
      if (state != null)
        'orderStatus': {
          'state': state,
        },
    };
  }

  testWidgets('shows confirmed sale status clearly', (tester) async {
    await tester.pumpWidget(buildItem(clientWithOrderState('CONFIRMADO')));

    expect(find.text('VENTA CONFIRMADA'), findsOneWidget);
  });

  testWidgets('shows draft order status clearly', (tester) async {
    await tester.pumpWidget(buildItem(clientWithOrderState('BORRADOR')));

    expect(find.text('PEDIDO BORRADOR'), findsOneWidget);
  });

  testWidgets('shows no sale status when client has no order status',
      (tester) async {
    await tester.pumpWidget(buildItem(clientWithOrderState(null)));

    expect(find.text('SIN VENTA'), findsOneWidget);
  });
}
