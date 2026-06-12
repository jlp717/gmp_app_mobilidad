// GMP Core Widgets Tests
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

void main() {
  group('AppColors Tests', () {
    test('primary color matches refined neon blue', () {
      expect(AppColors.primary, equals(const Color(0xFF3B82F6)));
    });

    test('secondary color matches refined neon green', () {
      expect(AppColors.secondary, equals(const Color(0xFF10B981)));
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

    test('text colors are defined', () {
      expect(AppColors.textPrimary, equals(const Color(0xFFF9FAFB)));
      expect(AppColors.textSecondary, isNotNull);
    });

    test('neon colors are defined', () {
      expect(AppColors.neonBlue, isNotNull);
      expect(AppColors.neonGreen, isNotNull);
      expect(AppColors.neonPurple, isNotNull);
    });
  });
}
