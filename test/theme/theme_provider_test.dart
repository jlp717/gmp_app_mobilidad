import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/theme/theme_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    AppColors.setBrightness(Brightness.dark);
  });

  test('keeps dark mode as the safe default and exposes ThemeMode', () {
    final provider = ThemeProvider();

    expect(provider.isDarkMode, isTrue);
    expect(provider.themeMode, ThemeMode.dark);
  });

  test('loads and persists the selected mode', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'isDarkMode': false,
    });
    final provider = ThemeProvider();
    await provider.ready;

    expect(provider.isDarkMode, isFalse);
    expect(provider.themeMode, ThemeMode.light);

    await provider.setTheme(true);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('isDarkMode'), isTrue);
  });

  test('light and dark themes keep structural surfaces readable', () {
    final light = AppTheme.lightTheme;
    final dark = AppTheme.darkTheme;

    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.scaffoldBackgroundColor, AppColors.canvas);
    expect(dark.scaffoldBackgroundColor, AppColors.darkCanvas);
    expect(light.progressIndicatorTheme.linearTrackColor, AppColors.panel);
    expect(dark.progressIndicatorTheme.linearTrackColor, AppColors.darkPanel);
    expect(
      ThemeData.estimateBrightnessForColor(light.colorScheme.onSurface),
      Brightness.dark,
    );
    expect(
      ThemeData.estimateBrightnessForColor(dark.colorScheme.onSurface),
      Brightness.light,
    );
  });
}
