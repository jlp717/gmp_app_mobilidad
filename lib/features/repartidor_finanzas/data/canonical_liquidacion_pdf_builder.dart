import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'dart:typed_data';

import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

/// Receipt PDF for a closed settlement.  This class intentionally accepts the
/// server's immutable close response, never the mutable daily form summary.
class CanonicalLiquidacionPdfBuilder {
  CanonicalLiquidacionPdfBuilder._();

  static final _money = NumberFormat.currency(
    locale: 'es_ES',
    // The standard PDF font used by the receipt does not contain U+20AC.
    // Keep the monetary output readable on every supported Android device.
    symbol: 'EUR',
    decimalDigits: 2,
  );

  static void _validateClosedSnapshot(RepartidorLiquidacionSnapshot snapshot) {
    final values = <double>[
      snapshot.deliveries,
      snapshot.payments,
      snapshot.expenses,
      snapshot.adjustments,
      snapshot.bankDeposits,
      snapshot.pending,
      snapshot.openingBalance,
      snapshot.balance,
    ];
    for (final value in values) {
      if (!value.isFinite ||
          ((value * 100).round() - value * 100).abs() > 0.000001) {
        throw StateError('La instantanea cerrada contiene importes invalidos');
      }
    }
  }

  // Built-in Helvetica keeps offline generation deterministic; restrict
  // dynamic labels to its portable subset instead of fetching a web font.
  static String _portablePdfText(String value) => value
      .replaceAll('á', 'a')
      .replaceAll('é', 'e')
      .replaceAll('í', 'i')
      .replaceAll('ó', 'o')
      .replaceAll('ú', 'u')
      .replaceAll('Á', 'A')
      .replaceAll('É', 'E')
      .replaceAll('Í', 'I')
      .replaceAll('Ó', 'O')
      .replaceAll('Ú', 'U')
      .replaceAll('ñ', 'n')
      .replaceAll('Ñ', 'N')
      .replaceAll('€', 'EUR')
      .replaceAll(RegExp(r'[^\x20-\x7e]'), '?');

  static String _formatPortableMoney(double value) =>
      _portablePdfText(_money.format(value)).replaceAll('\u00a0', ' ');

  static Future<Uint8List> buildBytes({
    required RepartidorLiquidacionResult liquidacion,
  }) async {
    if (liquidacion.status != 'CLOSED' || liquidacion.id.trim().isEmpty) {
      throw ArgumentError('La liquidacion cerrada es obligatoria para el PDF');
    }
    final date = DateTime.tryParse(liquidacion.date);
    if (date == null) {
      throw ArgumentError('La fecha de la liquidacion cerrada es invalida');
    }
    final snapshot = liquidacion.snapshot;
    _validateClosedSnapshot(snapshot);
    final expectedBalance = snapshot.openingBalance +
        snapshot.payments -
        snapshot.expenses +
        snapshot.adjustments -
        snapshot.bankDeposits;
    if ((expectedBalance - snapshot.balance).abs() > 0.001) {
      throw StateError('La instantanea cerrada no cuadra');
    }

    final pdf = pw.Document();
    final dateLabel = DateFormat('yyyy-MM-dd').format(date);
    const primary = PdfColor.fromInt(0xff003d7a);
    const green = PdfColor.fromInt(0xff067a58);
    const light = PdfColor.fromInt(0xffeef6ff);
    pw.Widget amountRow(String label, double amount, {bool emphasis = false}) =>
        pw.Container(
          margin: const pw.EdgeInsets.only(bottom: 6),
          padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: pw.BoxDecoration(
            color: emphasis ? const PdfColor.fromInt(0xffe7f8f1) : light,
            borderRadius: pw.BorderRadius.circular(6),
          ),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Text(label, style: const pw.TextStyle(fontSize: 10)),
              pw.Text(
                _formatPortableMoney(amount),
                style: pw.TextStyle(
                  fontSize: 11,
                  fontWeight: pw.FontWeight.bold,
                  color: emphasis ? green : primary,
                ),
              ),
            ],
          ),
        );

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(32),
        footer: (context) => pw.Align(
          alignment: pw.Alignment.centerRight,
          child: pw.Text(
            'Liquidacion cerrada - ${context.pageNumber}/${context.pagesCount}',
            style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600),
          ),
        ),
        build: (_) => [
          pw.Container(
            padding: const pw.EdgeInsets.all(16),
            decoration: pw.BoxDecoration(
              color: primary,
              borderRadius: pw.BorderRadius.circular(8),
            ),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'Liquidacion diaria cerrada',
                  style: pw.TextStyle(
                    color: PdfColors.white,
                    fontSize: 18,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.SizedBox(height: 5),
                pw.Text(
                  'Operacion ${_portablePdfText(liquidacion.id)}',
                  style: pw.TextStyle(
                    color: PdfColors.white,
                    fontSize: 11,
                  ),
                ),
                pw.Text(
                  'Repartidor ${_portablePdfText(liquidacion.repartidorId)} - $dateLabel',
                  style: pw.TextStyle(
                    color: PdfColors.white,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          pw.SizedBox(height: 18),
          pw.Text(
            'Instantanea de cierre',
            style: pw.TextStyle(
              color: primary,
              fontSize: 14,
              fontWeight: pw.FontWeight.bold,
            ),
          ),
          pw.SizedBox(height: 8),
          amountRow('Saldo inicial', snapshot.openingBalance),
          amountRow('Cobros cerrados', snapshot.payments),
          amountRow('Gastos cerrados', snapshot.expenses),
          amountRow('Ajustes cerrados', snapshot.adjustments),
          amountRow('Ingresos bancarios cerrados', snapshot.bankDeposits),
          amountRow('Saldo de cierre', snapshot.balance, emphasis: true),
        ],
      ),
    );
    return pdf.save();
  }

  static Future<void> preview({
    required RepartidorLiquidacionResult liquidacion,
  }) async {
    final bytes = await buildBytes(liquidacion: liquidacion);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static Future<void> share({
    required RepartidorLiquidacionResult liquidacion,
  }) async {
    final bytes = await buildBytes(liquidacion: liquidacion);
    await Share.shareXFiles(
      [
        XFile.fromData(
          bytes,
          mimeType: 'application/pdf',
          name: 'Liquidacion_${liquidacion.id}.pdf',
        ),
      ],
      subject: 'Liquidación diaria ${liquidacion.repartidorId}',
    );
  }
}
