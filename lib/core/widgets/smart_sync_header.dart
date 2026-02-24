import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';
import '../utils/responsive.dart';

class SmartSyncHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final DateTime? lastSync;
  final bool isLoading;
  final VoidCallback onSync;
  final VoidCallback? onMonthTap;
  final bool compact; // NEW: compact mode for smaller header

  const SmartSyncHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.lastSync,
    this.isLoading = false,
    required this.onSync,
    this.onMonthTap,
    this.compact = false, // Default false for backwards compatibility
  });

  @override
  Widget build(BuildContext context) {
    final factor = Responsive.landscapeScale(context);
    final double vertPad = (compact ? 8 : 16) * factor;
    final double iconSize = (compact ? 18 : 24) * factor;
    final double iconPad = (compact ? 6 : 10) * factor;
    final double titleSize = (compact ? 14 : 20) * factor;
    final double subtitleSize = (compact ? 11 : 12) * factor;

    return Container(
      padding: EdgeInsets.fromLTRB(compact ? 12 : Responsive.padding(context, small: 16, large: 24), vertPad, compact ? 12 : Responsive.padding(context, small: 16, large: 24), vertPad),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.surfaceColor,
            AppTheme.surfaceColor.withOpacity(0.8),
          ],
        ),
        border: Border(
          bottom: BorderSide(color: AppTheme.neonBlue.withOpacity(0.2), width: 1),
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
                  AppTheme.neonBlue.withOpacity(0.2),
                  AppTheme.neonPurple.withOpacity(0.2),
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
                        Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: compact ? 14 : 16),
                      ],
                    ),
                  )
                else
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: subtitleSize,
                      color: AppTheme.textSecondary.withOpacity(0.8),
                    ),
                  ),
              ],
            ),
          ),
          // Sync Button
          IconButton(
            onPressed: isLoading ? null : onSync,
            padding: EdgeInsets.zero,
            constraints: BoxConstraints(minWidth: compact ? 32 : 40, minHeight: compact ? 32 : 40),
            icon: isLoading
                ? SizedBox(
                    width: compact ? 18 : 24,
                    height: compact ? 18 : 24,
                    child: const CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppTheme.neonBlue,
                    ),
                  )
                : Icon(Icons.sync, color: AppTheme.neonBlue, size: compact ? 20 : 24),
          ),
        ],
      ),
    );
  }
}

