import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_completed.dart';

void main() {
  testWidgets('la entrega completada abre la accion de WhatsApp',
      (tester) async {
    var whatsappCalls = 0;
    final albaran = AlbaranEntrega(
      id: '2026-A-1-42-C1',
      numeroAlbaran: 42,
      ejercicio: 2026,
      codigoCliente: 'C1',
      nombreCliente: 'Cliente prueba',
      fecha: '2026-08-18',
      importeTotal: 0,
      codigoRepartidor: '08',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailCompleted(
            albaran: albaran,
            onPreviewReceiptPdf: () {},
            onDownloadReceiptPdf: () {},
            onSharePdfLocally: () {},
            onShareReceiptViaWhatsApp: () => whatsappCalls += 1,
            buildPrinterConfigSection: () => const SizedBox.shrink(),
            tieneImpresora: false,
            items: const <EntregaItem>[],
            onShowZebraPrintPreview: () {},
          ),
        ),
      ),
    );

    final action = find.text('Enviar por WhatsApp');
    await tester.scrollUntilVisible(action, 250);
    await tester.tap(action);

    expect(whatsappCalls, 1);
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
            onPreviewReceiptPdf: () {},
            onDownloadReceiptPdf: () {},
            onSharePdfLocally: () {},
            onShareReceiptViaWhatsApp: () {},
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
    expect(find.text('Enviar por WhatsApp'), findsOneWidget);
  });
}
