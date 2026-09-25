import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Estado inmutable del tema de la aplicación.
@immutable
class ThemeState {
  const ThemeState({
    this.isDarkMode = true,
    this.isLoadingPreference = true,
  });

  final bool isDarkMode;
  final bool isLoadingPreference;

  ThemeMode get themeMode => isDarkMode ? ThemeMode.dark : ThemeMode.light;

  ThemeState copyWith({bool? isDarkMode, bool? isLoadingPreference}) {
    return ThemeState(
      isDarkMode: isDarkMode ?? this.isDarkMode,
      isLoadingPreference: isLoadingPreference ?? this.isLoadingPreference,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other is ThemeState &&
            other.isDarkMode == isDarkMode &&
            other.isLoadingPreference == isLoadingPreference);
  }

  @override
  int get hashCode => Object.hash(isDarkMode, isLoadingPreference);
}

/// Provider para gestionar el tema de la aplicación
/// Permite cambiar entre tema claro y oscuro
class ThemeProvider extends Notifier<ThemeState> {
  // Preserve the shipped dark first frame while a saved preference loads.
  bool _isDarkMode = true;
  bool _isLoadingPreference = true;
  bool _selectionChangedWhileLoading = false;
  // Replaces the old torn-down guard: Riverpod tears the notifier down
  // automatically; async continuations check [_isAlive] (ref.mounted).
  bool _active = true;

  bool get isDarkMode => _isDarkMode;
  ThemeMode get themeMode => _isDarkMode ? ThemeMode.dark : ThemeMode.light;
  bool get isLoadingPreference => _isLoadingPreference;
  Future<void> get ready => _preferenceLoad ??= _loadThemeFromPrefs();

  Future<void>? _preferenceLoad;

  @override
  ThemeState build() {
    _active = true;
    _preferenceLoad ??= _loadThemeFromPrefs();
    return ThemeState(
      isDarkMode: _isDarkMode,
      isLoadingPreference: _isLoadingPreference,
    );
  }

  bool get _isAlive {
    try {
      return _active && ref.mounted;
    } catch (_) {
      // Direct instantiation outside a ProviderContainer (legacy unit test):
      // no ref available, treat as alive so field-level API still works.
      return _active;
    }
  }

  void _syncState() {
    if (!_isAlive) return;
    try {
      state = ThemeState(
        isDarkMode: _isDarkMode,
        isLoadingPreference: _isLoadingPreference,
      );
    } catch (_) {
      // Not attached to a container yet (direct construction in tests):
      // fields already hold the truth, state syncs on build().
    }
  }

  /// Carga la preferencia de tema desde SharedPreferences
  Future<void> _loadThemeFromPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!_selectionChangedWhileLoading) {
        _isDarkMode = prefs.getBool('isDarkMode') ?? true;
      }
    } catch (error) {
      debugPrint('[THEME] Could not load preference: $error');
    } finally {
      _isLoadingPreference = false;
      _syncState();
    }
  }

  /// Cambia entre tema claro y oscuro
  Future<void> toggleTheme() async {
    _isDarkMode = !_isDarkMode;
    _selectionChangedWhileLoading = true;
    _syncState();
    await _persistTheme();
  }

  /// Establece un tema específico
  Future<void> setTheme(bool isDark) async {
    if (_isLoadingPreference) _selectionChangedWhileLoading = true;
    if (_isDarkMode == isDark) return;
    _isDarkMode = isDark;
    _selectionChangedWhileLoading = true;
    _syncState();
    await _persistTheme();
  }

  Future<void> _persistTheme() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('isDarkMode', _isDarkMode);
    } catch (error) {
      debugPrint('[THEME] Could not persist preference: $error');
    }
  }
}

/// Riverpod provider for ThemeProvider
final themeProvider = NotifierProvider<ThemeProvider, ThemeState>(
  ThemeProvider.new,
);
