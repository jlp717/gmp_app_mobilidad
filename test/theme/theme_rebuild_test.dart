import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

void main() {
  testWidgets('shared palette follows a Material ThemeMode switch',
      (tester) async {
    final mode = ValueNotifier<ThemeMode>(ThemeMode.dark);

    await tester.pumpWidget(
      ValueListenableBuilder<ThemeMode>(
        valueListenable: mode,
        builder: (context, value, _) => MaterialApp(
          theme: AppTheme.lightTheme,
          darkTheme: AppTheme.darkTheme,
          themeMode: value,
          home: const _ThemeAwarePaletteProbe(),
        ),
      ),
    );

    expect(
      tester
          .widget<ColoredBox>(find.byKey(const ValueKey('palette-probe')))
          .color,
      AppColors.darkCanvas,
    );

    mode.value = ThemeMode.light;
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<ColoredBox>(find.byKey(const ValueKey('palette-probe')))
          .color,
      AppColors.canvas,
    );
    mode.dispose();
  });
}

class _ThemeAwarePaletteProbe extends StatelessWidget {
  const _ThemeAwarePaletteProbe();

  @override
  Widget build(BuildContext context) {
    AppColors.syncWithTheme(context);
    return ColoredBox(
      key: const ValueKey('palette-probe'),
      color: AppColors.themedCanvas,
      child: const SizedBox.expand(),
    );
  }
}
