import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ── State ────────────────────────────────────────────────────────────────────

class FilterState {
  final String? selectedVendor;
  const FilterState({this.selectedVendor});

  FilterState copyWith({Object? selectedVendor = _sentinel}) {
    return FilterState(
      selectedVendor: selectedVendor == _sentinel
          ? this.selectedVendor
          : selectedVendor as String?,
    );
  }

  static const _sentinel = Object();
}

// ── Notifier ─────────────────────────────────────────────────────────────────

class FilterNotifier extends Notifier<FilterState> {
  @override
  FilterState build() {
    _loadFromStorage();
    return const FilterState();
  }

  void setVendor(String? vendorCode) {
    if (state.selectedVendor != vendorCode) {
      state = state.copyWith(selectedVendor: vendorCode);
      _saveToStorage();
    }
  }

  void clear() {
    state = const FilterState();
    _saveToStorage();
  }

  Future<void> _saveToStorage() async {
    final prefs = await SharedPreferences.getInstance();
    if (state.selectedVendor != null) {
      await prefs.setString('global_filter_vendor', state.selectedVendor!);
    } else {
      await prefs.remove('global_filter_vendor');
    }
  }

  Future<void> _loadFromStorage() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('global_filter_vendor');
    if (saved != null) {
      state = FilterState(selectedVendor: saved);
    }
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

final filterProvider = NotifierProvider<FilterNotifier, FilterState>(
  FilterNotifier.new,
);

// ── Selectors ────────────────────────────────────────────────────────────────

final selectedVendorProvider = Provider<String?>((ref) {
  return ref.watch(filterProvider).selectedVendor;
});
