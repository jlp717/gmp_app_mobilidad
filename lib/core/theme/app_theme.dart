import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:google_fonts/google_fonts.dart';

/// Global GMP theme.
///
/// Phase 1 moves the app from decorative dashboard styling to a restrained
/// operational interface: compact surfaces, clear borders, semantic color, and
/// short performance-safe motion.
class AppTheme {
  AppTheme._();

  // ===========================================================================
  // RADIUS SYSTEM
  // ===========================================================================

  static const double radiusSm = 6.0;
  static const double radiusMd = 8.0;
  static const double radiusLg = 10.0;
  static const double radiusXl = 12.0;
  static const double radiusFull = 9999.0;

  // ===========================================================================
  // COLOR PALETTE - legacy aliases retained for compatibility
  // ===========================================================================

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

  // ===========================================================================
  // GRADIENTS
  // ===========================================================================

  static const LinearGradient primaryGradient = AppColors.primaryGradient;
  static const LinearGradient holoGradient = AppColors.holoGradient;
  static const LinearGradient scannerGradient = AppColors.scannerGradient;
  static const LinearGradient loginGradient = AppColors.loginGradient;
  static const LinearGradient brandGradient = AppColors.brandGradient;
  static const LinearGradient appShellGradient = AppColors.appShellGradient;
  static const LinearGradient panelGradient = AppColors.panelGradient;

