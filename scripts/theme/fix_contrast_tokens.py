"""Replace hardcoded Colors.* in theme-sensitive screens with AppTheme tokens."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILES = [
    ROOT / "lib/features/dashboard/presentation/widgets/filter_bar.dart",
    ROOT / "lib/features/dashboard/presentation/widgets/date_range_picker.dart",
    ROOT / "lib/features/dashboard/presentation/widgets/matrix_data_table.dart",
    ROOT / "lib/features/objectives/presentation/pages/objectives_page.dart",
    ROOT / "lib/features/objectives/presentation/pages/enhanced_client_matrix_page.dart",
    ROOT / "lib/features/objectives/presentation/pages/client_evolution_page.dart",
    ROOT / "lib/features/auth/presentation/pages/login_page.dart",
    ROOT / "lib/features/pedidos/presentation/widgets/order_summary_widget.dart",
    ROOT / "lib/features/sales_history/presentation/pages/product_history_page.dart",
    ROOT / "lib/features/pedidos/presentation/widgets/product_search_widget.dart",
]

REPLACEMENTS = [
    ("Colors.white.withValues", "AppTheme.textPrimary.withValues"),
    ("Colors.black.withValues", "AppTheme.textPrimary.withValues"),
    ("const TextStyle(color: Colors.white)", "TextStyle(color: AppTheme.textPrimary)"),
    ("const TextStyle(color: Colors.white70)", "TextStyle(color: AppTheme.textSecondary)"),
    ("const TextStyle(color: Colors.white54)", "TextStyle(color: AppTheme.textTertiary)"),
    ("const TextStyle(color: Colors.white, fontSize: 13)", "TextStyle(color: AppTheme.textPrimary, fontSize: 13)"),
    ("const TextStyle(color: Colors.white54, fontSize: 12)", "TextStyle(color: AppTheme.textTertiary, fontSize: 12)"),
    ("const TextStyle(color: Colors.white70, fontSize: 12)", "TextStyle(color: AppTheme.textSecondary, fontSize: 12)"),
    ("const TextStyle(color: Colors.white70, fontSize: 14)", "TextStyle(color: AppTheme.textSecondary, fontSize: 14)"),
    ("const TextStyle(color: Colors.white54, fontSize: 10)", "TextStyle(color: AppTheme.textTertiary, fontSize: 10)"),
    ("color: Colors.white,", "color: AppTheme.textPrimary,"),
    ("color: Colors.white)", "color: AppTheme.textPrimary)"),
    ("color: Colors.white;", "color: AppTheme.textPrimary;"),
    ("color: Colors.white70,", "color: AppTheme.textSecondary,"),
    ("color: Colors.white70)", "color: AppTheme.textSecondary)"),
    ("color: Colors.white54,", "color: AppTheme.textTertiary,"),
    ("color: Colors.white54)", "color: AppTheme.textTertiary)"),
    ("color: Colors.white38,", "color: AppTheme.textTertiary,"),
    ("color: Colors.white38)", "color: AppTheme.textTertiary)"),
    ("color: Colors.white30,", "color: AppTheme.textTertiary,"),
    ("color: Colors.white30)", "color: AppTheme.textTertiary)"),
    ("color: Colors.white24,", "color: AppTheme.borderColor,"),
    ("color: Colors.white12,", "color: AppTheme.borderColor,"),
    ("color: Colors.white10,", "color: AppTheme.borderColor,"),
    ("Colors.white10", "AppTheme.borderColor"),
    ("Colors.white12", "AppTheme.borderColor"),
    ("Colors.white24", "AppTheme.borderColor"),
    ("Colors.white30", "AppTheme.textTertiary"),
    ("Colors.white38", "AppTheme.textTertiary"),
    ("Colors.transparent", "AppColors.transparent"),
    ("Colors.black26", "AppTheme.textPrimary.withValues(alpha: 0.26)"),
    ("foregroundColor: Colors.white", "foregroundColor: AppColors.onAccent"),
    ("backgroundColor: Colors.white,", "backgroundColor: AppTheme.surfaceColor,"),
    ("?? Colors.white", "?? AppTheme.textPrimary"),
    (": Colors.white;", ": AppTheme.textPrimary;"),
    (": Colors.white,", ": AppTheme.textPrimary,"),
    ("Colors.white", "AppTheme.textPrimary"),
]

APP_COLORS_IMPORT = "import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';"
APP_THEME_IMPORT = "import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';"


def ensure_import(text: str, import_line: str) -> str:
    if import_line in text:
        return text
    if "import 'package:flutter/material.dart';" in text:
        return text.replace(
            "import 'package:flutter/material.dart';",
            "import 'package:flutter/material.dart';\n" + import_line,
            1,
        )
    return import_line + "\n" + text


def main() -> None:
    for path in FILES:
        original = path.read_text(encoding="utf-8")
        text = original
        for old, new in REPLACEMENTS:
            text = text.replace(old, new)
        if "AppColors." in text:
            text = ensure_import(text, APP_COLORS_IMPORT)
        if "AppTheme." in text:
            text = ensure_import(text, APP_THEME_IMPORT)
        if text != original:
            path.write_text(text, encoding="utf-8")
            print(f"updated {path.relative_to(ROOT)}")
        else:
            print(f"unchanged {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
