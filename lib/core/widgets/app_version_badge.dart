import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/config/app_release_info.dart';
import 'package:gmp_app_mobilidad/core/services/device_fingerprint.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Subtle version label for sidebar/drawer — helps verify installed build.
class AppVersionBadge extends StatelessWidget {
  const AppVersionBadge({
    super.key,
    this.compact = false,
    this.alignment = Alignment.center,
  });

  final bool compact;
  final Alignment alignment;

  String get _label {
    final version = DeviceFingerprint.appVersion;
    final build = DeviceFingerprint.buildNumber;
    if (version == 'unknown') {
      return 'GMP App';
    }
    if (compact) {
      return 'v$version ($build)';
    }
    return 'v$version · build $build · ${AppReleaseInfo.releaseDate}';
  }

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 10,
          vertical: compact ? 6 : 8,
        ),
        decoration: BoxDecoration(
          color: AppTheme.softPanel.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(
            color: AppTheme.borderColor.withValues(alpha: 0.65),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.verified_outlined,
              size: compact ? 12 : 13,
              color: AppTheme.textTertiary,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: compact ? 10 : 10.5,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.15,
                  height: 1.2,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
