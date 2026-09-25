import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';

/// Cell text helpers for the team-lead commissions table.
///
/// F3-02 extraction of `_teamTableText` / `_teamTableMoney` from
/// `commissions_page.dart` — output identical.
/// Money cell for the team-lead commissions table (primary color).
Widget teamTableMoney(dynamic value) => teamTableText(
      CurrencyFormatter.format((value as num?)?.toDouble() ?? 0),
      color: AppTheme.textPrimary,
    );

/// Base cell text for the team-lead commissions table.
Widget teamTableText(
  String value, {
  Color? color,
  FontWeight fontWeight = FontWeight.w500,
}) {
  return Text(
    value,
    style: TextStyle(
      color: color ?? AppTheme.textSecondary,
      fontSize: 11,
      fontWeight: fontWeight,
    ),
  );
}
