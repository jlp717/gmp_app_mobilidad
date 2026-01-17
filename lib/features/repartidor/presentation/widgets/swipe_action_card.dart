import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// Swipeable action card for client/delivery items
/// Left swipe: Mark as collected (green action)
/// Right swipe: Add note (blue action)
class SwipeActionCard extends StatefulWidget {
  final Widget child;
  final VoidCallback? onSwipeLeft; // Mark collected
  final VoidCallback? onSwipeRight; // Add note
  final String leftLabel;
  final String rightLabel;
  final IconData leftIcon;
  final IconData rightIcon;
  final Color leftColor;
  final Color rightColor;
  final bool enabled;

  const SwipeActionCard({
    super.key,
    required this.child,
    this.onSwipeLeft,
    this.onSwipeRight,
    this.leftLabel = 'Cobrado',
    this.rightLabel = 'Nota',
    this.leftIcon = Icons.check_circle_outline,
    this.rightIcon = Icons.note_add_outlined,
    this.leftColor = AppTheme.success,
    this.rightColor = AppTheme.neonBlue,
    this.enabled = true,
  });

  @override
  State<SwipeActionCard> createState() => _SwipeActionCardState();
}

class _SwipeActionCardState extends State<SwipeActionCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  double _dragExtent = 0;
  
  static const double _swipeThreshold = 80;
  static const double _maxSwipe = 120;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleDragUpdate(DragUpdateDetails details) {
    if (!widget.enabled) return;
    
    setState(() {
      _dragExtent += details.primaryDelta ?? 0;
      _dragExtent = _dragExtent.clamp(-_maxSwipe, _maxSwipe);
    });
  }

  void _handleDragEnd(DragEndDetails details) {
    if (!widget.enabled) return;

    if (_dragExtent.abs() >= _swipeThreshold) {
      if (_dragExtent < 0 && widget.onSwipeLeft != null) {
        // Swiped left - collect action
        widget.onSwipeLeft!();
      } else if (_dragExtent > 0 && widget.onSwipeRight != null) {
        // Swiped right - note action
        widget.onSwipeRight!();
      }
    }
    
    // Animate back to center
    _animateToCenter();
  }

  void _animateToCenter() {
    final startValue = _dragExtent;
    _controller.reset();
    _controller.addListener(() {
      setState(() {
        _dragExtent = startValue * (1 - _controller.value);
      });
    });
    _controller.forward();
  }

  @override
  Widget build(BuildContext context) {
    final progress = (_dragExtent.abs() / _maxSwipe).clamp(0.0, 1.0);
    final isLeftSwipe = _dragExtent < 0;
    final actionColor = isLeftSwipe ? widget.leftColor : widget.rightColor;
    final actionIcon = isLeftSwipe ? widget.leftIcon : widget.rightIcon;
    final actionLabel = isLeftSwipe ? widget.leftLabel : widget.rightLabel;

    return Stack(
      children: [
        // Background action indicator
        if (_dragExtent != 0)
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                color: actionColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              alignment: isLeftSwipe ? Alignment.centerRight : Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: AnimatedOpacity(
                opacity: progress,
                duration: const Duration(milliseconds: 100),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: isLeftSwipe
                      ? [
                          Text(
                            actionLabel,
                            style: TextStyle(
                              color: actionColor,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Icon(actionIcon, color: actionColor, size: 24),
                        ]
                      : [
                          Icon(actionIcon, color: actionColor, size: 24),
                          const SizedBox(width: 8),
                          Text(
                            actionLabel,
                            style: TextStyle(
                              color: actionColor,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                        ],
                ),
              ),
            ),
          ),
        
        // Main content
        GestureDetector(
          onHorizontalDragUpdate: _handleDragUpdate,
          onHorizontalDragEnd: _handleDragEnd,
          child: Transform.translate(
            offset: Offset(_dragExtent, 0),
            child: widget.child,
          ),
        ),
      ],
    );
  }
}

/// Mini bar chart for weekly visualization
class WeeklyMiniChart extends StatelessWidget {
  final List<int> dailyCounts;
  final int maxValue;
  final int selectedIndex;
  final Function(int)? onDayTap;

  const WeeklyMiniChart({
    super.key,
    required this.dailyCounts,
    this.maxValue = 0,
    this.selectedIndex = -1,
    this.onDayTap,
  });

  @override
  Widget build(BuildContext context) {
    final effectiveMax = maxValue > 0 
        ? maxValue 
        : dailyCounts.fold<int>(0, (max, v) => v > max ? v : max);
    
    if (effectiveMax == 0) return const SizedBox.shrink();

    return Container(
      height: 32,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(dailyCounts.length, (index) {
          final count = dailyCounts[index];
          final height = effectiveMax > 0 ? (count / effectiveMax) * 24 : 0.0;
          final isSelected = index == selectedIndex;
          
          return Expanded(
            child: GestureDetector(
              onTap: () => onDayTap?.call(index),
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 2),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeOutCubic,
                  height: height.clamp(4.0, 24.0),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: isSelected
                          ? [AppTheme.neonBlue, AppTheme.neonBlue.withOpacity(0.6)]
                          : count > 0
                              ? [AppTheme.neonBlue.withOpacity(0.5), AppTheme.neonBlue.withOpacity(0.2)]
                              : [AppTheme.borderColor, AppTheme.borderColor.withOpacity(0.5)],
                    ),
                    borderRadius: BorderRadius.circular(4),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: AppTheme.neonBlue.withOpacity(0.4),
                              blurRadius: 8,
                              spreadRadius: 1,
                            ),
                          ]
                        : null,
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
