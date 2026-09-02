import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// 🚀 FUTURISTIC THEME - Tema ultra-moderno con glassmorphism
///
/// CARACTERÍSTICAS:
/// - ðŸŽ¨ Paleta de colores neón cyberpunk
/// - ðŸ’Ž Glassmorphism effects en todos los elementos
/// - ðŸŒ™ Modo oscuro perfecto para TODA la app
/// - ✨ Gradientes vibrantes y animados
/// - ðŸ”® Efectos de blur y transparencias
///
/// PALETA DE COLORES:
/// - Primary: Cyan neón (#00F5FF)
/// - Secondary: Magenta neón (#FF00FF)
/// - Accent: Amarillo eléctrico (#FFE600)
/// - Success: Verde neón (#00FF41)
/// - Error: Rojo neón (#FF073A)
/// - Warning: Naranja neón (#FF6B00)
class FuturisticTheme {
  // ============================================================================
  // COLORES NEÓN PRINCIPALES
  // ============================================================================
  
  static const Color cyanNeon = AppColors.legacyFF00F5FF;
  static const Color magentaNeon = AppColors.legacyFFFF00FF;
  static const Color yellowNeon = AppColors.legacyFFFFE600;
  static const Color greenNeon = AppColors.legacyFF00FF41;
  static const Color redNeon = AppColors.legacyFFFF073A;
  static const Color orangeNeon = AppColors.legacyFFFF6B00;
  static const Color purpleNeon = AppColors.legacyFF9D00FF;
  static const Color blueNeon = AppColors.legacyFF0066FF;

  // ============================================================================
  // COLORES DE SUPERFICIE (DARK MODE)
  // ============================================================================
  
  static const Color backgroundDark = AppColors.legacyFF0A0E27;
  static const Color surfaceDark = AppColors.legacyFF1A1F3A;
  static const Color surfaceLighter = AppColors.legacyFF252B47;
  static const Color cardDark = AppColors.legacyFF1E2543;

  // ============================================================================
  // COLORES DE TEXTO (OPTIMIZADOS PARA DARK MODE)
  // ============================================================================
  
  static const Color textPrimary = AppColors.legacyFFFFFFFF;
  static const Color textSecondary = AppColors.legacyFFB8C5D6;
  static const Color textTertiary = AppColors.legacyFF8A98AC;
  static const Color textDisabled = AppColors.legacyFF5A6376;

