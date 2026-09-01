import 'package:flutter/material.dart';

/// Centralized visual palette for GMP App.
///
/// The public names are kept for compatibility, but the palette now targets a
/// premium executive-cockpit look: darker depth, sharper contrast, and measured
/// luminous accents.
class AppColors {
  AppColors._();

  // ===========================================================================
  // EXECUTIVE FUTURISM PALETTE
  // ===========================================================================

  static const Color canvas = Color(0xFFF4F7F8);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color panel = Color(0xFFE8EEF2);
  static const Color line = Color(0xFFC8D2DA);
  static const Color ink = Color(0xFF132027);
  static const Color muted = Color(0xFF5D6B75);
  static const Color faint = Color(0xFF87949D);

  static const Color darkCanvas = Color(0xFF05080D);
  static const Color darkSurfaceLayer = Color(0xFF0B1118);
  static const Color darkPanel = Color(0xFF101A24);
  static const Color darkLine = Color(0xFF263747);
  static const Color darkInk = Color(0xFFF4F9FB);
  static const Color darkMuted = Color(0xFFA8B8C4);

  static const Color forest = Color(0xFF00A878);
  static const Color moss = Color(0xFF36C486);
  static const Color harbor = Color(0xFF3B82F6);
  static const Color ochre = Color(0xFFF2B84B);
  static const Color brick = Color(0xFFFF5A5F);
  static const Color slate = Color(0xFF6B7C8F);
  static const Color teal = Color(0xFF12D6C5);
  static const Color aubergine = Color(0xFF8D6BFF);

  // ===========================================================================
  // LEGACY BASE ALIASES
  // ===========================================================================

  static const Color darkBase = darkCanvas;
  static const Color darkSurface = darkSurfaceLayer;
  static const Color darkCard = darkPanel;
  static const Color borderColor = darkLine;

  static const Color inkSurface = Color(0xFF070B11);
  static const Color raisedSurface = Color(0xFF0F1822);
  static const Color softPanel = Color(0xFF142230);
  static const Color mutedPanel = Color(0xFF1B2A38);

  static const Color surfaceCommand = Color(0xFF111F2A);
  static const Color surfaceOverlay = Color(0xFF162535);
  static const Color surfaceGlass = Color(0xCC111F2A);
  static const Color activeRing = Color(0xFF25E4C8);
  static const Color focusRing = Color(0xFF68A7FF);
  static const Color selectionRail = Color(0xFFF2B84B);
  static const Color criticalRing = Color(0xFFFF6B73);

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
  static const Color neonPink = Color(0xFFFF6BAA);
  static const Color neonCyan = teal;
  static const Color neonTeal = teal;
  static const Color neonElectric = Color(0xFF7DD3FC);
  static const Color holoBlue = harbor;

  static const Color accentMint = Color(0xFF69F0C9);
  static const Color accentAmber = ochre;
  static const Color accentRose = Color(0xFFFF7A90);
  static const Color accentIndigo = Color(0xFF8EA6FF);

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
  static const Color premiumPinkStart = Color(0xFFFF6BAA);
  static const Color premiumPinkEnd = brick;
  static const Color premiumGreenStart = moss;
  static const Color premiumGreenEnd = teal;
  static const Color premiumSunriseStart = ochre;
  static const Color premiumSunriseEnd = brick;
  static const Color premiumQuantumStart = harbor;
  static const Color premiumQuantumEnd = aubergine;
  static const Color premiumNeonStart = moss;
  static const Color premiumNeonEnd = Color(0xFFFF6BAA);

  static const Color glowIntense = Color(0xFF25E4C8);
  static const Color glowMedium = Color(0xFF3B82F6);
  static const Color glowSubtle = Color(0xFF27475F);

  // ===========================================================================
  // SEMANTIC STATUS COLORS
  // ===========================================================================

  static const Color success = Color(0xFF36C486);
  static const Color error = Color(0xFFFF5A5F);
  static const Color warning = Color(0xFFF2B84B);
  static const Color info = Color(0xFF68A7FF);

  static const Color obligatorio = error;
  static const Color opcional = warning;
  static const Color cobrado = success;
  static const Color credito = info;

  static const Color successColor = success;
  static const Color errorColor = error;
  static const Color warningColor = warning;
  static const Color infoColor = info;

  // ===========================================================================
  // BRAND COLORS
  // ===========================================================================

  /// Official WhatsApp green used for WhatsApp action buttons/links.
  static const Color whatsappGreen = Color(0xFF25D366);

  // ===========================================================================
  // TEXT COLORS
  // ===========================================================================

  static const Color textPrimary = darkInk;
  static const Color textSecondary = darkMuted;
  static const Color textTertiary = Color(0xFF758596);

  static const Color textPrimaryLight = ink;
  static const Color textSecondaryLight = muted;
  static const Color textTertiaryLight = faint;

  // ===========================================================================
  // CHART COLORS
  // ===========================================================================

  static const Color chartYellow = ochre;
  static const Color chartViolet = aubergine;
  static const Color chartEmerald = moss;
  static const Color chartAmber = Color(0xFFFFC857);
  static const Color chartCoral = Color(0xFFFF7A90);
  static const Color chartOcean = harbor;
  static const Color chartLime = Color(0xFFB8F171);
  static const Color chartMagenta = Color(0xFFFF6BAA);

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
      Color(0x553B82F6),
      Color(0x3325E4C8),
      Color(0x188D6BFF),
    ],
    stops: [0.0, 0.56, 1.0],
  );

  static const LinearGradient holoGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0x66111F2A),
      Color(0x333B82F6),
      Color(0x2925E4C8),
      Color(0x188D6BFF),
    ],
    stops: [0.0, 0.42, 0.72, 1.0],
  );

  static const LinearGradient scannerGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Colors.transparent,
      Color(0x8A25E4C8),
      Colors.transparent,
    ],
    stops: [0.0, 0.5, 1.0],
  );

  static const LinearGradient loginGradient = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [Color(0xFF05111B), Color(0xFF102A3D), Color(0xFF0D3B37)],
    stops: [0.0, 0.55, 1.0],
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
    colors: [teal, harbor, aubergine],
    stops: [0.0, 0.58, 1.0],
  );

  static const LinearGradient appShellGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      darkCanvas,
      Color(0xFF081421),
      Color(0xFF071A18),
      Color(0xFF101423),
    ],
    stops: [0.0, 0.42, 0.72, 1.0],
  );

  static const LinearGradient panelGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF142230),
      Color(0xFF0D1621),
      Color(0xFF101A24),
    ],
    stops: [0.0, 0.62, 1.0],
  );

  static const LinearGradient commandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFF162535),
      Color(0xFF0F1B27),
      Color(0xFF112D31),
    ],
    stops: [0.0, 0.55, 1.0],
  );

  static const LinearGradient dataHeaderGradient = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [
      Color(0x3325E4C8),
      Color(0x223B82F6),
      Color(0x118D6BFF),
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