  static LinearGradient get cardGradient => const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [raisedSurface, darkSurface],
      );

  static LinearGradient get urgentGradient => LinearGradient(
        colors: [
          error.withValues(alpha: 0.16),
          error.withValues(alpha: 0.05),
        ],
      );

  static LinearGradient get successGradient => LinearGradient(
        colors: [
          success.withValues(alpha: 0.16),
          success.withValues(alpha: 0.05),
        ],
      );

  // Compatibility alias for code expecting `themeData`.
  static ThemeData get themeData => darkTheme;

  // ===========================================================================
  // THEME DATA
  // ===========================================================================

  static ThemeData get darkTheme => _buildTheme(
        brightness: Brightness.dark,
        canvasColor: AppColors.darkCanvas,
        surface: AppColors.darkSurfaceLayer,
        panel: AppColors.darkPanel,
        border: AppColors.darkLine,
        primaryText: AppColors.darkInk,
        secondaryText: AppColors.darkMuted,
        tertiaryText: AppColors.textTertiary,
        systemOverlayStyle: const SystemUiOverlayStyle(
          statusBarColor: AppColors.darkCanvas,
          statusBarIconBrightness: Brightness.light,
          systemNavigationBarColor: AppColors.darkCanvas,
          systemNavigationBarIconBrightness: Brightness.light,
        ),
      );

  static ThemeData get lightTheme => _buildTheme(
        brightness: Brightness.light,
        canvasColor: AppColors.canvas,
        surface: AppColors.surface,
        panel: AppColors.panel,
        border: AppColors.line,
        primaryText: AppColors.ink,
        secondaryText: AppColors.muted,
        tertiaryText: AppColors.faint,
        systemOverlayStyle: const SystemUiOverlayStyle(
          statusBarColor: AppColors.canvas,
          statusBarIconBrightness: Brightness.dark,
          systemNavigationBarColor: AppColors.canvas,
          systemNavigationBarIconBrightness: Brightness.dark,
        ),
      );

  static ThemeData _buildTheme({
    required Brightness brightness,
    required Color canvasColor,
    required Color surface,
    required Color panel,
    required Color border,
    required Color primaryText,
    required Color secondaryText,
    required Color tertiaryText,
    required SystemUiOverlayStyle systemOverlayStyle,
  }) {
    final isDark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.forest,
      brightness: brightness,
      primary: AppColors.forest,
      secondary: AppColors.harbor,
      error: AppColors.error,
      surface: surface,
    ).copyWith(
      onPrimary: Colors.white,
      onSecondary: Colors.white,
      onSurface: primaryText,
      surfaceContainerHighest: panel,
      outline: border,
      outlineVariant: border.withValues(alpha: isDark ? 0.62 : 0.75),
    );

    final baseTextTheme = isDark
        ? ThemeData.dark(useMaterial3: true).textTheme
        : ThemeData.light(useMaterial3: true).textTheme;

    final textTheme = GoogleFonts.interTextTheme(baseTextTheme).copyWith(
      displayLarge: TextStyle(
        fontSize: 48,
        fontWeight: FontWeight.w600,
        color: primaryText,
        letterSpacing: 0,
      ),
      displayMedium: TextStyle(
        fontSize: 40,
        fontWeight: FontWeight.w600,
        color: primaryText,
        letterSpacing: 0,
      ),
      displaySmall: TextStyle(
        fontSize: 34,
        fontWeight: FontWeight.w600,
        color: primaryText,
        letterSpacing: 0,
      ),
      headlineLarge: TextStyle(
        fontSize: 28,
        fontWeight: FontWeight.w700,
        color: primaryText,
        letterSpacing: 0,
      ),
      headlineMedium: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w700,
        color: primaryText,
        letterSpacing: 0,
      ),
      headlineSmall: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: primaryText,
        letterSpacing: 0,
      ),
      titleLarge: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: primaryText,
        letterSpacing: 0,
      ),
      titleMedium: TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: primaryText,
        letterSpacing: 0,
      ),
      titleSmall: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: primaryText,
        letterSpacing: 0,
      ),
      bodyLarge: TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w400,
        color: primaryText,
        letterSpacing: 0,
      ),
      bodyMedium: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: secondaryText,
        letterSpacing: 0,
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        color: tertiaryText,
        letterSpacing: 0,
      ),
      labelLarge: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: primaryText,
        letterSpacing: 0,
      ),
      labelMedium: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: secondaryText,
        letterSpacing: 0,
      ),
      labelSmall: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: tertiaryText,
        letterSpacing: 0,
      ),
    );

    final cardShadow = [
      BoxShadow(
        color: Colors.black.withValues(alpha: isDark ? 0.18 : 0.06),
        blurRadius: 10,
        offset: const Offset(0, 4),
      ),
    ];

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: canvasColor,
      colorScheme: scheme,
      primaryColor: AppColors.forest,
      textTheme: textTheme,
      fontFamily: GoogleFonts.inter().fontFamily,
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shadowColor: Colors.black.withValues(alpha: isDark ? 0.28 : 0.08),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: BorderSide(color: border.withValues(alpha: 0.72)),
        ),
        clipBehavior: Clip.antiAlias,
        margin: const EdgeInsets.all(0),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: primaryText,
        elevation: 0,
        scrolledUnderElevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        iconTheme: IconThemeData(color: secondaryText),
        actionsIconTheme: IconThemeData(color: secondaryText),
        titleTextStyle: TextStyle(
          color: primaryText,
          fontSize: 17,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        toolbarTextStyle: TextStyle(
          color: secondaryText,
          fontSize: 13,
          letterSpacing: 0,
        ),
        systemOverlayStyle: systemOverlayStyle,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.forest,
          foregroundColor: Colors.white,
          disabledBackgroundColor: panel,
          disabledForegroundColor: tertiaryText,
          elevation: 0,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          animationDuration: AppColors.animFast,
          enableFeedback: true,
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.forest,
          side: BorderSide(color: border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          animationDuration: AppColors.animFast,
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.forest,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusSm),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? panel.withValues(alpha: 0.72) : surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: AppColors.forest, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: AppColors.error, width: 2),
        ),
        labelStyle: TextStyle(color: secondaryText, letterSpacing: 0),
        hintStyle: TextStyle(color: tertiaryText, letterSpacing: 0),
        prefixIconColor: secondaryText,
        suffixIconColor: secondaryText,
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.forest,
        foregroundColor: Colors.white,
        elevation: 3,
        focusElevation: 4,
        hoverElevation: 4,
        highlightElevation: 4,
        disabledElevation: 0,
        shape: const CircleBorder(),
        enableFeedback: true,
      ),
      datePickerTheme: DatePickerThemeData(
        backgroundColor: surface,
        headerBackgroundColor: AppColors.forest,
        headerForegroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        dayForegroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return Colors.white;
          if (states.contains(WidgetState.disabled)) return tertiaryText;
          return primaryText;
        }),
        dayBackgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.forest;
          return Colors.transparent;
        }),
        todayForegroundColor: WidgetStateProperty.all(AppColors.forest),
        todayBackgroundColor: WidgetStateProperty.all(Colors.transparent),
        todayBorder: const BorderSide(color: AppColors.forest),
        yearForegroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return Colors.white;
          return primaryText;
        }),
        yearBackgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.forest;
          return Colors.transparent;
        }),
        rangeSelectionBackgroundColor: AppColors.forest.withValues(alpha: 0.14),
        dividerColor: border,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusXl),
          side: BorderSide(color: border),
        ),
        elevation: 12,
        shadowColor: Colors.black.withValues(alpha: isDark ? 0.42 : 0.12),
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(radiusXl),
          ),
          side: BorderSide(color: border),
        ),
        elevation: 10,
        shadowColor: Colors.black.withValues(alpha: isDark ? 0.35 : 0.12),
        surfaceTintColor: Colors.transparent,
        modalElevation: 12,
        modalBarrierColor: Colors.black.withValues(alpha: 0.42),
        dragHandleColor: tertiaryText,
        dragHandleSize: const Size(32, 4),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? AppColors.darkPanel : AppColors.ink,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 13),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        behavior: SnackBarBehavior.floating,
        elevation: 8,
        width: 440,
      ),
      dividerTheme: DividerThemeData(
        color: border.withValues(alpha: 0.8),
        thickness: 1,
        space: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: panel,
        selectedColor: AppColors.forest.withValues(alpha: 0.14),
        disabledColor: panel.withValues(alpha: 0.55),
        labelStyle: TextStyle(color: secondaryText, fontSize: 12),
        secondaryLabelStyle: TextStyle(color: primaryText, fontSize: 12),
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusSm),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: secondaryText,
        textColor: primaryText,
        tileColor: Colors.transparent,
        selectedTileColor: AppColors.forest.withValues(alpha: 0.10),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 10,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          side: BorderSide(color: border),
        ),
        textStyle: TextStyle(color: primaryText, fontSize: 13),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) return tertiaryText;
            return secondaryText;
          }),
          overlayColor: WidgetStateProperty.all(
            AppColors.forest.withValues(alpha: 0.08),
          ),
          shape: WidgetStateProperty.all(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radiusMd),
            ),
          ),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: AppColors.forest,
        linearTrackColor: panel,
        circularTrackColor: panel,
      ),
      dataTableTheme: DataTableThemeData(
        headingRowColor: WidgetStateProperty.all(panel),
        headingTextStyle: TextStyle(
          color: primaryText,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        dataTextStyle: TextStyle(
          color: primaryText,
          fontSize: 12,
          letterSpacing: 0,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
        dividerThickness: 1,
        columnSpacing: 20,
        horizontalMargin: 14,
        dataRowMinHeight: 40,
        dataRowMaxHeight: 46,
        headingRowHeight: 42,
        decoration: BoxDecoration(
          color: surface,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(radiusMd),
          boxShadow: cardShadow,
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: surface,
        indicatorColor: AppColors.forest.withValues(alpha: 0.14),
        selectedIconTheme: const IconThemeData(color: AppColors.forest),
        unselectedIconTheme: IconThemeData(color: secondaryText),
        selectedLabelTextStyle: TextStyle(
          color: primaryText,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelTextStyle: TextStyle(
          color: secondaryText,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: AppColors.forest.withValues(alpha: 0.14),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            color: selected ? primaryText : secondaryText,
            fontSize: 11,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          );
        }),
      ),
    );
  }

  // ===========================================================================
  // CUSTOM DECORATIONS
  // ===========================================================================

  static BoxDecoration appBackground() => const BoxDecoration(
        gradient: appShellGradient,
      );

  static BoxDecoration premiumPanel({
    Color? accentColor,
    double radius = radiusLg,
    double opacity = 1,
  }) {
    final accent = accentColor ?? AppColors.forest;
    return BoxDecoration(
      color: raisedSurface,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: accent.withValues(alpha: 0.18)),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.18 * opacity),
          blurRadius: 12,
          offset: const Offset(0, 5),
        ),
      ],
    );
  }

  static BoxDecoration glassMorphism({Color? color}) => BoxDecoration(
        color: color ?? raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: borderColor.withValues(alpha: 0.8)),
        boxShadow: elevation1,
      );

  static BoxDecoration neonGlow({required Color color}) => BoxDecoration(
        color: raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.28)),
        boxShadow: elevation1,
      );

  static BoxDecoration holoCard({Color? glowColor}) => BoxDecoration(
        color: raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(
          color: (glowColor ?? AppColors.forest).withValues(alpha: 0.24),
        ),
        boxShadow: elevation1,
      );

  static BoxDecoration urgentCard() => BoxDecoration(
        color: raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: error.withValues(alpha: 0.42), width: 1.2),
      );

  static BoxDecoration successCard() => BoxDecoration(
        color: raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: success.withValues(alpha: 0.34)),
      );

  static BoxDecoration facturaCard() => BoxDecoration(
        color: raisedSurface,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: neonPurple.withValues(alpha: 0.28)),
      );

  static BoxDecoration fabGlow() => BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.forest,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.24),
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      );

  static List<Color> get pulsingBorderColors => [
        AppColors.forest.withValues(alpha: 0.24),
        AppColors.harbor.withValues(alpha: 0.34),
        AppColors.forest.withValues(alpha: 0.24),
      ];

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
        color: (borderColor ?? AppColors.darkLine).withValues(alpha: 0.8),
        width: borderWidth,
      ),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.18),
          blurRadius: 10,
          offset: const Offset(0, 4),
        ),
      ],
    );
  }

  static BoxDecoration gradientCard({
    required Color startColor,
    required Color endColor,
    double borderRadius = 24.0,
    double borderOpacity = 0.2,
    AlignmentGeometry begin = Alignment.topLeft,
    AlignmentGeometry end = Alignment.bottomRight,
  }) {
    return BoxDecoration(
      color: raisedSurface,
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: startColor.withValues(alpha: borderOpacity),
      ),
      boxShadow: elevation1,
    );
  }

  // ===========================================================================
  // ELEVATION
  // ===========================================================================

  static List<BoxShadow> get elevation1 => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.10),
          blurRadius: 8,
          offset: const Offset(0, 3),
        ),
      ];

  static List<BoxShadow> get elevation2 => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.14),
          blurRadius: 12,
          offset: const Offset(0, 5),
        ),
      ];

  static List<BoxShadow> get elevation3 => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.18),
          blurRadius: 18,
          offset: const Offset(0, 8),
        ),
      ];

  static List<BoxShadow> get heroShadow => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.22),
          blurRadius: 24,
          offset: const Offset(0, 12),
        ),
      ];

  // ===========================================================================
  // SPACING AND MOTION
  // ===========================================================================

  static const double paddingS = AppColors.paddingS;
  static const double paddingM = AppColors.paddingM;
  static const double paddingL = AppColors.paddingL;
  static const double paddingXL = AppColors.paddingXL;

  static const Duration animFast = AppColors.animFast;
  static const Duration animNormal = AppColors.animNormal;
  static const Duration animSlow = AppColors.animSlow;
  static const Duration animPulse = AppColors.animPulse;

  // ===========================================================================
  // TEXT HELPERS
  // ===========================================================================

  static const TextStyle displayTitle = TextStyle(
    color: textPrimary,
    fontSize: 18,
    fontWeight: FontWeight.w700,
    letterSpacing: 0,
  );

  static const TextStyle headline = TextStyle(
    color: textPrimary,
    fontSize: 15,
    fontWeight: FontWeight.w700,
    letterSpacing: 0,
  );

  static const TextStyle bodyLabel = TextStyle(
    color: textSecondary,
    fontSize: 13,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
  );

  static const TextStyle captionText = TextStyle(
    color: textTertiary,
    fontSize: 11,
    fontWeight: FontWeight.w500,
    letterSpacing: 0,
  );

  static const TextStyle metricValue = TextStyle(
    color: textPrimary,
    fontSize: 22,
    fontWeight: FontWeight.w800,
    letterSpacing: 0,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  static const TextStyle metricLabel = TextStyle(
    color: textTertiary,
    fontSize: 10,
    fontWeight: FontWeight.w700,
    letterSpacing: 0,
  );
}
