import 'package:flutter/material.dart';
import 'dart:math' as math;
import '../../../../core/theme/app_theme.dart';

/// KPI Dashboard widget for Rutero tab
/// Shows deliveries completed, pending payments, and weekly progress
class RuteroKpiDashboard extends StatelessWidget {
  final int totalEntregas;
  final int entregasCompletadas;
  final double montoACobrar;
  final double montoOpcional;
  final double montoCobrado;
  final bool isLoading;

  const RuteroKpiDashboard({
    super.key,
    required this.totalEntregas,
    required this.entregasCompletadas,
    required this.montoACobrar,
    required this.montoOpcional,
    this.montoCobrado = 0,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    final progresoEntregas = totalEntregas > 0 
        ? entregasCompletadas / totalEntregas 
        : 0.0;
    final progresoCobros = montoACobrar > 0 
        ? montoCobrado / montoACobrar 
        : 0.0;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkSurface,
            AppTheme.darkCard.withOpacity(0.8),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppTheme.neonBlue.withOpacity(0.3),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonBlue.withOpacity(0.1),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      ),
      child: isLoading
          ? const Center(
              child: SizedBox(
                height: 60,
                child: CircularProgressIndicator(
                  color: AppTheme.neonBlue,
                  strokeWidth: 2,
                ),
              ),
            )
          : Row(
              children: [
                // Circular progress for deliveries
                Expanded(
                  child: _buildCircularKpi(
                    label: 'Entregas',
                    value: '$entregasCompletadas/$totalEntregas',
                    progress: progresoEntregas,
                    color: AppTheme.neonBlue,
                    icon: Icons.local_shipping_outlined,
                  ),
                ),
                Container(
                  width: 1,
                  height: 60,
                  color: AppTheme.borderColor,
                ),
                // Cobros obligatorios
                Expanded(
                  child: _buildLinearKpi(
                    label: 'A Cobrar',
                    amount: montoACobrar,
                    color: AppTheme.error,
                    icon: Icons.payment_outlined,
                  ),
                ),
                Container(
                  width: 1,
                  height: 60,
                  color: AppTheme.borderColor,
                ),
                // Cobros opcionales
                Expanded(
                  child: _buildLinearKpi(
                    label: 'Opcional',
                    amount: montoOpcional,
                    color: AppTheme.warning,
                    icon: Icons.attach_money_outlined,
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildCircularKpi({
    required String label,
    required String value,
    required double progress,
    required Color color,
    required IconData icon,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 56,
          height: 56,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Background circle
              CustomPaint(
                size: const Size(56, 56),
                painter: _CircularProgressPainter(
                  progress: progress,
                  color: color,
                  backgroundColor: AppTheme.borderColor,
                ),
              ),
              // Icon
              Icon(icon, color: color, size: 22),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          value,
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 10,
          ),
        ),
      ],
    );
  }

  Widget _buildLinearKpi({
    required String label,
    required double amount,
    required Color color,
    required IconData icon,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: color.withOpacity(0.15),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withOpacity(0.3)),
          ),
          child: Icon(icon, color: color, size: 22),
        ),
        const SizedBox(height: 8),
        Text(
          '${amount.toStringAsFixed(0)}€',
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 10,
          ),
        ),
      ],
    );
  }
}

/// Custom painter for circular progress indicator
class _CircularProgressPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color backgroundColor;

  _CircularProgressPainter({
    required this.progress,
    required this.color,
    required this.backgroundColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 4;
    
    // Background arc
    final bgPaint = Paint()
      ..color = backgroundColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    
    canvas.drawCircle(center, radius, bgPaint);
    
    // Progress arc
    final progressPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2, // Start from top
      2 * math.pi * progress.clamp(0.0, 1.0),
      false,
      progressPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _CircularProgressPainter oldDelegate) {
    return progress != oldDelegate.progress || color != oldDelegate.color;
  }
}
