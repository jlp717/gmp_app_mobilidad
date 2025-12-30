import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// Search filter bar with debounced input
class FilterBar extends StatefulWidget {
  final Function(String? productCode, String? productName, String? clientName) onFiltersChanged;
  
  const FilterBar({
    super.key,
    required this.onFiltersChanged,
  });

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

  @override
  void dispose() {
    _productCodeController.dispose();
    _productNameController.dispose();
    _clientNameController.dispose();
    super.dispose();
  }

  void _handleFilterChange() {
    final productCode = _productCodeController.text.trim().isEmpty ? null : _productCodeController.text.trim();
    final productName = _productNameController.text.trim().isEmpty ? null : _productNameController.text.trim();
    final clientName = _clientNameController.text.trim().isEmpty ? null : _clientNameController.text.trim();
    
    if (productCode != _activeProductCode || productName != _activeProductName || clientName != _activeClientName) {
      setState(() {
        _activeProductCode = productCode;
        _activeProductName = productName;
        _activeClientName = clientName;
      });
      
      // Debounce: wait 500ms before applying
      Future.delayed(const Duration(milliseconds: 500), () {
        if (productCode == _productCodeController.text.trim() || _productCodeController.text.trim().isEmpty) {
          widget.onFiltersChanged(productCode, productName, clientName);
        }
      });
    }
  }

  void _clearAll() {
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

  bool get _hasActiveFilters => _activeProductCode != null || _activeProductName != null || _activeClientName != null;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.search, color: AppTheme.neonBlue, size: 20),
              const SizedBox(width: 8),
              const Text(
                'Filtros de Búsqueda',
                style: TextStyle(color: AppTheme.neonBlue, fontSize: 14, fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              if (_hasActiveFilters)
                TextButton.icon(
                  onPressed: _clearAll,
                  icon: const Icon(Icons.clear, size: 16, color: Colors.redAccent),
                  label: const Text('Limpiar', style: TextStyle(color: Colors.redAccent, fontSize: 12)),
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
      style: const TextStyle(color: Colors.white, fontSize: 13),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white54, fontSize: 12),
        prefixIcon: Icon(icon, color: AppTheme.neonGreen, size: 18),
        filled: true,
        fillColor: AppTheme.darkBase,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
    );
  }
}
