/// Order PDF Generator
/// ===================
/// Generates and shares order PDFs using the pdf package

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import '../../data/pedidos_service.dart';

class OrderPdfGenerator {
  static Future<void> generateAndShare(BuildContext context, OrderDetail order) async {
    final pdf = pw.Document();
    final header = order.header;
    final lines = order.lines;

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(40),
        header: (ctx) => _buildPdfHeader(header),
        footer: (ctx) => pw.Container(
          alignment: pw.Alignment.centerRight,
          child: pw.Text('Pagina ${ctx.pageNumber}/${ctx.pagesCount}',
              style: pw.TextStyle(fontSize: 9, color: PdfColors.grey600)),
        ),
        build: (ctx) => [
          _buildClientInfo(header),
          pw.SizedBox(height: 16),
          _buildLinesTable(lines),
          pw.SizedBox(height: 16),
          _buildTotals(header, lines),
          if ((header.tipoVenta).isNotEmpty) ...[
            pw.SizedBox(height: 12),
            pw.Text('Tipo de venta: ${_saleTypeLabel(header.tipoVenta)}',
                style: pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
          ],
        ],
      ),
    );

    await Printing.sharePdf(
      bytes: await pdf.save(),
      filename: 'Pedido_${header.numeroPedido}_${header.clienteCode}.pdf',
    );
  }

  static pw.Widget _buildPdfHeader(OrderSummary header) {
    return pw.Container(
      padding: const pw.EdgeInsets.only(bottom: 12),
      decoration: const pw.BoxDecoration(
        border: pw.Border(bottom: pw.BorderSide(color: PdfColors.grey300, width: 1)),
      ),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('MARI PEPA', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold,
                  color: PdfColor.fromHex('#003d7a'))),
              pw.Text('Food & Frozen', style: pw.TextStyle(fontSize: 10, color: PdfColors.grey600)),
            ],
          ),
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              pw.Text('PEDIDO #${header.numeroPedido}',
                  style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
              pw.Text('Fecha: ${header.fecha}', style: const pw.TextStyle(fontSize: 10)),
              pw.Container(
                padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: pw.BoxDecoration(
                  color: _statusColor(header.estado),
                  borderRadius: pw.BorderRadius.circular(4),
                ),
                child: pw.Text(header.estado, style: pw.TextStyle(fontSize: 9,
                    color: PdfColors.white, fontWeight: pw.FontWeight.bold)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static pw.Widget _buildClientInfo(OrderSummary header) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(10),
      decoration: pw.BoxDecoration(
        color: PdfColor.fromHex('#f8f9fa'),
        borderRadius: pw.BorderRadius.circular(4),
      ),
      child: pw.Row(
        children: [
          pw.Expanded(
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text('Cliente', style: pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
                pw.Text(header.clienteName, style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
                pw.Text(header.clienteCode, style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
              ],
            ),
          ),
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              pw.Text('Vendedor', style: pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
              pw.Text(header.vendedorCode, style: const pw.TextStyle(fontSize: 10)),
            ],
          ),
        ],
      ),
    );
  }

  static pw.Widget _buildLinesTable(List<OrderLine> lines) {
    return pw.TableHelper.fromTextArray(
      headerStyle: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: PdfColors.white),
      headerDecoration: pw.BoxDecoration(color: PdfColor.fromHex('#003d7a')),
      cellStyle: const pw.TextStyle(fontSize: 9),
      cellPadding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      cellAlignments: {
        0: pw.Alignment.centerLeft,
        1: pw.Alignment.centerLeft,
        2: pw.Alignment.centerRight,
        3: pw.Alignment.centerRight,
        4: pw.Alignment.centerRight,
        5: pw.Alignment.centerRight,
      },
      headers: ['Codigo', 'Producto', 'Cajas', 'Uds', 'Precio', 'Total'],
      data: lines.map((l) => [
        l.codigoArticulo,
        l.descripcion.length > 25 ? '${l.descripcion.substring(0, 25)}...' : l.descripcion,
        l.cantidadEnvases > 0 ? l.cantidadEnvases.toStringAsFixed(0) : '-',
        l.cantidadUnidades > 0 ? l.cantidadUnidades.toStringAsFixed(0) : '-',
        '\u20AC${l.precioVenta.toStringAsFixed(3)}',
        '\u20AC${l.importeVenta.toStringAsFixed(2)}',
      ]).toList(),
    );
  }

  static pw.Widget _buildTotals(OrderSummary header, List<OrderLine> lines) {
    final totalVenta = lines.fold<double>(0, (s, l) => s + l.importeVenta);
    final totalMargen = lines.fold<double>(0, (s, l) => s + l.importeMargen);
    final pctMargen = totalVenta > 0 ? (totalMargen / totalVenta * 100) : 0;
    final totalEnvases = lines.fold<double>(0, (s, l) => s + l.cantidadEnvases);

    return pw.Container(
      alignment: pw.Alignment.centerRight,
      child: pw.Container(
        width: 220,
        padding: const pw.EdgeInsets.all(10),
        decoration: pw.BoxDecoration(
          color: PdfColor.fromHex('#f8f9fa'),
          borderRadius: pw.BorderRadius.circular(4),
          border: pw.Border.all(color: PdfColors.grey300),
        ),
        child: pw.Column(
          children: [
            _totalRow('Lineas:', '${lines.length}'),
            _totalRow('Cajas:', totalEnvases.toStringAsFixed(0)),
            pw.Divider(color: PdfColors.grey300),
            _totalRow('Total:', '\u20AC${totalVenta.toStringAsFixed(2)}',
                bold: true, color: PdfColor.fromHex('#003d7a')),
            _totalRow('Margen:', '\u20AC${totalMargen.toStringAsFixed(2)} (${pctMargen.toStringAsFixed(1)}%)'),
          ],
        ),
      ),
    );
  }

  static pw.Widget _totalRow(String label, String value, {bool bold = false, PdfColor? color}) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 2),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(label, style: pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
          pw.Text(value, style: pw.TextStyle(fontSize: bold ? 12 : 10,
              fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
              color: color ?? PdfColors.black)),
        ],
      ),
    );
  }

  static PdfColor _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'BORRADOR': return PdfColor.fromHex('#2196F3');
      case 'CONFIRMADO': return PdfColor.fromHex('#4CAF50');
      case 'ENVIADO': return PdfColor.fromHex('#9C27B0');
      case 'ANULADO': return PdfColor.fromHex('#F44336');
      default: return PdfColors.grey;
    }
  }

  static String _saleTypeLabel(String type) {
    switch (type) {
      case 'CC': return 'Venta';
      case 'VC': return 'Venta Sin Nombre';
      case 'NV': return 'No Venta';
      default: return type;
    }
  }
}
