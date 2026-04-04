/// Order Trend Chart
/// =================
/// Custom-painted line chart showing 7-day order trend.
/// No external dependencies — pure CustomPainter.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

class TrendDataPoint {
  final String date;
  final int orders;
  final double amount;

  const TrendDataPoint({
    required this.date,
    required this.orders,
    required this.amount,
  });
}

class OrderTrendChart extends StatelessWidget {
  final List<TrendDataPoint> data;
  final double height;

  const OrderTrendChart({
    Key? key,
    required this.data,
    this.height = 80,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) {
      return SizedBox(
        height: height,
        child: Center(
          child: Text(
            'Sin datos de tendencia',
            style: TextStyle(color: Colors.white38, fontSize: 11),
          ),
        ),
      );
    }

    return SizedBox(
      height: height,
      child: CustomPaint(
        painter: _TrendChartPainter(data),
        size: Size(double.infinity, height),
      ),
    );
  }
}

class _TrendChartPainter extends CustomPainter {
  final List<TrendDataPoint> data;

  _TrendChartPainter(this.data);

  @override
  void paint(Canvas canvas, Size size) {
    if (data.isEmpty) return;

    const padding = 4.0;
    final chartWidth = size.width - padding * 2;
    final chartHeight = size.height - padding * 2;

    final maxOrders =
        data.map((d) => d.orders).reduce((a, b) => a > b ? a : b).toDouble();
    final safeMax = maxOrders > 0 ? maxOrders : 1;

    final linePaint = Paint()
      ..color = AppTheme.neonBlue.withOpacity(0.8)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final fillPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          AppTheme.neonBlue.withOpacity(0.3),
          AppTheme.neonBlue.withOpacity(0.02),
        ],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height))
      ..style = PaintingStyle.fill;

    final dotPaint = Paint()
      ..color = AppTheme.neonBlue
      ..style = PaintingStyle.fill;

    final dotBorderPaint = Paint()
      ..color = AppTheme.neonBlue.withOpacity(0.4)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    // Build points
    final points = <Offset>[];
    for (int i = 0; i < data.length; i++) {
      final x = padding +
          (i / (data.length - 1).clamp(1, double.infinity)) * chartWidth;
      final y =
          padding + chartHeight - (data[i].orders / safeMax) * chartHeight;
      points.add(Offset(x, y));
    }

    // Draw fill area
    if (points.length > 1) {
      final fillPath = Path();
      fillPath.moveTo(points.first.dx, points.first.dy);
      for (int i = 1; i < points.length; i++) {
        fillPath.lineTo(points[i].dx, points[i].dy);
      }
      fillPath.lineTo(points.last.dx, size.height - padding);
      fillPath.lineTo(points.first.dx, size.height - padding);
      fillPath.close();
      canvas.drawPath(fillPath, fillPaint);
    }

    // Draw line
    if (points.length > 1) {
      final linePath = Path();
      linePath.moveTo(points.first.dx, points.first.dy);
      for (int i = 1; i < points.length; i++) {
        linePath.lineTo(points[i].dx, points[i].dy);
      }
      canvas.drawPath(linePath, linePaint);
    }

    // Draw dots
    for (final p in points) {
      canvas.drawCircle(p, 3, dotBorderPaint);
      canvas.drawCircle(p, 2, dotPaint);
    }

    // Draw date labels
    final labelPaint = TextPainter(
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    );
    final labelStyle = TextStyle(color: Colors.white54, fontSize: 8);

    for (int i = 0; i < data.length; i++) {
      final x = padding +
          (i / (data.length - 1).clamp(1, double.infinity)) * chartWidth;
      final dateStr =
          data[i].date.length >= 5 ? data[i].date.substring(5) : data[i].date;
      labelPaint.text = TextSpan(text: dateStr, style: labelStyle);
      labelPaint.layout();
      labelPaint.paint(
          canvas, Offset(x - labelPaint.width / 2, size.height - 14));
    }
  }

  @override
  bool shouldRepaint(covariant _TrendChartPainter oldDelegate) {
    return oldDelegate.data != data;
  }
}
