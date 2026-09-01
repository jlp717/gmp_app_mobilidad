import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_completed.dart';

void main() {
  testWidgets('entrega completada ofrece nota y albarán por separado',
      (tester) async {
    var noteWhatsApp = 0;
    var commercialPreview = 0;
    final albaran = AlbaranEntrega(
      id: '2026-A-1-42-C1',
      numeroAlbaran: 42,
      ejercicio: 2026,
      codigoCliente: 'C1',
      nombreCliente: 'Cliente prueba',
      fecha: '2026-08-18',
      importeTotal: 0,
      codigoRepartidor: '08',
      estado: EstadoEntrega.entregado,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailCompleted(
            albaran: albaran,
            onPreviewDeliveryNotePdf: () {},
            onShareDeliveryNotePdf: () {},
            onShareDeliveryNoteWhatsApp: () => noteWhatsApp += 1,
            onPreviewCommercialPdf: () => commercialPreview += 1,
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

    expect(find.text('NOTA DE ENTREGA'), findsOneWidget);
    expect(find.text('ALBARÁN (CON FIRMA)'), findsOneWidget);
    expect(find.text('Ver nota de entrega'), findsOneWidget);
    expect(find.text('Ver Albarán'), findsOneWidget);

    final noteAction = find.text('Nota por WhatsApp');
    await tester.scrollUntilVisible(noteAction, 250);
    await tester.tap(noteAction);
    expect(noteWhatsApp, 1);

    final commercialAction = find.text('Ver Albarán');
    await tester.scrollUntilVisible(commercialAction, 250);
    await tester.tap(commercialAction);
    expect(commercialPreview, 1);
  });

  testWidgets('la no-entrega es terminal y conserva la orden', (tester) async {
    final albaran = AlbaranEntrega(
      id: '2026-A-1-43-C1',
      numeroAlbaran: 43,
      ejercicio: 2026,
      codigoCliente: 'C1',
      nombreCliente: 'Cliente no disponible',
      fecha: '2026-08-19',
      importeTotal: 10,
      codigoRepartidor: '08',
      ordenPreparacion: 991,
      estado: EstadoEntrega.noEntregado,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailCompleted(
            albaran: albaran,
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

    expect(find.text('NO ENTREGA CONFIRMADA'), findsOneWidget);
    expect(find.text('Orden prep.'), findsOneWidget);
    expect(find.text('991'), findsOneWidget);
    expect(find.text('Nota por WhatsApp'), findsOneWidget);
    expect(find.text('ALBARÁN (CON FIRMA)'), findsNothing);
    expect(find.text('Ver Albarán'), findsNothing);
    expect(find.text('Compartir Albarán'), findsNothing);
    expect(find.text('Albarán por WhatsApp'), findsNothing);
  });

  testWidgets('el rechazo conserva la nota pero no ofrece documento comercial',
      (tester) async {
    final albaran = AlbaranEntrega(
      id: '2026-A-1-45-C1',
      numeroAlbaran: 45,
      ejercicio: 2026,
      codigoCliente: 'C1',
      nombreCliente: 'Cliente rechazado',
      fecha: '2026-08-21',
      importeTotal: 12,
      codigoRepartidor: '08',
      numeroFactura: 9837,
      estado: EstadoEntrega.rechazado,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailCompleted(
            albaran: albaran,
            onPreviewDeliveryNotePdf: () {},
            onShareDeliveryNotePdf: () {},
            onShareDeliveryNoteWhatsApp: () {},
            onPreviewCommercialPdf: () {},
            onShareCommercialPdf: () {},
            onShareCommercialWhatsApp: () {},
            buildPrinterConfigSection: () => const Text('PRINTER CONFIG'),
            tieneImpresora: true,
            items: <EntregaItem>[
              EntregaItem(
                itemId: 'line-1',
                codigoArticulo: 'A1',
                descripcion: 'Articulo',
                cantidadPedida: 1,
              ),
            ],
            onShowZebraPrintPreview: () {},
          ),
        ),
      ),
    );

    expect(find.text('ENTREGA RECHAZADA'), findsOneWidget);
    expect(find.text('NOTA DE ENTREGA'), findsOneWidget);
    expect(find.text('FACTURA (CON FIRMA)'), findsNothing);
    expect(find.text('Ver Factura'), findsNothing);
    expect(find.text('PRINTER CONFIG'), findsNothing);
    expect(find.text('Imprimir ticket térmico'), findsNothing);
  });

  testWidgets('si hay factura, el bloque comercial se etiqueta Factura',
      (tester) async {
    final albaran = AlbaranEntrega(
      id: '2026-A-1-44-C1',
      numeroAlbaran: 44,
      ejercicio: 2026,
      codigoCliente: 'C1',
      nombreCliente: 'Cliente factura',
      fecha: '2026-08-20',
      importeTotal: 36.4,
      codigoRepartidor: '08',
      numeroFactura: 9836,
      serieFactura: 'F',
      estado: EstadoEntrega.entregado,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailCompleted(
            albaran: albaran,
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

    expect(find.text('FACTURA (CON FIRMA)'), findsOneWidget);
    expect(find.text('Ver Factura'), findsOneWidget);
    expect(find.text('NOTA DE ENTREGA'), findsOneWidget);
  });
}
