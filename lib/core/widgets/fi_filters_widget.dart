import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';

/// Widget reutilizable para filtros jerárquicos FI1-FI5
/// 
/// Estructura de jerarquía:
/// - FI1: Categoría principal (ej: PRODUCTOS DEL MAR, CARNE CONGELADA)
/// - FI2: Subcategoría (ej: LANGOSTINO, GAMBA) - depende de FI1
/// - FI3: Atributo adicional (poco usado, ~19% artículos)
/// - FI4: Características especiales (SIN GLUTEN, VEGANO) (~18% artículos)
/// - FI5: Tipo de conservación (CONGELADO, HELADO, CARNE FRESCA)
class FiFiltersWidget extends StatefulWidget {
  /// Callback cuando los filtros cambian
  final Function(FiFilterState) onFiltersChanged;
  
  /// Filtros iniciales (opcional)
  final FiFilterState? initialFilters;
  
  /// Opciones disponibles precargadas (para evitar llamadas al API)
  final FiFilterOptions? availableOptions;
  
  /// Si se muestra compacto (2 columnas) o expandido
  final bool compact;
  
  /// Mostrar solo FI principales (FI1, FI2, FI5) u ocultar FI3/FI4
  final bool showAdvanced;
  
  /// Si el widget está habilitado
  final bool enabled;

  const FiFiltersWidget({
    super.key,
    required this.onFiltersChanged,
    this.initialFilters,
    this.availableOptions,
    this.compact = true,
    this.showAdvanced = false,
    this.enabled = true,
  });

  @override
  State<FiFiltersWidget> createState() => _FiFiltersWidgetState();
}

class _FiFiltersWidgetState extends State<FiFiltersWidget> {
  // Current selection state
  String? _selectedFi1;
  String? _selectedFi2;
  String? _selectedFi3;
  String? _selectedFi4;
  String? _selectedFi5;
  
  // Available options (loaded from API or passed as prop)
  List<FiOption> _fi1Options = [];
  List<FiOption> _fi2Options = [];
  List<FiOption> _fi3Options = [];
  List<FiOption> _fi4Options = [];
  List<FiOption> _fi5Options = [];
  
  // Loading states
  bool _loadingFi1 = false;
  bool _loadingFi2 = false;
  bool _loadingFi3 = false;
  bool _loadingFi4 = false;
  bool _loadingFi5 = false;
  
  // Count of matching articles
  int _articleCount = 0;

  @override
  void initState() {
    super.initState();
    _initializeFilters();
  }

  void _initializeFilters() {
    if (widget.initialFilters != null) {
      _selectedFi1 = widget.initialFilters!.fi1;
      _selectedFi2 = widget.initialFilters!.fi2;
      _selectedFi3 = widget.initialFilters!.fi3;
      _selectedFi4 = widget.initialFilters!.fi4;
      _selectedFi5 = widget.initialFilters!.fi5;
    }
    
    if (widget.availableOptions != null) {
      _fi1Options = widget.availableOptions!.fi1;
      _fi2Options = widget.availableOptions!.fi2;
      _fi3Options = widget.availableOptions!.fi3;
      _fi4Options = widget.availableOptions!.fi4;
      _fi5Options = widget.availableOptions!.fi5;
    } else {
      _loadFi1Options();
      _loadFi5Options();
    }
  }

  @override
  void didUpdateWidget(FiFiltersWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    // If available options changed externally, update local state
    if (widget.availableOptions != oldWidget.availableOptions && widget.availableOptions != null) {
      setState(() {
        _fi1Options = widget.availableOptions!.fi1;
        _fi2Options = widget.availableOptions!.fi2;
        _fi3Options = widget.availableOptions!.fi3;
        _fi4Options = widget.availableOptions!.fi4;
        _fi5Options = widget.availableOptions!.fi5;
      });
    }
  }

