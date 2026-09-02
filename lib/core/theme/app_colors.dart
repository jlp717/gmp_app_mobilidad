import 'package:flutter/material.dart';

/// Centralized visual palette for GMP App.
///
/// The public names are kept for compatibility, but the palette now targets a
/// premium executive-cockpit look: darker depth, sharper contrast, and measured
/// luminous accents.
class AppColors {
  AppColors._();

  // Shared brightness bridge for legacy widgets that use AppTheme aliases.
  // ThemeProvider updates this value before the root Theme is rebuilt.
  static Brightness _brightness = Brightness.dark;

  static Brightness get brightness => _brightness;
  static bool get isDark => _brightness == Brightness.dark;

  static void setBrightness(Brightness value) {
    _brightness = value;
  }

  /// Registers a widget as a dependency of the active Material theme and
  /// keeps legacy AppColors aliases synchronized when ThemeMode changes.
  ///
  /// Older feature widgets read AppColors directly instead of calling
  /// Theme.of(context). Without this bridge they could keep a stale colour
  /// until an unrelated rebuild.
  static Brightness syncWithTheme(BuildContext context) {
    final value = Theme.of(context).brightness;
    setBrightness(value);
    return value;
  }

  // The legacy feature widgets still consume AppTheme aliases. Keeping the
  // selected brightness here lets those aliases follow the root theme while
  // the immutable brand/status tokens remain const and safe to use in const
  // widgets.
  static Color get themedCanvas => isDark ? darkCanvas : canvas;
  static Color get themedSurface => isDark ? darkSurfaceLayer : surface;
  static Color get themedPanel => isDark ? darkPanel : panel;
  static Color get themedLine => isDark ? darkLine : line;
  static Color get themedInk => isDark ? darkInk : ink;
  static Color get themedMuted => isDark ? darkMuted : muted;
  // Keep the fallback independent from the legacy `textTertiary` alias below.
  // That alias points back to `themedTertiaryText`, so using it here would
  // recurse whenever a widget asks for a tertiary colour.
  static Color get themedFaint => isDark ? darkMuted : faint;

  static Color get themedInkSurface => isDark ? inkSurface : surface;
  static Color get themedRaisedSurface => isDark ? raisedSurface : surface;
  static Color get themedSoftPanel => isDark ? softPanel : panel;
  static Color get themedMutedPanel =>
      isDark ? mutedPanel : const Color(0xFFDCE6EC);
  static Color get themedSurfaceCommand => isDark ? surfaceCommand : surface;
  static Color get themedSurfaceOverlay => isDark ? surfaceOverlay : surface;
  static Color get themedSurfaceGlass =>
      isDark ? surfaceGlass : const Color(0xE6FFFFFF);

  static Color get themedPrimaryText => themedInk;
  static Color get themedSecondaryText => themedMuted;
  static Color get themedTertiaryText => themedFaint;

