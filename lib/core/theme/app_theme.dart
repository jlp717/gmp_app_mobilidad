import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:google_fonts/google_fonts.dart';

/// Ultra-modern, minimalist, futuristic theme for tablet app
/// Dark theme with neon blue/green accents
/// Optimized for tablets (10+ inches)
class AppTheme {
  AppTheme._();

  // ============================================================================
  // COLOR PALETTE - Re-exports from AppColors for compatibility
  // ============================================================================

  static const Color darkBase = AppColors.darkBase;
  static const Color darkSurface = AppColors.darkSurface;
  static const Color darkCard = AppColors.darkCard;
  static const Color borderColor = AppColors.borderColor;

  static const Color surfaceColor = AppColors.surfaceColor;

  static const Color neonBlue = AppColors.neonBlue;
  static const Color neonGreen = AppColors.neonGreen;
  static const Color neonPurple = AppColors.neonPurple;
  static const Color neonPink = AppColors.neonPink;

  static const Color neonCyan = AppColors.neonCyan;
  static const Color neonTeal = AppColors.neonTeal;
  static const Color neonElectric = AppColors.neonElectric;
  static const Color holoBlue = AppColors.holoBlue;

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
  // GRADIENTS - Holographic & Futuristic
  // ============================================================================

  static const LinearGradient primaryGradient = AppColors.primaryGradient;
  static const LinearGradient holoGradient = AppColors.holoGradient;
  static const LinearGradient scannerGradient = AppColors.scannerGradient;

