import 'dart:typed_data';

import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

/// Builds / shares daily liquidacion PDF (commercial-style #003d7a).
class LiquidacionPdfBuilder {
  LiquidacionPdfBuilder._();

  static const _primary = '#003d7a';
  static const _secondary = '#1a5490';
  static const _light = '#f8f9fa';

  static final _money = NumberFormat.currency(
    locale: 'es_ES',
    symbol: '€',
    decimalDigits: 2,
  );

  static Future<Uint8List> buildBytes({
    required String repartidorId,
    required DateTime date,
    required RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  }) async {
    final pdf = pw.Document();
    final dateLabel = DateFormat('EEEE d MMMM yyyy', 'es_ES').format(date);
    final diferencia = summary.totalAIngresar - summary.saldoActual;
    final balanced = diferencia.abs() < 0.01;

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(36),
        header: (_) => _header(repartidorId, dateLabel),
        footer: (ctx) => pw.Align(
          alignment: pw.Alignment.centerRight,
          child: pw.Text(
            'Página ${ctx.pageNumber}/${ctx.pagesCount} · GMP Mobilidad · datos live',
            style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey600),
          ),
        ),
        build: (_) => [
          // Hero total (same signal as commercial liquidacion UI)
          pw.Container(
            width: double.infinity,
            padding: const pw.EdgeInsets.all(16),
            decoration: pw.BoxDecoration(
              color: PdfColor.fromHex(_secondary),
              borderRadius: pw.BorderRadius.circular(8),
            ),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'TOTAL A INGRESAR',
                  style: pw.TextStyle(
                    color: PdfColors.white,
                    fontSize: 10,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.SizedBox(height: 6),
                pw.Text(
                  _money.format(summary.totalAIngresar),
                  style: pw.TextStyle(
                    color: PdfColors.white,
                    fontSize: 26,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.SizedBox(height: 4),
                pw.Text(
                  balanced
                      ? 'Cuadrada'
                      : 'Descuadre ${_money.format(diferencia)}',
                  style: pw.TextStyle(
                    color:
                        balanced ? PdfColors.lightGreen100 : PdfColors.amber100,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          pw.SizedBox(height: 16),
          _sectionTitle('COBROS DEL DÍA'),
          _kpiGrid([
            ('Efectivo', summary.totalEfectivo),
            ('Cheques', summary.totalCheques),
            ('Tarjeta', summary.totalTarjeta),
            ('Postdatados', summary.totalPostdatados),
          ]),
          pw.SizedBox(height: 16),
          _sectionTitle('BALANCE ERP / APP'),
          _row('Entregado ERP', summary.entregado),
          _row('Deuda pendiente ERP', summary.deudaPendiente),
          _row('Saldo actual', summary.saldoActual),
          _row('Gastos', summary.gastos),
          _row('Total a ingresar', summary.totalAIngresar, emphasize: true),
          _row('Diferencia (ingreso − saldo)', diferencia),
          if (ledger != null) ...[
            pw.SizedBox(height: 16),
            _sectionTitle('DESGLOSE LIQUIDACIÓN (DB)'),
            _row('Estado', 0, textValue: ledger.status),
            ...ledger.expenses.map(
              (e) => _row('Gasto · ${e.detail}', e.amount),
            ),
            ...ledger.bankDeposits.map(
              (e) => _row('Ingreso · ${e.detail}', e.amount),
            ),
            ...ledger.adjustments.map(
              (e) => _row('Ajuste · ${e.detail}', e.amount),
            ),
            _row('Total gastos', ledger.expensesTotal),
            _row('Total ingresos', ledger.bankDepositsTotal),
            _row('Total ajustes', ledger.adjustmentsTotal),
          ],
          if (summary.cobros.isNotEmpty) ...[
            pw.SizedBox(height: 18),
            _sectionTitle('COBROS DETALLE'),
            pw.TableHelper.fromTextArray(
              headers: const ['Cliente', 'Tipo', 'Importe'],
              data: summary.cobros
                  .take(40)
                  .map(
                    (c) => [
                      c.nombreCliente.isEmpty
                          ? c.codigoCliente
                          : c.nombreCliente,
                      c.tipoCobro,
                      _money.format(c.importe),
                    ],
                  )
                  .toList(),
              headerStyle: pw.TextStyle(
                color: PdfColors.white,
                fontWeight: pw.FontWeight.bold,
                fontSize: 10,
              ),
              headerDecoration:
                  pw.BoxDecoration(color: PdfColor.fromHex(_primary)),
              cellStyle: const pw.TextStyle(fontSize: 9),
              cellAlignment: pw.Alignment.centerLeft,
              headerAlignment: pw.Alignment.centerLeft,
            ),
          ],
        ],
      ),
    );

    return pdf.save();
  }

  static Future<void> preview({
    required String repartidorId,
    required DateTime date,
    required RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  }) async {
    final bytes = await buildBytes(
      repartidorId: repartidorId,
      date: date,
      summary: summary,
      ledger: ledger,
    );
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static Future<void> share({
    required String repartidorId,
    required DateTime date,
    required RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  }) async {
    final bytes = await buildBytes(
      repartidorId: repartidorId,
      date: date,
      summary: summary,
      ledger: ledger,
    );
    final ymd =
        '${date.year}${date.month.toString().padLeft(2, '0')}${date.day.toString().padLeft(2, '0')}';
    final name = 'Liquidacion_${repartidorId}_$ymd.pdf';
    await Printing.sharePdf(bytes: bytes, filename: name);
  }

  static Future<void> shareViaSystem({
    required String repartidorId,
    required DateTime date,
    required RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  }) async {
    final bytes = await buildBytes(
      repartidorId: repartidorId,
      date: date,
      summary: summary,
      ledger: ledger,
    );
    final ymd =
        '${date.year}${date.month.toString().padLeft(2, '0')}${date.day.toString().padLeft(2, '0')}';
    final name = 'Liquidacion_${repartidorId}_$ymd.pdf';
    await Share.shareXFiles(
      [
        XFile.fromData(
          bytes,
          mimeType: 'application/pdf',
          name: name,
        ),
      ],
      subject: 'Liquidación diaria $repartidorId',
      text: 'Liquidación diaria GMP · $ymd',
    );
  }

  static pw.Widget _header(String repartidorId, String dateLabel) {
    return pw.Container(
      margin: const pw.EdgeInsets.only(bottom: 18),
      padding: const pw.EdgeInsets.all(14),
      decoration: pw.BoxDecoration(
        color: PdfColor.fromHex(_primary),
        borderRadius: pw.BorderRadius.circular(8),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                'LIQUIDACIÓN DIARIA',
                style: pw.TextStyle(
                  color: PdfColors.white,
                  fontSize: 16,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
              pw.SizedBox(height: 4),
              pw.Text(
                'Repartidor $repartidorId',
                style: const pw.TextStyle(color: PdfColors.white, fontSize: 11),
              ),
            ],
          ),
          pw.Text(
            dateLabel,
            style: const pw.TextStyle(color: PdfColors.white, fontSize: 11),
          ),
        ],
      ),
    );
  }

  static pw.Widget _sectionTitle(String label) {
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 8),
      child: pw.Text(
        label,
        style: pw.TextStyle(
          color: PdfColor.fromHex(_secondary),
          fontSize: 12,
          fontWeight: pw.FontWeight.bold,
        ),
      ),
    );
  }