  // ============================================================================
  // GRADIENTES CYBERPUNK
  // ============================================================================
  
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [cyanNeon, blueNeon],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient secondaryGradient = LinearGradient(
    colors: [magentaNeon, purpleNeon],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient accentGradient = LinearGradient(
    colors: [yellowNeon, orangeNeon],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient successGradient = LinearGradient(
    colors: [greenNeon, cyanNeon],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient errorGradient = LinearGradient(
    colors: [redNeon, orangeNeon],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient backgroundGradient = LinearGradient(
    colors: [
      AppColors.legacyFF0A0E27,
      AppColors.legacyFF1A1F3A,
      AppColors.legacyFF0F1329,
    ],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    stops: [0.0, 0.5, 1.0],
  );

  static const LinearGradient cardGradient = LinearGradient(
    colors: [
      AppColors.legacyFF1E2543,
      AppColors.legacyFF252B47,
    ],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // ============================================================================
  // SOMBRAS NEÓN
  // ============================================================================
  
  static List<BoxShadow> get neonShadowCyan => [
    BoxShadow(
      color: cyanNeon.withValues(alpha: 0.3),
      blurRadius: 20,
      spreadRadius: 2,
      offset: const Offset(0, 4),
    ),
    BoxShadow(
      color: cyanNeon.withValues(alpha: 0.1),
      blurRadius: 40,
      spreadRadius: 4,
      offset: const Offset(0, 8),
    ),
  ];

  static List<BoxShadow> get neonShadowMagenta => [
    BoxShadow(
      color: magentaNeon.withValues(alpha: 0.3),
      blurRadius: 20,
      spreadRadius: 2,
      offset: const Offset(0, 4),
    ),
    BoxShadow(
      color: magentaNeon.withValues(alpha: 0.1),
      blurRadius: 40,
      spreadRadius: 4,
      offset: const Offset(0, 8),
    ),
  ];

  static List<BoxShadow> get glassShadow => [
    BoxShadow(
      color: AppColors.systemBlack.withValues(alpha: 0.2),
      blurRadius: 15,
      spreadRadius: 1,
      offset: const Offset(0, 5),
    ),
    BoxShadow(
      color: cyanNeon.withValues(alpha: 0.1),
      blurRadius: 30,
      offset: const Offset(0, 10),
    ),
  ];

  // ============================================================================
  // COLORES PARA MODO CLARO
  // ============================================================================
  
  static const Color lightBackground = AppColors.legacyFFF8FAFC;
  static const Color lightSurface = AppColors.legacyFFFFFFFF;
  static const Color lightTextPrimary = AppColors.legacyFF0F172A;
  static const Color lightTextSecondary = AppColors.legacyFF475569;
  static const Color lightTextTertiary = AppColors.legacyFF94A3B8;

  // ============================================================================
  // THEME DATA COMPLETO
  // ============================================================================
  
  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      
      // Colores base
      scaffoldBackgroundColor: lightBackground,
      primaryColor: cyanNeon,
      colorScheme:  ColorScheme.light(
        primary: cyanNeon,
        secondary: magentaNeon,
        tertiary: purpleNeon,
        error: redNeon,
        onSecondary: AppColors.themedWhite,
        onSurface: lightTextPrimary,
        surfaceContainerHighest: AppColors.legacyFFF1F5F9,
        onSurfaceVariant: lightTextSecondary,
        outline: AppColors.legacyFFCBD5E1,
        outlineVariant: AppColors.legacyFFE2E8F0,
      ),

      // AppBar
      appBarTheme: const AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: AppColors.transparent,
        foregroundColor: lightTextPrimary,
        titleTextStyle: TextStyle(
          color: lightTextPrimary,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
        iconTheme: IconThemeData(
          color: lightTextPrimary,
          size: 24,
        ),
      ),

      // Card
      cardTheme: CardThemeData(
        color: lightSurface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(
            color: AppColors.legacyFFE2E8F0,
          ),
        ),
      ),

      // Elevated Button
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: cyanNeon,
          foregroundColor: AppColors.themedWhite,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ).copyWith(
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return AppColors.legacyFFE2E8F0;
            }
            return cyanNeon;
          }),
        ),
      ),

      // Outlined Button
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: cyanNeon,
          side: BorderSide(color: cyanNeon.withValues(alpha: 0.5), width: 2),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),

      // Text Button
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: cyanNeon,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
      ),

      // Input Decoration
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: lightSurface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.legacyFFE2E8F0),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.legacyFFE2E8F0),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: cyanNeon, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: redNeon.withValues(alpha: 0.5)),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: redNeon, width: 2),
        ),
        labelStyle: const TextStyle(color: lightTextSecondary),
        hintStyle: const TextStyle(color: lightTextTertiary),
        prefixIconColor: cyanNeon,
        suffixIconColor: cyanNeon,
      ),

      // Floating Action Button
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: cyanNeon,
        foregroundColor: AppColors.themedWhite,
        elevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
      ),

      // Dialog
      dialogTheme: DialogThemeData(
        backgroundColor: lightSurface,
        elevation: 8,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: AppColors.legacyFFE2E8F0),
        ),
      ),

      // Bottom Sheet
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: lightSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),

      // Chip
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.legacyFFF1F5F9,
        selectedColor: cyanNeon.withValues(alpha: 0.2),
        labelStyle: const TextStyle(color: lightTextPrimary),
        side: const BorderSide(color: AppColors.legacyFFE2E8F0),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),

      // Divider
      dividerTheme: const DividerThemeData(
        color: AppColors.legacyFFE2E8F0,
        thickness: 1,
        space: 1,
      ),

      // Typography
      textTheme: const TextTheme(
        displayLarge: TextStyle(
          fontSize: 57,
          fontWeight: FontWeight.w700,
          color: lightTextPrimary,
          letterSpacing: -0.25,
        ),
        displayMedium: TextStyle(
          fontSize: 45,
          fontWeight: FontWeight.w700,
          color: lightTextPrimary,
        ),
        displaySmall: TextStyle(
          fontSize: 36,
          fontWeight: FontWeight.w700,
          color: lightTextPrimary,
        ),
        headlineLarge: TextStyle(
          fontSize: 32,
          fontWeight: FontWeight.w700,
          color: lightTextPrimary,
        ),
        headlineMedium: TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          color: lightTextPrimary,
        ),
        headlineSmall: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w700,
          color: lightTextPrimary,
        ),
        titleLarge: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: lightTextPrimary,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: lightTextPrimary,
        ),
        titleSmall: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: lightTextPrimary,
        ),
        bodyLarge: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: lightTextSecondary,
        ),
        bodyMedium: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: lightTextSecondary,
        ),
        bodySmall: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w400,
          color: lightTextTertiary,
        ),
        labelLarge: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: lightTextPrimary,
        ),
        labelMedium: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: lightTextSecondary,
        ),
        labelSmall: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: lightTextTertiary,
        ),
      ),

      // Icon Theme
      iconTheme: const IconThemeData(
        color: cyanNeon,
        size: 24,
      ),

      // Progress Indicator
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: cyanNeon,
      ),

      // Switch
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon;
          }
          return lightTextTertiary;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon.withValues(alpha: 0.5);
          }
          return AppColors.legacyFFE2E8F0;
        }),
      ),

      // Checkbox
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon;
          }
          return AppColors.transparent;
        }),
        checkColor: WidgetStateProperty.all(AppColors.themedWhite),
        side: const BorderSide(color: AppColors.legacyFFCBD5E1, width: 2),
      ),

      // Radio
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon;
          }
          return lightTextTertiary;
        }),
      ),

      // Slider
      sliderTheme: SliderThemeData(
        activeTrackColor: cyanNeon,
        inactiveTrackColor: AppColors.legacyFFE2E8F0,
        thumbColor: cyanNeon,
        overlayColor: cyanNeon.withValues(alpha: 0.2),
      ),
    );
  }
  
  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      
      // Colores base
      scaffoldBackgroundColor: backgroundDark,
      primaryColor: cyanNeon,
      colorScheme: const ColorScheme.dark(
        primary: cyanNeon,
        secondary: magentaNeon,
        tertiary: purpleNeon,
        error: redNeon,
        surface: surfaceDark,
        onPrimary: backgroundDark,
        onSecondary: backgroundDark,
        onError: textPrimary,
      ),

      // AppBar
      appBarTheme: AppBarTheme(
        backgroundColor: surfaceDark.withValues(alpha: 0.9),
        elevation: 0,
        centerTitle: false,
        iconTheme: const IconThemeData(color: textPrimary),
        titleTextStyle: const TextStyle(
          color: textPrimary,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),

      // Card
      cardTheme: CardThemeData(
        color: surfaceDark.withValues(alpha: 0.6),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(
            color: cyanNeon.withValues(alpha: 0.2),
          ),
        ),
      ),

      // Elevated Button
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.transparent,
          foregroundColor: textPrimary,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ).copyWith(
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return surfaceLighter.withValues(alpha: 0.3);
            }
            return null; // Usará gradiente
          }),
        ),
      ),

      // Outlined Button
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: cyanNeon,
          side: BorderSide(color: cyanNeon.withValues(alpha: 0.5), width: 2),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),

      // Text Button
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: cyanNeon,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
      ),

      // Input Decoration
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceDark.withValues(alpha: 0.5),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: cyanNeon.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: cyanNeon.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: cyanNeon, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: redNeon.withValues(alpha: 0.5)),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: redNeon, width: 2),
        ),
        labelStyle: const TextStyle(color: textSecondary),
        hintStyle: const TextStyle(color: textTertiary),
        prefixIconColor: cyanNeon,
        suffixIconColor: cyanNeon,
      ),

      // Floating Action Button
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.transparent,
        foregroundColor: textPrimary,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
      ),

      // Dialog
      dialogTheme: DialogThemeData(
        backgroundColor: surfaceDark.withValues(alpha: 0.95),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: BorderSide(color: cyanNeon.withValues(alpha: 0.3)),
        ),
      ),

      // Bottom Sheet
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surfaceDark.withValues(alpha: 0.95),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),

      // Chip
      chipTheme: ChipThemeData(
        backgroundColor: surfaceLighter.withValues(alpha: 0.5),
        selectedColor: cyanNeon.withValues(alpha: 0.2),
        labelStyle: const TextStyle(color: textPrimary),
        side: BorderSide(color: cyanNeon.withValues(alpha: 0.3)),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),

      // Divider
      dividerTheme: DividerThemeData(
        color: cyanNeon.withValues(alpha: 0.2),
        thickness: 1,
        space: 1,
      ),

      // Typography
      textTheme: const TextTheme(
        displayLarge: TextStyle(
          fontSize: 57,
          fontWeight: FontWeight.w700,
          color: textPrimary,
          letterSpacing: -0.25,
        ),
        displayMedium: TextStyle(
          fontSize: 45,
          fontWeight: FontWeight.w700,
          color: textPrimary,
        ),
        displaySmall: TextStyle(
          fontSize: 36,
          fontWeight: FontWeight.w700,
          color: textPrimary,
        ),
        headlineLarge: TextStyle(
          fontSize: 32,
          fontWeight: FontWeight.w700,
          color: textPrimary,
        ),
        headlineMedium: TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          color: textPrimary,
        ),
        headlineSmall: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w700,
          color: textPrimary,
        ),
        titleLarge: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: textPrimary,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: textPrimary,
        ),
        titleSmall: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: textPrimary,
        ),
        bodyLarge: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: textSecondary,
        ),
        bodyMedium: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: textSecondary,
        ),
        bodySmall: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w400,
          color: textTertiary,
        ),
        labelLarge: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: textPrimary,
        ),
        labelMedium: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: textSecondary,
        ),
        labelSmall: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: textTertiary,
        ),
      ),

      // Icon Theme
      iconTheme: const IconThemeData(
        color: cyanNeon,
        size: 24,
      ),

      // Progress Indicator
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: cyanNeon,
      ),

      // Switch
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon;
          }
          return textTertiary;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon.withValues(alpha: 0.5);
          }
          return surfaceLighter;
        }),
      ),

      // Checkbox
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon;
          }
          return AppColors.transparent;
        }),
        checkColor: WidgetStateProperty.all(backgroundDark),
        side: BorderSide(color: cyanNeon.withValues(alpha: 0.5), width: 2),
      ),

      // Radio
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return cyanNeon;
          }
          return textTertiary;
        }),
      ),

      // Slider
      sliderTheme: SliderThemeData(
        activeTrackColor: cyanNeon,
        inactiveTrackColor: surfaceLighter,
        thumbColor: cyanNeon,
        overlayColor: cyanNeon.withValues(alpha: 0.2),
      ),
    );
  }
}

/// Extension para facilitar el acceso al tema
extension BuildContextThemeExtension on BuildContext {
  ThemeData get theme => Theme.of(this);
  TextTheme get textTheme => Theme.of(this).textTheme;
  ColorScheme get colorScheme => Theme.of(this).colorScheme;
}