  /// Card gradient for delivery cards
  static LinearGradient get cardGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          darkSurface,
          darkCard.withOpacity(0.8),
        ],
      );

  /// Urgent indicator gradient (red pulse)
  static LinearGradient get urgentGradient => LinearGradient(
        colors: [
          error.withOpacity(0.3),
          error.withOpacity(0.1),
        ],
      );

  /// Success indicator gradient
  static LinearGradient get successGradient => LinearGradient(
        colors: [
          success.withOpacity(0.3),
          success.withOpacity(0.1),
        ],
      );

  // Alias for compatibility (lightTheme not implemented, using darkTheme)
  static ThemeData get lightTheme => darkTheme;

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
      ),

      // Typography - Roboto
      textTheme: GoogleFonts.robotoTextTheme(
        ThemeData.dark().textTheme.copyWith(
              displayLarge: const TextStyle(
                  fontSize: 57,
                  fontWeight: FontWeight.w300,
                  color: textPrimary,),
              displayMedium: const TextStyle(
                  fontSize: 45,
                  fontWeight: FontWeight.w300,
                  color: textPrimary,),
              displaySmall: const TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w400,
                  color: textPrimary,),
              headlineLarge: const TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w400,
                  color: textPrimary,),
              headlineMedium: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w400,
                  color: textPrimary,),
              headlineSmall: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w400,
                  color: textPrimary,),
              titleLarge: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  color: textPrimary,),
              titleMedium: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  color: textPrimary,),
              titleSmall: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: textPrimary,),
              bodyLarge: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                  color: textPrimary,),
              bodyMedium: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w400,
                  color: textSecondary,),
              bodySmall: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: textTertiary,),
            ),
      ),

      // Card Theme - Updated to 20px for modern rounded look
      cardTheme: CardThemeData(
        color: darkCard,
        elevation: 4,
        shadowColor: neonBlue.withOpacity(0.1),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),

      // App Bar Theme
      appBarTheme: const AppBarTheme(
        backgroundColor: darkSurface,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: neonBlue),
      ),

      // Button Themes - Updated to 16px rounded
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: neonBlue,
          foregroundColor: darkBase,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        ),
      ),

      // Input Theme - Updated to 16px rounded
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: darkSurface,
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(20),
            borderSide: BorderSide.none,),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(20),
            borderSide: const BorderSide(color: neonBlue, width: 2),),
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
    );
  }

  // ============================================================================
  // CUSTOM DECORATIONS
  // ============================================================================

  static BoxDecoration glassMorphism({Color? color}) => BoxDecoration(
        color: (color ?? darkCard).withOpacity(0.7),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: neonBlue.withOpacity(0.2)),
        boxShadow: [
          BoxShadow(color: neonBlue.withOpacity(0.1), blurRadius: 20),
        ],
      );

  static BoxDecoration neonGlow({required Color color}) => BoxDecoration(
        color: darkCard,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color),
        boxShadow: [
          BoxShadow(color: color.withOpacity(0.3), blurRadius: 20),
          BoxShadow(
              color: color.withOpacity(0.1), blurRadius: 40, spreadRadius: 5,),
        ],
      );

  /// NEW: Holographic card decoration with gradient
  static BoxDecoration holoCard({Color? glowColor}) => BoxDecoration(
        gradient: cardGradient,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: (glowColor ?? neonBlue).withOpacity(0.3),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: (glowColor ?? neonBlue).withOpacity(0.15),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      );

  /// NEW: Urgent card decoration (for obligatory payments)
  static BoxDecoration urgentCard() => BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            darkSurface,
            error.withOpacity(0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: error.withOpacity(0.5), width: 2),
        boxShadow: [
          BoxShadow(
            color: error.withOpacity(0.2),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      );

  /// NEW: Success card decoration (for completed items)
  static BoxDecoration successCard() => BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            darkSurface,
            success.withOpacity(0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: success.withOpacity(0.4), width: 1.5),
      );

  /// NEW: Factura card decoration (purple tint for invoices)
  static BoxDecoration facturaCard() => BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            darkSurface,
            neonPurple.withOpacity(0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: neonPurple.withOpacity(0.4), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: neonPurple.withOpacity(0.15),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      );

  /// NEW: Floating action button glow
  static BoxDecoration fabGlow() => BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [neonBlue, neonCyan],
        ),
        boxShadow: [
          BoxShadow(
            color: neonBlue.withOpacity(0.4),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      );

  /// NEW: Subtle pulsing border animation colors
  static List<Color> get pulsingBorderColors => [
        neonBlue.withOpacity(0.3),
        neonCyan.withOpacity(0.5),
        neonBlue.withOpacity(0.3),
      ];

  // Spacing constants (tablet-optimized) - re-export from AppColors
  static const double paddingS = AppColors.paddingS;
  static const double paddingM = AppColors.paddingM;
  static const double paddingL = AppColors.paddingL;
  static const double paddingXL = AppColors.paddingXL;

  // Animation durations - re-export from AppColors
  static const Duration animFast = AppColors.animFast;
  static const Duration animNormal = AppColors.animNormal;
  static const Duration animSlow = AppColors.animSlow;
  static const Duration animPulse = AppColors.animPulse;

  // ============================================================================
  // GLASSMORPHISM HELPERS
  // ============================================================================

  /// Premium frosted glass container decoration.
  /// [blur] controls the backdrop blur intensity.
  /// [opacity] controls background transparency.
  static BoxDecoration glassMorphismPremium({
    Color? color,
    double blur = 20.0,
    double opacity = 0.6,
    double borderRadius = 16.0,
    Color? borderColor,
    double borderWidth = 1.0,
    Color? glowColor,
    double glowBlur = 16.0,
  }) {
    return BoxDecoration(
      color: (color ?? darkCard).withOpacity(opacity),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: (borderColor ?? neonBlue).withOpacity(0.2),
        width: borderWidth,
      ),
      boxShadow: [
        BoxShadow(
          color: (glowColor ?? neonBlue).withOpacity(0.08),
          blurRadius: glowBlur,
        ),
        BoxShadow(
          color: Colors.black.withOpacity(0.3),
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
    double borderRadius = 14.0,
    double borderOpacity = 0.25,
    AlignmentGeometry begin = Alignment.topLeft,
    AlignmentGeometry end = Alignment.bottomRight,
  }) {
    return BoxDecoration(
      gradient: LinearGradient(
        begin: begin,
        end: end,
        colors: [
          startColor.withOpacity(0.15),
          endColor.withOpacity(0.05),
        ],
      ),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: startColor.withOpacity(borderOpacity),
      ),
      boxShadow: [
        BoxShadow(
          color: startColor.withOpacity(0.06),
          blurRadius: 12,
          offset: const Offset(0, 4),
        ),
      ],
    );
  }

  // ============================================================================
  // ELEVATION/SHADOW SYSTEM
  // ============================================================================

  static List<BoxShadow> elevation1 = [
    BoxShadow(
      color: Colors.black.withOpacity(0.15),
      blurRadius: 4,
      offset: const Offset(0, 2),
    ),
  ];

  static List<BoxShadow> elevation2 = [
    BoxShadow(
      color: Colors.black.withOpacity(0.2),
      blurRadius: 8,
      offset: const Offset(0, 4),
    ),
    BoxShadow(
      color: neonBlue.withOpacity(0.05),
      blurRadius: 16,
    ),
  ];

  static List<BoxShadow> elevation3 = [
    BoxShadow(
      color: Colors.black.withOpacity(0.25),
      blurRadius: 16,
      offset: const Offset(0, 8),
    ),
    BoxShadow(
      color: neonBlue.withOpacity(0.08),
      blurRadius: 24,
    ),
  ];

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
