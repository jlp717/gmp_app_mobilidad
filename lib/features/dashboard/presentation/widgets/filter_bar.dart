import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Search filter bar with debounced input
class FilterBar extends StatefulWidget {
  const FilterBar({
    required this.onFiltersChanged,
    super.key,
  });
  final Function(String? productCode, String? productName, String? clientName)
      onFiltersChanged;

  @override
  State<FilterBar> createState() => _FilterBarState();
}

class _FilterBarState extends State<FilterBar> {
  final _productCodeController = TextEditingController();
  final _productNameController = TextEditingController();
  final _clientNameController = TextEditingController();

  String? _activeProductCode;
  String? _activeProductName;
  String? _activeClientName;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _productCodeController.dispose();
    _productNameController.dispose();
    _clientNameController.dispose();
    super.dispose();
  }

  void _handleFilterChange() {
    final productCode = _productCodeController.text.trim().isEmpty
        ? null
        : _productCodeController.text.trim();
    final productName = _productNameController.text.trim().isEmpty
        ? null
        : _productNameController.text.trim();
    final clientName = _clientNameController.text.trim().isEmpty
        ? null
        : _clientNameController.text.trim();

    if (productCode == _activeProductCode &&
        productName == _activeProductName &&
        clientName == _activeClientName) {
      return;
    }

    setState(() {
      _activeProductCode = productCode;
      _activeProductName = productName;
      _activeClientName = clientName;
    });

    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      widget.onFiltersChanged(
        _activeProductCode,
        _activeProductName,
        _activeClientName,
      );
    });
  }

  void _clearAll() {
    _debounce?.cancel();
    _productCodeController.clear();
    _productNameController.clear();
    _clientNameController.clear();
    setState(() {
      _activeProductCode = null;
      _activeProductName = null;
      _activeClientName = null;
    });
    widget.onFiltersChanged(null, null, null);
  }

  bool get _hasActiveFilters =>
      _activeProductCode != null ||
      _activeProductName != null ||
      _activeClientName != null;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.search, color: AppTheme.info, size: 20),
              const SizedBox(width: 8),
              const Text(
                'Filtros de Búsqueda',
                style: TextStyle(
                  color: AppTheme.info,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const Spacer(),
              if (_hasActiveFilters)
                TextButton.icon(
                  onPressed: _clearAll,
                  icon:
                      const Icon(Icons.clear, size: 16, color: AppTheme.error),
                  label: const Text(
                    'Limpiar',
                    style: TextStyle(color: AppTheme.error, fontSize: 12),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _buildSearchField(
                  controller: _productCodeController,
                  label: 'C código producto',
                  icon: Icons.qr_code,
                  onChanged: (_) => _handleFilterChange(),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildSearchField(
                  controller: _productNameController,
                  label: 'Descripción producto',
                  icon: Icons.inventory,
                  onChanged: (_) => _handleFilterChange(),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildSearchField(
                  controller: _clientNameController,
                  label: 'Cliente',
                  icon: Icons.person,
                  onChanged: (_) => _handleFilterChange(),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSearchField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    required Function(String) onChanged,
  }) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      style: TextStyle(color: AppTheme.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: AppTheme.textTertiary, fontSize: 12),
        prefixIcon: Icon(icon, color: AppTheme.success, size: 18),
        filled: true,
        fillColor: AppTheme.inkSurface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
    );
  }
}
