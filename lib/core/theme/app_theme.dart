import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:google_fonts/google_fonts.dart';

/// Ultra-modern, minimalist, futuristic theme for tablet app — V2 Premium.
/// Dark theme with refined neon accents, generous border radius, and premium glassmorphism.
class AppTheme {
  AppTheme._();

  // ============================================================================
  // BORDER RADIUS SYSTEM — V2 (generous, modern)
  // ============================================================================

  /// Small radius — chips, badges, tags
  static const double radiusSm = 8.0;

  /// Medium radius — buttons, inputs, small cards
  static const double radiusMd = 12.0;

  /// Large radius — cards, modals, panels
  static const double radiusLg = 18.0;

  /// Extra large radius — hero cards, login panel
  static const double radiusXl = 22.0;

  /// Full pill — pills, avatars
  static const double radiusFull = 9999.0;

  // ============================================================================
  // COLOR PALETTE - Re-exports from AppColors for compatibility
  // ============================================================================

  static const Color darkBase = AppColors.darkBase;
  static const Color darkSurface = AppColors.darkSurface;
  static const Color darkCard = AppColors.darkCard;
  static const Color borderColor = AppColors.borderColor;
  static const Color inkSurface = AppColors.inkSurface;
  static const Color raisedSurface = AppColors.raisedSurface;
  static const Color softPanel = AppColors.softPanel;
  static const Color mutedPanel = AppColors.mutedPanel;

  static const Color surfaceColor = AppColors.surfaceColor;

  static const Color neonBlue = AppColors.neonBlue;
  static const Color neonGreen = AppColors.neonGreen;
  static const Color neonPurple = AppColors.neonPurple;
  static const Color neonPink = AppColors.neonPink;

  static const Color neonCyan = AppColors.neonCyan;
  static const Color neonTeal = AppColors.neonTeal;
  static const Color neonElectric = AppColors.neonElectric;
  static const Color holoBlue = AppColors.holoBlue;
  static const Color accentMint = AppColors.accentMint;
  static const Color accentAmber = AppColors.accentAmber;
  static const Color accentRose = AppColors.accentRose;
  static const Color accentIndigo = AppColors.accentIndigo;

  static const Color glowIntense = AppColors.glowIntense;
  static const Color glowMedium = AppColors.glowMedium;
  static const Color glowSubtle = AppColors.glowSubtle;

  static const Color success = AppColors.success;
  static const Color error = AppColors.error;
  static const Color warning = AppColors.warning;
  static const Color info = AppColors.info;

  static const Color successColor = AppColors.successColor;
  static const Color errorColor = AppColors.errorColor;
  static const Color warningColor = AppColors.warningColor;
  static const Color infoColor = AppColors.infoColor;

  static const Color obligatorio = AppColors.obligatorio;
  static const Color opcional = AppColors.opcional;
  static const Color cobrado = AppColors.cobrado;
  static const Color credito = AppColors.credito;

  static const Color textPrimary = AppColors.textPrimary;
  static const Color textSecondary = AppColors.textSecondary;
  static const Color textTertiary = AppColors.textTertiary;

  static const List<Color> chartColors = AppColors.chartColors;

  // ============================================================================
  // GRADIENTS - Premium V2
  // ============================================================================

  static const LinearGradient primaryGradient = AppColors.primaryGradient;
  static const LinearGradient holoGradient = AppColors.holoGradient;
  static const LinearGradient scannerGradient = AppColors.scannerGradient;
  static const LinearGradient loginGradient = AppColors.loginGradient;
  static const LinearGradient brandGradient = AppColors.brandGradient;
  static const LinearGradient appShellGradient = AppColors.appShellGradient;
  static const LinearGradient panelGradient = AppColors.panelGradient;

