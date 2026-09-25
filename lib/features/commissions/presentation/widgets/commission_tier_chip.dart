import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Tier chip shown in commission breakdowns.
///
/// F3-02 extraction of `_buildTierChip` from `commissions_page.dart` —
/// visuals identical; adds a [Semantics] label for screen readers.
class CommissionTierChip extends StatelessWidget {
  /// Creates a tier chip with identical visuals to `_buildTierChip`.
  const CommissionTierChip({
    required this.tier,
    required this.range,
    required this.rate,
    super.key,
  });

  /// Tier code (e.g. F1).
  final String tier;

  /// Sales range label.
  final String range;

  /// Commission rate label.
  final String rate;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$tier $range $rate',
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: AppTheme.info.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppTheme.info.withValues(alpha: 0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.info.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                tier,
                style: const TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.info,
                ),
              ),
            ),
            const SizedBox(width: 4),
            Text(
              '$range → $rate',
              style: TextStyle(fontSize: 9, color: AppTheme.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}
