import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';

EntregaItem _line({
  required String id,
  required String name,
  double qty = 1,
  double unitPrice = 10,
}) {
  return EntregaItem(
    itemId: id,
    codigoArticulo: id,
    descripcion: name,
    cantidadPedida: qty,
    precioUnitario: unitPrice,
  );
}

Widget _wrap(
  Widget child, {
  Size size = const Size(390, 700),
  EdgeInsets padding = const EdgeInsets.only(bottom: 48),
}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(
        size: size,
        padding: padding,
      ),
      child: Scaffold(
        body: child,
      ),
    ),
  );
}

RuteroDetailProducts _products({
  required List<EntregaItem> items,
  VoidCallback? onNoDelivery,
}) {
  final checked = <String, bool>{
    for (final item in items) item.itemId: false,
  };
  if (items.isNotEmpty) {
    checked[items.first.itemId] = true;
  }
  final quantities = <String, double>{
    for (final item in items) item.itemId: item.cantidadPedida.toDouble(),
  };
  return RuteroDetailProducts(
    items: items,
    isLoadingItems: false,
    itemsError: null,
    productChecked: checked,
    productQuantities: quantities,
    ordenPreparacion: '12',
    canonicalDocumentTotal: 31,
    quantitiesChanged: false,
    onProductCheckedChanged: (_, __) {},
    onQuantityChanged: (_, __) {},
    onShowQuantityEditDialog: (_, __) {},
    onRetryItems: () {},
    onConfirmAll: () {},
    onContinueToPayment: () {},
    onNoDelivery: onNoDelivery ?? () {},
    onOpenFicha: (_) {},
    onShowFullscreenImage: (_, __) {},
  );
}

void main() {
  final twoProducts = [
    _line(id: 'A1', name: 'ALMEJA MARRON'),
    _line(id: 'A2', name: 'MEJILLON GALLEGO'),
  ];

  testWidgets(
      'lista de productos y CTAs visibles sin hueco entre Continuar y No entrega',
      (tester) async {
    await tester.pumpWidget(
      _wrap(_products(items: twoProducts)),
    );

    expect(find.text('ALMEJA MARRON'), findsOneWidget);
    expect(find.text('MEJILLON GALLEGO'), findsOneWidget);
    expect(find.text('Continuar al cobro'), findsOneWidget);
    expect(
      find.text('No entrega (cerrado o no disponible)'),
      findsOneWidget,
    );
    expect(find.text('Marcar todo'), findsOneWidget);
    expect(find.textContaining('Importe: 31,00 €'), findsOneWidget);
    expect(find.textContaining('Orden prep. 12'), findsOneWidget);

    expect(find.text('ALMEJA MARRON').hitTestable(), findsOneWidget);
    expect(find.text('MEJILLON GALLEGO').hitTestable(), findsOneWidget);
    expect(find.text('Continuar al cobro').hitTestable(), findsOneWidget);
    expect(
      find.text('No entrega (cerrado o no disponible)').hitTestable(),
      findsOneWidget,
    );

    final continueRect = tester.getRect(find.text('Continuar al cobro'));
    final noEntregaRect = tester.getRect(
      find.text('No entrega (cerrado o no disponible)'),
    );
    expect(noEntregaRect.top - continueRect.bottom, lessThan(32));
    expect(noEntregaRect.top, greaterThan(continueRect.bottom));
  });

  testWidgets('en teléfono pequeño los dos productos siguen visibles',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        _products(items: twoProducts),
        size: const Size(360, 640),
      ),
    );

    expect(find.text('ALMEJA MARRON').hitTestable(), findsOneWidget);
    expect(find.text('MEJILLON GALLEGO').hitTestable(), findsOneWidget);
    expect(find.text('Continuar al cobro'), findsOneWidget);
    expect(
      find.text('No entrega (cerrado o no disponible)'),
      findsOneWidget,
    );
  });

  testWidgets('en landscape compacto no se abre un hueco entre CTAs',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        _products(items: twoProducts),
        size: const Size(700, 360),
        padding: const EdgeInsets.only(bottom: 24),
      ),
    );

    final continueRect = tester.getRect(find.text('Continuar al cobro'));
    final noEntregaRect = tester.getRect(
      find.text('No entrega (cerrado o no disponible)'),
    );
    expect(noEntregaRect.top - continueRect.bottom, lessThan(32));
    expect(find.text('ALMEJA MARRON').hitTestable(), findsOneWidget);
  });
}
