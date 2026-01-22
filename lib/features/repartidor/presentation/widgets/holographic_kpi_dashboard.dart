import 'package:flutter/material.dart';
import 'dart:math' as math;
import '../../../../core/theme/app_theme.dart';

/// Holographic KPI Dashboard with futuristic design
/// Features:
/// - Animated circular progress rings with scanner effect
/// - Glowing metrics with pulse animations
/// - Gamification badges and streaks
/// - AI suggestion banner (optional)
class HolographicKpiDashboard extends StatefulWidget {
  final int totalEntregas;
  final int entregasCompletadas;
  final double montoACobrar;
  final double montoOpcional;
  final double totalMonto;
  final double montoCobrado;
  final bool isLoading;
  


  const HolographicKpiDashboard({
    super.key,
    required this.totalEntregas,
    required this.entregasCompletadas,
    required this.montoACobrar,
    required this.montoOpcional,
    required this.totalMonto,
    this.montoCobrado = 0,
    this.isLoading = false,
  });

  @override
  State<HolographicKpiDashboard> createState() => _HolographicKpiDashboardState();
}

class _HolographicKpiDashboardState extends State<HolographicKpiDashboard>
    with TickerProviderStateMixin {
  late AnimationController _scannerController;
  late AnimationController _pulseController;
  late AnimationController _progressController;
  late Animation<double> _scannerAnimation;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _initAnimations();
  }

  void _initAnimations() {
    // Scanner rotation
    _scannerController = AnimationController(
      duration: const Duration(seconds: 3),
      vsync: this,
    )..repeat();
    
    _scannerAnimation = Tween<double>(begin: 0, end: 2 * math.pi).animate(
      CurvedAnimation(parent: _scannerController, curve: Curves.linear),
    );
    
    // Pulse effect
    _pulseController = AnimationController(
      duration: AppTheme.animPulse,
      vsync: this,
    )..repeat(reverse: true);
    
    _pulseAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    
    // Progress animation on load
    _progressController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    )..forward();
  }

  @override
  void didUpdateWidget(HolographicKpiDashboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.totalEntregas != widget.totalEntregas ||
        oldWidget.entregasCompletadas != widget.entregasCompletadas) {
      _progressController.reset();
      _progressController.forward();
    }
  }

  @override
  void dispose() {
    _scannerController.dispose();
    _pulseController.dispose();
    _progressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 8), // Reduced vertical margin
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), // Compact padding
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkSurface,
            AppTheme.darkCard.withOpacity(0.8),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppTheme.neonBlue.withOpacity(0.2),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonBlue.withOpacity(0.08),
            blurRadius: 20,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: widget.isLoading ? _buildLoadingState() : _buildContent(),
    );
  }

  Widget _buildLoadingState() {
    return const SizedBox(
      height: 100,
      child: Center(
        child: CircularProgressIndicator(
          color: AppTheme.neonBlue,
          strokeWidth: 2,
        ),
      ),
    );
  }

  Widget _buildContent() {
    return Column(
      children: [
        // Main KPI Row
        Row(
          children: [
            // Circular progress for deliveries
            Expanded(
              flex: 3,
              child: _buildDeliveryProgress(),
            ),
            
            // Vertical divider
            Container(
              width: 1,
              height: 80,
              margin: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    AppTheme.neonBlue.withOpacity(0.5),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
            
            // Money metrics
            Expanded(
              flex: 5,
              child: _buildMoneyMetrics(),
            ),
          ],
        ),
        
        const SizedBox(height: 12),
        
        if (widget.isLoading)
          const LinearProgressIndicator(
            backgroundColor: Colors.transparent,
            valueColor: AlwaysStoppedAnimation<Color>(AppTheme.neonBlue),
            minHeight: 2,
          ),
      ],
    );
  }

  Widget _buildDeliveryProgress() {
    final progress = widget.totalEntregas > 0
        ? widget.entregasCompletadas / widget.totalEntregas
        : 0.0;

    return AnimatedBuilder(
      animation: Listenable.merge([_scannerAnimation, _progressController]),
      builder: (context, child) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 80,
              height: 80,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  // Background ring
                  CustomPaint(
                    size: const Size(80, 80),
                    painter: _HoloRingPainter(
                      progress: progress * _progressController.value,
                      scannerAngle: _scannerAnimation.value,
                      backgroundColor: AppTheme.borderColor,
                      progressColor: AppTheme.neonBlue,
                      glowColor: AppTheme.neonCyan,
                    ),
                  ),
                  // Center content
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.local_shipping_outlined,
                        color: AppTheme.neonBlue,
                        size: 20,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${widget.entregasCompletadas}/${widget.totalEntregas}',
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'ENTREGAS',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.bold,
                letterSpacing: 1,
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildMoneyMetrics() {
    return Row(
      children: [
        Expanded(
          child: _buildMetricTile(
            label: 'TOTAL',
            amount: widget.totalMonto,
            icon: Icons.functions,
            color: AppTheme.textPrimary,
          ),
        ),
        Expanded(
          child: _buildMetricTile(
            label: 'A COBRAR',
            amount: widget.montoACobrar,
            icon: Icons.payment_outlined,
            color: AppTheme.obligatorio,
            isUrgent: widget.montoACobrar > 0,
          ),
        ),
        Expanded(
          child: _buildMetricTile(
            label: 'OPCIONAL',
            amount: widget.montoOpcional,
            icon: Icons.attach_money_outlined,
            color: AppTheme.opcional,
          ),
        ),
      ],
    );
  }

  Widget _buildMetricTile({
    required String label,
    required double amount,
    required IconData icon,
    required Color color,
    bool isUrgent = false,
  }) {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        final glowOpacity = isUrgent ? 0.1 + _pulseAnimation.value * 0.15 : 0.0;
        
        return Container(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
          decoration: isUrgent
              ? BoxDecoration(
                  color: color.withOpacity(glowOpacity),
                  borderRadius: BorderRadius.circular(12),
                  border: isUrgent ? Border.all(color: color.withOpacity(0.3)) : null,
                )
              : null,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(height: 6),
              AnimatedBuilder(
                animation: _progressController,
                builder: (context, child) {
                  final displayAmount = amount * _progressController.value;
                  return Text(
                    '${displayAmount.toStringAsFixed(0)}€',
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  );
                },
              ),
              Text(
                label,
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        );
      },
    );
  }


  Widget _buildBadge({
    required IconData icon,
    required String value,
    required String label,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: color.withOpacity(0.3),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 4),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }



}

/// Custom painter for holographic ring progress
class _HoloRingPainter extends CustomPainter {
  final double progress;
  final double scannerAngle;
  final Color backgroundColor;
  final Color progressColor;
  final Color glowColor;

  _HoloRingPainter({
    required this.progress,
    required this.scannerAngle,
    required this.backgroundColor,
    required this.progressColor,
    required this.glowColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 6;
    const strokeWidth = 6.0;

    // Background ring
    final bgPaint = Paint()
      ..color = backgroundColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, bgPaint);

    // Progress arc
    final progressPaint = Paint()
      ..shader = SweepGradient(
        startAngle: -math.pi / 2,
        endAngle: 3 * math.pi / 2,
        colors: [progressColor, glowColor, progressColor],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius))
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      2 * math.pi * progress.clamp(0.0, 1.0),
      false,
      progressPaint,
    );

    // Scanner effect (rotating highlight)
    final scannerPaint = Paint()
      ..shader = SweepGradient(
        startAngle: scannerAngle - 0.3,
        endAngle: scannerAngle + 0.3,
        colors: [
          Colors.transparent,
          glowColor.withOpacity(0.6),
          Colors.transparent,
        ],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius))
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, scannerPaint);
    
    // Outer glow
    final glowPaint = Paint()
      ..color = progressColor.withOpacity(0.2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 4);

    canvas.drawCircle(center, radius + 4, glowPaint);
  }

  @override
  bool shouldRepaint(covariant _HoloRingPainter oldDelegate) {
    return progress != oldDelegate.progress ||
        scannerAngle != oldDelegate.scannerAngle;
  }
}
