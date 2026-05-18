import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Smart Sync Header — V2 Premium.
/// Modern header with refined gradients, border radius, and subtle interactions.
class SmartSyncHeader extends StatelessWidget {

  const SmartSyncHeader({
    required this.title, required this.subtitle, required this.onSync, super.key,
    this.lastSync,
    this.isLoading = false,
    this.onMonthTap,
    this.compact = false,
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
    final vertPad = (isCompact ? 2 : 14) * factor;
    final iconSize = (isCompact ? 18 : 22) * factor;
    final iconPad = (isCompact ? 6 : 10) * factor;
    final titleSize = (isCompact ? 14 : 18) * factor;
    final subtitleSize = (isCompact ? 11 : 12) * factor;

    return Container(
      padding: EdgeInsets.fromLTRB(
        isCompact ? 12 : Responsive.padding(context, small: 16, large: 24),
        vertPad,
        isCompact ? 12 : Responsive.padding(context, small: 16, large: 24),
        vertPad,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkCard,
            AppTheme.darkSurface.withValues(alpha: 0.9),
          ],
        ),
        border: Border(
          bottom: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.15)),
        ),
      ),
      child: Row(
        children: [
          // Icon container
          Container(
            padding: EdgeInsets.all(iconPad),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withValues(alpha: 0.15),
                  AppTheme.neonPurple.withValues(alpha: 0.12),
                ],
              ),
              borderRadius: BorderRadius.circular(isCompact ? AppTheme.radiusSm : AppTheme.radiusMd),
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
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                    letterSpacing: -0.2,
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
                              fontWeight: FontWeight.w500,
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
                        color: AppTheme.textSecondary,
                      ),
                    ),
                ],
              ],
            ),
          ),
          // Sync Button
          InkWell(
            onTap: isLoading ? null : onSync,
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              child: isLoading
                  ? SizedBox(
                      width: isCompact ? 18 : 20,
                      height: isCompact ? 18 : 20,
                      child: const CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.neonBlue,
                      ),
                    )
                  : Icon(Icons.sync_rounded, color: AppTheme.neonBlue, size: isCompact ? 20 : 22),
            ),
          ),
        ],
      ),
    );
  }
}
