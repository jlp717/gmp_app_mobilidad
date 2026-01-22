import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';

/// Futuristic week navigator with holographic design
/// Features:
/// - Swipeable week timeline with smooth animations
/// - Interactive tooltips for day status
/// - Progress bar with energy charging effect
/// - Gesture controls for rapid navigation
class FuturisticWeekNavigator extends StatefulWidget {
  final DateTime selectedDate;
  final List<Map<String, dynamic>> weekDays;
  final Function(DateTime) onDaySelected;
  final Function(int) onWeekChange;
  final bool isLoading;
  final int totalClients;

  const FuturisticWeekNavigator({
    super.key,
    required this.selectedDate,
    required this.weekDays,
    required this.onDaySelected,
    required this.onWeekChange,
    this.isLoading = false,
    this.totalClients = 0,
  });

  @override
  State<FuturisticWeekNavigator> createState() => _FuturisticWeekNavigatorState();
}

class _FuturisticWeekNavigatorState extends State<FuturisticWeekNavigator>
    with TickerProviderStateMixin {
  late AnimationController _pulseController;
  late AnimationController _progressController;
  late Animation<double> _pulseAnimation;
  late Animation<double> _progressAnimation;
  
  // Swipe detection
  double _dragStartX = 0;
  
  @override
  void initState() {
    super.initState();
    _initAnimations();
  }
  
  void _initAnimations() {
    // Pulse animation for selected day
    _pulseController = AnimationController(
      duration: AppTheme.animPulse,
      vsync: this,
    )..repeat(reverse: true);
    
    _pulseAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    
    // Progress animation
    _progressController = AnimationController(
      duration: AppTheme.animSlow,
      vsync: this,
    );
    
    _progressAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _progressController, curve: Curves.easeOutCubic),
    );
    
    _progressController.forward();
  }
  
  @override
  void didUpdateWidget(FuturisticWeekNavigator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.weekDays != widget.weekDays) {
      _progressController.reset();
      _progressController.forward();
    }
  }
  
  @override
  void dispose() {
    _pulseController.dispose();
    _progressController.dispose();
    super.dispose();
  }

  int _getWeekNumber(DateTime date) {
    final firstDayOfYear = DateTime(date.year, 1, 1);
    final days = date.difference(firstDayOfYear).inDays;
    return ((days + firstDayOfYear.weekday) / 7).ceil();
  }
  
  double _calculateWeekProgress() {
    if (widget.weekDays.isEmpty) return 0.0;
    
    int completed = 0;
    int total = 0;
    
    for (var day in widget.weekDays) {
      final clients = day['clients'] ?? 0;
      if (clients > 0) {
        total++;
        if (day['status'] == 'good') completed++;
      }
    }
    
    return total > 0 ? completed / total : 0.0;
  }

  @override
  Widget build(BuildContext context) {
    final weekNum = _getWeekNumber(widget.selectedDate);
    final weekStart = widget.selectedDate.subtract(
      Duration(days: widget.selectedDate.weekday - 1),
    );
    final weekEnd = weekStart.add(const Duration(days: 6));
    final dateFormat = DateFormat('d MMM', 'es_ES');
    final weekRange = '${dateFormat.format(weekStart)} - ${dateFormat.format(weekEnd)}';
    final progress = _calculateWeekProgress();

    return GestureDetector(
      onHorizontalDragStart: (details) {
        _dragStartX = details.globalPosition.dx;
      },
      onHorizontalDragEnd: (details) {
        final delta = details.globalPosition.dx - _dragStartX;
        if (delta.abs() > 50) {
          HapticFeedback.lightImpact();
          widget.onWeekChange(delta > 0 ? -1 : 1);
        }
      },
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              AppTheme.darkSurface,
              AppTheme.darkBase.withOpacity(0.95),
            ],
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Week header with navigation
            _buildWeekHeader(weekNum, weekRange),
            
            // Day strip
            _buildDayStrip(),
            
            // Progress bar
            _buildProgressBar(progress),
          ],
        ),
      ),
    );
  }

  Widget _buildWeekHeader(int weekNum, String weekRange) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          // Previous week button
          _buildNavButton(
            icon: Icons.chevron_left,
            onTap: () {
              HapticFeedback.selectionClick();
              widget.onWeekChange(-1);
            },
          ),
          
          // Week info
          Expanded(
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            AppTheme.neonBlue.withOpacity(0.2),
                            AppTheme.neonCyan.withOpacity(0.1),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: AppTheme.neonBlue.withOpacity(0.3),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.calendar_today,
                            size: 14,
                            color: AppTheme.neonBlue,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'SEMANA $weekNum',
                            style: const TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1.2,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  weekRange,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          
          // Next week button
          _buildNavButton(
            icon: Icons.chevron_right,
            onTap: () {
              HapticFeedback.selectionClick();
              widget.onWeekChange(1);
            },
          ),
          
          const SizedBox(width: 12),
          
          // Client count badge
          _buildClientBadge(),
        ],
      ),
    );
  }

  Widget _buildNavButton({required IconData icon, required VoidCallback onTap}) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: AppTheme.neonBlue.withOpacity(0.2),
            ),
          ),
          child: Icon(
            icon,
            color: AppTheme.neonBlue,
            size: 20,
          ),
        ),
      ),
    );
  }

  Widget _buildClientBadge() {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppTheme.neonBlue.withOpacity(0.15 + _pulseAnimation.value * 0.05),
                AppTheme.neonCyan.withOpacity(0.1 + _pulseAnimation.value * 0.05),
              ],
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: AppTheme.neonBlue.withOpacity(0.4),
            ),
            boxShadow: [
              BoxShadow(
                color: AppTheme.neonBlue.withOpacity(0.1 + _pulseAnimation.value * 0.1),
                blurRadius: 8,
                spreadRadius: 1,
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.people_alt_outlined,
                size: 14,
                color: AppTheme.neonBlue,
              ),
              const SizedBox(width: 6),
              Text(
                '${widget.totalClients}',
                style: const TextStyle(
                  color: AppTheme.neonBlue,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildDayStrip() {
    if (widget.weekDays.isEmpty) {
      return Container(
        height: 70,
        alignment: Alignment.center,
        child: widget.isLoading
            ? const CircularProgressIndicator(
                color: AppTheme.neonBlue,
                strokeWidth: 2,
              )
            : Text(
                'Sin datos de la semana',
                style: TextStyle(color: AppTheme.textSecondary),
              ),
      );
    }

    return Container(
      height: 80,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        children: widget.weekDays.asMap().entries.map((entry) {
          final index = entry.key;
          final dayData = entry.value;
          return Expanded(
            child: _buildDayTile(dayData, index),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildDayTile(Map<String, dynamic> dayData, int index) {
    final date = DateTime.parse(dayData['date']);
    final isSelected = DateUtils.isSameDay(date, widget.selectedDate);
    final isToday = DateUtils.isSameDay(date, DateTime.now());
    final count = dayData['clients'] ?? 0;
    final status = dayData['status'] ?? 'none';
    
    // Determine colors based on status
    Color statusColor = AppTheme.textSecondary;
    if (status == 'good') statusColor = AppTheme.success;
    else if (status == 'bad') statusColor = AppTheme.error;
    else if (count > 0) statusColor = AppTheme.neonBlue;
    
    final dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    final dayLetter = dayNames[date.weekday - 1];

    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        widget.onDaySelected(date);
      },
      onLongPress: () => _showDayTooltip(context, dayData, date),
      child: AnimatedBuilder(
        animation: _pulseAnimation,
        builder: (context, child) {
          final glowIntensity = isSelected ? _pulseAnimation.value * 0.3 : 0.0;
          
          return AnimatedContainer(
            duration: AppTheme.animNormal,
            margin: const EdgeInsets.symmetric(horizontal: 3),
            decoration: BoxDecoration(
              gradient: isSelected
                  ? LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        AppTheme.neonBlue,
                        AppTheme.neonCyan.withOpacity(0.8),
                      ],
                    )
                  : null,
              color: isSelected
                  ? null
                  : (count > 0 ? AppTheme.darkCard : AppTheme.darkBase.withOpacity(0.5)),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isSelected
                    ? AppTheme.neonCyan
                    : isToday
                        ? AppTheme.neonBlue.withOpacity(0.5)
                        : (count > 0 ? statusColor.withOpacity(0.3) : Colors.transparent),
                width: isSelected || isToday ? 2 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: AppTheme.neonBlue.withOpacity(0.4 + glowIntensity),
                        blurRadius: 12,
                        spreadRadius: 2,
                      ),
                    ]
                  : null,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Day letter
                Text(
                  dayLetter,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: isSelected ? AppTheme.darkBase : AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                // Count
                Text(
                  count > 0 ? '$count' : '-',
                  style: TextStyle(
                    fontSize: isSelected ? 18 : 16,
                    fontWeight: FontWeight.w900,
                    color: isSelected
                        ? AppTheme.darkBase
                        : (count > 0 ? statusColor : AppTheme.textTertiary),
                  ),
                ),
                // Status indicator
                if (count > 0 && !isSelected)
                  Container(
                    margin: const EdgeInsets.only(top: 4),
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: statusColor,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: statusColor.withOpacity(0.5),
                          blurRadius: 4,
                        ),
                      ],
                    ),
                  ),
                // Today indicator
                if (isToday && !isSelected)
                  Container(
                    margin: const EdgeInsets.only(top: 2),
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      'HOY',
                      style: TextStyle(
                        fontSize: 6,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.neonBlue,
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildProgressBar(double progress) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: [
          Row(
            children: [
              Icon(
                Icons.bolt,
                size: 14,
                color: AppTheme.neonBlue,
              ),
              const SizedBox(width: 6),
              Text(
                'PROGRESO SEMANAL',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textSecondary,
                  letterSpacing: 1,
                ),
              ),
              const Spacer(),
              AnimatedBuilder(
                animation: _progressAnimation,
                builder: (context, child) {
                  return Text(
                    '${(progress * _progressAnimation.value * 100).toInt()}%',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.neonBlue,
                    ),
                  );
                },
              ),
            ],
          ),
          const SizedBox(height: 6),
          AnimatedBuilder(
            animation: _progressAnimation,
            builder: (context, child) {
              return Container(
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(2),
                ),
                child: Stack(
                  children: [
                    // Background
                    Container(
                      decoration: BoxDecoration(
                        color: AppTheme.borderColor,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    // Progress
                    FractionallySizedBox(
                      widthFactor: progress * _progressAnimation.value,
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [AppTheme.neonBlue, AppTheme.neonCyan],
                          ),
                          borderRadius: BorderRadius.circular(2),
                          boxShadow: [
                            BoxShadow(
                              color: AppTheme.neonBlue.withOpacity(0.5),
                              blurRadius: 6,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  void _showDayTooltip(BuildContext context, Map<String, dynamic> dayData, DateTime date) {
    final status = dayData['status'] ?? 'none';
    final count = dayData['clients'] ?? 0;
    
    String statusText = 'Sin entregas programadas';
    IconData statusIcon = Icons.event_busy;
    Color statusColor = AppTheme.textSecondary;
    
    if (count > 0) {
      if (status == 'good') {
        statusText = '✓ Todas las entregas completadas';
        statusIcon = Icons.check_circle;
        statusColor = AppTheme.success;
      } else if (status == 'bad') {
        statusText = '⚠ Entregas pendientes o con incidencias';
        statusIcon = Icons.warning;
        statusColor = AppTheme.error;
      } else {
        statusText = '$count clientes programados';
        statusIcon = Icons.local_shipping;
        statusColor = AppTheme.neonBlue;
      }
    }
    
    HapticFeedback.mediumImpact();
    
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(statusIcon, color: statusColor, size: 24),
            const SizedBox(width: 12),
            Text(
              DateFormat('EEEE d', 'es_ES').format(date),
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        content: Text(
          statusText,
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              widget.onDaySelected(date);
            },
            child: Text(
              'IR A ESTE DÍA',
              style: TextStyle(color: AppTheme.neonBlue),
            ),
          ),
        ],
      ),
    );
  }
}
