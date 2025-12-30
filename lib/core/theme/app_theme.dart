import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Ultra-modern, minimalist, futuristic theme for tablet app
/// Dark theme with neon blue/green accents
/// Optimized for tablets (10+ inches)
class AppTheme {
  // ============================================================================
  // COLOR PALETTE - Futuristic Dark with Neon Accents
  // ============================================================================

  // Base colors
  static const Color darkBase = Color(0xFF0A0E27);
  static const Color darkSurface = Color(0xFF1A1F3A);
  static const Color darkCard = Color(0xFF252B48);
  static const Color borderColor = Color(0xFF333955);
  
  // Added for compatibility
  static const Color surfaceColor = darkSurface;

  // Neon accents
  static const Color neonBlue = Color(0xFF00D4FF);
  static const Color neonGreen = Color(0xFF00FF88);
  static const Color neonPurple = Color(0xFFBB86FC);
  static const Color neonPink = Color(0xFFFF6B9D);  // Pink for rutero

  // Status colors
  static const Color success = Color(0xFF00FF88); // Green for positive
  static const Color error = Color(0xFFFF3B5C);   // Red for negative
  static const Color warning = Color(0xFFFFAA00);
  static const Color info = Color(0xFF00D4FF);

  // Text colors
  static const Color textPrimary = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFFB0B8D4);
  static const Color textTertiary = Color(0xFF6B7280);

  // Chart colors
  static const List<Color> chartColors = [
    neonBlue,
    neonGreen,
    neonPurple,
    Color(0xFFFF6B9D),
    Color(0xFFFFC233),
    Color(0xFF8B5CF6),
    Color(0xFF10B981),
    Color(0xFFF59E0B),
  ];

  // ============================================================================
  // THEME DATA
  // ============================================================================

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: darkBase,

      // Color scheme
      colorScheme: ColorScheme.dark(
        primary: neonBlue,
        secondary: neonGreen,
        surface: darkSurface,
        background: darkBase,
        error: error,
        onPrimary: darkBase,
        onSecondary: darkBase,
        onSurface: textPrimary,
        onBackground: textPrimary,
        onError: textPrimary,
      ),

      // Typography - Roboto
      textTheme: GoogleFonts.robotoTextTheme(
        ThemeData.dark().textTheme.copyWith(
          displayLarge: const TextStyle(fontSize: 57, fontWeight: FontWeight.w300, color: textPrimary),
          displayMedium: const TextStyle(fontSize: 45, fontWeight: FontWeight.w300, color: textPrimary),
          displaySmall: const TextStyle(fontSize: 36, fontWeight: FontWeight.w400, color: textPrimary),
          headlineLarge: const TextStyle(fontSize: 32, fontWeight: FontWeight.w400, color: textPrimary),
          headlineMedium: const TextStyle(fontSize: 28, fontWeight: FontWeight.w400, color: textPrimary),
          headlineSmall: const TextStyle(fontSize: 24, fontWeight: FontWeight.w400, color: textPrimary),
          titleLarge: const TextStyle(fontSize: 22, fontWeight: FontWeight.w500, color: textPrimary),
          titleMedium: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: textPrimary),
          titleSmall: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: textPrimary),
          bodyLarge: const TextStyle(fontSize: 16, fontWeight: FontWeight.w400, color: textPrimary),
          bodyMedium: const TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: textSecondary),
          bodySmall: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: textTertiary),
        ),
      ),

      // Card Theme
      cardTheme: CardThemeData(
        color: darkCard,
        elevation: 4,
        shadowColor: neonBlue.withOpacity(0.1),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),

      // App Bar Theme
      appBarTheme: const AppBarTheme(
        backgroundColor: darkSurface,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: neonBlue),
      ),

      // Button Themes
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: neonBlue,
          foregroundColor: darkBase,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        ),
      ),

      // Input Theme
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: darkSurface,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: neonBlue, width: 2)),
      ),
    );
  }

  // ============================================================================
  // CUSTOM DECORATIONS
  // ============================================================================

  static BoxDecoration glassMorphism({Color? color}) => BoxDecoration(
    color: (color ?? darkCard).withOpacity(0.7),
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: neonBlue.withOpacity(0.2), width: 1),
    boxShadow: [BoxShadow(color: neonBlue.withOpacity(0.1), blurRadius: 20)],
  );

  static BoxDecoration neonGlow({required Color color}) => BoxDecoration(
    color: darkCard,
    borderRadius: BorderRadius.circular(12),
    border: Border.all(color: color, width: 1),
    boxShadow: [
      BoxShadow(color: color.withOpacity(0.3), blurRadius: 20),
      BoxShadow(color: color.withOpacity(0.1), blurRadius: 40, spreadRadius: 5),
    ],
  );

  // Spacing constants (tablet-optimized)
  static const double paddingS = 12.0;
  static const double paddingM = 16.0;
  static const double paddingL = 24.0;
  static const double paddingXL = 32.0;
}
