---
name: flutter-material3
description: Flutter Material 3: ThemeData, ColorScheme, tipografía.
---

# Skill: flutter-material3 — Material 3 en gmp_app_mobilidad

Guía de theming Material 3 para Flutter 3.10+. Colores centralizados en `app_colors.dart`.

## ThemeData Configuración

```dart
// lib/core/theme/app_theme.dart
import 'package:flutter/material.dart';
import 'app_colors.dart';

class AppTheme {
  static ThemeData get lightTheme => ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.light,
    ),
    textTheme: _buildTextTheme(),
    appBarTheme: const AppBarTheme(
      elevation: 0,
      centerTitle: false,
      scrolledUnderElevation: 1,
    ),
    cardTheme: const CardTheme(
      elevation: 0,
      margin: EdgeInsets.zero,
    ),
    navigationBarTheme: NavigationBarThemeData(
      elevation: 0,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
    ),
  );

  static ThemeData get darkTheme => ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.dark,
    ),
  );

  static TextTheme _buildTextTheme() => const TextTheme(
    displayLarge: TextStyle(fontSize: 57, fontWeight: FontWeight.w400),
    headlineMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w600),
    titleLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w500),
    bodyLarge: TextStyle(fontSize: 16),
    bodyMedium: TextStyle(fontSize: 14),
    labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
  );
}
```

## AppColors (Regla: SIEMPRE usar este archivo)

```dart
// lib/core/theme/app_colors.dart — NO hardcodear colores en widgets
class AppColors {
  // Primarios
  static const Color primary = Color(0xFF1565C0);      // Azul corporativo
  static const Color secondary = Color(0xFF00897B);    // Verde
  static const Color error = Color(0xFFD32F2F);

  // Estados de pedido
  static const Color pedidoPendiente = Color(0xFFF57C00);  // Naranja
  static const Color pedidoConfirmado = Color(0xFF388E3C); // Verde
  static const Color pedidoCancelado = Color(0xFFD32F2F);  // Rojo
  static const Color pedidoEntregado = Color(0xFF1976D2);  // Azul

  // Fondos
  static const Color surfaceVariant = Color(0xFFF5F5F5);
  static const Color divider = Color(0xFFE0E0E0);
}
```

## Widgets Material 3 (Obligatorios)

```dart
// ✅ NavigationBar (no BottomNavigationBar legacy)
NavigationBar(
  selectedIndex: _currentIndex,
  onDestinationSelected: (index) => setState(() => _currentIndex = index),
  destinations: const [
    NavigationDestination(icon: Icon(Icons.home), label: 'Inicio'),
    NavigationDestination(icon: Icon(Icons.list), label: 'Pedidos'),
  ],
)

// ✅ FilledButton (no RaisedButton)
FilledButton(onPressed: onPressed, child: const Text('Confirmar'))
FilledButton.tonal(onPressed: onPressed, child: const Text('Secundario'))

// ✅ Card con elevation 0
Card(
  elevation: 0,
  color: Theme.of(context).colorScheme.surfaceContainerHighest,
  child: Padding(padding: const EdgeInsets.all(16), child: content),
)

// ✅ SearchBar (Material 3)
SearchBar(
  hintText: 'Buscar pedidos...',
  leading: const Icon(Icons.search),
  onChanged: (query) => ref.read(searchProvider.notifier).search(query),
)
```

## ThemeExtensions para Tokens Personalizados

```dart
@immutable
class AppStatusColors extends ThemeExtension<AppStatusColors> {
  const AppStatusColors({
    required this.pending,
    required this.confirmed,
    required this.delivered,
  });

  final Color pending;
  final Color confirmed;
  final Color delivered;

  @override
  AppStatusColors copyWith({Color? pending, Color? confirmed, Color? delivered}) =>
    AppStatusColors(
      pending: pending ?? this.pending,
      confirmed: confirmed ?? this.confirmed,
      delivered: delivered ?? this.delivered,
    );

  @override
  AppStatusColors lerp(AppStatusColors? other, double t) => this;
}

// Uso en widget:
final statusColors = Theme.of(context).extension<AppStatusColors>()!;
color: statusColors.pending,
```

## Anti-patrones
- `Color(0xFF...)` en widgets → usar `AppColors.xxx`
- `BottomNavigationBar` → usar `NavigationBar`
- `RaisedButton` / `FlatButton` → usar `FilledButton` / `TextButton`
- `showDialog` sin `barrierColor` → oscurece correctamente el fondo
- `MediaQuery.of(context).size` en widgets → usar `LayoutBuilder` para responsividad
