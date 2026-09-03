import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
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
  static const _greenDark = '#067a58';
  static const _light = '#eef6ff';
  static const _cardGreen = '#e7f8f1';
  static const _cardAmber = '#fff6e0';

  static final _money = NumberFormat.currency(
    locale: 'es_ES',
    symbol: '€',
    decimalDigits: 2,
  );

  static String gmpNumber(
    String repartidorId,
    DateTime date, {
    int sequence = 0,
  }) {
    final digits = repartidorId.replaceAll(RegExp(r'\D'), '');
    final vendor = (digits.isEmpty ? '0' : digits).padLeft(3, '0');
    final safeVendor =
        vendor.length > 3 ? vendor.substring(vendor.length - 3) : vendor;
    return 'GMP ${date.year} A $safeVendor ${sequence.toString().padLeft(6, '0')}';
  }

  static Future<Uint8List> buildBytes({
    required String repartidorId,
    required DateTime date,
    required RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  }) async {
    final pdf = pw.Document();
    final dateLabel = DateFormat('yyyy-MM-dd HH:mm:ss').format(date);
    final displayNumber = gmpNumber(repartidorId, date);

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.fromLTRB(28, 28, 28, 36),
        header: (_) => _header(displayNumber, repartidorId, dateLabel),
        footer: (ctx) => pw.Align(
          alignment: pw.Alignment.centerRight,
          child: pw.Text(
            'Página ${ctx.pageNumber}/${ctx.pagesCount} · Granja Mari Pepa',
            style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey600),
          ),
        ),
        build: (_) => [
          _metaCard(repartidorId, dateLabel),
          pw.SizedBox(height: 16),
          _sectionTitle('Cobros de la liquidación'),
          if (summary.cobros.isEmpty)
            pw.Text(
              'Sin cobros en el periodo.',
              style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey600),
            )
          else
            pw.TableHelper.fromTextArray(
              headers: const [
                'Fecha',
                'Cliente',
                'Nombre',
                'Tipo cobro',
                'Documento',
                'Importe',
              ],
              data: summary.cobros
                  .take(80)
                  .map(
                    (c) => [
                      c.fecha,
                      c.codigoCliente,
                      if (c.nombreCliente.isEmpty)
                        c.codigoCliente
                      else
                        c.nombreCliente,
                      c.tipoCobro,
                      c.documento,
                      _money.format(c.importe),
                    ],
                  )
                  .toList(),
              headerStyle: pw.TextStyle(
                color: PdfColors.white,
                fontWeight: pw.FontWeight.bold,
                fontSize: 8,
              ),
              headerDecoration:
                  pw.BoxDecoration(color: PdfColor.fromHex(_primary)),
              cellStyle: const pw.TextStyle(fontSize: 8),
              cellAlignment: pw.Alignment.centerLeft,
              headerAlignment: pw.Alignment.centerLeft,
              oddRowDecoration: pw.BoxDecoration(
                color: PdfColor.fromHex(_light),
              ),
            ),
          pw.SizedBox(height: 8),
          pw.Align(
            alignment: pw.Alignment.centerRight,
            child: pw.Container(
              padding:
                  const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: pw.BoxDecoration(
                color: PdfColor.fromHex(_greenDark),
                borderRadius: pw.BorderRadius.circular(6),
              ),
              child: pw.Text(
                'Total cobros ${_money.format(summary.totalCobrosDia)}',
                style: pw.TextStyle(
                  color: PdfColors.white,
                  fontWeight: pw.FontWeight.bold,
                  fontSize: 10,
                ),
              ),
            ),
          ),
          pw.SizedBox(height: 18),
          _sectionTitle('Resumen tesorería'),
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Expanded(
                child: pw.Column(
                  children: [
                    _treasuryRow(
                      'Total efectivo',
                      summary.totalEfectivo,
                      green: true,
                    ),
                    _treasuryRow('Total cheques', summary.totalCheques),
                    _treasuryRow('Total tarjeta', summary.totalTarjeta),
                    _treasuryRow('Total postdatados', summary.totalPostdatados),
                    _treasuryRow(
                      'Total cobros día',
                      summary.totalCobrosDia,
                      green: true,
                    ),
                  ],
                ),
              ),
              pw.SizedBox(width: 12),
              pw.Expanded(
                child: pw.Column(
                  children: [
                    _treasuryRow(
                      'Saldo actual',
                      summary.saldoActual,
                      warn: summary.saldoActual < 0,
                    ),
                    _treasuryRow('Gastos', summary.gastos),
                    _treasuryRow(
                      'Total a ingresar',
                      summary.totalAIngresar,
                      green: true,
                    ),
                    _treasuryRow('Ingreso en banco', summary.ingresoBanco),
                  ],
                ),
              ),
            ],
          ),
          if (ledger != null) ...[
            pw.SizedBox(height: 16),
            _sectionTitle('Movimientos del día'),
            ...ledger.expenses
                .map((e) => _row('Gasto · ${e.detail}', e.amount)),
            ...ledger.bankDeposits
                .map((e) => _row('Ingreso · ${e.detail}', e.amount)),
            ...ledger.adjustments
                .map((e) => _row('Ajuste · ${e.detail}', e.amount)),
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

  static pw.Widget _header(
    String displayNumber,
    String repartidorId,
    String dateLabel,
  ) {
    return pw.Container(
      margin: const pw.EdgeInsets.only(bottom: 14),
      padding: const pw.EdgeInsets.all(14),
      decoration: pw.BoxDecoration(
        color: PdfColor.fromHex(_primary),
        borderRadius: pw.BorderRadius.circular(10),
      ),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(
            'Liquidación Diaria - $displayNumber',
            style: pw.TextStyle(
              color: PdfColors.white,
              fontSize: 16,
              fontWeight: pw.FontWeight.bold,
            ),
          ),
          pw.SizedBox(height: 4),
          pw.Text(
            'Granja Mari Pepa · Vendedor $repartidorId',
            style: pw.TextStyle(color: PdfColors.white, fontSize: 11),
          ),
          pw.Text(
            dateLabel,
            style:
                pw.TextStyle(color: PdfColor.fromHex('#d7ecff'), fontSize: 9),
          ),
        ],
      ),
    );
  }

  static pw.Widget _metaCard(String repartidorId, String dateLabel) {
    return pw.Container(
      width: double.infinity,
      padding: const pw.EdgeInsets.all(12),
      decoration: pw.BoxDecoration(
        color: PdfColor.fromHex(_light),
        borderRadius: pw.BorderRadius.circular(8),
        border: pw.Border.all(color: PdfColor.fromHex('#c5d4e8')),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(
            'Vendedor: $repartidorId',
            style: pw.TextStyle(
              fontSize: 11,
              fontWeight: pw.FontWeight.bold,
              color: PdfColor.fromHex(_primary),
            ),
          ),
          pw.Text(
            'Usuario: $repartidorId',
            style: const pw.TextStyle(fontSize: 10),
          ),
          pw.Text(
            dateLabel,
            style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey700),
          ),
        ],
      ),
    );
  }

  static pw.Widget _treasuryRow(
    String label,
    double value, {
    bool green = false,
    bool warn = false,
  }) {
    final bg = green
        ? _cardGreen
        : warn
            ? _cardAmber
            : _light;
    final color = green
        ? PdfColor.fromHex(_greenDark)
        : warn
            ? PdfColors.red800
            : PdfColor.fromHex(_primary);
    return pw.Container(
      margin: const pw.EdgeInsets.only(bottom: 6),
      padding: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: pw.BoxDecoration(
        color: PdfColor.fromHex(bg),
        borderRadius: pw.BorderRadius.circular(8),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(
            label,
            style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700),
          ),
          pw.Text(
            _money.format(value),
            style: pw.TextStyle(
              fontSize: 11,
              fontWeight: pw.FontWeight.bold,
              color: color,
            ),
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
