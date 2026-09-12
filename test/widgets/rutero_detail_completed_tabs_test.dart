import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_completed.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_tab_bar.dart';

class _TabHarness extends StatefulWidget {
  @override
  State<_TabHarness> createState() => _TabHarnessState();
}

class _TabHarnessState extends State<_TabHarness>
    with SingleTickerProviderStateMixin {
  late final TabController controller;

  @override
  void initState() {
    super.initState();
    controller = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Column(
          children: [
            RuteroDetailTabBar(
              tabController: controller,
              isUrgent: false,
            ),
            const Expanded(child: SizedBox.shrink()),
          ],
        ),
      ),
    );
  }
}

void main() {
  testWidgets(
      'tras completar siguen las tres pestañas Productos / Cobro / Finalizar',
      (tester) async {
    await tester.pumpWidget(_TabHarness());
    expect(find.text('Productos'), findsOneWidget);
    expect(find.text('Cobro'), findsOneWidget);
    expect(find.text('Finalizar'), findsOneWidget);
  });

  testWidgets(
      'productos completados son solo lectura y muestran importe entregado',
      (tester) async {
    final item = EntregaItem(
      itemId: '1',
      codigoArticulo: 'ART-1',
      descripcion: 'Aceite',
      cantidadPedida: 2,
      precioUnitario: 10,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailProducts(
            items: [item],
            isLoadingItems: false,
            itemsError: null,
            productChecked: const {'1': true},
            productQuantities: const {'1': 3},
            ordenPreparacion: '1',
            readOnly: true,
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
    );

    expect(find.text('Continuar a cobro'), findsNothing);
    expect(
        find.textContaining('Importe según unidades: 30,00'), findsOneWidget);
    expect(ruteroMaxDeliverableQuantity(2), 20);
    expect(
      ruteroLineDeliveredAmount(item: item, deliveredQty: 3),
      30,
    );
  });

  testWidgets('finalizar completado conserva PDFs', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailCompleted(
            albaran: AlbaranEntrega(
              id: '2026-A-1-42-C1',
              numeroAlbaran: 42,
              ejercicio: 2026,
              serie: 'P',
              terminal: 15,
              codigoCliente: 'C1',
              nombreCliente: 'Cliente prueba',
              fecha: '2026-08-18',
              importeTotal: 30,
              codigoRepartidor: '08',
              estado: EstadoEntrega.entregado,
            ),
            onPreviewDeliveryNotePdf: () {},
            onShareDeliveryNotePdf: () {},
            onShareDeliveryNoteWhatsApp: () {},
            onPreviewCommercialPdf: () {},
            onShareCommercialPdf: () {},
            onShareCommercialWhatsApp: () {},
            buildPrinterConfigSection: () => const SizedBox.shrink(),
            tieneImpresora: false,
            items: const <EntregaItem>[],
            onShowZebraPrintPreview: () {},
          ),
        ),
      ),
    );

    expect(find.text('Nota de entrega'), findsOneWidget);
    expect(find.text('Albarán (con firma)'), findsOneWidget);
    expect(find.text('Albarán P-15-42'), findsOneWidget);
  });
}
