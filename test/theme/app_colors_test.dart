// GMP Core Widgets Tests
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

void main() {
  group('AppColors Tests', () {
    test('primary color uses the executive palette', () {
      expect(AppColors.primary, equals(AppColors.forest));
    });

    test('secondary color uses the executive palette', () {
      expect(AppColors.secondary, equals(AppColors.moss));
    });

    test('has all required colors', () {
      expect(AppColors.primary, isNotNull);
      expect(AppColors.secondary, isNotNull);
      expect(AppColors.cardColor, isNotNull);
      expect(AppColors.backgroundColor, isNotNull);
      expect(AppColors.surfaceColor, isNotNull);
      expect(AppColors.success, isNotNull);
      expect(AppColors.warning, isNotNull);
      expect(AppColors.error, isNotNull);
    });

    test('theme aliases follow the selected brightness', () {
      AppColors.setBrightness(Brightness.dark);
      expect(AppColors.themedPrimaryText, equals(AppColors.darkInk));
      expect(AppColors.themedSurface, equals(AppColors.darkSurfaceLayer));

      AppColors.setBrightness(Brightness.light);
      expect(AppColors.themedPrimaryText, equals(AppColors.ink));
      expect(AppColors.themedSurface, equals(AppColors.surface));

      // Do not leak mutable theme state into another test.
      AppColors.setBrightness(Brightness.dark);
    });

    test('legacy white overlays adapt instead of becoming invisible in light mode', () {
      AppColors.setBrightness(Brightness.dark);
      expect(AppColors.themedWhite, equals(AppColors.systemWhite));
      expect(AppColors.themedWhite70.a, closeTo(0.70, 0.01));

      AppColors.setBrightness(Brightness.light);
      expect(AppColors.themedWhite, equals(AppColors.ink));
      expect(AppColors.themedWhite24.a, closeTo(0.24, 0.01));

      AppColors.setBrightness(Brightness.dark);
    });

    test('neon colors are defined', () {
      expect(AppColors.neonBlue, isNotNull);
      expect(AppColors.neonGreen, isNotNull);
      expect(AppColors.neonPurple, isNotNull);
    });

    test('semantic colours keep accessible contrast on both surfaces', () {
      double relativeLuminance(Color color) {
        double channel(int value) {
          final normalized = value / 255;
          return normalized <= 0.03928
              ? normalized / 12.92
              : math.pow((normalized + 0.055) / 1.055, 2.4).toDouble();
        }

        return 0.2126 * channel(color.red) +
            0.7152 * channel(color.green) +
            0.0722 * channel(color.blue);
      }

      double contrast(Color foreground, Color background) {
        final a = relativeLuminance(foreground);
        final b = relativeLuminance(background);
        final lighter = a > b ? a : b;
        final darker = a > b ? b : a;
        return (lighter + 0.05) / (darker + 0.05);
      }

      for (final colour in [
        AppColors.success,
        AppColors.error,
        AppColors.warning,
        AppColors.info,
      ]) {
        expect(contrast(colour, AppColors.surface), greaterThanOrEqualTo(3));
        expect(
          contrast(colour, AppColors.darkCanvas),
          greaterThanOrEqualTo(3),
        );
      }
    });
  });
}
