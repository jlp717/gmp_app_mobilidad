import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Manages global filters like "Selected Vendor" across the app
class FilterProvider with ChangeNotifier {
  String? _selectedVendor;

  String? get selectedVendor => _selectedVendor;

  FilterProvider() {
    _loadFromStorage();
  }

  void setVendor(String? vendorCode) {
    if (_selectedVendor != vendorCode) {
      _selectedVendor = vendorCode;
      notifyListeners();
      _saveToStorage();
    }
  }

  Future<void> _saveToStorage() async {
    final prefs = await SharedPreferences.getInstance();
    if (_selectedVendor != null) {
      await prefs.setString('global_filter_vendor', _selectedVendor!);
    } else {
      await prefs.remove('global_filter_vendor');
    }
  }

  Future<void> _loadFromStorage() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('global_filter_vendor');
    if (saved != null) {
      _selectedVendor = saved;
      notifyListeners();
    }
  }

  // Clear when logging out
  void clear() {
    _selectedVendor = null;
    _saveToStorage();
    notifyListeners();
  }
}
