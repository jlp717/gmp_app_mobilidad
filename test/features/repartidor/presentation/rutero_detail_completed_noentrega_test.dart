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
  testWidgets(
      'completed view hides the signed albarán section on '
      'no-entrega', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.noEntregado)),
    );
    expect(find.text('NO ENTREGA CONFIRMADA'), findsOneWidget);
    expect(find.textContaining('ALBARÁN (CON FIRMA)'), findsNothing);
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
    expect(find.text('ENTREGA RECHAZADA'), findsOneWidget);
    expect(find.textContaining('ALBARÁN (CON FIRMA)'), findsNothing);
    expect(find.text('Ver nota de entrega'), findsOneWidget);
  });

  testWidgets(
      'completed view keeps the signed albarán section on '
      'entregado (no regression)', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.entregado)),
    );
    expect(find.text('ENTREGA COMPLETADA'), findsOneWidget);
    expect(find.textContaining('ALBARÁN (CON FIRMA)'), findsOneWidget);
    expect(find.text('Ver Albarán'), findsOneWidget);
  });

  testWidgets(
      'completed view keeps the signed albarán section on '
      'parcial (no regression)', (tester) async {
    await tester.pumpWidget(
      _wrap(_albaranWithEstado(EstadoEntrega.parcial)),
    );
    expect(find.text('ENTREGA PARCIAL CONFIRMADA'), findsOneWidget);
    expect(find.textContaining('ALBARÁN (CON FIRMA)'), findsOneWidget);
    expect(find.text('Ver Albarán'), findsOneWidget);
  });
}
