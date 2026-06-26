import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Shared sync header for operational list/detail pages.
class SmartSyncHeader extends StatelessWidget {
  const SmartSyncHeader({
    required this.title,
    required this.subtitle,
    required this.onSync,
    super.key,
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
    final vertPad = (isCompact ? 6 : 12) * factor;
    final iconSize = (isCompact ? 17 : 20) * factor;
    final iconPad = (isCompact ? 6 : 8) * factor;
    final titleSize = (isCompact ? 14 : 17) * factor;
    final subtitleSize = (isCompact ? 11 : 12) * factor;

    return Container(
      padding: EdgeInsets.fromLTRB(
        isCompact ? 12 : Responsive.padding(context, small: 16, large: 24),
        vertPad,
        isCompact ? 12 : Responsive.padding(context, small: 16, large: 24),
        vertPad,
      ),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.9)),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(iconPad),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              border: Border.all(
                color: AppTheme.info.withValues(alpha: 0.18),
              ),
            ),
            child: Icon(
              Icons.local_shipping_outlined,
              color: AppTheme.info,
              size: iconSize,
            ),
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
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textPrimary,
                    letterSpacing: 0,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (!isCompact) ...[
                  if (onMonthTap != null)
                    InkWell(
                      onTap: onMonthTap,
                      borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                      child: Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: Text(
                                subtitle,
                                style: TextStyle(
                                  fontSize: subtitleSize,
                                  color: AppTheme.info,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 0,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Icon(
                              Icons.arrow_drop_down,
                              color: AppTheme.info,
                              size: isCompact ? 14 : 16,
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: subtitleSize,
                        color: AppTheme.textSecondary,
                        letterSpacing: 0,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ],
            ),
          ),
          IconButton(
            tooltip: 'Sincronizar',
            onPressed: isLoading ? null : onSync,
            icon: isLoading
                ? SizedBox(
                    width: isCompact ? 18 : 20,
                    height: isCompact ? 18 : 20,
                    child: const CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(
                    Icons.sync_rounded,
                    color: AppTheme.info,
                    size: isCompact ? 20 : 22,
                  ),
          ),
        ],
      ),
    );
  }
}
