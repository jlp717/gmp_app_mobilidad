import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Ultra-modern, minimalist, futuristic theme for tablet app
/// Dark theme with neon blue/green accents
/// Optimized for tablets (10+ inches)
class AppTheme {
  // ============================================================================
  // COLOR PALETTE - Futuristic Dark with Neon Accents
  // ============================================================================

  // Base colors - SLIGHTLY LIGHTER FOR BETTER DEPTH (Senior Redesign)
  static const Color darkBase = Color(0xFF0F172A); 
  static const Color darkSurface = Color(0xFF1E293B);
  static const Color darkCard = Color(0xFF334155);
  static const Color borderColor = Color(0xFF475569);
  
  // Added for compatibility
  static const Color surfaceColor = darkSurface;

  // Neon accents (Primary palette - cian/azul)
  static const Color neonBlue = Color(0xFF00D4FF);
  static const Color neonGreen = Color(0xFF00FF88);
  static const Color neonPurple = Color(0xFFBB86FC);
  static const Color neonPink = Color(0xFFFF6B9D);
  
  // NEW: Extended Neon palette for futuristic UI
  static const Color neonCyan = Color(0xFF00FFFF);
  static const Color neonTeal = Color(0xFF00CED1);
  static const Color neonElectric = Color(0xFF7DF9FF);
  static const Color holoBlue = Color(0xFF1E90FF);
  
  // NEW: Glow intensities
  static const Color glowIntense = Color(0xFF00D4FF);
  static const Color glowMedium = Color(0xFF0099CC);
  static const Color glowSubtle = Color(0xFF006699);

  // Status colors
  static const Color success = Color(0xFF00FF88); // Green for positive
  static const Color error = Color(0xFFFF3B5C);   // Red for negative
  static const Color warning = Color(0xFFFFAA00);
  static const Color info = Color(0xFF00D4FF);

  // Aliases for compatibility
  static const Color successColor = success;
  static const Color errorColor = error;
  static const Color warningColor = warning;
  static const Color infoColor = info;
  
  // NEW: Payment status colors
  static const Color obligatorio = Color(0xFFFF3B5C); // Red - must collect
  static const Color opcional = Color(0xFFFFAA00);    // Orange - optional
  static const Color cobrado = Color(0xFF00FF88);     // Green - paid
  static const Color credito = Color(0xFF00D4FF);     // Blue - credit

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
  // GRADIENTS - Holographic & Futuristic
  // ============================================================================
  
  /// Primary brand gradient (neon blue)
  static LinearGradient get primaryGradient => LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [
      neonBlue.withOpacity(0.3),
      neonBlue.withOpacity(0.1),
    ],
  );

  /// Holographic gradient for premium cards
  static LinearGradient get holoGradient => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      neonCyan.withOpacity(0.15),
      neonBlue.withOpacity(0.1),
      neonPurple.withOpacity(0.1),
      neonCyan.withOpacity(0.15),
    ],
    stops: const [0.0, 0.35, 0.65, 1.0],
  );
  
  /// Scanner effect gradient (for animated elements)
  static LinearGradient get scannerGradient => const LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Colors.transparent,
      neonCyan,
      Colors.transparent,
    ],
    stops: [0.0, 0.5, 1.0],
  );
  
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
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [
      error.withOpacity(0.3),
      error.withOpacity(0.1),
    ],
  );
  
  /// Success indicator gradient
  static LinearGradient get successGradient => LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [
      success.withOpacity(0.3),
      success.withOpacity(0.1),
    ],
  );

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
        todayBorder: BorderSide(color: neonBlue, width: 1),
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
  
  /// NEW: Holographic card decoration with gradient
  static BoxDecoration holoCard({Color? glowColor}) => BoxDecoration(
    gradient: cardGradient,
    borderRadius: BorderRadius.circular(16),
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
    borderRadius: BorderRadius.circular(16),
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
    borderRadius: BorderRadius.circular(16),
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
    borderRadius: BorderRadius.circular(16),
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
    gradient: LinearGradient(
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

  // Spacing constants (tablet-optimized)
  static const double paddingS = 12.0;
  static const double paddingM = 16.0;
  static const double paddingL = 24.0;
  static const double paddingXL = 32.0;
  
  // NEW: Animation durations
  static const Duration animFast = Duration(milliseconds: 150);
  static const Duration animNormal = Duration(milliseconds: 300);
  static const Duration animSlow = Duration(milliseconds: 500);
  static const Duration animPulse = Duration(milliseconds: 1500);
}
