import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

class SmartSyncHeader extends StatelessWidget { // NEW: compact mode for smaller header

  const SmartSyncHeader({
    required this.title, required this.subtitle, required this.onSync, super.key,
    this.lastSync,
    this.isLoading = false,
    this.onMonthTap,
    this.compact = false, // Default false for backwards compatibility
  });
  final String title;
  final String subtitle;
  final DateTime? lastSync;
  final bool isLoading;
  final VoidCallback onSync;
  final VoidCallback? onMonthTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final isCompact = compact || Responsive.isLandscapeCompact(context);
    final factor = Responsive.landscapeScale(context);
    // Extreme padding reduction in auto-compact mode
    final vertPad = (isCompact ? 2 : 16) * factor;
    final iconSize = (isCompact ? 18 : 24) * factor;
    final iconPad = (isCompact ? 6 : 10) * factor;
    final titleSize = (isCompact ? 14 : 20) * factor;
    final subtitleSize = (isCompact ? 11 : 12) * factor;

    return Container(
      padding: EdgeInsets.fromLTRB(isCompact ? 12 : Responsive.padding(context, small: 16, large: 24), vertPad, isCompact ? 12 : Responsive.padding(context, small: 16, large: 24), vertPad),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.surfaceColor,
            AppTheme.surfaceColor.withValues(alpha: 0.8),
          ],
        ),
        border: Border(
          bottom: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.2)),
        ),
      ),
      child: Row(
        children: [
          // Icon
          Container(
            padding: EdgeInsets.all(iconPad),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withValues(alpha: 0.2),
                  AppTheme.neonPurple.withValues(alpha: 0.2),
                ],
              ),
              borderRadius: BorderRadius.circular(compact ? 8 : 12),
            ),
            child: Icon(Icons.local_shipping_outlined, color: AppTheme.neonBlue, size: iconSize),
          ),
          SizedBox(width: compact ? 8 : 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: titleSize,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                if (!isCompact) ...[
                  if (onMonthTap != null)
                    GestureDetector(
                      onTap: onMonthTap,
                      child: Row(
                        children: [
                          Text(
                            subtitle,
                            style: TextStyle(
                              fontSize: subtitleSize,
                              color: AppTheme.neonBlue,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: isCompact ? 14 : 16),
                        ],
                      ),
                    )
                  else
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: subtitleSize,
                        color: AppTheme.textSecondary.withValues(alpha: 0.8),
                      ),
                    ),
                ],
              ],
            ),
          ),
          // Sync Button
          IconButton(
            onPressed: isLoading ? null : onSync,
            padding: EdgeInsets.zero,
            constraints: BoxConstraints(minWidth: isCompact ? 32 : 40, minHeight: isCompact ? 32 : 40),
            icon: isLoading
                ? SizedBox(
                    width: isCompact ? 18 : 24,
                    height: isCompact ? 18 : 24,
                    child: const CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppTheme.neonBlue,
                    ),
                  )
                : Icon(Icons.sync, color: AppTheme.neonBlue, size: isCompact ? 20 : 24),
          ),
        ],
      ),
    );
  }
}

