import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';

EntregaItem _line({
  required String id,
  required double qty,
  required double unitPrice,
}) {
  return EntregaItem(
    itemId: id,
    codigoArticulo: id,
    descripcion: 'Articulo $id',
    cantidadPedida: qty,
    precioUnitario: unitPrice,
  );
}

void main() {
  testWidgets('untouched products show CPC 31,00 not LAC 30,80',
      (tester) async {
    final items = [
      _line(id: '1', qty: 1, unitPrice: 15.4),
      _line(id: '2', qty: 1, unitPrice: 15.4),
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 800,
            child: RuteroDetailProducts(
              items: items,
              isLoadingItems: false,
              itemsError: null,
              productChecked: const {'1': true, '2': true},
              productQuantities: const {'1': 1, '2': 1},
              ordenPreparacion: null,
              canonicalDocumentTotal: 31,
              quantitiesChanged: false,
              onProductCheckedChanged: (_, __) {},
              onQuantityChanged: (_, __) {},
              onShowQuantityEditDialog: (_, __) {},
              onRetryItems: () {},
              onConfirmAll: () {},
              onContinueToPayment: () {},
              onOpenFicha: (_) {},
              onShowFullscreenImage: (_, __) {},
            ),
          ),
        ),
      ),
    );

    expect(find.textContaining('Importe: 31,00 €'), findsOneWidget);
    expect(find.textContaining('30,80'), findsNothing);
    expect(find.textContaining('29,80'), findsNothing);
    expect(find.textContaining('Importe según unidades'), findsNothing);
  });

  testWidgets('kg shows 5,75 kg and boxes show cajas', (tester) async {
    final pollo = EntregaItem(
      itemId: 'P1',
      codigoArticulo: 'POLLO',
      descripcion: 'Pollo',
      cantidadPedida: 5.75,
      unit: 'KILOGRAMOS',
      precioUnitario: 4,
    );
    final cajas = EntregaItem(
      itemId: 'C1',
      codigoArticulo: 'CAJA',
      descripcion: 'Caja aceite',
      cantidadPedida: 2,
      unit: 'CAJAS',
      precioUnitario: 10,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 900,
            child: RuteroDetailProducts(
              items: [pollo, cajas],
              isLoadingItems: false,
              itemsError: null,
              productChecked: const {'P1': true, 'C1': true},
              productQuantities: const {'P1': 5.75, 'C1': 2},
              ordenPreparacion: null,
              canonicalDocumentTotal: 43,
              quantitiesChanged: false,
              onProductCheckedChanged: (_, __) {},
              onQuantityChanged: (_, __) {},
              onShowQuantityEditDialog: (_, __) {},
              onRetryItems: () {},
              onConfirmAll: () {},
              onContinueToPayment: () {},
              onOpenFicha: (_) {},
              onShowFullscreenImage: (_, __) {},
            ),
          ),
        ),
      ),
    );

    expect(ruteroQuantityUnitLabel('KILOGRAMOS'), 'kg');
    expect(ruteroQuantityUnitLabel('CAJAS'), 'cajas');
    expect(find.text('5,75 kg'), findsOneWidget);
    expect(find.text('2 cajas'), findsOneWidget);
  });

  testWidgets('packed box line shows 1 caja not 27 pieces (ART 7020)',
      (tester) async {
    final baguette = EntregaItem(
      itemId: '1',
      codigoArticulo: '7020',
      descripcion: 'PAN BAGUETTE ARTESANA 270GR',
      cantidadPedida: 27,
      bultos: 1,
      unit: 'UNIDADES',
      precioUnitario: 0.5,
    );
    expect(ruteroPrefersBoxQuantity(baguette), isTrue);
    expect(ruteroDriverFacingOrderedQty(baguette), 1);
    expect(ruteroLineQuantityUnitLabel(baguette), 'caja');
    expect(ruteroCanonicalFromFacing(baguette, 1), 27);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 800,
            child: RuteroDetailProducts(
              items: [baguette],
              isLoadingItems: false,
              itemsError: null,
              productChecked: const {'1': true},
              productQuantities: const {'1': 27},
              ordenPreparacion: '51349',
              canonicalDocumentTotal: 14.04,
              quantitiesChanged: false,
              onProductCheckedChanged: (_, __) {},
              onQuantityChanged: (_, __) {},
              onShowQuantityEditDialog: (_, __) {},
              onRetryItems: () {},
              onConfirmAll: () {},
              onContinueToPayment: () {},
              onOpenFicha: (_) {},
              onShowFullscreenImage: (_, __) {},
            ),
          ),
        ),
      ),
    );

    expect(find.text('1 caja'), findsOneWidget);
    expect(find.text('27'), findsNothing);
    expect(find.textContaining('27 uds'), findsNothing);
  });
}
