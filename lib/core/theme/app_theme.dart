import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:google_fonts/google_fonts.dart';

/// Global GMP theme.
///
/// V2 targets an executive-cockpit interface: premium depth, crisp hierarchy,
/// role accents, and performance-safe motion.
class AppTheme {
  AppTheme._();

  // ===========================================================================
  // RADIUS SYSTEM
  // ===========================================================================

  static const double radiusSm = 6;
  static const double radiusMd = 8;
  static const double radiusLg = 10;
  static const double radiusXl = 12;
  static const double radiusFull = 9999;

  // ===========================================================================
  // COLOR PALETTE - legacy aliases retained for compatibility
  // ===========================================================================

  static Color get darkBase => AppColors.themedCanvas;
  static Color get darkSurface => AppColors.themedSurface;
  static Color get darkCard => AppColors.themedPanel;
  static Color get borderColor => AppColors.themedLine;
  static Color get inkSurface => AppColors.themedInkSurface;
  static Color get raisedSurface => AppColors.themedRaisedSurface;
  static Color get softPanel => AppColors.themedSoftPanel;
  static Color get mutedPanel => AppColors.themedMutedPanel;
  static Color get surfaceCommand => AppColors.themedSurfaceCommand;
  static Color get surfaceOverlay => AppColors.themedSurfaceOverlay;
  static Color get surfaceGlass => AppColors.themedSurfaceGlass;
  static const Color activeRing = AppColors.activeRing;
  static const Color focusRing = AppColors.focusRing;
  static const Color selectionRail = AppColors.selectionRail;
  static const Color criticalRing = AppColors.criticalRing;

  static Color get surfaceColor =>
      AppColors.isDark ? AppColors.darkSurfaceLayer : AppColors.surface;

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

  static Color get textPrimary => AppColors.themedPrimaryText;
  static Color get textSecondary => AppColors.themedSecondaryText;
  static Color get textTertiary => AppColors.themedTertiaryText;

  static const List<Color> chartColors = AppColors.chartColors;

  // ===========================================================================
  // GRADIENTS
  // ===========================================================================

