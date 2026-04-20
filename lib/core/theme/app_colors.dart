import 'package:flutter/material.dart';

/// Centralized color palette for GMP App.
/// Use these constants instead of hardcoded Color(0xFF...) values.
/// This ensures consistency across the app and makes theme changes easier.
class AppColors {
  AppColors._();

  // ============================================================================
  // BASE COLORS - Dark Theme Foundation
  // ============================================================================

  static const Color darkBase = Color(0xFF0F172A);
  static const Color darkSurface = Color(0xFF1E293B);
  static const Color darkCard = Color(0xFF334155);
  static const Color borderColor = Color(0xFF475569);

  // Aliases for compatibility
  static const Color backgroundColor = darkBase;
  static const Color surfaceColor = darkSurface;
  static const Color cardColor = darkCard;

  // ============================================================================
  // NEON ACCENTS - Primary Palette
  // ============================================================================

  static const Color neonBlue = Color(0xFF00D4FF);
  static const Color neonGreen = Color(0xFF00FF88);
  static const Color neonPurple = Color(0xFFBB86FC);
  static const Color neonPink = Color(0xFFFF6B9D);
  static const Color neonCyan = Color(0xFF00FFFF);
  static const Color neonTeal = Color(0xFF00CED1);
  static const Color neonElectric = Color(0xFF7DF9FF);
  static const Color holoBlue = Color(0xFF1E90FF);

  // Aliases
  static const Color primary = neonBlue;
  static const Color secondary = neonGreen;

  // ============================================================================
  // GLOW INTENSITIES
  // ============================================================================

  static const Color glowIntense = Color(0xFF00D4FF);
  static const Color glowMedium = Color(0xFF0099CC);
  static const Color glowSubtle = Color(0xFF006699);

  // ============================================================================
  // STATUS COLORS
  // ============================================================================

  static const Color success = Color(0xFF00FF88);
  static const Color error = Color(0xFFFF3B5C);
  static const Color warning = Color(0xFFFFAA00);
  static const Color info = Color(0xFF00D4FF);

  // Payment status colors
  static const Color obligatorio = Color(0xFFFF3B5C);
  static const Color opcional = Color(0xFFFFAA00);
  static const Color cobrado = Color(0xFF00FF88);
  static const Color credito = Color(0xFF00D4FF);

  // Aliases for compatibility
  static const Color successColor = success;
  static const Color errorColor = error;
  static const Color warningColor = warning;
  static const Color infoColor = info;

  // ============================================================================
  // TEXT COLORS
  // ============================================================================

  static const Color textPrimary = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFFB0B8D4);
  static const Color textTertiary = Color(0xFF6B7280);

  // ============================================================================
  // CHART COLORS
  // ============================================================================

  static const Color chartYellow = Color(0xFFFFC233);
  static const Color chartViolet = Color(0xFF8B5CF6);
  static const Color chartEmerald = Color(0xFF10B981);
  static const Color chartAmber = Color(0xFFF59E0B);

  static const List<Color> chartColors = [
    neonBlue,
    neonGreen,
    neonPurple,
    neonPink,
    chartYellow,
    chartViolet,
    chartEmerald,
    chartAmber,
  ];

  // ============================================================================
  // GRADIENTS - Predefined for common use cases
  // ============================================================================

  static const LinearGradient primaryGradient = LinearGradient(
    colors: [
      Color(0x4D00D4FF), // 30% opacity neonBlue
      Color(0x1A00D4FF), // 10% opacity neonBlue
    ],
  );

  static const LinearGradient holoGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0x2600FFFF), // 15% opacity neonCyan
      Color(0x1A00D4FF), // 10% opacity neonBlue
      Color(0x1ABB86FC), // 10% opacity neonPurple
      Color(0x2600FFFF), // 15% opacity neonCyan
    ],
    stops: [0.0, 0.35, 0.65, 1.0],
  );

  static const LinearGradient scannerGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Colors.transparent,
      neonCyan,
      Colors.transparent,
    ],
    stops: [0.0, 0.5, 1.0],
  );

  // ============================================================================
  // SPACING CONSTANTS (commonly used with colors)
  // ============================================================================

  static const double paddingS = 12;
  static const double paddingM = 16;
  static const double paddingL = 24;
  static const double paddingXL = 32;

  // ============================================================================
  // ANIMATION DURATIONS
  // ============================================================================

  static const Duration animFast = Duration(milliseconds: 150);
  static const Duration animNormal = Duration(milliseconds: 300);
  static const Duration animSlow = Duration(milliseconds: 500);
  static const Duration animPulse = Duration(milliseconds: 1500);

  // ============================================================================
  // LEGACY COLORS - Kept for compatibility with older code
  // ============================================================================

  static const Color surfaceVariant = Color(0xFF1E293B);
  static const Color outlineVariant = Color(0xFF475569);
  static const Color inverseSurface = Color(0xFFFFFFFF);
  static const Color inversePrimary = Color(0xFF0F172A);
}
