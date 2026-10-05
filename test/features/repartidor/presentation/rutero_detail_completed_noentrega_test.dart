import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_completed.dart';

AlbaranEntrega _albaranWithEstado(EstadoEntrega estado) => AlbaranEntrega(
      id: '2026-A-1-100-1234',
      ejercicio: 2026,
      serie: 'A',
      terminal: 1,
      numeroAlbaran: 100,
      codigoCliente: '1234',
      nombreCliente: 'CLIENTE TEST',
      fecha: '2026-09-01',
      direccion: 'Calle Falsa 1',
      poblacion: 'Almería',
      importeTotal: 50,
      estado: estado,
    );

Widget _wrap(AlbaranEntrega albaran) => MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: RuteroDetailCompleted(
            albaran: albaran,
            onPreviewDeliveryNotePdf: () {},
            onShareDeliveryNotePdf: () {},
            onShareDeliveryNoteWhatsApp: () {},
            onPreviewCommercialPdf: () {},
            onShareCommercialPdf: () {},
            onShareCommercialWhatsApp: () {},
            buildPrinterConfigSection: () => const SizedBox.shrink(),
            tieneImpresora: false,
            items: const [],
            onShowZebraPrintPreview: () {},
          ),
        ),
      ),
    );

void main() {
  testWidgets('ver nota de entrega abre el PDF sin pedir confirmación',
      (tester) async {
    var opened = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: RuteroDetailCompleted(
              albaran: _albaranWithEstado(EstadoEntrega.entregado),
              onPreviewDeliveryNotePdf: () => opened += 1,
              onShareDeliveryNotePdf: () {},
              onShareDeliveryNoteWhatsApp: () {},
              onPreviewCommercialPdf: () {},
              onShareCommercialPdf: () {},
              onShareCommercialWhatsApp: () {},
              buildPrinterConfigSection: () => const SizedBox.shrink(),
              tieneImpresora: false,
              items: const [],
              onShowZebraPrintPreview: () {},
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Ver nota de entrega'));
    await tester.pump();
    expect(opened, 1);
    expect(find.text('¿Estás seguro de abrir el PDF?'), findsNothing);
    final source = File(
      'lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart',
    ).readAsStringSync();
    final start = source.indexOf('Future<void> _previewReceiptPdf()');
    final end = source.indexOf('Future<void> _downloadReceiptPdf()');
    final body = source.substring(start, end);
    expect(body.contains('confirmRepartidorAction'), isFalse);
    expect(body.contains('_previewCommercialPdf'), isFalse);
  });

  testWidgets(
      'completed view hides the signed albarán section on '
      'no-entrega', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.noEntregado)),
    );
    expect(find.text('No entrega confirmada'), findsOneWidget);
    expect(find.textContaining('Albarán (con firma)'), findsNothing);
    expect(find.text('Ver Albarán'), findsNothing);
    // The delivery note (no-entrega receipt) stays available.
    expect(find.text('Ver nota de entrega'), findsOneWidget);
  });

  testWidgets(
      'completed view hides the signed albarán section on '
      'rechazado', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.rechazado)),
    );
    expect(find.text('Entrega rechazada'), findsOneWidget);
    expect(find.textContaining('Albarán (con firma)'), findsNothing);
    expect(find.text('Ver nota de entrega'), findsOneWidget);
  });

  testWidgets(
      'completed view keeps the signed albarán section on '
      'entregado (no regression)', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.entregado)),
    );
    expect(find.text('Entrega completada'), findsOneWidget);
    expect(find.textContaining('Albarán (con firma)'), findsOneWidget);
    expect(find.text('Ver Albarán'), findsOneWidget);
  });

  testWidgets(
      'completed view keeps the signed albarán section on '
      'parcial (no regression)', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.parcial)),
    );
    expect(find.text('Entrega parcial confirmada'), findsOneWidget);
    expect(find.textContaining('Albarán (con firma)'), findsOneWidget);
    expect(find.text('Ver Albarán'), findsOneWidget);
  });
}
