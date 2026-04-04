import 'package:flutter/material.dart';
import 'dart:math' as math;
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

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
      margin: const EdgeInsets.fromLTRB(12, 2, 12, 4), // Ultra compact margins
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), // Minimal padding
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkSurface,
            AppTheme.darkCard.withOpacity(0.8),
          ],
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: AppTheme.neonBlue.withOpacity(0.2),
          width: 1,
        ),
      ),
      child: widget.isLoading ? _buildLoadingState() : _buildContent(),
    );
  }

  Widget _buildLoadingState() {
    return const SizedBox(
      height: 50,
      child: Center(
        child: CircularProgressIndicator(
          color: AppTheme.neonBlue,
          strokeWidth: 2,
        ),
      ),
    );
  }

  Widget _buildContent() {
    final isSmall = MediaQuery.of(context).size.width < 380 || Responsive.isSmall(context); // Extra small phone check
    
    if (isSmall) {
      return Column(
        children: [
          _buildDeliveryProgress(isSmall: true),
          const SizedBox(height: 8),
          const Divider(color: Colors.white10),
          _buildMoneyMetrics(isSmall: true),
        ],
      );
    }

    return Row(
      children: [
        // Circular progress for deliveries
        _buildDeliveryProgress(),
        
        // Vertical divider
        Container(
          width: 1,
          height: 40,
          margin: const EdgeInsets.symmetric(horizontal: 10),
          color: AppTheme.borderColor,
        ),
        
        // Money metrics
        Expanded(
          child: _buildMoneyMetrics(),
        ),
      ],
    );
  }

  Widget _buildDeliveryProgress({bool isSmall = false}) {
    final progress = widget.totalEntregas > 0
        ? widget.entregasCompletadas / widget.totalEntregas
        : 0.0;
    
    final size = isSmall ? 50.0 : 70.0;

    return AnimatedBuilder(
      animation: Listenable.merge([_scannerAnimation, _progressController]),
      builder: (context, child) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: size,
              height: size,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  // Background ring
                  CustomPaint(
                    size: Size(size, size),
                    painter: _HoloRingPainter(
                      progress: progress * _progressController.value,
                      scannerAngle: _scannerAnimation.value,
                      backgroundColor: AppTheme.borderColor,
                      progressColor: AppTheme.neonBlue,
                      glowColor: AppTheme.neonCyan,
                      strokeWidth: isSmall ? 4.0 : 6.0,
                    ),
                  ),
                  // Center content
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.local_shipping_outlined,
                        color: AppTheme.neonBlue,
                        size: isSmall ? 10 : 14,
                      ),
                      FittedBox(
                        child: Text(
                          '${widget.entregasCompletadas}/${widget.totalEntregas}',
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.bold,
                            fontSize: isSmall ? 8 : 10,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'ENTREGAS',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: isSmall ? 8 : 9,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1,
                  ),
                ),
                 Text(
                   '${(progress * 100).toInt()}%',
                   style: TextStyle(
                     color: AppTheme.neonBlue,
                     fontWeight: FontWeight.bold,
                     fontSize: isSmall ? 14 : 18,
                   ),
                 ),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _buildMoneyMetrics({bool isSmall = false}) {
    return Row(
      children: [
        Expanded(
          child: _buildMetricTile(
            label: 'TOTAL',
            amount: widget.totalMonto,
            icon: Icons.functions,
            color: AppTheme.textPrimary,
            isSmall: isSmall || Responsive.isSmall(context),
          ),
        ),
        Expanded(
          child: _buildMetricTile(
            label: 'A COBRAR',
            amount: widget.montoACobrar,
            icon: Icons.payment_outlined,
            color: AppTheme.obligatorio,
            isUrgent: widget.montoACobrar > 0,
            isSmall: isSmall || Responsive.isSmall(context),
          ),
        ),
        Expanded(
          child: _buildMetricTile(
            label: 'OPCIONAL',
            amount: widget.montoOpcional,
            icon: Icons.attach_money_outlined,
            color: AppTheme.opcional,
            isSmall: isSmall || Responsive.isSmall(context),
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
    bool isSmall = false,
  }) {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        final glowOpacity = isUrgent ? 0.1 + _pulseAnimation.value * 0.15 : 0.0;
        
        return Container(
          padding: EdgeInsets.symmetric(vertical: isSmall ? 4 : 8, horizontal: 2),
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
                padding: EdgeInsets.all(isSmall ? 4 : 8),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: isSmall ? 12 : 18),
              ),
              const SizedBox(height: 4),
              AnimatedBuilder(
                animation: _progressController,
                builder: (context, child) {
                  final displayAmount = amount * _progressController.value;
                  return FittedBox(
                    child: Text(
                      '${displayAmount.toStringAsFixed(0)}€',
                      style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.bold,
                        fontSize: isSmall ? 11 : 14,
                      ),
                    ),
                  );
                },
              ),
              FittedBox(
                child: Text(
                  label,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: isSmall ? 7 : 9,
                    fontWeight: FontWeight.w500,
                  ),
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

class _HoloRingPainter extends CustomPainter {
  final double progress;
  final double scannerAngle;
  final Color backgroundColor;
  final Color progressColor;
  final Color glowColor;
  final double strokeWidth;

  _HoloRingPainter({
    required this.progress,
    required this.scannerAngle,
    required this.backgroundColor,
    required this.progressColor,
    required this.glowColor,
    this.strokeWidth = 6.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - strokeWidth;

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
        colors: [this.progressColor, this.glowColor, this.progressColor],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius))
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      2 * math.pi * this.progress.clamp(0.0, 1.0),
      false,
      progressPaint,
    );

    // Scanner effect (rotating highlight)
    final scannerPaint = Paint()
      ..shader = SweepGradient(
        startAngle: this.scannerAngle - 0.3,
        endAngle: this.scannerAngle + 0.3,
        colors: [
          Colors.transparent,
          this.glowColor.withOpacity(0.6),
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
      ..color = this.progressColor.withOpacity(0.2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 4);

    canvas.drawCircle(center, radius + 4, glowPaint);
  }

  @override
  bool shouldRepaint(covariant _HoloRingPainter oldDelegate) {
    return this.progress != oldDelegate.progress ||
        this.scannerAngle != oldDelegate.scannerAngle;
  }
}