  /// Card gradient for delivery cards
  static LinearGradient get cardGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          raisedSurface,
          softPanel,
        ],
      );

  /// Urgent indicator gradient (red pulse)
  static LinearGradient get urgentGradient => LinearGradient(
        colors: [
          error.withValues(alpha: 0.3),
          error.withValues(alpha: 0.1),
        ],
      );

  /// Success indicator gradient
  static LinearGradient get successGradient => LinearGradient(
        colors: [
          success.withValues(alpha: 0.3),
          success.withValues(alpha: 0.1),
        ],
      );

  // Alias for compatibility (lightTheme not implemented, using darkTheme)
  static ThemeData get lightTheme => darkTheme;

  /// Compatibility alias for code expecting `themeData`.
  static ThemeData get themeData => darkTheme;

  // ============================================================================
  // THEME DATA
  // ============================================================================

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: darkBase,

      // Color scheme
      colorScheme: const ColorScheme.dark(
        primary: neonBlue,
        secondary: neonGreen,
        surface: darkSurface,
        error: error,
        onPrimary: darkBase,
        onSecondary: darkBase,
        onError: textPrimary,
        onSurface: textPrimary,
      ),

      // Typography - Inter (more modern than Roboto)
      textTheme: GoogleFonts.interTextTheme(
        ThemeData.dark().textTheme.copyWith(
              displayLarge: const TextStyle(
                fontSize: 57,
                fontWeight: FontWeight.w300,
                color: textPrimary,
              ),
              displayMedium: const TextStyle(
                fontSize: 45,
                fontWeight: FontWeight.w300,
                color: textPrimary,
              ),
              displaySmall: const TextStyle(
                fontSize: 36,
                fontWeight: FontWeight.w400,
                color: textPrimary,
              ),
              headlineLarge: const TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w400,
                color: textPrimary,
              ),
              headlineMedium: const TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w400,
                color: textPrimary,
              ),
              headlineSmall: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w400,
                color: textPrimary,
              ),
              titleLarge: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w500,
                color: textPrimary,
              ),
              titleMedium: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: textPrimary,
              ),
              titleSmall: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: textPrimary,
              ),
              bodyLarge: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w400,
                color: textPrimary,
              ),
              bodyMedium: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w400,
                color: textSecondary,
              ),
              bodySmall: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w400,
                color: textTertiary,
              ),
            ),
      ),

      // Card Theme — V2.5: premium shadow, frosted border, dark surface
      cardTheme: CardThemeData(
        color: raisedSurface,
        elevation: 1,
        shadowColor: Colors.black.withValues(alpha: 0.32),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.07)),
        ),
        clipBehavior: Clip.antiAlias,
      ),

      // App Bar Theme — V2.5: subtle bottom glow, premium icons
      appBarTheme: AppBarTheme(
        backgroundColor: inkSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        shadowColor: neonBlue.withValues(alpha: 0.08),
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        iconTheme: const IconThemeData(color: neonBlue),
        actionsIconTheme: const IconThemeData(color: neonBlue),
        titleTextStyle: const TextStyle(
          color: textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        toolbarTextStyle: const TextStyle(
          color: textSecondary,
          fontSize: 14,
        ),
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: darkBase,
          statusBarIconBrightness: Brightness.light,
          systemNavigationBarColor: darkBase,
          systemNavigationBarIconBrightness: Brightness.light,
        ),
      ),

      // Button Themes — V2.5: animated press state, neon border, premium
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: neonBlue,
          foregroundColor: darkBase,
          disabledBackgroundColor: darkCard,
          disabledForegroundColor: textTertiary,
          elevation: 0,
          shadowColor: neonBlue.withValues(alpha: 0.18),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radiusMd)),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          animationDuration: const Duration(milliseconds: 200),
          enableFeedback: true,
        ),
      ),

      // Outlined button with neon border
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: neonBlue,
          side: BorderSide(color: neonBlue.withValues(alpha: 0.34)),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radiusMd)),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          animationDuration: const Duration(milliseconds: 200),
        ),
      ),

      // Text button with subtle accent
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: neonBlue,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radiusSm)),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        ),
      ),

      // Input Theme — V2.5: glow focus, premium radius
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: softPanel,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: borderColor.withValues(alpha: 0.75)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: borderColor.withValues(alpha: 0.55)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: neonBlue, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: error, width: 1),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: error, width: 2),
        ),
        labelStyle: const TextStyle(color: textSecondary),
        hintStyle: const TextStyle(color: textTertiary),
      ),

      // Floating action button theme
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: neonBlue,
        foregroundColor: darkBase,
        elevation: 4,
        focusElevation: 8,
        hoverElevation: 6,
        highlightElevation: 8,
        disabledElevation: 0,
        shape: const CircleBorder(),
        enableFeedback: true,
      ),

      // DatePicker Theme for dark mode visibility
      datePickerTheme: DatePickerThemeData(
        backgroundColor: darkSurface,
        headerBackgroundColor: neonBlue,
        headerForegroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        dayForegroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return darkBase;
          if (states.contains(WidgetState.disabled)) return Colors.grey;
          return Colors.white;
        }),
        dayBackgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return neonBlue;
          return Colors.transparent;
        }),
        todayForegroundColor: WidgetStateProperty.all(neonBlue),
        todayBackgroundColor: WidgetStateProperty.all(Colors.transparent),
        todayBorder: const BorderSide(color: neonBlue),
        yearForegroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return darkBase;
          return Colors.white;
        }),
        yearBackgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return neonBlue;
          return Colors.transparent;
        }),
        rangeSelectionBackgroundColor: neonBlue.withValues(alpha: 0.2),
        dividerColor: Colors.white24,
      ),

      // Dialog Theme — V2.5: generous radius, premium shadow, subtle glow
      dialogTheme: DialogThemeData(
        backgroundColor: raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
        elevation: 12,
        shadowColor: Colors.black.withValues(alpha: 0.5),
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 40, vertical: 24),
      ),

      // Bottom Sheet Theme — V2.5: frosted top, elevated
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(radiusXl)),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
        elevation: 12,
        shadowColor: Colors.black.withValues(alpha: 0.4),
        surfaceTintColor: Colors.transparent,
        modalElevation: 16,
        modalBarrierColor: Colors.black.withValues(alpha: 0.5),
        dragHandleColor: textTertiary,
        dragHandleSize: const Size(32, 4),
      ),

      // Snackbar Theme — V2.5: floating pill, premium
      snackBarTheme: SnackBarThemeData(
        backgroundColor: raisedSurface,
        contentTextStyle: const TextStyle(color: textPrimary, fontSize: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.06)),
        ),
        behavior: SnackBarBehavior.floating,
        elevation: 8,
        width: 440,
      ),

      dividerTheme: DividerThemeData(
        color: borderColor.withValues(alpha: 0.45),
        thickness: 1,
        space: 1,
      ),

      chipTheme: ChipThemeData(
        backgroundColor: softPanel,
        selectedColor: neonBlue.withValues(alpha: 0.18),
        disabledColor: mutedPanel.withValues(alpha: 0.55),
        labelStyle: const TextStyle(color: textSecondary, fontSize: 12),
        secondaryLabelStyle: const TextStyle(color: textPrimary, fontSize: 12),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        side: BorderSide(color: borderColor.withValues(alpha: 0.55)),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusSm),
        ),
      ),

      listTileTheme: ListTileThemeData(
        iconColor: textSecondary,
        textColor: textPrimary,
        tileColor: Colors.transparent,
        selectedTileColor: neonBlue.withValues(alpha: 0.12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
      ),

      popupMenuTheme: PopupMenuThemeData(
        color: raisedSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 10,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
      ),

      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) return textTertiary;
            return neonBlue;
          }),
          overlayColor: WidgetStateProperty.all(
            neonBlue.withValues(alpha: 0.10),
          ),
          shape: WidgetStateProperty.all(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radiusMd),
            ),
          ),
        ),
      ),

      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: neonBlue,
        linearTrackColor: mutedPanel,
        circularTrackColor: mutedPanel,
      ),
    );
  }

  // ============================================================================
  // CUSTOM DECORATIONS — V2 Premium
  // ============================================================================

  static BoxDecoration appBackground() => const BoxDecoration(
        gradient: appShellGradient,
      );

  static BoxDecoration premiumPanel({
    Color? accentColor,
    double radius = radiusLg,
    double opacity = 1,
  }) {
    final accent = accentColor ?? neonBlue;
    return BoxDecoration(
      gradient: panelGradient,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: accent.withValues(alpha: 0.16)),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.26 * opacity),
          blurRadius: 22,
          offset: const Offset(0, 12),
        ),
        BoxShadow(
          color: accent.withValues(alpha: 0.045 * opacity),
          blurRadius: 28,
        ),
      ],
    );
  }

  /// Glassmorphism — V2: softer, more refined
  static BoxDecoration glassMorphism({Color? color}) => BoxDecoration(
        color: (color ?? raisedSurface).withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.2),
              blurRadius: 20,
              offset: const Offset(0, 8)),
        ],
      );

  /// Neon glow — V2: subtler, more premium
  static BoxDecoration neonGlow({required Color color}) => BoxDecoration(
        color: raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        boxShadow: [
          BoxShadow(color: color.withValues(alpha: 0.15), blurRadius: 16),
          BoxShadow(
              color: color.withValues(alpha: 0.05),
              blurRadius: 32,
              spreadRadius: 2),
        ],
      );

  /// Holographic card — V2
  static BoxDecoration holoCard({Color? glowColor}) => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(
          color: (glowColor ?? neonBlue).withValues(alpha: 0.2),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: (glowColor ?? neonBlue).withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      );

  /// Urgent card decoration (for obligatory payments)
  static BoxDecoration urgentCard() => BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            darkSurface,
            error.withValues(alpha: 0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: error.withValues(alpha: 0.4), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: error.withValues(alpha: 0.12),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      );

  /// Success card decoration
  static BoxDecoration successCard() => BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            darkSurface,
            success.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: success.withValues(alpha: 0.3), width: 1),
      );

  /// Factura card decoration (purple tint)
  static BoxDecoration facturaCard() => BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            darkSurface,
            neonPurple.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: neonPurple.withValues(alpha: 0.3), width: 1),
        boxShadow: [
          BoxShadow(
            color: neonPurple.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      );

  /// Floating action button glow
  static BoxDecoration fabGlow() => BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [neonBlue, neonCyan],
        ),
        boxShadow: [
          BoxShadow(
            color: neonBlue.withValues(alpha: 0.3),
            blurRadius: 16,
            spreadRadius: 1,
          ),
        ],
      );

  /// Pulsing border animation colors
  static List<Color> get pulsingBorderColors => [
        neonBlue.withValues(alpha: 0.3),
        neonCyan.withValues(alpha: 0.5),
        neonBlue.withValues(alpha: 0.3),
      ];

  // ============================================================================
  // GLASSMORPHISM HELPERS — V2
  // ============================================================================

  /// Premium frosted glass container decoration.
  static BoxDecoration glassMorphismPremium({
    Color? color,
    double blur = 20.0,
    double opacity = 0.6,
    double borderRadius = 24.0,
    Color? borderColor,
    double borderWidth = 1.0,
    Color? glowColor,
    double glowBlur = 16.0,
  }) {
    return BoxDecoration(
      color: (color ?? darkCard).withValues(alpha: opacity),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: (borderColor ?? Colors.white).withValues(alpha: 0.08),
        width: borderWidth,
      ),
      boxShadow: [
        BoxShadow(
          color: (glowColor ?? neonBlue).withValues(alpha: 0.06),
          blurRadius: glowBlur,
        ),
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.3),
          blurRadius: 8,
          offset: const Offset(0, 4),
        ),
      ],
    );
  }

  /// Gradient card with directional color flow.
  static BoxDecoration gradientCard({
    required Color startColor,
    required Color endColor,
    double borderRadius = 24.0,
    double borderOpacity = 0.2,
    AlignmentGeometry begin = Alignment.topLeft,
    AlignmentGeometry end = Alignment.bottomRight,
  }) {
    return BoxDecoration(
      gradient: LinearGradient(
        begin: begin,
        end: end,
        colors: [
          startColor.withValues(alpha: 0.12),
          endColor.withValues(alpha: 0.04),
        ],
      ),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: startColor.withValues(alpha: borderOpacity),
      ),
      boxShadow: [
        BoxShadow(
          color: startColor.withValues(alpha: 0.04),
          blurRadius: 12,
          offset: const Offset(0, 4),
        ),
      ],
    );
  }

  // ============================================================================
  // ELEVATION/SHADOW SYSTEM — V2 (softer, more layered)
  // ============================================================================

  static List<BoxShadow> get elevation1 => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.1),
          blurRadius: 4,
          offset: const Offset(0, 2),
        ),
      ];

  static List<BoxShadow> get elevation2 => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.15),
          blurRadius: 8,
          offset: const Offset(0, 4),
        ),
        BoxShadow(
          color: neonBlue.withValues(alpha: 0.04),
          blurRadius: 16,
        ),
      ];

  static List<BoxShadow> get elevation3 => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.2),
          blurRadius: 16,
          offset: const Offset(0, 8),
        ),
        BoxShadow(
          color: neonBlue.withValues(alpha: 0.06),
          blurRadius: 24,
        ),
      ];

  /// Premium hero shadow — for featured cards and login panel
  static List<BoxShadow> get heroShadow => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.3),
          blurRadius: 40,
          offset: const Offset(0, 20),
        ),
        BoxShadow(
          color: neonBlue.withValues(alpha: 0.08),
          blurRadius: 60,
          spreadRadius: 4,
        ),
      ];

  // ============================================================================
  // SPACING & ANIMATION — re-export from AppColors
  // ============================================================================

  static const double paddingS = AppColors.paddingS;
  static const double paddingM = AppColors.paddingM;
  static const double paddingL = AppColors.paddingL;
  static const double paddingXL = AppColors.paddingXL;

  static const Duration animFast = AppColors.animFast;
  static const Duration animNormal = AppColors.animNormal;
  static const Duration animSlow = AppColors.animSlow;
  static const Duration animPulse = AppColors.animPulse;

  // ============================================================================
  // TEXT SCALE HELPERS
  // ============================================================================

  /// Display title (largest, e.g. vehicle name in header)
  static const TextStyle displayTitle = TextStyle(
    color: textPrimary,
    fontSize: 18,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
  );

  /// Section headline
  static const TextStyle headline = TextStyle(
    color: textPrimary,
    fontSize: 15,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );

  /// Body label
  static const TextStyle bodyLabel = TextStyle(
    color: textSecondary,
    fontSize: 13,
    fontWeight: FontWeight.w500,
  );

  /// Caption / tertiary text
  static const TextStyle captionText = TextStyle(
    color: textTertiary,
    fontSize: 11,
    fontWeight: FontWeight.w400,
  );

  /// Metric value (numbers in dashboards)
  static const TextStyle metricValue = TextStyle(
    color: textPrimary,
    fontSize: 20,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.5,
  );

  /// Metric label (below metric value)
  static const TextStyle metricLabel = TextStyle(
    color: textTertiary,
    fontSize: 10,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.5,
  );
}