  /// Load FI1 options from API
  Future<void> _loadFi1Options() async {
    if (_fi1Options.isNotEmpty) return;
    
    setState(() => _loadingFi1 = true);
    try {
      final response = await ApiClient.get('/filters/fi1');
      if (response['success'] == true) {
        setState(() {
          _fi1Options = (response['filters'] as List)
              .map((f) => FiOption.fromJson(f as Map<String, dynamic>))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Error loading FI1: $e');
    } finally {
      setState(() => _loadingFi1 = false);
    }
  }

  /// Load FI2 options based on selected FI1
  Future<void> _loadFi2Options() async {
    if (_selectedFi1 == null) {
      setState(() => _fi2Options = []);
      return;
    }
    
    setState(() => _loadingFi2 = true);
    try {
      final response = await ApiClient.get('/filters/fi2', queryParameters: {
        'fi1Code': _selectedFi1!,
      });
      if (response['success'] == true) {
        setState(() {
          _fi2Options = (response['filters'] as List)
              .map((f) => FiOption.fromJson(f as Map<String, dynamic>))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Error loading FI2: $e');
    } finally {
      setState(() => _loadingFi2 = false);
    }
  }

  /// Load FI3 options based on selected FI1/FI2
  Future<void> _loadFi3Options() async {
    if (_selectedFi1 == null && _selectedFi2 == null) {
      setState(() => _fi3Options = []);
      return;
    }
    
    setState(() => _loadingFi3 = true);
    try {
      final params = <String, String>{};
      if (_selectedFi1 != null) params['fi1Code'] = _selectedFi1!;
      if (_selectedFi2 != null) params['fi2Code'] = _selectedFi2!;
      
      final response = await ApiClient.get('/filters/fi3', queryParameters: params);
      if (response['success'] == true) {
        setState(() {
          _fi3Options = (response['filters'] as List)
              .map((f) => FiOption.fromJson(f as Map<String, dynamic>))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Error loading FI3: $e');
    } finally {
      setState(() => _loadingFi3 = false);
    }
  }

  /// Load FI4 options based on current selection
  Future<void> _loadFi4Options() async {
    setState(() => _loadingFi4 = true);
    try {
      final params = <String, String>{};
      if (_selectedFi1 != null) params['fi1Code'] = _selectedFi1!;
      if (_selectedFi2 != null) params['fi2Code'] = _selectedFi2!;
      if (_selectedFi3 != null) params['fi3Code'] = _selectedFi3!;
      
      final response = await ApiClient.get('/filters/fi4', queryParameters: params);
      if (response['success'] == true) {
        setState(() {
          _fi4Options = (response['filters'] as List)
              .map((f) => FiOption.fromJson(f as Map<String, dynamic>))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Error loading FI4: $e');
    } finally {
      setState(() => _loadingFi4 = false);
    }
  }

  /// Load FI5 options (independent, always loaded)
  Future<void> _loadFi5Options() async {
    if (_fi5Options.isNotEmpty) return;
    
    setState(() => _loadingFi5 = true);
    try {
      final response = await ApiClient.get('/filters/fi5');
      if (response['success'] == true) {
        setState(() {
          _fi5Options = (response['filters'] as List)
              .map((f) => FiOption.fromJson(f as Map<String, dynamic>))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Error loading FI5: $e');
    } finally {
      setState(() => _loadingFi5 = false);
    }
  }

  /// Notify parent of filter changes
  void _notifyFiltersChanged() {
    widget.onFiltersChanged(FiFilterState(
      fi1: _selectedFi1,
      fi2: _selectedFi2,
      fi3: _selectedFi3,
      fi4: _selectedFi4,
      fi5: _selectedFi5,
    ));
  }

  /// Handle FI1 selection change
  void _onFi1Changed(String? value) {
    setState(() {
      _selectedFi1 = value;
      // Clear dependent selections
      _selectedFi2 = null;
      _selectedFi3 = null;
      _selectedFi4 = null;
      _fi2Options = [];
      _fi3Options = [];
      _fi4Options = [];
    });
    
    if (value != null) {
      _loadFi2Options();
      if (widget.showAdvanced) {
        _loadFi3Options();
        _loadFi4Options();
      }
    }
    _notifyFiltersChanged();
  }

  /// Handle FI2 selection change
  void _onFi2Changed(String? value) {
    setState(() {
      _selectedFi2 = value;
      // Clear dependent selections
      _selectedFi3 = null;
      _selectedFi4 = null;
      _fi3Options = [];
      _fi4Options = [];
    });
    
    if (widget.showAdvanced && value != null) {
      _loadFi3Options();
      _loadFi4Options();
    }
    _notifyFiltersChanged();
  }

  /// Handle FI3 selection change
  void _onFi3Changed(String? value) {
    setState(() {
      _selectedFi3 = value;
      _selectedFi4 = null;
      _fi4Options = [];
    });
    
    if (value != null) {
      _loadFi4Options();
    }
    _notifyFiltersChanged();
  }

  /// Handle FI4 selection change
  void _onFi4Changed(String? value) {
    setState(() => _selectedFi4 = value);
    _notifyFiltersChanged();
  }

  /// Handle FI5 selection change
  void _onFi5Changed(String? value) {
    setState(() => _selectedFi5 = value);
    _notifyFiltersChanged();
  }

  /// Clear all filters
  void clearFilters() {
    setState(() {
      _selectedFi1 = null;
      _selectedFi2 = null;
      _selectedFi3 = null;
      _selectedFi4 = null;
      _selectedFi5 = null;
      _fi2Options = [];
      _fi3Options = [];
      _fi4Options = [];
    });
    _notifyFiltersChanged();
  }

  /// Check if any filter is active
  bool get hasActiveFilters => 
      _selectedFi1 != null || 
      _selectedFi2 != null || 
      _selectedFi3 != null || 
      _selectedFi4 != null || 
      _selectedFi5 != null;

  @override
  Widget build(BuildContext context) {
    if (widget.compact) {
      return _buildCompactLayout();
    }
    return _buildExpandedLayout();
  }

  /// Compact layout: 2 columns, chip-based
  Widget _buildCompactLayout() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Row 1: FI1 (Categoría) + FI5 (Tipo)
        Row(
          children: [
            Expanded(
              child: _buildDropdown(
                label: 'Categoría',
                value: _selectedFi1,
                options: _fi1Options,
                loading: _loadingFi1,
                onChanged: widget.enabled ? _onFi1Changed : null,
                icon: Icons.category,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildDropdown(
                label: 'Tipo',
                value: _selectedFi5,
                options: _fi5Options,
                loading: _loadingFi5,
                onChanged: widget.enabled ? _onFi5Changed : null,
                icon: Icons.ac_unit,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        // Row 2: FI2 (Subcategoría) - Siempre visible pero disabled si no hay FI1
        _buildDropdown(
          label: 'Subcategoría',
          value: _selectedFi2,
          options: _fi2Options,
          loading: _loadingFi2,
          onChanged: widget.enabled ? _onFi2Changed : null,
          icon: Icons.subdirectory_arrow_right,
          enabled: _selectedFi1 != null,
        ),
        // Advanced filters (FI3, FI4) - Siempre visibles cuando showAdvanced=true
        if (widget.showAdvanced) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              // FI3 - Detalle
              Expanded(
                child: _buildDropdown(
                  label: 'Detalle',
                  value: _selectedFi3,
                  options: _fi3Options,
                  loading: _loadingFi3,
                  onChanged: widget.enabled ? _onFi3Changed : null,
                  icon: Icons.tune,
                  enabled: _selectedFi1 != null && (_fi3Options.isNotEmpty || _loadingFi3),
                ),
              ),
              const SizedBox(width: 8),
              // FI4 - Especial
              Expanded(
                child: _buildDropdown(
                  label: 'Especial',
                  value: _selectedFi4,
                  options: _fi4Options,
                  loading: _loadingFi4,
                  onChanged: widget.enabled ? _onFi4Changed : null,
                  icon: Icons.eco,
                  enabled: _selectedFi1 != null && (_fi4Options.isNotEmpty || _loadingFi4),
                ),
              ),
            ],
          ),
        ],
        // Clear button
        if (hasActiveFilters) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: widget.enabled ? clearFilters : null,
              icon: const Icon(Icons.clear_all, size: 16),
              label: const Text('Limpiar filtros', style: TextStyle(fontSize: 11)),
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.error,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              ),
            ),
          ),
        ],
      ],
    );
  }

  /// Expanded layout: Full width dropdowns
  Widget _buildExpandedLayout() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildDropdown(
          label: 'Categoría Principal (FI1)',
          value: _selectedFi1,
          options: _fi1Options,
          loading: _loadingFi1,
          onChanged: widget.enabled ? _onFi1Changed : null,
          icon: Icons.category,
        ),
        const SizedBox(height: 12),
        _buildDropdown(
          label: 'Subcategoría (FI2)',
          value: _selectedFi2,
          options: _fi2Options,
          loading: _loadingFi2,
          onChanged: widget.enabled ? _onFi2Changed : null,
          icon: Icons.subdirectory_arrow_right,
          enabled: _selectedFi1 != null,
        ),
        if (widget.showAdvanced) ...[
          const SizedBox(height: 12),
          _buildDropdown(
            label: 'Detalle (FI3)',
            value: _selectedFi3,
            options: _fi3Options,
            loading: _loadingFi3,
            onChanged: widget.enabled ? _onFi3Changed : null,
            icon: Icons.tune,
            enabled: _selectedFi2 != null,
          ),
          const SizedBox(height: 12),
          _buildDropdown(
            label: 'Características (FI4)',
            value: _selectedFi4,
            options: _fi4Options,
            loading: _loadingFi4,
            onChanged: widget.enabled ? _onFi4Changed : null,
            icon: Icons.eco,
          ),
        ],
        const SizedBox(height: 12),
        _buildDropdown(
          label: 'Tipo Conservación (FI5)',
          value: _selectedFi5,
          options: _fi5Options,
          loading: _loadingFi5,
          onChanged: widget.enabled ? _onFi5Changed : null,
          icon: Icons.ac_unit,
        ),
        if (hasActiveFilters) ...[
          const SizedBox(height: 16),
          Center(
            child: OutlinedButton.icon(
              onPressed: widget.enabled ? clearFilters : null,
              icon: const Icon(Icons.clear_all, size: 18),
              label: const Text('Limpiar todos los filtros'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.error,
              ),
            ),
          ),
        ],
      ],
    );
  }

  /// Build a single dropdown filter
  Widget _buildDropdown({
    required String label,
    required String? value,
    required List<FiOption> options,
    required bool loading,
    required void Function(String?)? onChanged,
    required IconData icon,
    bool enabled = true,
  }) {
    final isActive = value != null;
    final effectiveEnabled = enabled && !loading && widget.enabled;
    final hasOptions = options.isNotEmpty;
    
    // Colores consistentes con el diseño de la app
    Color getBorderColor() {
      if (!effectiveEnabled) return Colors.grey.shade700;
      if (isActive) return AppTheme.neonBlue;
      return Colors.grey.shade600;
    }
    
    Color getFillColor() {
      if (!effectiveEnabled) return AppTheme.surfaceColor.withOpacity(0.5);
      if (isActive) return AppTheme.neonBlue.withOpacity(0.15);
      return AppTheme.surfaceColor;
    }
    
    Color getIconColor() {
      if (!effectiveEnabled) return Colors.grey.shade600;
      if (isActive) return AppTheme.neonBlue;
      return AppTheme.textSecondary;
    }
    
    return SizedBox(
      height: 36,
      child: DropdownButtonFormField<String?>(
        value: value,
        decoration: InputDecoration(
          labelText: label,
          labelStyle: TextStyle(
            fontSize: 10,
            color: effectiveEnabled ? (isActive ? AppTheme.neonBlue : AppTheme.textSecondary) : Colors.grey.shade600,
            fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
          ),
          prefixIcon: loading
              ? SizedBox(
                  width: 20,
                  height: 20,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppTheme.neonBlue,
                    ),
                  ),
                )
              : Icon(
                  icon,
                  size: 16,
                  color: getIconColor(),
                ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
          isDense: true,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide(color: getBorderColor(), width: isActive ? 1.5 : 1),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide(color: getBorderColor(), width: isActive ? 1.5 : 1),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: AppTheme.neonBlue, width: 2),
          ),
          disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide(color: Colors.grey.shade700),
          ),
          filled: true,
          fillColor: getFillColor(),
        ),
        dropdownColor: AppTheme.surfaceColor,
        style: TextStyle(
          fontSize: 11,
          color: effectiveEnabled ? Colors.white : Colors.grey.shade500,
        ),
        icon: Icon(
          Icons.arrow_drop_down,
          color: effectiveEnabled ? (isActive ? AppTheme.neonBlue : Colors.white54) : Colors.grey.shade700,
        ),
        items: [
          DropdownMenuItem<String?>(
            value: null,
            child: Text(
              hasOptions ? 'Todos' : (loading ? 'Cargando...' : 'Sin opciones'),
              style: TextStyle(
                fontSize: 11,
                color: Colors.grey.shade400,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
          ...options.map((opt) => DropdownMenuItem<String?>(
            value: opt.code,
            child: Text(
              opt.displayName,
              style: const TextStyle(fontSize: 11),
              overflow: TextOverflow.ellipsis,
            ),
          )),
        ],
        onChanged: effectiveEnabled ? onChanged : null,
        isExpanded: true,
      ),
    );
  }
}

/// State holder for FI filter selections
class FiFilterState {
  final String? fi1;
  final String? fi2;
  final String? fi3;
  final String? fi4;
  final String? fi5;

  const FiFilterState({
    this.fi1,
    this.fi2,
    this.fi3,
    this.fi4,
    this.fi5,
  });

  bool get isEmpty => fi1 == null && fi2 == null && fi3 == null && fi4 == null && fi5 == null;
  bool get isNotEmpty => !isEmpty;

  Map<String, String> toQueryParams() {
    final params = <String, String>{};
    if (fi1 != null) params['fi1'] = fi1!;
    if (fi2 != null) params['fi2'] = fi2!;
    if (fi3 != null) params['fi3'] = fi3!;
    if (fi4 != null) params['fi4'] = fi4!;
    if (fi5 != null) params['fi5'] = fi5!;
    return params;
  }

  @override
  String toString() => 'FiFilterState(fi1: $fi1, fi2: $fi2, fi3: $fi3, fi4: $fi4, fi5: $fi5)';
}

/// Available options for FI filters
class FiFilterOptions {
  final List<FiOption> fi1;
  final List<FiOption> fi2;
  final List<FiOption> fi3;
  final List<FiOption> fi4;
  final List<FiOption> fi5;

  const FiFilterOptions({
    this.fi1 = const [],
    this.fi2 = const [],
    this.fi3 = const [],
    this.fi4 = const [],
    this.fi5 = const [],
  });

  factory FiFilterOptions.fromApiResponse(Map<String, dynamic> response) {
    return FiFilterOptions(
      fi1: _parseOptions(response['fi1']),
      fi2: _parseOptions(response['fi2']),
      fi3: _parseOptions(response['fi3']),
      fi4: _parseOptions(response['fi4']),
      fi5: _parseOptions(response['fi5']),
    );
  }

  static List<FiOption> _parseOptions(dynamic data) {
    if (data == null) return [];
    return (data as List).map((f) => FiOption.fromJson(f as Map<String, dynamic>)).toList();
  }
}

/// Single FI filter option
class FiOption {
  final String code;
  final String name;
  final int count;

  const FiOption({
    required this.code,
    required this.name,
    this.count = 0,
  });

  factory FiOption.fromJson(Map<String, dynamic> json) {
    return FiOption(
      code: json['code']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      count: json['count'] is int ? (json['count'] as int) : int.tryParse(json['count']?.toString() ?? '0') ?? 0,
    );
  }

  String get displayName => name.isNotEmpty ? name : code;

  @override
  String toString() => 'FiOption($code: $name)';
}
