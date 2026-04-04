import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../domain/models/load_planner_models.dart';

/// PDF Export Service for the Load Planner.
///
/// Generates a professional one-page PDF report with:
/// - Header: vehicle info, date, branding
/// - Metrics summary: volume, weight, box counts
/// - Box table: full inventory with dimensions and positions
/// - Optional 3D screenshot image
class PdfExportService {
  const PdfExportService._();

  /// Generate and return PDF bytes.
  static Future<Uint8List> generateReport({
    required String vehicleCode,
    required String vehicleName,
    required DateTime date,
    required PlannerMetrics metrics,
    required TruckDimensions truck,
    required List<LoadBox> placedBoxes,
    required List<LoadBox> overflowBoxes,
    Uint8List? screenshotBytes,
  }) async {
    final pdf = pw.Document(
      title: 'Plan de Carga - $vehicleCode',
      author: 'GMP Mobilidad',
      creator: 'GMP Load Planner',
    );

    final dateStr =
        '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';

    // Premium color palette
    const accentColor = PdfColor.fromInt(0xFF00D4FF);
    const successColor = PdfColor.fromInt(0xFF00FF88);
    const errorColor = PdfColor.fromInt(0xFFFF3B5C);
    const warningColor = PdfColor.fromInt(0xFFFFAA00);
    const darkBg = PdfColor.fromInt(0xFF0F172A);
    const darkSurface = PdfColor.fromInt(0xFF1E293B);
    const textPrimary = PdfColors.white;
    const textSecondary = PdfColor.fromInt(0xFFB0B8D4);
    const textTertiary = PdfColor.fromInt(0xFF6B7280);

    PdfColor _statusColor() {
      switch (metrics.status) {
        case LoadStatus.seguro:
          return successColor;
        case LoadStatus.optimo:
          return warningColor;
        case LoadStatus.exceso:
          return errorColor;
      }
    }

    String _statusLabel() {
      switch (metrics.status) {
        case LoadStatus.seguro:
          return 'SEGURO';
        case LoadStatus.optimo:
          return 'OPTIMO';
        case LoadStatus.exceso:
          return 'EXCESO';
      }
    }

    // Build screenshot image if provided
    pw.Widget? screenshotWidget;
    if (screenshotBytes != null && screenshotBytes.isNotEmpty) {
      try {
        final image = pw.MemoryImage(screenshotBytes);
        screenshotWidget = pw.Container(
          width: double.infinity,
          height: 200,
          decoration: pw.BoxDecoration(
            borderRadius: pw.BorderRadius.circular(8),
            border: pw.Border.all(color: accentColor, width: 0.5),
          ),
          child: pw.ClipRRect(
            horizontalRadius: 8,
            verticalRadius: 8,
            child: pw.Image(image, fit: pw.BoxFit.contain),
          ),
        );
      } catch (_) {
        // If image fails, skip it
      }
    }

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(32),
        theme: pw.ThemeData.withFont(
          base: await PdfGoogleFonts.robotoRegular(),
          bold: await PdfGoogleFonts.robotoBold(),
          italic: await PdfGoogleFonts.robotoItalic(),
        ),
        build: (context) => [
          // ═══════════════════════════════════════════════════
          // HEADER
          // ═══════════════════════════════════════════════════
          pw.Container(
            padding: const pw.EdgeInsets.all(16),
            decoration: pw.BoxDecoration(
              color: darkSurface,
              borderRadius: pw.BorderRadius.circular(8),
            ),
            child: pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(
                      'PLAN DE CARGA',
                      style: pw.TextStyle(
                        color: textPrimary,
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                        letterSpacing: 1.5,
                      ),
                    ),
                    pw.SizedBox(height: 4),
                    pw.Text(
                      vehicleName.isNotEmpty ? vehicleName : vehicleCode,
                      style: pw.TextStyle(
                        color: accentColor,
                        fontSize: 14,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.end,
                  children: [
                    pw.Text(
                      vehicleCode,
                      style: pw.TextStyle(
                        color: textSecondary,
                        fontSize: 11,
                      ),
                    ),
                    pw.SizedBox(height: 2),
                    pw.Text(
                      'Fecha: $dateStr',
                      style: pw.TextStyle(
                        color: textSecondary,
                        fontSize: 11,
                      ),
                    ),
                    pw.SizedBox(height: 2),
                    pw.Container(
                      padding: const pw.EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 3,
                      ),
                      decoration: pw.BoxDecoration(
                        color: _statusColor(),
                        borderRadius: pw.BorderRadius.circular(4),
                      ),
                      child: pw.Text(
                        _statusLabel(),
                        style: pw.TextStyle(
                          color: darkBg,
                          fontSize: 10,
                          fontWeight: pw.FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          pw.SizedBox(height: 16),

          // ═══════════════════════════════════════════════════
          // METRICS CARDS
          // ═══════════════════════════════════════════════════
          pw.Row(
            children: [
              _metricCard(
                'Volumen',
                '${(metrics.usedVolumeCm3 / 1e6).toStringAsFixed(1)} / ${(metrics.containerVolumeCm3 / 1e6).toStringAsFixed(1)} m³',
                '${metrics.volumePct.toStringAsFixed(1)}%',
                metrics.volumePct > 95
                    ? errorColor
                    : metrics.volumePct > 80
                        ? warningColor
                        : successColor,
                darkSurface,
                textPrimary,
                textSecondary,
              ),
              pw.SizedBox(width: 12),
              _metricCard(
                'Peso',
                '${metrics.totalWeightKg.toStringAsFixed(0)} / ${metrics.maxPayloadKg.toStringAsFixed(0)} kg',
                '${metrics.weightPct.toStringAsFixed(1)}%',
                metrics.weightPct > 95
                    ? errorColor
                    : metrics.weightPct > 80
                        ? warningColor
                        : successColor,
                darkSurface,
                textPrimary,
                textSecondary,
              ),
              pw.SizedBox(width: 12),
              _metricCard(
                'Cajas',
                '${metrics.placedCount} colocadas',
                metrics.overflowCount > 0
                    ? '+${metrics.overflowCount} fuera'
                    : 'Todo cabe',
                metrics.overflowCount > 0 ? errorColor : successColor,
                darkSurface,
                textPrimary,
                textSecondary,
              ),
            ],
          ),

          pw.SizedBox(height: 16),

          // ═══════════════════════════════════════════════════
          // TRUCK DIMENSIONS
          // ═══════════════════════════════════════════════════
          pw.Container(
            padding: const pw.EdgeInsets.all(10),
            decoration: pw.BoxDecoration(
              color: darkSurface,
              borderRadius: pw.BorderRadius.circular(6),
            ),
            child: pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceAround,
              children: [
                _truckDim('Largo', '${truck.lengthCm.toStringAsFixed(0)} cm',
                    textPrimary, textTertiary),
                _truckDim('Ancho', '${truck.widthCm.toStringAsFixed(0)} cm',
                    textPrimary, textTertiary),
                _truckDim('Alto', '${truck.heightCm.toStringAsFixed(0)} cm',
                    textPrimary, textTertiary),
                _truckDim('Carga Max',
                    '${truck.maxPayloadKg.toStringAsFixed(0)} kg',
                    accentColor, textTertiary),
              ],
            ),
          ),

          pw.SizedBox(height: 16),

          // ═══════════════════════════════════════════════════
          // 3D SCREENSHOT (if available)
          // ═══════════════════════════════════════════════════
          if (screenshotWidget != null) ...[
            screenshotWidget,
            pw.SizedBox(height: 16),
          ],

          // ═══════════════════════════════════════════════════
          // PLACED BOXES TABLE
          // ═══════════════════════════════════════════════════
          pw.Text(
            'Cajas Colocadas (${placedBoxes.length})',
            style: pw.TextStyle(
              color: textPrimary,
              fontSize: 12,
              fontWeight: pw.FontWeight.bold,
            ),
          ),
          pw.SizedBox(height: 6),

          _boxTable(placedBoxes, darkSurface, textPrimary, textSecondary,
              textTertiary, accentColor),

          // ═══════════════════════════════════════════════════
          // OVERFLOW BOXES TABLE (if any)
          // ═══════════════════════════════════════════════════
          if (overflowBoxes.isNotEmpty) ...[
            pw.SizedBox(height: 16),
            pw.Text(
              'Cajas Fuera del Camión (${overflowBoxes.length})',
              style: pw.TextStyle(
                color: errorColor,
                fontSize: 12,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.SizedBox(height: 6),
            _boxTable(overflowBoxes, darkSurface, textPrimary, textSecondary,
                textTertiary, errorColor),
          ],

          pw.SizedBox(height: 20),

          // Footer
          pw.Container(
            alignment: pw.Alignment.center,
            child: pw.Text(
              'Generado por GMP Load Planner · $dateStr',
              style: pw.TextStyle(
                color: textTertiary,
                fontSize: 8,
              ),
            ),
          ),
        ],
      ),
    );

    return pdf.save();
  }

  /// Preview PDF in the native print dialog.
  static Future<void> previewReport({
    required String vehicleCode,
    required String vehicleName,
    required DateTime date,
    required PlannerMetrics metrics,
    required TruckDimensions truck,
    required List<LoadBox> placedBoxes,
    required List<LoadBox> overflowBoxes,
    Uint8List? screenshotBytes,
  }) async {
    final bytes = await generateReport(
      vehicleCode: vehicleCode,
      vehicleName: vehicleName,
      date: date,
      metrics: metrics,
      truck: truck,
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      screenshotBytes: screenshotBytes,
    );

    await Printing.layoutPdf(
      onLayout: (_) => bytes,
      name: 'Plan_Carga_${vehicleCode}_${date.year}${date.month.toString().padLeft(2, '0')}${date.day.toString().padLeft(2, '0')}',
    );
  }

  // ─── Helper widgets ──────────────────────────────────────────────────────

  static pw.Expanded _metricCard(
    String label,
    String value,
    String pct,
    PdfColor color,
    PdfColor bg,
    PdfColor titleColor,
    PdfColor subtitleColor,
  ) {
    return pw.Expanded(
      child: pw.Container(
        padding: const pw.EdgeInsets.all(12),
        decoration: pw.BoxDecoration(
          color: bg,
          borderRadius: pw.BorderRadius.circular(6),
          border: pw.Border.all(color: color, width: 0.5),
        ),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              label.toUpperCase(),
              style: pw.TextStyle(
                color: subtitleColor,
                fontSize: 8,
                letterSpacing: 1,
              ),
            ),
            pw.SizedBox(height: 4),
            pw.Text(
              pct,
              style: pw.TextStyle(
                color: color,
                fontSize: 18,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.SizedBox(height: 2),
            pw.Text(
              value,
              style: pw.TextStyle(
                color: subtitleColor,
                fontSize: 9,
              ),
            ),
          ],
        ),
      ),
    );
  }

  static pw.Widget _truckDim(
    String label,
    String value,
    PdfColor valueColor,
    PdfColor labelColor,
  ) {
    return pw.Column(
      children: [
        pw.Text(
          value,
          style: pw.TextStyle(
            color: valueColor,
            fontSize: 11,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
        pw.SizedBox(height: 2),
        pw.Text(
          label,
          style: pw.TextStyle(
            color: labelColor,
            fontSize: 8,
          ),
        ),
      ],
    );
  }

  static pw.Widget _boxTable(
    List<LoadBox> boxes,
    PdfColor bgColor,
    PdfColor textColor,
    PdfColor textSecondary,
    PdfColor textTertiary,
    PdfColor accentColor,
  ) {
    return pw.TableHelper.fromTextArray(
      border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFF334155), width: 0.5),
      headerDecoration: pw.BoxDecoration(color: bgColor),
      cellAlignment: pw.Alignment.centerLeft,
      headerHeight: 24,
      cellHeight: 20,
      cellStyle: pw.TextStyle(color: textSecondary, fontSize: 8),
      headerStyle: pw.TextStyle(
        color: accentColor,
        fontSize: 8,
        fontWeight: pw.FontWeight.bold,
      ),
      headers: [
        'Artículo',
        'Cliente',
        'Pedido',
        'Peso (kg)',
        'Dims (cm)',
        'Posición',
      ],
      data: boxes.map((b) => [
        b.articleCode,
        b.clientCode,
        '#${b.orderNumber}',
        b.weight.toStringAsFixed(1),
        '${b.w.toStringAsFixed(0)}×${b.d.toStringAsFixed(0)}×${b.h.toStringAsFixed(0)}',
        'X:${b.x.toStringAsFixed(0)} Y:${b.y.toStringAsFixed(0)} Z:${b.z.toStringAsFixed(0)}',
      ]).toList(),
    );
  }
}
