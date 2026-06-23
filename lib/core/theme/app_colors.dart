import 'package:flutter/material.dart';

/// Centralized color palette for GMP App — V2 Premium Edition.
/// Modern, refined tones with glassmorphism-friendly opacity levels.
class AppColors {
  AppColors._();

  // ============================================================================
  // BASE COLORS — Deep Space Foundation (V2 refined)
  // ============================================================================

  static const Color darkBase = Color(0xFF070A0F);
  static const Color darkSurface = Color(0xFF0D141B);
  static const Color darkCard = Color(0xFF151E27);
  static const Color borderColor = Color(0xFF2A3644);

  static const Color inkSurface = Color(0xFF0A1118);
  static const Color raisedSurface = Color(0xFF182331);
  static const Color softPanel = Color(0xFF101923);
  static const Color mutedPanel = Color(0xFF202A36);

  // Aliases for compatibility
  static const Color backgroundColor = darkBase;
  static const Color surfaceColor = darkSurface;
  static const Color cardColor = darkCard;

  // ============================================================================
  // NEON ACCENTS — Refined Premium Palette
  // ============================================================================

  static const Color neonBlue = Color(0xFF3B82F6);
  static const Color neonGreen = Color(0xFF10B981);
  static const Color neonPurple = Color(0xFF8B5CF6);
  static const Color neonPink = Color(0xFFEC4899);
  static const Color neonCyan = Color(0xFF06B6D4);
  static const Color neonTeal = Color(0xFF14B8A6);
  static const Color neonElectric = Color(0xFF60A5FA);
  static const Color holoBlue = Color(0xFF2563EB);

  static const Color accentMint = Color(0xFF5EEAD4);
  static const Color accentAmber = Color(0xFFFBBF24);
  static const Color accentRose = Color(0xFFFB7185);
  static const Color accentIndigo = Color(0xFF818CF8);

  // Advanced accents
  static const Color quantumRed = Color(0xFFFF4466);
  static const Color quantumOrange = Color(0xFFFFAA00);
  static const Color quantumLime = Color(0xFF8AFF00);
  static const Color quantumViolet = Color(0xFF9D4EDD);

  // Holographic effect colors
  static const Color holoPrimary = Color(0xFF00D4FF);
  static const Color holoSecondary = Color(0xFFB967FF);
  static const Color holoAccent = Color(0xFFFF55AA);
  static const Color holoSuccess = Color(0xFF00FFAA);
  static const Color holoWarning = Color(0xFFFFAA00);
  static const Color holoError = Color(0xFFFF4466);

  // Aliases
  static const Color primary = neonBlue;
  static const Color secondary = neonGreen;

  // ============================================================================
  // PREMIUM GRADIENT COLORS — Soft, modern blends
  // ============================================================================

  static const Color premiumBlueStart = Color(0xFF3B82F6);
  static const Color premiumBlueEnd = Color(0xFF8B5CF6);
  static const Color premiumPinkStart = Color(0xFFEC4899);
  static const Color premiumPinkEnd = Color(0xFFF43F5E);
  static const Color premiumGreenStart = Color(0xFF10B981);
  static const Color premiumGreenEnd = Color(0xFF06B6D4);
  static const Color premiumSunriseStart = Color(0xFFF59E0B);
  static const Color premiumSunriseEnd = Color(0xFFEF4444);
  static const Color premiumQuantumStart = Color(0xFF00D4FF);
  static const Color premiumQuantumEnd = Color(0xFFB967FF);
  static const Color premiumNeonStart = Color(0xFF00FFAA);
  static const Color premiumNeonEnd = Color(0xFFFF55AA);

  // ============================================================================
  // GLOW INTENSITIES
  // ============================================================================

  static const Color glowIntense = Color(0xFF3B82F6);
  static const Color glowMedium = Color(0xFF2563EB);
  static const Color glowSubtle = Color(0xFF1D4ED8);

  // ============================================================================
  // STATUS COLORS
  // ============================================================================

