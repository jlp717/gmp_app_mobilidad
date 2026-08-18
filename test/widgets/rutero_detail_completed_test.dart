import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_completed.dart';

void main() {
  testWidgets('la entrega completada conserva la accion local de WhatsApp',
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

    final action = find.text('WhatsApp (selector local)');
    await tester.scrollUntilVisible(action, 250);
    await tester.tap(action);

    expect(whatsappCalls, 1);
  });
}
