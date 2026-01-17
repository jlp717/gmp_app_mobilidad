import 'package:flutter/material.dart';
import 'dart:math' as math;
import '../../../../core/theme/app_theme.dart';

/// KPI Dashboard widget for Rutero tab
/// Shows deliveries completed, pending payments, and weekly progress
  final double totalMonto; // New field

  const RuteroKpiDashboard({
    super.key,
    required this.totalEntregas,
    required this.entregasCompletadas,
    required this.montoACobrar,
    required this.montoOpcional,
    required this.totalMonto, // New field
    this.montoCobrado = 0,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    final progresoEntregas = totalEntregas > 0 
        ? entregasCompletadas / totalEntregas 
        : 0.0;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), // Reduced vertical margin
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12), // Reduced padding
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppTheme.neonBlue.withOpacity(0.3),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonBlue.withOpacity(0.05),
            blurRadius: 10,
            spreadRadius: 1,
          ),
        ],
      ),
      child: isLoading
          ? const Center(
              child: SizedBox(
                height: 40, // Reduced height
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
                  flex: 2,
                  child: _buildCircularKpi(
                    label: 'Entregas',
                    value: '$entregasCompletadas/$totalEntregas',
                    progress: progresoEntregas,
                    color: AppTheme.neonBlue,
                    icon: Icons.local_shipping_outlined,
                  ),
                ),
                Container(width: 1, height: 40, color: AppTheme.borderColor),
                
                // Total Load
                Expanded(
                  flex: 2,
                  child: _buildLinearKpi(
                    label: 'Total',
                    amount: totalMonto,
                    color: AppTheme.textPrimary,
                    icon: Icons.functions,
                  ),
                ),
                
                // A Cobrar
                Expanded(
                  flex: 2,
                  child: _buildLinearKpi(
                    label: 'A Cobrar',
                    amount: montoACobrar,
                    color: AppTheme.error,
                    icon: Icons.payment_outlined,
                  ),
                ),
                
                // Opcional
                Expanded(
                  flex: 2,
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
          width: 40, // Reduced
          height: 40, // Reduced
          child: Stack(
            alignment: Alignment.center,
            children: [
              CustomPaint(
                size: const Size(40, 40),
                painter: _CircularProgressPainter(
                  progress: progress,
                  color: color,
                  backgroundColor: AppTheme.borderColor,
                ),
              ),
              Icon(icon, color: color, size: 16), // Reduced
            ],
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.bold,
            fontSize: 12, // Reduced
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 9, // Reduced
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
        Icon(icon, color: color, size: 18), // Icon only, no box
        const SizedBox(height: 2),
        Text(
          '${amount.toStringAsFixed(0)}€',
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.bold,
            fontSize: 12, // Reduced
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 9, // Reduced
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