  static const Color success = Color(0xFF10B981);
  static const Color error = Color(0xFFEF4444);
  static const Color warning = Color(0xFFF59E0B);
  static const Color info = Color(0xFF3B82F6);

  // Payment status colors
  static const Color obligatorio = Color(0xFFEF4444);
  static const Color opcional = Color(0xFFF59E0B);
  static const Color cobrado = Color(0xFF10B981);
  static const Color credito = Color(0xFF3B82F6);

  // Aliases for compatibility
  static const Color successColor = success;
  static const Color errorColor = error;
  static const Color warningColor = warning;
  static const Color infoColor = info;

  // ============================================================================
  // TEXT COLORS — Improved contrast
  // ============================================================================

  static const Color textPrimary = Color(0xFFF9FAFB);
  static const Color textSecondary = Color(0xFF9CA3AF);
  static const Color textTertiary = Color(0xFF6B7280);

  // ============================================================================
  // CHART COLORS
  // ============================================================================

  static const Color chartYellow = Color(0xFFFBBF24);
  static const Color chartViolet = Color(0xFF8B5CF6);
  static const Color chartEmerald = Color(0xFF10B981);
  static const Color chartAmber = Color(0xFFF59E0B);
  static const Color chartCoral = Color(0xFFFF6B6B);
  static const Color chartOcean = Color(0xFF00D4FF);
  static const Color chartLime = Color(0xFF8AFF00);
  static const Color chartMagenta = Color(0xFFFF55AA);

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
  // GRADIENTS — Premium V2
  // ============================================================================

  /// Primary gradient — soft blue to purple
  static const LinearGradient primaryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0x4D3B82F6),
      Color(0x1A3B82F6),
    ],
  );

  /// Holographic gradient — cyan → blue → purple → cyan
  static const LinearGradient holoGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0x2606B6D4),
      Color(0x1A3B82F6),
      Color(0x1A8B5CF6),
      Color(0x2606B6D4),
    ],
    stops: [0.0, 0.35, 0.65, 1.0],
  );

  /// Scanner gradient — vertical cyan sweep
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

  /// Login button gradient — blue → purple → pink
  static const LinearGradient loginGradient = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [
      Color(0xFF3B82F6),
      Color(0xFF8B5CF6),
      Color(0xFFEC4899),
    ],
  );

  /// Success gradient — green → teal
  static const LinearGradient successGradient = LinearGradient(
    colors: [
      Color(0xFF10B981),
      Color(0xFF06B6D4),
    ],
  );

  /// Warning gradient — amber → red
  static const LinearGradient warningGradient = LinearGradient(
    colors: [
      Color(0xFFF59E0B),
      Color(0xFFEF4444),
    ],
  );

  /// Brand gradient for logos and headers
  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF3B82F6),
      Color(0xFF14B8A6),
      Color(0xFFF59E0B),
    ],
  );

  static const LinearGradient appShellGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF070A0F),
      Color(0xFF0B1415),
      Color(0xFF101923),
    ],
    stops: [0.0, 0.55, 1.0],
  );

  static const LinearGradient panelGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF182331),
      Color(0xFF101923),
    ],
  );

  // ============================================================================
  // DYNAMIC GRADIENTS — For interactive elements
  // ============================================================================

  static const List<Color> dynamicGradient1 = [
    neonBlue,
    neonGreen,
  ];

  static const List<Color> dynamicGradient2 = [
    neonPurple,
    neonPink,
  ];

  static const List<Color> dynamicGradient3 = [
    neonBlue,
    neonPurple,
  ];

  static const List<Color> dynamicGradient4 = [
    neonGreen,
    neonCyan,
  ];

  static const List<Color> holographicGradient = [
    neonCyan,
    neonPurple,
    neonPink,
    neonGreen,
  ];

  // ============================================================================
  // SPACING CONSTANTS
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
  // LEGACY COLORS — Kept for compatibility with older code
  // ============================================================================

  static const Color surfaceVariant = darkSurface;
  static const Color outlineVariant = borderColor;
  static const Color inverseSurface = Color(0xFFF9FAFB);
  static const Color inversePrimary = Color(0xFF0A0E1A);
}