  static pw.Widget _kpiGrid(List<(String, double)> items) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(10),
      decoration: pw.BoxDecoration(
        color: PdfColor.fromHex(_light),
        borderRadius: pw.BorderRadius.circular(8),
      ),
      child: pw.Row(
        children: [
          for (final item in items)
            pw.Expanded(
              child: pw.Column(
                children: [
                  pw.Text(
                    item.$1,
                    style: const pw.TextStyle(
                      fontSize: 9,
                      color: PdfColors.grey700,
                    ),
                  ),
                  pw.SizedBox(height: 4),
                  pw.Text(
                    _money.format(item.$2),
                    style: pw.TextStyle(
                      fontSize: 12,
                      fontWeight: pw.FontWeight.bold,
                      color: PdfColor.fromHex(_primary),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static pw.Widget _row(
    String label,
    double value, {
    bool emphasize = false,
    String? textValue,
  }) {
    return pw.Container(
      padding: const pw.EdgeInsets.symmetric(vertical: 6),
      decoration: const pw.BoxDecoration(
        border: pw.Border(
          bottom: pw.BorderSide(color: PdfColors.grey300, width: 0.5),
        ),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(
            label,
            style: pw.TextStyle(
              fontSize: 10,
              fontWeight: emphasize ? pw.FontWeight.bold : pw.FontWeight.normal,
            ),
          ),
          pw.Text(
            textValue ?? _money.format(value),
            style: pw.TextStyle(
              fontSize: 11,
              fontWeight: emphasize ? pw.FontWeight.bold : pw.FontWeight.normal,
              color: emphasize ? PdfColor.fromHex(_primary) : PdfColors.black,
            ),
          ),
        ],
      ),
    );
  }
}
