import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import '../../data/pedidos_service.dart';

class OrderPdfGenerator {
  static const _primaryColor = '#003d7a';
  static const _secondaryColor = '#1a5490';
  static const _accentColor = '#28a745';
  static const _darkGray = '#2c3e50';
  static const _mediumGray = '#6c757d';
  static const _lightGray = '#E8E8E8';
  static const _ultraLight = '#f8f9fa';

  static Future<void> generateAndShare(
      BuildContext context, OrderDetail order) async {
    final pdf = pw.Document();
    final header = order.header;
    final lines = order.lines;

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(40),
        header: (ctx) => _buildPdfHeader(header),
        footer: (ctx) => _buildFooter(ctx),
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

  static pw.Widget _buildFooter(pw.Context ctx) {
    return pw.Container(
      alignment: pw.Alignment.center,
      child: pw.Column(
        children: [
          pw.Divider(color: PdfColor.fromHex(_lightGray)),
          pw.SizedBox(height: 4),
          pw.Text('MARI PEPA - Food & Frozen',
              style: pw.TextStyle(
                  fontSize: 7, color: PdfColor.fromHex(_mediumGray))),
          pw.Text('Congelados y refrigerados para hostelería',
              style: pw.TextStyle(
                  fontSize: 6, color: PdfColor.fromHex(_mediumGray))),
          pw.SizedBox(height: 2),
          pw.Text('Página ${ctx.pageNumber} de ${ctx.pagesCount}',
              style: pw.TextStyle(
                  fontSize: 7, color: PdfColor.fromHex(_mediumGray))),
        ],
      ),
    );
  }

  static pw.Widget _buildPdfHeader(OrderSummary header) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Container(
          width: double.infinity,
          height: 4,
          color: PdfColor.fromHex(_secondaryColor),
        ),
        pw.SizedBox(height: 8),
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text('MARI PEPA',
                    style: pw.TextStyle(
                        fontSize: 28,
                        fontWeight: pw.FontWeight.bold,
                        color: PdfColor.fromHex(_primaryColor))),
                pw.SizedBox(height: 2),
                pw.Text('Food & Frozen',
                    style: pw.TextStyle(
                        fontSize: 12,
                        color: PdfColor.fromHex(_darkGray),
                        fontWeight: pw.FontWeight.bold)),
                pw.SizedBox(height: 2),
                pw.Text('Congelados y refrigerados para hostelería',
                    style: pw.TextStyle(
                        fontSize: 8, color: PdfColor.fromHex(_mediumGray))),
              ],
            ),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Container(
                  padding: const pw.EdgeInsets.symmetric(
                      horizontal: 12, vertical: 6),
                  decoration: pw.BoxDecoration(
                    color: PdfColor.fromHex(_secondaryColor),
                    borderRadius: pw.BorderRadius.circular(4),
                  ),
                  child: pw.Text('PEDIDO',
                      style: pw.TextStyle(
                          fontSize: 10,
                          color: PdfColors.white,
                          fontWeight: pw.FontWeight.bold)),
                ),
                pw.SizedBox(height: 4),
                pw.Text('#${header.numeroPedido}',
                    style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                        color: PdfColor.fromHex(_darkGray))),
              ],
            ),
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text('Fecha: ${header.fecha}',
                style: pw.TextStyle(
                    fontSize: 10, color: PdfColor.fromHex(_mediumGray))),
            pw.Container(
              padding:
                  const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: pw.BoxDecoration(
                color: _statusColor(header.estado),
                borderRadius: pw.BorderRadius.circular(4),
              ),
              child: pw.Text(_statusLabel(header.estado),
                  style: pw.TextStyle(
                      fontSize: 10,
                      color: PdfColors.white,
                      fontWeight: pw.FontWeight.bold)),
            ),
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Divider(color: PdfColor.fromHex(_lightGray), thickness: 1),
      ],
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
                pw.Text('Cliente',
                    style: pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
                pw.Text(header.clienteName,
                    style: pw.TextStyle(
                        fontSize: 12, fontWeight: pw.FontWeight.bold)),
                pw.Text(header.clienteCode,
                    style: const pw.TextStyle(
                        fontSize: 10, color: PdfColors.grey700)),
              ],
            ),
          ),
          pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              pw.Text('Vendedor',
                  style: pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
              pw.Text(header.vendedorCode,
                  style: const pw.TextStyle(fontSize: 10)),
            ],
          ),
        ],
      ),
    );
  }

  static pw.Widget _buildLinesTable(List<OrderLine> lines) {
    return pw.TableHelper.fromTextArray(
      headerStyle: pw.TextStyle(
          fontSize: 9, fontWeight: pw.FontWeight.bold, color: PdfColors.white),
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
      data: lines
          .map((l) => [
                l.codigoArticulo,
                l.descripcion.length > 25
                    ? '${l.descripcion.substring(0, 25)}...'
                    : l.descripcion,
                l.cantidadEnvases > 0
                    ? l.cantidadEnvases.toStringAsFixed(0)
                    : '-',
                l.cantidadUnidades > 0
                    ? l.cantidadUnidades.toStringAsFixed(0)
                    : '-',
                _money(l.precioVenta, decimals: 3),
                _money(l.importeVenta),
              ])
          .toList(),
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
            _totalRow('Total:', _money(totalVenta),
                bold: true, color: PdfColor.fromHex('#003d7a')),
            _totalRow('Margen:',
                '${_money(totalMargen)} (${pctMargen.toStringAsFixed(1)}%)'),
          ],
        ),
      ),
    );
  }

  static pw.Widget _totalRow(String label, String value,
      {bool bold = false, PdfColor? color}) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 2),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(label,
              style: pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
          pw.Text(value,
              style: pw.TextStyle(
                  fontSize: bold ? 12 : 10,
                  fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                  color: color ?? PdfColors.black)),
        ],
      ),
    );
  }

  static PdfColor _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'BORRADOR':
        return PdfColor.fromHex('#2196F3');
      case 'CONFIRMADO':
        return PdfColor.fromHex('#4CAF50');
      case 'ENVIADO':
        return PdfColor.fromHex('#9C27B0');
      case 'ANULADO':
        return PdfColor.fromHex('#F44336');
      default:
        return PdfColors.grey;
    }
  }

  static String _statusLabel(String status) {
    switch (status.toUpperCase()) {
      case 'BORRADOR':
        return 'BORRADOR';
      case 'CONFIRMADO':
        return 'CONFIRMADO';
      case 'ENVIADO':
        return 'ENVIADO';
      case 'ANULADO':
        return 'ANULADO';
      default:
        return status;
    }
  }

  static String _saleTypeLabel(String type) {
    switch (type) {
      case 'CC':
        return 'Venta';
      case 'VC':
        return 'Venta Sin Nombre';
      case 'NV':
        return 'No Venta';
      default:
        return type;
    }
  }

  static String _money(num value, {int decimals = 2}) {
    final text = value.toStringAsFixed(decimals).replaceAll('.', ',');
    return '$text \u20AC';
  }
}
