import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';

EntregaItem _item(String itemId, String description) => EntregaItem(
      itemId: itemId,
      codigoArticulo: 'ART-REPETIDO',
      descripcion: description,
      cantidadPedida: 2,
    );

void main() {
  group('canonical delivery line identity', () {
    test('same article remains two independent LINEA_ID entries', () {
      final items = <EntregaItem>[
        _item('LINEA-1', 'Primera línea'),
        _item('LINEA-2', 'Segunda línea'),
      ];

      expect(validateRuteroLineIdentities(items), isNull);
      expect(items.map(ruteroLineKey), <String>['LINEA-1', 'LINEA-2']);
      expect(<String, double>{
        for (final item in items) ruteroLineKey(item): 2,
      }, hasLength(2));
    });

    test('empty or unfinished line loads fail closed before submit', () {
      expect(
        validateRuteroLoadedDeliveryLines(
          items: const <EntregaItem>[],
          isLoading: false,
        ),
        isNotNull,
      );
      expect(
        validateRuteroLoadedDeliveryLines(
          items: const <EntregaItem>[],
          isLoading: true,
        ),
        isNotNull,
      );
      expect(
        validateRuteroLoadedDeliveryLines(
          items: <EntregaItem>[_item('LINEA-1', 'Válida')],
          isLoading: false,
          loadError: 'Error de carga',
        ),
        'Error de carga',
      );
    });

    test('missing and duplicate LINEA_ID fail closed', () {
      expect(
        validateRuteroLineIdentities(<EntregaItem>[_item('', 'Sin ID')]),
        isNotNull,
      );
      expect(
        validateRuteroLineIdentities(<EntregaItem>[
          _item('LINEA-1', 'Primera línea'),
          _item('LINEA-1', 'Duplicada'),
        ]),
        isNotNull,
      );
    });
  });

  testWidgets('callbacks use LINEA_ID for repeated article codes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final changed = <String>[];
    final items = <EntregaItem>[
      _item('LINEA-1', 'Primera línea'),
      _item('LINEA-2', 'Segunda línea'),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailProducts(
            items: items,
            isLoadingItems: false,
            itemsError: null,
            productChecked: const <String, bool>{},
            productQuantities: const <String, double>{
              'LINEA-1': 1,
              'LINEA-2': 2,
            },
            ordenPreparacion: null,
            onProductCheckedChanged: (lineId, _) => changed.add(lineId),
            onQuantityChanged: (lineId, value) {},
            onShowQuantityEditDialog: (item, value) {},
            onRetryItems: () {},
            onConfirmAll: () {},
            onContinueToPayment: () {},
            onOpenFicha: (_) {},
            onShowFullscreenImage: (url, name) {},
          ),
        ),
      ),
    );

    await tester.tap(find.text('Primera línea'));
    await tester.tap(find.text('Segunda línea'));
    await tester.pump();

    expect(changed, <String>['LINEA-1', 'LINEA-2']);
  });

  testWidgets('missing LINEA_ID renders blocking error', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailProducts(
            items: <EntregaItem>[_item('', 'Sin ID')],
            isLoadingItems: false,
            itemsError: null,
            productChecked: const <String, bool>{},
            productQuantities: const <String, double>{},
            ordenPreparacion: null,
            onProductCheckedChanged: (lineId, value) {},
            onQuantityChanged: (lineId, value) {},
            onShowQuantityEditDialog: (item, value) {},
            onRetryItems: () {},
            onConfirmAll: () {},
            onContinueToPayment: () {},
            onOpenFicha: (_) {},
            onShowFullscreenImage: (url, name) {},
          ),
        ),
      ),
    );

    expect(find.textContaining('identificador'), findsOneWidget);
    expect(find.text('CONTINUAR AL PAGO'), findsNothing);
  });

  testWidgets('retry button invokes the item reload callback', (tester) async {
    var retryCount = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailProducts(
            items: const <EntregaItem>[],
            isLoadingItems: false,
            itemsError: 'No se pudieron cargar las líneas',
            productChecked: const <String, bool>{},
            productQuantities: const <String, double>{},
            ordenPreparacion: null,
            onProductCheckedChanged: (lineId, value) {},
            onQuantityChanged: (lineId, value) {},
            onShowQuantityEditDialog: (item, value) {},
            onRetryItems: () => retryCount += 1,
            onConfirmAll: () {},
            onContinueToPayment: () {},
            onOpenFicha: (_) {},
            onShowFullscreenImage: (url, name) {},
          ),
        ),
      ),
    );

    await tester.tap(find.text('Reintentar'));

    expect(retryCount, 1);
  });
}