  static const LinearGradient primaryGradient = AppColors.primaryGradient;
  static const LinearGradient holoGradient = AppColors.holoGradient;
  static const LinearGradient scannerGradient = AppColors.scannerGradient;
  static LinearGradient get loginGradient => AppColors.themedLoginGradient;
  static const LinearGradient brandGradient = AppColors.brandGradient;
  static LinearGradient get appShellGradient =>
      AppColors.themedAppShellGradient;
  static LinearGradient get panelGradient => AppColors.themedPanelGradient;
  static LinearGradient get commandGradient => AppColors.themedCommandGradient;
  static LinearGradient get dataHeaderGradient => LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: [
          AppColors.teal.withValues(alpha: 0.20),
          AppColors.harbor.withValues(alpha: 0.14),
          AppColors.aubergine.withValues(alpha: 0.08),
        ],
      );

  static LinearGradient get cardGradient => AppColors.themedCardGradient;

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
  static ThemeData get themeData => AppColors.isDark ? darkTheme : lightTheme;

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
        tertiaryText: AppColors.darkMuted,
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
      seedColor: AppColors.teal,
      brightness: brightness,
      primary: AppColors.teal,
      secondary: AppColors.harbor,
      error: AppColors.error,
      surface: surface,
    ).copyWith(
      // Teal is intentionally bright; dark ink keeps buttons and selected
      // calendar cells readable in both modes.
      onPrimary: AppColors.ink,
      onSecondary: isDark ? AppColors.darkInk : AppColors.ink,
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
        color: AppColors.systemBlack.withValues(alpha: isDark ? 0.32 : 0.08),
        blurRadius: 18,
        offset: const Offset(0, 10),
      ),
    ];

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: canvasColor,
      colorScheme: scheme,
      primaryColor: AppColors.teal,
      textTheme: textTheme,
      fontFamily: GoogleFonts.inter().fontFamily,
      cardTheme: CardThemeData(
        color: isDark ? AppColors.raisedSurface : surface,
        elevation: 0,
        shadowColor:
            AppColors.systemBlack.withValues(alpha: isDark ? 0.28 : 0.08),
        surfaceTintColor: AppColors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: BorderSide(
            color: isDark
                ? AppColors.activeRing.withValues(alpha: 0.16)
                : border.withValues(alpha: 0.72),
          ),
        ),
        clipBehavior: Clip.antiAlias,
        margin: const EdgeInsets.all(0),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor:
            isDark ? AppColors.surfaceCommand.withValues(alpha: 0.98) : surface,
        foregroundColor: primaryText,
        elevation: 0,
        scrolledUnderElevation: 0,
        shadowColor: AppColors.transparent,
        surfaceTintColor: AppColors.transparent,
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
          backgroundColor: AppColors.teal,
          foregroundColor: AppColors.ink,
          disabledBackgroundColor: panel,
          disabledForegroundColor: tertiaryText,
          elevation: 0,
          shadowColor: AppColors.teal.withValues(alpha: 0.28),
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
          foregroundColor: AppColors.teal,
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
          foregroundColor: AppColors.teal,
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
        fillColor:
            isDark ? AppColors.surfaceCommand.withValues(alpha: 0.86) : surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(
            color: isDark ? AppColors.darkLine.withValues(alpha: 0.78) : border,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: BorderSide(
            color:
                isDark ? AppColors.activeRing.withValues(alpha: 0.16) : border,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: AppColors.activeRing, width: 1.6),
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
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.teal,
        foregroundColor: AppColors.ink,
        elevation: 3,
        focusElevation: 4,
        hoverElevation: 4,
        highlightElevation: 4,
        disabledElevation: 0,
        shape: CircleBorder(),
        enableFeedback: true,
      ),
      datePickerTheme: DatePickerThemeData(
        backgroundColor: surface,
        headerBackgroundColor:
            isDark ? AppColors.surfaceCommand : AppColors.ink,
        headerForegroundColor: AppColors.themedWhite,
        surfaceTintColor: AppColors.transparent,
        dayForegroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.ink;
          if (states.contains(WidgetState.disabled)) return tertiaryText;
          return primaryText;
        }),
        dayBackgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.teal;
          return AppColors.transparent;
        }),
        todayForegroundColor: WidgetStateProperty.all(
          isDark ? AppColors.teal : AppColors.harbor,
        ),
        todayBackgroundColor: WidgetStateProperty.all(AppColors.transparent),
        todayBorder: const BorderSide(color: AppColors.teal),
        yearForegroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.ink;
          return primaryText;
        }),
        yearBackgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return AppColors.teal;
          return AppColors.transparent;
        }),
        rangeSelectionBackgroundColor: AppColors.teal.withValues(alpha: 0.14),
        dividerColor: border,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: isDark ? AppColors.surfaceOverlay : surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusXl),
          side: BorderSide(
            color:
                isDark ? AppColors.activeRing.withValues(alpha: 0.18) : border,
          ),
        ),
        elevation: 12,
        shadowColor:
            AppColors.systemBlack.withValues(alpha: isDark ? 0.42 : 0.12),
        surfaceTintColor: AppColors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? AppColors.surfaceOverlay : surface,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(radiusXl),
          ),
          side: BorderSide(
            color:
                isDark ? AppColors.activeRing.withValues(alpha: 0.16) : border,
          ),
        ),
        elevation: 10,
        shadowColor:
            AppColors.systemBlack.withValues(alpha: isDark ? 0.35 : 0.12),
        surfaceTintColor: AppColors.transparent,
        modalElevation: 12,
        modalBarrierColor: AppColors.systemBlack.withValues(alpha: 0.58),
        dragHandleColor: tertiaryText,
        dragHandleSize: const Size(32, 4),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? AppColors.surfaceCommand : AppColors.ink,
        contentTextStyle:
            const TextStyle(color: AppColors.systemWhite, fontSize: 13),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
        behavior: SnackBarBehavior.floating,
        elevation: 14,
        width: 440,
      ),
      dividerTheme: DividerThemeData(
        color: border.withValues(alpha: 0.8),
        thickness: 1,
        space: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AppColors.surfaceCommand : panel,
        selectedColor: AppColors.teal.withValues(alpha: 0.18),
        disabledColor: panel.withValues(alpha: 0.55),
        labelStyle: TextStyle(color: secondaryText, fontSize: 12),
        secondaryLabelStyle: TextStyle(color: primaryText, fontSize: 12),
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        side: BorderSide(
          color: isDark ? AppColors.activeRing.withValues(alpha: 0.18) : border,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusSm),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: secondaryText,
        textColor: primaryText,
        tileColor: AppColors.transparent,
        selectedTileColor: AppColors.teal.withValues(alpha: 0.12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: isDark ? AppColors.surfaceOverlay : surface,
        surfaceTintColor: AppColors.transparent,
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
        color: AppColors.teal,
        linearTrackColor: panel,
        circularTrackColor: panel,
      ),
      dataTableTheme: DataTableThemeData(
        headingRowColor: WidgetStateProperty.all(
          isDark ? AppColors.surfaceCommand : panel,
        ),
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
          color: isDark ? AppColors.raisedSurface : surface,
          border: Border.all(
            color:
                isDark ? AppColors.activeRing.withValues(alpha: 0.16) : border,
          ),
          borderRadius: BorderRadius.circular(radiusMd),
          boxShadow: cardShadow,
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: isDark ? AppColors.surfaceCommand : surface,
        indicatorColor: AppColors.teal.withValues(alpha: 0.16),
        selectedIconTheme: const IconThemeData(color: AppColors.teal),
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
        backgroundColor: isDark ? AppColors.surfaceCommand : surface,
        indicatorColor: AppColors.teal.withValues(alpha: 0.16),
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

  static BoxDecoration appBackground() => BoxDecoration(
        gradient: appShellGradient,
      );

  static BoxDecoration premiumPanel({
    Color? accentColor,
    double radius = radiusLg,
    double opacity = 1,
  }) {
    final accent = accentColor ?? AppColors.forest;
    return BoxDecoration(
      gradient: cardGradient,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: accent.withValues(alpha: 0.26)),
      boxShadow: [
        BoxShadow(
          color: AppColors.systemBlack.withValues(alpha: 0.34 * opacity),
          blurRadius: 24,
          offset: const Offset(0, 14),
        ),
        BoxShadow(
          color: accent.withValues(alpha: 0.10 * opacity),
          blurRadius: 22,
          offset: const Offset(0, 0),
        ),
      ],
    );
  }

  static BoxDecoration glassMorphism({Color? color}) => BoxDecoration(
        gradient: commandGradient,
        color: color,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: activeRing.withValues(alpha: 0.14)),
        boxShadow: elevation2,
      );

  static BoxDecoration neonGlow({required Color color}) => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.38)),
        boxShadow: [
          ...elevation2,
          BoxShadow(
            color: color.withValues(alpha: 0.13),
            blurRadius: 24,
          ),
        ],
      );

  static BoxDecoration holoCard({Color? glowColor}) => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(
          color: (glowColor ?? AppColors.teal).withValues(alpha: 0.30),
        ),
        boxShadow: [
          ...elevation2,
          BoxShadow(
            color: (glowColor ?? AppColors.teal).withValues(alpha: 0.10),
            blurRadius: 26,
          ),
        ],
      );

  static BoxDecoration urgentCard() => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: error.withValues(alpha: 0.50), width: 1.2),
        boxShadow: [
          ...elevation2,
          BoxShadow(color: error.withValues(alpha: 0.12), blurRadius: 24),
        ],
      );

  static BoxDecoration successCard() => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: success.withValues(alpha: 0.38)),
        boxShadow: [
          ...elevation2,
          BoxShadow(color: success.withValues(alpha: 0.10), blurRadius: 22),
        ],
      );

  static BoxDecoration facturaCard() => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(radiusLg),
        border: Border.all(color: neonPurple.withValues(alpha: 0.36)),
        boxShadow: [
          ...elevation2,
          BoxShadow(color: neonPurple.withValues(alpha: 0.10), blurRadius: 22),
        ],
      );

  static BoxDecoration fabGlow() => BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.teal,
        boxShadow: [
          BoxShadow(
            color: AppColors.teal.withValues(alpha: 0.24),
            blurRadius: 22,
          ),
          BoxShadow(
            color: AppColors.systemBlack.withValues(alpha: 0.32),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      );

  static List<Color> get pulsingBorderColors => [
        AppColors.teal.withValues(alpha: 0.26),
        AppColors.harbor.withValues(alpha: 0.38),
        AppColors.aubergine.withValues(alpha: 0.26),
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
    final glow = glowColor ?? AppColors.teal;
    return BoxDecoration(
      color: (color ?? surfaceGlass).withValues(alpha: opacity),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: (borderColor ?? glow).withValues(alpha: 0.22),
        width: borderWidth,
      ),
      boxShadow: [
        BoxShadow(
          color: AppColors.systemBlack.withValues(alpha: 0.32),
          blurRadius: 22,
          offset: const Offset(0, 12),
        ),
        BoxShadow(
          color: glow.withValues(alpha: 0.09),
          blurRadius: glowBlur,
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
      gradient: LinearGradient(
        begin: begin,
        end: end,
        colors: [
          startColor.withValues(alpha: 0.20),
          raisedSurface,
          endColor.withValues(alpha: 0.12),
        ],
        stops: const [0.0, 0.56, 1.0],
      ),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: startColor.withValues(alpha: borderOpacity + 0.10),
      ),
      boxShadow: [
        ...elevation2,
        BoxShadow(
          color: startColor.withValues(alpha: 0.09),
          blurRadius: 22,
        ),
      ],
    );
  }

  // ===========================================================================
  // ELEVATION
  // ===========================================================================

  static List<BoxShadow> get elevation1 => [
        BoxShadow(
          color: AppColors.systemBlack.withValues(alpha: 0.22),
          blurRadius: 12,
          offset: const Offset(0, 6),
        ),
      ];

  static List<BoxShadow> get elevation2 => [
        BoxShadow(
          color: AppColors.systemBlack.withValues(alpha: 0.28),
          blurRadius: 18,
          offset: const Offset(0, 10),
        ),
      ];

  static List<BoxShadow> get elevation3 => [
        BoxShadow(
          color: AppColors.systemBlack.withValues(alpha: 0.34),
          blurRadius: 28,
          offset: const Offset(0, 16),
        ),
      ];

  static List<BoxShadow> get heroShadow => [
        BoxShadow(
          color: AppColors.systemBlack.withValues(alpha: 0.42),
          blurRadius: 36,
          offset: const Offset(0, 22),
        ),
        BoxShadow(
          color: AppColors.teal.withValues(alpha: 0.09),
          blurRadius: 34,
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

  static TextStyle get displayTitle => TextStyle(
        color: textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      );

  static TextStyle get headline => TextStyle(
        color: textPrimary,
        fontSize: 15,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      );

  static TextStyle get bodyLabel => TextStyle(
        color: textSecondary,
        fontSize: 13,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
      );

  static TextStyle get captionText => TextStyle(
        color: textTertiary,
        fontSize: 11,
        fontWeight: FontWeight.w500,
        letterSpacing: 0,
      );

  static TextStyle get metricValue => TextStyle(
        color: textPrimary,
        fontSize: 22,
        fontWeight: FontWeight.w800,
        letterSpacing: 0,
        fontFeatures: [FontFeature.tabularFigures()],
      );

  static TextStyle get metricLabel => TextStyle(
        color: textTertiary,
        fontSize: 10,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      );
}
