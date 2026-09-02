import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Provider para gestionar el tema de la aplicación
/// Permite cambiar entre tema claro y oscuro
class ThemeProvider extends ChangeNotifier {
  ThemeProvider() {
    _preferenceLoad = _loadThemeFromPrefs();
  }
  // Preserve the shipped dark first frame while a saved preference loads.
  bool _isDarkMode = true;
  bool _isLoadingPreference = true;
  bool _selectionChangedWhileLoading = false;
  bool _disposed = false;

  bool get isDarkMode => _isDarkMode;
  ThemeMode get themeMode => _isDarkMode ? ThemeMode.dark : ThemeMode.light;
  bool get isLoadingPreference => _isLoadingPreference;
  Future<void> get ready => _preferenceLoad;

  late final Future<void> _preferenceLoad;

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
      if (!_disposed) notifyListeners();
    }
  }

  /// Cambia entre tema claro y oscuro
  Future<void> toggleTheme() async {
    _isDarkMode = !_isDarkMode;
    _selectionChangedWhileLoading = true;
    if (!_disposed) notifyListeners();
    await _persistTheme();
  }

  /// Establece un tema específico
  Future<void> setTheme(bool isDark) async {
    if (_isLoadingPreference) _selectionChangedWhileLoading = true;
    if (_isDarkMode == isDark) return;
    _isDarkMode = isDark;
    _selectionChangedWhileLoading = true;
    if (!_disposed) notifyListeners();
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

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Riverpod provider for ThemeProvider
final themeProvider = ChangeNotifierProvider<ThemeProvider>((ref) {
  return ThemeProvider();
});