  static LinearGradient get themedAppShellGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: isDark
            ? const [
                darkCanvas,
                Color(0xFF081421),
                Color(0xFF071A18),
                Color(0xFF101423),
              ]
            : const [
                canvas,
                Color(0xFFEEF4F5),
                Color(0xFFE7F5F2),
                Color(0xFFF2F2F7),
              ],
        stops: const [0.0, 0.42, 0.72, 1.0],
      );

  static LinearGradient get themedPanelGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: isDark
            ? const [
                Color(0xFF142230),
                Color(0xFF0D1621),
                Color(0xFF101A24),
              ]
            : const [
                surface,
                Color(0xFFF4F7F8),
                panel,
              ],
        stops: const [0.0, 0.62, 1.0],
      );

  static LinearGradient get themedCommandGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: isDark
            ? const [
                Color(0xFF162535),
                Color(0xFF0F1B27),
                Color(0xFF112D31),
              ]
            : const [
                surface,
                Color(0xFFF1F6F7),
                Color(0xFFE6F6F3),
              ],
        stops: const [0.0, 0.55, 1.0],
      );

  static LinearGradient get themedLoginGradient => LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: isDark
            ? const [Color(0xFF05111B), Color(0xFF102A3D), Color(0xFF0D3B37)]
            : const [Color(0xFFF4F7F8), Color(0xFFE6F1F9), Color(0xFFE5F7F2)],
        stops: const [0.0, 0.55, 1.0],
      );

  static LinearGradient get themedCardGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: isDark
            ? const [Color(0xFF172636), Color(0xFF0E1722), Color(0xFF111F25)]
            : const [surface, Color(0xFFF7FAFB), panel],
        stops: const [0.0, 0.64, 1.0],
      );

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
  static const Color onAccent = Color(0xFFFFFFFF);

  // ===========================================================================
  // LEGACY BASE ALIASES
  // ===========================================================================

  static Color get darkBase => themedCanvas;
  static Color get darkSurface => themedSurface;
  static Color get darkCard => themedPanel;
  static Color get borderColor => themedLine;

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

  static Color get backgroundColor => themedCanvas;
  static Color get surfaceColor => themedSurface;
  static Color get cardColor => themedPanel;

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

  // These semantic colours are intentionally dark enough for icons and text
  // on the light surface while retaining at least 3:1 contrast on the dark
  // canvas. The button foreground for success uses `ink` below.
  static const Color success = Color(0xFF007A52);
  static const Color error = Color(0xFFD32F2F);
  static const Color warning = Color(0xFFA15C00);
  static const Color info = Color(0xFF2563EB);

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

  static Color get textPrimary => themedPrimaryText;
  static Color get textSecondary => themedSecondaryText;
  static Color get textTertiary => themedTertiaryText;

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

  static Color get surfaceVariant => darkSurface;
  static Color get outlineVariant => borderColor;
  static const Color inverseSurface = canvas;
  static Color get inversePrimary => darkBase;

  // BEGIN GENERATED F1 LEGACY TOKENS
  // Framework and legacy tokens preserve existing visual values while
  // making palette ownership explicit and searchable.
  static const Color transparent = Colors.transparent;
  static const Color systemWhite = Color(0xFFFFFFFF);
  static const Color systemWhite10 = Color(0x1AFFFFFF);
  static const Color systemWhite12 = Color(0x1FFFFFFF);
  static const Color systemWhite24 = Color(0x3DFFFFFF);
  static const Color systemWhite30 = Color(0x4DFFFFFF);
  static const Color systemWhite38 = Color(0x61FFFFFF);
  static const Color systemWhite54 = Color(0x8AFFFFFF);
  static const Color systemWhite60 = Color(0x99FFFFFF);
  static const Color systemWhite70 = Color(0xB3FFFFFF);
  static const Color systemBlack = Color(0xFF000000);
  static const Color systemBlack12 = Color(0x1F000000);
  static const Color systemBlack26 = Color(0x42000000);
  static const Color systemBlack38 = Color(0x61000000);
  static const Color systemBlack45 = Color(0x73000000);
  static const Color systemBlack54 = Color(0x8A000000);
  static const Color systemBlack87 = Color(0xDE000000);
  static const Color systemGrey = Color(0xFF9E9E9E);
  static const Color systemBlue = Color(0xFF2196F3);
  static const Color systemBlueAccent = Color(0xFF448AFF);
  static const Color systemBlueGrey = Color(0xFF607D8B);
  static const Color systemBrown = Color(0xFF795548);
  static const Color systemCyan = Color(0xFF00BCD4);
  static const Color systemCyanAccent = Color(0xFF00E5FF);
  static const Color systemDeepPurple = Color(0xFF673AB7);
  static const Color systemGreen = Color(0xFF4CAF50);
  static const Color systemGreenAccent = Color(0xFF69F0AE);
  static const Color systemLightBlue = Color(0xFF03A9F4);
  static const Color systemLightGreen = Color(0xFF8BC34A);
  static const Color systemOrange = Color(0xFFFF9800);
  static const Color systemOrangeAccent = Color(0xFFFFAB40);
  static const Color systemPink = Color(0xFFE91E63);
  static const Color systemPinkAccent = Color(0xFFFF4081);
  static const Color systemPurple = Color(0xFF9C27B0);
  static const Color systemPurpleAccent = Color(0xFFE040FB);
  static const Color systemRed = Color(0xFFF44336);
  static const Color systemRedAccent = Color(0xFFFF5252);
  static const Color systemAmber = Color(0xFFFFC107);
  static const Color systemTeal = Color(0xFF009688);
  static const Color systemAmber50 = Color(0xFFFFF8E1);
  static const Color systemAmber100 = Color(0xFFFFECB3);
  static const Color systemAmber700 = Color(0xFFFFA000);
  static const Color systemAmber800 = Color(0xFFFF8F00);
  static const Color systemAmber900 = Color(0xFFFF6F00);
  static const Color systemBlue50 = Color(0xFFE3F2FD);
  static const Color systemBlue300 = Color(0xFF64B5F6);
  static const Color systemBlue400 = Color(0xFF42A5F5);
  static const Color systemBlue700 = Color(0xFF1976D2);
  static const Color systemBlueGrey200 = Color(0xFFB0BEC5);
  static const Color systemBrown300 = Color(0xFF8D6E63);
  static const Color systemCyan400 = Color(0xFF26C6DA);
  static const Color systemCyanAccent400 = Color(0xFF00E5FF);
  static const Color systemGreen50 = Color(0xFFE8F5E9);
  static const Color systemGreen400 = Color(0xFF66BB6A);
  static const Color systemGreen700 = Color(0xFF388E3C);
  static const Color systemGreen800 = Color(0xFF2E7D32);
  static const Color systemGreenAccent400 = Color(0xFF00E676);
  static const Color systemGreenAccent700 = Color(0xFF00C853);
  static const Color systemGrey50 = Color(0xFFFAFAFA);
  static const Color systemGrey100 = Color(0xFFF5F5F5);
  static const Color systemGrey200 = Color(0xFFEEEEEE);
  static const Color systemGrey300 = Color(0xFFE0E0E0);
  static const Color systemGrey400 = Color(0xFFBDBDBD);
  static const Color systemGrey500 = Color(0xFF9E9E9E);
  static const Color systemGrey600 = Color(0xFF757575);
  static const Color systemGrey700 = Color(0xFF616161);
  static const Color systemGrey800 = Color(0xFF424242);
  static const Color systemOrange300 = Color(0xFFFFB74D);
  static const Color systemOrange700 = Color(0xFFF57C00);
  static const Color systemPink400 = Color(0xFFEC407A);
  static const Color systemPurple50 = Color(0xFFF3E5F5);
  static const Color systemPurple400 = Color(0xFFAB47BC);
  static const Color systemPurple700 = Color(0xFF7B1FA2);
  static const Color systemRed700 = Color(0xFFD32F2F);
  static const Color legacy0A000000 = Color(0x0A000000);
  static const Color legacy12FFFFFF = Color(0x12FFFFFF);
  static const Color legacy15FFFFFF = Color(0x15FFFFFF);
  static const Color legacy18000000 = Color(0x18000000);
  static const Color legacy18FFFFFF = Color(0x18FFFFFF);
  static const Color legacy20000000 = Color(0x20000000);
  static const Color legacy20FFFFFF = Color(0x20FFFFFF);
  static const Color legacy25FFFFFF = Color(0x25FFFFFF);
  static const Color legacy30FFFFFF = Color(0x30FFFFFF);
  static const Color legacy40000000 = Color(0x40000000);
  static const Color legacy45FFFFFF = Color(0x45FFFFFF);
  static const Color legacy55FFFFFF = Color(0x55FFFFFF);
  static const Color legacy60000000 = Color(0x60000000);
  static const Color legacy60FFFFFF = Color(0x60FFFFFF);
  static const Color legacy66FF3B5C = Color(0x66FF3B5C);
  static const Color legacy80000000 = Color(0x80000000);
  static const Color legacyAA000000 = Color(0xAA000000);
  static const Color legacyAA1A1A2E = Color(0xAA1A1A2E);
  static const Color legacyAA1B5E20 = Color(0xAA1B5E20);
  static const Color legacyAAFFFFFF = Color(0xAAFFFFFF);
  static const Color legacyCC000000 = Color(0xCC000000);
  static const Color legacyCC1A1A2E = Color(0xCC1A1A2E);
  static const Color legacyCC1A202C = Color(0xCC1A202C);
  static const Color legacyCCFFFFFF = Color(0xCCFFFFFF);
  static const Color legacyFF0000FF = Color(0xFF0000FF);
  static const Color legacyFF0066FF = Color(0xFF0066FF);
  static const Color legacyFF009688 = Color(0xFF009688);
  static const Color legacyFF00BCD4 = Color(0xFF00BCD4);
  static const Color legacyFF00D2FF = Color(0xFF00D2FF);
  static const Color legacyFF00D4FF = Color(0xFF00D4FF);
  static const Color legacyFF00F5FF = Color(0xFF00F5FF);
  static const Color legacyFF00FF00 = Color(0xFF00FF00);
  static const Color legacyFF00FF41 = Color(0xFF00FF41);
  static const Color legacyFF00FF88 = Color(0xFF00FF88);
  static const Color legacyFF0A0E1A = Color(0xFF0A0E1A);
  static const Color legacyFF0A0E21 = Color(0xFF0A0E21);
  static const Color legacyFF0A0E27 = Color(0xFF0A0E27);
  static const Color legacyFF0A2E1A = Color(0xFF0A2E1A);
  static const Color legacyFF0C1A3A = Color(0xFF0C1A3A);
  static const Color legacyFF0D1320 = Color(0xFF0D1320);
  static const Color legacyFF0D47A1 = Color(0xFF0D47A1);
  static const Color legacyFF0F1329 = Color(0xFF0F1329);
  static const Color legacyFF0F172A = Color(0xFF0F172A);
  static const Color legacyFF10B981 = Color(0xFF10B981);
  static const Color legacyFF111827 = Color(0xFF111827);
  static const Color legacyFF1976D2 = Color(0xFF1976D2);
  static const Color legacyFF1A0A2E = Color(0xFF1A0A2E);
  static const Color legacyFF1A1A2E = Color(0xFF1A1A2E);
  static const Color legacyFF1A1F35 = Color(0xFF1A1F35);
  static const Color legacyFF1A1F3A = Color(0xFF1A1F3A);
  static const Color legacyFF1A202C = Color(0xFF1A202C);
  static const Color legacyFF1A2332 = Color(0xFF1A2332);
  static const Color legacyFF1E1E2E = Color(0xFF1E1E2E);
  static const Color legacyFF1E2543 = Color(0xFF1E2543);
  static const Color legacyFF1E2746 = Color(0xFF1E2746);
  static const Color legacyFF1E293B = Color(0xFF1E293B);
  static const Color legacyFF1E40AF = Color(0xFF1E40AF);
  static const Color legacyFF1F2937 = Color(0xFF1F2937);
  static const Color legacyFF2196F3 = Color(0xFF2196F3);
  static const Color legacyFF22C55E = Color(0xFF22C55E);
  static const Color legacyFF22D3EE = Color(0xFF22D3EE);
  static const Color legacyFF252B47 = Color(0xFF252B47);
  static const Color legacyFF2563EB = Color(0xFF2563EB);
  static const Color legacyFF25D366 = Color(0xFF25D366);
  static const Color legacyFF2979FF = Color(0xFF2979FF);
  static const Color legacyFF2D1B00 = Color(0xFF2D1B00);
  static const Color legacyFF2D2D44 = Color(0xFF2D2D44);
  static const Color legacyFF2D3748 = Color(0xFF2D3748);
  static const Color legacyFF2D5A87 = Color(0xFF2D5A87);
  static const Color legacyFF2E0A0A = Color(0xFF2E0A0A);
  static const Color legacyFF2E7D32 = Color(0xFF2E7D32);
  static const Color legacyFF374151 = Color(0xFF374151);
  static const Color legacyFF38B6FF = Color(0xFF38B6FF);
  static const Color legacyFF38BDF8 = Color(0xFF38BDF8);
  static const Color legacyFF3B82F6 = Color(0xFF3B82F6);
  static const Color legacyFF475569 = Color(0xFF475569);
  static const Color legacyFF4A5568 = Color(0xFF4A5568);
  static const Color legacyFF4ADE80 = Color(0xFF4ADE80);
  static const Color legacyFF4CAF50 = Color(0xFF4CAF50);
  static const Color legacyFF4D96FF = Color(0xFF4D96FF);
  static const Color legacyFF4ECDC4 = Color(0xFF4ECDC4);
  static const Color legacyFF5A6376 = Color(0xFF5A6376);
  static const Color legacyFF5B8FB9 = Color(0xFF5B8FB9);
  static const Color legacyFF60A5FA = Color(0xFF60A5FA);
  static const Color legacyFF66BB6A = Color(0xFF66BB6A);
  static const Color legacyFF6BCB77 = Color(0xFF6BCB77);
  static const Color legacyFF84FFFF = Color(0xFF84FFFF);
  static const Color legacyFF87CEEB = Color(0xFF87CEEB);
  static const Color legacyFF8A98AC = Color(0xFF8A98AC);
  static const Color legacyFF8B5CF6 = Color(0xFF8B5CF6);
  static const Color legacyFF90CAF9 = Color(0xFF90CAF9);
  static const Color legacyFF94A3B8 = Color(0xFF94A3B8);
  static const Color legacyFF95E1D3 = Color(0xFF95E1D3);
  static const Color legacyFF9C27B0 = Color(0xFF9C27B0);
  static const Color legacyFF9CA3AF = Color(0xFF9CA3AF);
  static const Color legacyFF9D00FF = Color(0xFF9D00FF);
  static const Color legacyFFA06CD5 = Color(0xFFA06CD5);
  static const Color legacyFFA78BFA = Color(0xFFA78BFA);
  static const Color legacyFFA855F7 = Color(0xFFA855F7);
  static const Color legacyFFA8E6CF = Color(0xFFA8E6CF);
  static const Color legacyFFB8C5D6 = Color(0xFFB8C5D6);
  static const Color legacyFFCBD5E1 = Color(0xFFCBD5E1);
  static const Color legacyFFDDA0DD = Color(0xFFDDA0DD);
  static const Color legacyFFE2E8F0 = Color(0xFFE2E8F0);
  static const Color legacyFFE53935 = Color(0xFFE53935);
  static const Color legacyFFEC4899 = Color(0xFFEC4899);
  static const Color legacyFFEF4444 = Color(0xFFEF4444);
  static const Color legacyFFF0E68C = Color(0xFFF0E68C);
  static const Color legacyFFF1F5F9 = Color(0xFFF1F5F9);
  static const Color legacyFFF472B6 = Color(0xFFF472B6);
  static const Color legacyFFF5F7FA = Color(0xFFF5F7FA);
  static const Color legacyFFF8FAFC = Color(0xFFF8FAFC);
  static const Color legacyFFF97316 = Color(0xFFF97316);
  static const Color legacyFFFDE68A = Color(0xFFFDE68A);
  static const Color legacyFFFF0000 = Color(0xFFFF0000);
  static const Color legacyFFFF00FF = Color(0xFFFF00FF);
  static const Color legacyFFFF073A = Color(0xFFFF073A);
  static const Color legacyFFFF4081 = Color(0xFFFF4081);
  static const Color legacyFFFF4444 = Color(0xFFFF4444);
  static const Color legacyFFFF5722 = Color(0xFFFF5722);
  static const Color legacyFFFF6584 = Color(0xFFFF6584);
  static const Color legacyFFFF6B00 = Color(0xFFFF6B00);
  static const Color legacyFFFF6B6B = Color(0xFFFF6B6B);
  static const Color legacyFFFF6B9D = Color(0xFFFF6B9D);
  static const Color legacyFFFF8C42 = Color(0xFFFF8C42);
  static const Color legacyFFFF8C8C = Color(0xFFFF8C8C);
  static const Color legacyFFFF9800 = Color(0xFFFF9800);
  static const Color legacyFFFF9A9E = Color(0xFFFF9A9E);
  static const Color legacyFFFFB347 = Color(0xFFFFB347);
  static const Color legacyFFFFC107 = Color(0xFFFFC107);
  static const Color legacyFFFFD600 = Color(0xFFFFD600);
  static const Color legacyFFFFE600 = Color(0xFFFFE600);
  static const Color legacyFFFFE66D = Color(0xFFFFE66D);
  static const Color legacyFFFFFFFF = Color(0xFFFFFFFF);
  // END GENERATED F1 LEGACY TOKENS

  // Historical white-overlay names are kept as dynamic aliases. In dark mode
  // they remain white overlays; in light mode they switch to the ink color so
  // controls that used a white-on-dark treatment preserve readable contrast.
  static Color get themedWhite => isDark ? systemWhite : ink;
  static Color get themedWhite10 => themedWhite.withValues(alpha: 0.10);
  static Color get themedWhite12 => themedWhite.withValues(alpha: 0.12);
  static Color get themedWhite24 => themedWhite.withValues(alpha: 0.24);
  static Color get themedWhite30 => themedWhite.withValues(alpha: 0.30);
  static Color get themedWhite38 => themedWhite.withValues(alpha: 0.38);
  static Color get themedWhite54 => themedWhite.withValues(alpha: 0.54);
  static Color get themedWhite60 => themedWhite.withValues(alpha: 0.60);
  static Color get themedWhite70 => themedWhite.withValues(alpha: 0.70);
}
