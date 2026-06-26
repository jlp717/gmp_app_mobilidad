import 'package:flutter/material.dart';

/// Centralized visual palette for GMP App.
///
/// Phase 1 keeps the legacy public names used across the app, but remaps them
/// to a restrained operational design system. New code should prefer the
/// semantic names: canvas, surface, panel, line, ink, muted, brand, info, etc.
class AppColors {
  AppColors._();

  // ===========================================================================
  // OPERATIONAL LEDGER PALETTE
  // ===========================================================================

  static const Color canvas = Color(0xFFF6F7F4);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color panel = Color(0xFFEEF2ED);
  static const Color line = Color(0xFFD7DDD5);
  static const Color ink = Color(0xFF1E2522);
  static const Color muted = Color(0xFF66736D);
  static const Color faint = Color(0xFF8B9791);

  static const Color darkCanvas = Color(0xFF101412);
  static const Color darkSurfaceLayer = Color(0xFF171D1A);
  static const Color darkPanel = Color(0xFF202822);
  static const Color darkLine = Color(0xFF33413B);
  static const Color darkInk = Color(0xFFF2F5F1);
  static const Color darkMuted = Color(0xFFA7B2AC);

  static const Color forest = Color(0xFF0E5F4A);
  static const Color moss = Color(0xFF2F855A);
  static const Color harbor = Color(0xFF1D4E89);
  static const Color ochre = Color(0xFFB7791F);
  static const Color brick = Color(0xFFB42318);
  static const Color slate = Color(0xFF475569);
  static const Color teal = Color(0xFF0F766E);
  static const Color aubergine = Color(0xFF694D75);

  // ===========================================================================
  // LEGACY BASE ALIASES
  // ===========================================================================

  static const Color darkBase = darkCanvas;
  static const Color darkSurface = darkSurfaceLayer;
  static const Color darkCard = darkPanel;
  static const Color borderColor = darkLine;

  static const Color inkSurface = Color(0xFF121815);
  static const Color raisedSurface = Color(0xFF1B231F);
  static const Color softPanel = Color(0xFF202822);
  static const Color mutedPanel = Color(0xFF29332E);

  static const Color backgroundColor = darkBase;
  static const Color surfaceColor = darkSurface;
  static const Color cardColor = darkCard;

  // ===========================================================================
  // ACCENT ALIASES
  // ===========================================================================

  static const Color primary = forest;
  static const Color secondary = moss;

  // Legacy names kept so feature files can migrate incrementally.
  static const Color neonBlue = harbor;
  static const Color neonGreen = moss;
  static const Color neonPurple = aubergine;
  static const Color neonPink = Color(0xFF9F4F63);
  static const Color neonCyan = teal;
  static const Color neonTeal = teal;
  static const Color neonElectric = Color(0xFF386FA4);
  static const Color holoBlue = harbor;

  static const Color accentMint = Color(0xFF74A892);
  static const Color accentAmber = ochre;
  static const Color accentRose = Color(0xFFB85C5C);
  static const Color accentIndigo = Color(0xFF52658C);

  static const Color quantumRed = brick;
  static const Color quantumOrange = ochre;
  static const Color quantumLime = moss;
  static const Color quantumViolet = aubergine;

  static const Color holoPrimary = harbor;
  static const Color holoSecondary = aubergine;
  static const Color holoAccent = Color(0xFF9F4F63);
  static const Color holoSuccess = moss;
  static const Color holoWarning = ochre;
  static const Color holoError = brick;

  static const Color premiumBlueStart = harbor;
  static const Color premiumBlueEnd = teal;
  static const Color premiumPinkStart = Color(0xFF9F4F63);
  static const Color premiumPinkEnd = brick;
  static const Color premiumGreenStart = moss;
  static const Color premiumGreenEnd = teal;
  static const Color premiumSunriseStart = ochre;
  static const Color premiumSunriseEnd = brick;
  static const Color premiumQuantumStart = harbor;
  static const Color premiumQuantumEnd = aubergine;
  static const Color premiumNeonStart = moss;
  static const Color premiumNeonEnd = Color(0xFF9F4F63);

