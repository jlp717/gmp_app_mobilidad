import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/widgets/liquidacion_diaria_view.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });

  testWidgets('closed liquidacion Ver PDF pushes PdfPreviewScreen',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final ingreso = TextEditingController(text: '0.00');
    addTearDown(ingreso.dispose);

    const closed = RepartidorLiquidacionResult(
      created: true,
      id: '701',
      marker: 'marker-701',
      repartidorId: '94',
      date: '2026-08-19',
      status: 'CLOSED',
      snapshot: RepartidorLiquidacionSnapshot(
        deliveries: 100,
        payments: 100,
        expenses: 0,
        adjustments: 0,
        bankDeposits: 0,
        pending: 0,
        openingBalance: 0,
        balance: 100,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              return Scaffold(
                body: LiquidacionDiariaScreen(
                  gmpRef: 'GMP-94',
                  repartidorId: '94',
                  sessionDate: DateTime(2026, 8, 19),
                  summary: RepartidorDailySummary(
                    repartidorId: '94',
                    date: '2026-08-19',
                    totalEfectivo: 100,
                    totalCheques: 0,
                    totalTarjeta: 0,
                    totalPostdatados: 0,
                    saldoActual: 0,
                    totalCobrosDia: 100,
                    gastos: 0,
                    totalAIngresar: 100,
                    cobrosCount: 0,
                  ),
                  ingresoBancoController: ingreso,
                  isClosed: true,
                  isAggregate: false,
                  isSaving: false,
                  canCreateAdjustments: false,
                  isSubmittingEntry: false,
                  closedResult: closed,
                  onBack: null,
                  onSave: () {},
                  onExpense: () {},
                  onBankDeposit: () {},
                  onAdjustment: () {},
                  onPreviewPdf: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => PdfPreviewScreen(
                          pdfBytes: Uint8List.fromList(
                            const <int>[0x25, 0x50, 0x44, 0x46],
                          ),
                          title: 'Liquidación diaria 94',
                          fileName: 'Liquidacion_701.pdf',
                        ),
                      ),
                    );
                  },
                  onSharePdf: () {},
                  cobrosPanel: const SizedBox.shrink(),
                  ledgerPanel: null,
                ),
              );
            },
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Ver PDF'), findsNothing);
    expect(find.byTooltip('Ver PDF'), findsOneWidget);
    expect(find.byType(PdfPreviewScreen), findsNothing);

    final previewButton = find.ancestor(
      of: find.byTooltip('Ver PDF'),
      matching: find.byType(IconButton),
    );
    await tester.ensureVisible(previewButton);
    tester.widget<IconButton>(previewButton).onPressed!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(PdfPreviewScreen), findsOneWidget);
  });
}