  static const Color glowIntense = harbor;
  static const Color glowMedium = Color(0xFF2F6690);
  static const Color glowSubtle = Color(0xFF335C67);

  // ===========================================================================
  // SEMANTIC STATUS COLORS
  // ===========================================================================

  static const Color success = Color(0xFF2F855A);
  static const Color error = Color(0xFFB42318);
  static const Color warning = Color(0xFFB7791F);
  static const Color info = Color(0xFF1D4E89);

  static const Color obligatorio = error;
  static const Color opcional = warning;
  static const Color cobrado = success;
  static const Color credito = info;

  static const Color successColor = success;
  static const Color errorColor = error;
  static const Color warningColor = warning;
  static const Color infoColor = info;

  // ===========================================================================
  // TEXT COLORS
  // ===========================================================================

  static const Color textPrimary = darkInk;
  static const Color textSecondary = darkMuted;
  static const Color textTertiary = Color(0xFF75827C);

  static const Color textPrimaryLight = ink;
  static const Color textSecondaryLight = muted;
  static const Color textTertiaryLight = faint;

  // ===========================================================================
  // CHART COLORS
  // ===========================================================================

  static const Color chartYellow = ochre;
  static const Color chartViolet = aubergine;
  static const Color chartEmerald = moss;
  static const Color chartAmber = Color(0xFFC98A2E);
  static const Color chartCoral = Color(0xFFB85C5C);
  static const Color chartOcean = harbor;
  static const Color chartLime = Color(0xFF6F8F52);
  static const Color chartMagenta = Color(0xFF9F4F63);

  static const List<Color> chartColors = [
    harbor,
    moss,
    ochre,
    aubergine,
    teal,
    slate,
    chartCoral,
    chartLime,
  ];

  // ===========================================================================
  // GRADIENTS
  // ===========================================================================

  static const LinearGradient primaryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0x331D4E89),
      Color(0x140E5F4A),
    ],
  );

  static const LinearGradient holoGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0x24202822),
      Color(0x161D4E89),
      Color(0x120E5F4A),
    ],
    stops: [0.0, 0.55, 1.0],
  );

  static const LinearGradient scannerGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Colors.transparent,
      Color(0x661D4E89),
      Colors.transparent,
    ],
    stops: [0.0, 0.5, 1.0],
  );

  static const LinearGradient loginGradient = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [forest, harbor],
  );

  static const LinearGradient successGradient = LinearGradient(
    colors: [success, teal],
  );

  static const LinearGradient warningGradient = LinearGradient(
    colors: [warning, brick],
  );

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [forest, harbor],
  );

  static const LinearGradient appShellGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      darkCanvas,
      Color(0xFF121815),
      darkSurfaceLayer,
    ],
    stops: [0.0, 0.52, 1.0],
  );

  static const LinearGradient panelGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      darkPanel,
      darkSurfaceLayer,
    ],
  );

  static const List<Color> dynamicGradient1 = [harbor, teal];
  static const List<Color> dynamicGradient2 = [aubergine, Color(0xFF9F4F63)];
  static const List<Color> dynamicGradient3 = [harbor, aubergine];
  static const List<Color> dynamicGradient4 = [moss, teal];
  static const List<Color> holographicGradient = [harbor, moss, ochre, slate];

  // ===========================================================================
  // SPACING AND MOTION
  // ===========================================================================

  static const double paddingS = 8;
  static const double paddingM = 12;
  static const double paddingL = 20;
  static const double paddingXL = 28;

  static const Duration animFast = Duration(milliseconds: 120);
  static const Duration animNormal = Duration(milliseconds: 220);
  static const Duration animSlow = Duration(milliseconds: 360);
  static const Duration animPulse = Duration(milliseconds: 1200);

  // ===========================================================================
  // LEGACY COLORS
  // ===========================================================================

  static const Color surfaceVariant = darkSurface;
  static const Color outlineVariant = borderColor;
  static const Color inverseSurface = canvas;
  static const Color inversePrimary = darkBase;
}
