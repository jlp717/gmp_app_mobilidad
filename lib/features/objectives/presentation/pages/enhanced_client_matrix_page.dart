import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/widgets/fi_filters_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/fullscreen_image_viewer.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';
import 'package:gmp_app_mobilidad/features/sales_history/presentation/widgets/sales_summary_header.dart';
import 'package:path_provider/path_provider.dart';

/// Enhanced Client Matrix Page v6 - Professional design, no overflow
class EnhancedClientMatrixPage extends StatefulWidget {
  const EnhancedClientMatrixPage({
    required this.clientCode,
    required this.clientName,
    super.key,
    this.isJefeVentas = false,
  });
  final String clientCode;
  final String clientName;
  final bool isJefeVentas;

  @override
  State<EnhancedClientMatrixPage> createState() =>
      _EnhancedClientMatrixPageState();
}

class _EnhancedClientMatrixPageState extends State<EnhancedClientMatrixPage> {
  bool _isLoading = true;
  String? _error;
  bool _showFilters = false;

  // Legacy familia/subfamilia hierarchy
  List<Map<String, dynamic>> _families = [];
  // 5-level FI hierarchy (FI1 > FI2 > FI3 > FI4 > productos)
  List<Map<String, dynamic>> _fiHierarchy = [];

  Map<String, dynamic> _grandTotal = {};
  Map<String, dynamic> _summary = {};
  Map<String, dynamic> _monthlyTotals = {};
  Map<String, dynamic> _availableFilters = {};

  // Client specific info
  Map<String, dynamic>? _editableNotes;
  Map<String, dynamic> _contactInfo = {};

  Set<int> _selectedYears = _defaultYears();
  Set<int> _selectedMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  // Pending filter state (only apply when user clicks Apply)
  final Set<int> _pendingYears = _defaultYears();
  Set<int> _pendingMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  bool _filtersDirty = false; // Track if filters changed
  String _productCodeSearch = '';
  String _productNameSearch = '';

  // FI hierarchical filters state
  FiFilterState _fiFilters = const FiFilterState();
  FiFilterOptions? _fiOptions;

  // Grouping depth: 0=sin grupos, 1=FI1 only (default), 2=FI1+FI2, 3=FI1+FI2+FI3, 4=FI1+FI2+FI3+FI4, 5=todos
  int _maxDepthLevel = 1;

  final _codeCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  Timer? _filterDebounce;
  int _loadGeneration = 0;

  // Expansion state for legacy hierarchy
  final Set<String> _expandedFamilies = {};
  final Set<String> _expandedSubfamilies = {};
  // Expansion state for FI hierarchy (keyed by level-code)
  final Set<String> _expandedFiNodes = {};
  // Progressive FI product loading: how many tiles each expanded family
  // shows (keyed by node), and the chunk size for the "Ver más" button.
  final Map<String, int> _fiProductsShown = {};
  static const int _fiProductChunk = 50;

  static const _mNames = [
    'ENE',
    'FEB',
    'MAR',
    'ABR',
    'MAY',
    'JUN',
    'JUL',
    'AGO',
    'SEP',
    'OCT',
    'NOV',
    'DIC',
  ];
  static List<int> get _years => ApiConfig.availableYears;
  static Set<int> _defaultYears() {
    final years = [...ApiConfig.availableYears]..sort((a, b) => b.compareTo(a));
    if (years.isEmpty) return {DateTime.now().year};
    return years.take(3).toSet();
  }

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _filterDebounce?.cancel();
    _codeCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  int get _startMonth => _selectedMonths.isEmpty
      ? 1
      : _selectedMonths.reduce((a, b) => a < b ? a : b);
  int get _endMonth => _selectedMonths.isEmpty
      ? 12
      : _selectedMonths.reduce((a, b) => a > b ? a : b);
  List<int> get _selectedYearsDesc {
    final years = _selectedYears.toList()..sort((a, b) => b.compareTo(a));
    return years;
  }

  String get _yearsParam => _selectedYears.isNotEmpty
      ? _selectedYearsDesc.join(',')
      : DateTime.now().year.toString();

  Future<void> _loadData() async {
    final generation = ++_loadGeneration;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await ApiClient.get(
        ApiConfig.clientMatrix,
        queryParameters: {
          'clientCode': widget.clientCode,
          'years': _yearsParam,
          'startMonth': _startMonth.toString(),
          'endMonth': _endMonth.toString(),
          if (_productCodeSearch.isNotEmpty) 'productCode': _productCodeSearch,
          if (_productNameSearch.isNotEmpty) 'productName': _productNameSearch,
          // NEW: FI hierarchical filters
          if (_fiFilters.fi1 != null) 'fi1': _fiFilters.fi1,
          if (_fiFilters.fi2 != null) 'fi2': _fiFilters.fi2,
          if (_fiFilters.fi3 != null) 'fi3': _fiFilters.fi3,
          if (_fiFilters.fi4 != null) 'fi4': _fiFilters.fi4,
          if (_fiFilters.fi5 != null) 'fi5': _fiFilters.fi5,
          'includeYoY': 'true',
        },
        cacheKey: [
          'client-matrix-advanced',
          widget.clientCode,
          _yearsParam,
          _startMonth,
          _endMonth,
          _productCodeSearch,
          _productNameSearch,
          _fiFilters.fi1 ?? '',
          _fiFilters.fi2 ?? '',
          _fiFilters.fi3 ?? '',
          _fiFilters.fi4 ?? '',
          _fiFilters.fi5 ?? '',
        ].join(':'),
        cacheTTL: CacheService.defaultTTL,
      );

      if (!mounted || generation != _loadGeneration) return;

      setState(() {
        // Legacy family/subfamily hierarchy
        final rawFamilies = response['families'] ?? [];
        _families = (rawFamilies as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();

        // NEW: 5-level FI hierarchy
        final rawFiHierarchy = response['fiHierarchy'] ?? [];
        _fiHierarchy = (rawFiHierarchy as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();

        _grandTotal = (response['grandTotal'] as Map<String, dynamic>?) ?? {};
        _summary = (response['summary'] as Map<String, dynamic>?) ?? {};
        _monthlyTotals =
            (response['monthlyTotals'] as Map<String, dynamic>?) ?? {};
        _availableFilters =
            (response['availableFilters'] as Map<String, dynamic>?) ?? {};
        _editableNotes = response['editableNotes'] as Map<String, dynamic>?;
        _contactInfo = (response['contactInfo'] as Map<String, dynamic>?) ?? {};

        // Parse FI options from availableFilters
        // Solo FI1 y FI5 precargadas, FI2/FI3/FI4 se cargan en cascada desde API
        _fiOptions = FiFilterOptions(
          fi1: _parseFiOptions(_availableFilters['fi1']),
          fi2: [], // Se cargan dinámicamente al seleccionar FI1
          fi3: [], // Se cargan dinámicamente al seleccionar FI1/FI2
          fi4: [], // Se cargan dinámicamente al seleccionar FI1/FI2/FI3
          fi5: _parseFiOptions(_availableFilters['fi5']),
        );

        _isLoading = false;

        // Auto-expand first item if only one
        if (_fiHierarchy.length == 1) {
          _expandedFiNodes
              .add('fi1_${(_fiHierarchy.first['fi1Code'] as String?) ?? ''}');
        }
        if (_families.length == 1) {
          _expandedFamilies
              .add((_families.first['familyCode'] as String?) ?? '');
        }
      });
    } catch (e) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Widget _buildFlatProductsList() {
    final products = _collectFlatProductsForCurrentFilters()
      ..sort((a, b) {
        final aSales = (a['totalSales'] as num?)?.toDouble() ?? 0;
        final bSales = (b['totalSales'] as num?)?.toDouble() ?? 0;
        return bSales.compareTo(aSales);
      });

    if (products.isEmpty) {
      return Center(
        child: Text(
          'No hay productos',
          style: TextStyle(color: AppTheme.textTertiary),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(4),
      itemCount: products.length,
      itemBuilder: (context, index) => _buildFiProduct(products[index]),
    );
  }

  List<Map<String, dynamic>> _collectFlatProductsForCurrentFilters() {
    final fiProducts = _fiHierarchy
        .expand(_collectAllProducts)
        .map(Map<String, dynamic>.from)
        .toList();

    if (fiProducts.isNotEmpty) {
      return fiProducts;
    }

    return _families.expand(_collectLegacyFamilyProducts).toList();
  }

  List<Map<String, dynamic>> _collectLegacyFamilyProducts(
    Map<String, dynamic> family,
  ) {
    final results = <Map<String, dynamic>>[];
    final subfamilies = family['subfamilies'] as List?;
    if (subfamilies == null) return results;

    for (final subfamily in subfamilies) {
      if (subfamily is! Map) continue;

      final products = subfamily['products'] as List?;
      if (products == null) continue;

      for (final product in products) {
        if (product is! Map) continue;
        results.add(Map<String, dynamic>.from(product));
      }
    }

    return results;
  }

  /// Parse FI options from API response
  List<FiOption> _parseFiOptions(dynamic data) {
    if (data == null) return [];
    try {
      return (data as List).map((item) {
        if (item is Map<String, dynamic>) {
          return FiOption.fromJson(item);
        } else if (item is Map) {
          return FiOption.fromJson(Map<String, dynamic>.from(item));
        }
        return FiOption(code: item.toString(), name: item.toString());
      }).toList();
    } catch (e) {
      debugPrint('Error parsing FI options: $e');
      return [];
    }
  }

  String _formatCurrency(double value) {
    // Always show full number with proper formatting (2.900 € not 2.9K)
    return CurrencyFormatter.format(value);
  }

  void _scheduleFilterLoad() {
    _filterDebounce?.cancel();
    _filterDebounce = Timer(const Duration(milliseconds: 250), _applyFilters);
  }

  void _applyFilters() {
    _filterDebounce?.cancel();
    if (!mounted) return;
    setState(() {
      _selectedYears = Set.from(_pendingYears);
      _selectedMonths = Set.from(_pendingMonths);
      _productCodeSearch = _codeCtrl.text.trim();
      _productNameSearch = _nameCtrl.text.trim();
      _filtersDirty = false;
    });
    unawaited(_loadData());
  }

  Future<void> _openNotesDialog() async {
    final currentNotes = _editableNotes?['text'] as String? ?? '';
    final ctrl = TextEditingController(text: currentNotes);

    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        title: const Text('Observaciones Cliente'),
        content: TextField(
          controller: ctrl,
          maxLines: 5,
          decoration: const InputDecoration(
            hintText: 'Escribe aquí las observaciones...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'Cancelar',
              style: TextStyle(color: AppTheme.textTertiary),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text),
            style:
                ElevatedButton.styleFrom(backgroundColor: AppTheme.accentRose),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );

    if (result != null && result != currentNotes) {
      await _saveNotes(result);
    }
  }

  Future<void> _saveNotes(String notes) async {
    // Show saving indicator? Or just optimistically update.
    // Let's reload data after save to be sure and show loading.
    setState(() => _isLoading = true);

    try {
      await ApiClient.put(
        '${ApiConfig.clientsList}/notes',
        data: {
          'clientCode': widget.clientCode,
          'notes': notes,
        },
      );
      await CacheService.invalidateByPrefix(
        'client-matrix-advanced:${widget.clientCode}:',
      );

      // Reload to reflect changes (and get modifiedBy info correct)
      await _loadData();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Observaciones guardadas correctaemnte'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false); // Stop loading if error
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error guardando notas: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        backgroundColor: AppTheme.raisedSurface,
        elevation: 0,
        toolbarHeight: 50,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${widget.clientCode} - ${widget.clientName}',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              'Historial de Compras',
              style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
            ),
          ],
        ),
        actions: [
          if (!_isLoading && _error == null)
            IconButton(
              icon: Icon(
                _editableNotes != null &&
                        (_editableNotes!['text'] as String).isNotEmpty
                    ? Icons.edit_note
                    : Icons.note_add,
                color: _editableNotes != null &&
                        (_editableNotes!['text'] as String).isNotEmpty
                    ? AppTheme.warning
                    : AppTheme.textPrimary,
              ),
              onPressed: _openNotesDialog,
              tooltip: 'Observaciones',
            ),
          IconButton(
            icon: Icon(
              _showFilters ? Icons.filter_list_off : Icons.filter_list,
              size: 20,
            ),
            onPressed: () => setState(() => _showFilters = !_showFilters),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, size: 20),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: ModernLoading(message: 'Cargando matriz...'))
          : _error != null
              ? _buildError()
              : SafeArea(
                  child: Column(
                    children: [
                      if (_editableNotes != null &&
                          (_editableNotes!['text'] as String).isNotEmpty)
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppTheme.warning.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: AppTheme.warning.withValues(alpha: 0.5),
                            ),
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.warning_amber_rounded,
                                color: AppTheme.warning,
                                size: 20,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  _editableNotes!['text'] as String,
                                  style: TextStyle(
                                    color: AppTheme.textPrimary,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      // KPI alerts
                      ClientAlertsWidget(clientId: widget.clientCode),
                      if (_showFilters) _buildFilters(),
                      _buildSummaryRow(),
                      _buildComparisonOverview(),
                      _buildMonthlyRow(),
                      _buildGroupingBar(),
                      // Solo jerarquía FI de 5 niveles
                      Expanded(
                        child: _maxDepthLevel == 0
                            ? _buildFlatProductsList()
                            : (_fiHierarchy.isEmpty
                                ? Center(
                                    child: Text(
                                      'Sin datos',
                                      style: TextStyle(
                                        color: AppTheme.textTertiary,
                                      ),
                                    ),
                                  )
                                : _buildFiHierarchyList()),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildFilters() {
    return Container(
      constraints: const BoxConstraints(
        maxHeight: 340,
      ), // Increased for all 5 FI filters
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.3)),
        ),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Years Row
            Row(
              children: [
                const Text(
                  'Años: ',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
                ),
                ...List.generate(
                  _years.length,
                  (i) => Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: ChoiceChip(
                      label: Text(
                        '${_years[i]}',
                        style: const TextStyle(fontSize: 10),
                      ),
                      selected: _pendingYears.contains(_years[i]),
                      onSelected: (s) {
                        setState(() {
                          if (s) {
                            _pendingYears.add(_years[i]);
                          } else if (_pendingYears.length > 1) {
                            _pendingYears.remove(_years[i]);
                          }
                          _filtersDirty = true;
                        });
                        _scheduleFilterLoad();
                      },
                      visualDensity: VisualDensity.compact,
                      padding: EdgeInsets.zero,
                      labelPadding: const EdgeInsets.symmetric(horizontal: 6),
                      selectedColor: AppTheme.info.withValues(alpha: 0.3),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            // Months Row with All/None buttons
            Row(
              children: [
                const Text(
                  'Meses: ',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
                ),
                GestureDetector(
                  onTap: () {
                    setState(() {
                      _pendingMonths = {
                        1,
                        2,
                        3,
                        4,
                        5,
                        6,
                        7,
                        8,
                        9,
                        10,
                        11,
                        12,
                      };
                      _filtersDirty = true;
                    });
                    _scheduleFilterLoad();
                  },
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.info.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text('Todos', style: TextStyle(fontSize: 9)),
                  ),
                ),
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: () {
                    setState(() {
                      _pendingMonths = {DateTime.now().month};
                      _filtersDirty = true;
                    });
                    _scheduleFilterLoad();
                  }, // Keep at least current month
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.error.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text('Ninguno', style: TextStyle(fontSize: 9)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SizedBox(
                    height: 26,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: List.generate(
                        12,
                        (i) => Padding(
                          padding: const EdgeInsets.only(right: 3),
                          child: ChoiceChip(
                            label: Text(
                              _mNames[i],
                              style: const TextStyle(fontSize: 8),
                            ),
                            selected: _pendingMonths.contains(i + 1),
                            onSelected: (s) {
                              setState(() {
                                if (s) {
                                  _pendingMonths.add(i + 1);
                                } else if (_pendingMonths.length > 1) {
                                  _pendingMonths.remove(i + 1);
                                }
                                _filtersDirty = true;
                              });
                              _scheduleFilterLoad();
                            },
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            labelPadding:
                                const EdgeInsets.symmetric(horizontal: 3),
                            selectedColor:
                                AppTheme.accentIndigo.withValues(alpha: 0.3),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            // Search fields row
            Row(
              children: [
                Expanded(
                  child: _buildTextField(_codeCtrl, 'Código', (v) {
                    setState(() {
                      _productCodeSearch = v.trim();
                      _filtersDirty = true;
                    });
                    _scheduleFilterLoad();
                  }),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: _buildTextField(_nameCtrl, 'Descripción', (v) {
                    setState(() {
                      _productNameSearch = v.trim();
                      _filtersDirty = true;
                    });
                    _scheduleFilterLoad();
                  }),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // NEW: FI Hierarchical Filters (replaces Familia/Subfamilia)
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.inkSurface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(
                        Icons.filter_alt,
                        size: 14,
                        color: AppTheme.info,
                      ),
                      SizedBox(width: 4),
                      Text(
                        'Filtros de Producto',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  FiFiltersWidget(
                    showAdvanced: true, // Show all 5 FI levels
                    initialFilters: _fiFilters,
                    availableOptions: _fiOptions,
                    onFiltersChanged: (newFilters) {
                      setState(() {
                        _fiFilters = newFilters;
                        _filtersDirty = true;
                      });
                      _scheduleFilterLoad();
                    },
                  ),
                ],
              ),
            ),

            const SizedBox(height: 8),
            // APPLY BUTTON
            Center(
              child: ElevatedButton.icon(
                onPressed: _filtersDirty ? _applyFilters : null,
                icon: const Icon(Icons.check, size: 16),
                label: Text(
                  _filtersDirty ? 'Aplicar Filtros' : 'Filtros Aplicados',
                  style: const TextStyle(fontSize: 11),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor:
                      _filtersDirty ? AppTheme.info : AppTheme.textTertiary,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField(
    TextEditingController ctrl,
    String hint,
    Function(String) onSubmit,
  ) {
    return SizedBox(
      height: 32,
      child: Focus(
        onFocusChange: (hasFocus) {
          if (!hasFocus && ctrl.text.isNotEmpty) {
            onSubmit(ctrl.text);
          }
        },
        child: TextField(
          controller: ctrl,
          style: const TextStyle(fontSize: 11),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(fontSize: 10),
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            isDense: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(6)),
            suffixIcon: ctrl.text.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear, size: 14),
                    onPressed: () {
                      ctrl.clear();
                      onSubmit('');
                    },
                    padding: EdgeInsets.zero,
                  )
                : null,
          ),
          onChanged: onSubmit,
          onSubmitted: onSubmit,
        ),
      ),
    );
  }

  Widget _buildDropdown(
    String label,
    String? value,
    List<Map<String, dynamic>> options,
    Function(String?) onChange,
  ) {
    return SizedBox(
      height: 32,
      child: DropdownButtonFormField<String?>(
        initialValue: value,
        decoration: InputDecoration(
          hintText: label,
          hintStyle: const TextStyle(fontSize: 10),
          contentPadding: const EdgeInsets.symmetric(horizontal: 8),
          isDense: true,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(6)),
        ),
        style: const TextStyle(fontSize: 10),
        items: [
          const DropdownMenuItem(
            child: Text('Todas', style: TextStyle(fontSize: 10)),
          ),
          ...options.map(
            (o) => DropdownMenuItem(
              value: o['code'] as String,
              child: Text(
                o['name'] as String,
                style: const TextStyle(fontSize: 10),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ],
        onChanged: onChange,
      ),
    );
  }

  Map<String, dynamic> _mapFrom(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) {
      return value.map((key, value) => MapEntry(key.toString(), value));
    }
    return {};
  }

  Map<String, dynamic> _yearData(dynamic byYear, int year) {
    final yearMap = _mapFrom(byYear);
    return _mapFrom(yearMap[year.toString()]);
  }

  double _numValue(Map<String, dynamic> data, String key) =>
      (data[key] as num?)?.toDouble() ?? 0;

  String _formatUnits(double value) {
    if (value.abs() >= 100 || value == value.roundToDouble()) {
      return value.toStringAsFixed(0);
    }
    return value.toStringAsFixed(2);
  }

  Widget _buildSummaryRow() {
    final byYear = _mapFrom(_summary['byYear']);
    if (byYear.isEmpty) {
      return SalesSummaryHeader(
        summary: _summary,
        showMargin: widget.isJefeVentas,
        isJefeVentas: widget.isJefeVentas,
      );
    }

    final height = widget.isJefeVentas ? 96.0 : 82.0;
    return Container(
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.25)),
        ),
      ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _selectedYearsDesc.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final year = _selectedYearsDesc[index];
          final data = _yearData(byYear, year);
          final sales = _numValue(data, 'sales');
          final units = _numValue(data, 'units');
          final products = (data['productCount'] as num?)?.toInt() ?? 0;
          final margin = _numValue(data, 'margin');
          final marginPercent = _numValue(data, 'marginPercent');

          return Container(
            width: widget.isJefeVentas ? 178 : 150,
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.raisedSurface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: AppTheme.info.withValues(alpha: 0.25),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      '$year',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.info,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '$products prod.',
                      style: TextStyle(
                        fontSize: 8,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  _formatCurrency(sales),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  '${_formatUnits(units)} uds',
                  style: TextStyle(
                    fontSize: 9,
                    color: AppTheme.textSecondary,
                  ),
                ),
                if (widget.isJefeVentas) ...[
                  const SizedBox(height: 3),
                  Text(
                    '${_formatCurrency(margin)} (${marginPercent.toStringAsFixed(1)}%)',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      color: marginPercent >= 0
                          ? AppTheme.success
                          : AppTheme.error,
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _summaryItem(String value, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          Text(
            label,
            style: TextStyle(fontSize: 8, color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _productStat(
    String label,
    String value,
    Color color, {
    bool isBold = false,
  }) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: isBold ? 12 : 10,
            fontWeight: isBold ? FontWeight.bold : FontWeight.w500,
            color: color,
          ),
        ),
        Text(
          label,
          style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
        ),
      ],
    );
  }

  Map<String, dynamic> _comparisonFrom(dynamic source) {
    if (source is! Map) return const <String, dynamic>{};
    final raw = source['comparison'];
    if (raw is! Map) return const <String, dynamic>{};
    return Map<String, dynamic>.from(raw);
  }

  List<Map<String, dynamic>> _comparisonEntries(
    Map<String, dynamic> comparison,
  ) {
    final raw = comparison['comparisons'];
    if (raw is! List) return const <Map<String, dynamic>>[];
    return raw.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  Color _comparisonColorFromName(String? color, {Color? fallback}) {
    switch ((color ?? '').toLowerCase()) {
      case 'green':
        return AppTheme.success;
      case 'red':
        return AppTheme.error;
      case 'blue':
        return AppTheme.info;
      default:
        return fallback ?? AppTheme.info;
    }
  }

  IconData _comparisonIcon(String? trend) {
    switch ((trend ?? '').toLowerCase()) {
      case 'up':
        return Icons.trending_up;
      case 'down':
      case 'lost':
        return Icons.trending_down;
      case 'new':
        return Icons.auto_awesome;
      case 'flat':
      case 'no-data':
      default:
        return Icons.horizontal_rule;
    }
  }

  Widget _buildComparisonChip(
    Map<String, dynamic> entry, {
    bool compact = false,
  }) {
    final year = entry['year']?.toString() ?? '—';
    final label = entry['label']?.toString() ?? '—';
    final color = _comparisonColorFromName(entry['color']?.toString());
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 5 : 8,
        vertical: compact ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _comparisonIcon(entry['trend']?.toString()),
            size: compact ? 9 : 12,
            color: color,
          ),
          SizedBox(width: compact ? 2 : 4),
          Text(
            'vs $year $label',
            style: TextStyle(
              fontSize: compact ? 7 : 9,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildComparisonStrip(
    Map<String, dynamic> row, {
    bool compact = false,
  }) {
    final comparison = _comparisonFrom(row);
    final entries = _comparisonEntries(comparison).take(2).toList();
    if (entries.isEmpty) return const SizedBox.shrink();
    return Wrap(
      alignment: WrapAlignment.end,
      spacing: compact ? 3 : 5,
      runSpacing: compact ? 2 : 4,
      children: [
        for (final entry in entries)
          _buildComparisonChip(entry, compact: compact),
      ],
    );
  }

  Widget _buildComparisonBadge(
    Map<String, dynamic> row, {
    bool compact = false,
  }) {
    final comparison = _comparisonFrom(row);
    if (comparison.isEmpty) return const SizedBox.shrink();
    final label = comparison['label']?.toString() ?? '—';
    final color = _comparisonColorFromName(comparison['color']?.toString());
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 5 : 7,
        vertical: compact ? 2 : 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _comparisonIcon(comparison['trend']?.toString()),
            size: compact ? 9 : 12,
            color: color,
          ),
          SizedBox(width: compact ? 2 : 4),
          Text(
            label,
            style: TextStyle(
              fontSize: compact ? 7 : 9,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildComparisonOverview() {
    final source =
        _comparisonFrom(_summary).isNotEmpty ? _summary : _grandTotal;
    final comparison = _comparisonFrom(source);
    if (comparison.isEmpty) return const SizedBox.shrink();

    final referenceYear = comparison['referenceYear']?.toString() ?? '—';
    final referenceValue = (comparison['referenceValue'] as num?)?.toDouble() ??
        _numValue(
          _yearData(_mapFrom(source['byYear']), _selectedYearsDesc.first),
          'sales',
        );

    return Container(
      margin: const EdgeInsets.fromLTRB(8, 4, 8, 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.info.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Referencia $referenceYear',
                  style: TextStyle(
                    fontSize: 9,
                    color: AppTheme.textSecondary,
                  ),
                ),
                Text(
                  _formatCurrency(referenceValue),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppTheme.info,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(child: _buildComparisonStrip(source, compact: false)),
        ],
      ),
    );
  }

  Widget _buildMonthlyRow() {
    final years = _selectedYearsDesc;
    final height = 38.0 + (years.length * 18.0);

    return Container(
      height: height,
      padding: const EdgeInsets.only(bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface,
        border: Border(bottom: BorderSide(color: AppTheme.info, width: 2)),
        boxShadow: [
          BoxShadow(
            color: AppTheme.textPrimary.withValues(alpha: 0.26),
            blurRadius: 4,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        itemCount: 12,
        itemBuilder: (c, i) {
          final m = i + 1;
          if (!_selectedMonths.contains(m)) return const SizedBox.shrink();

          final data = _monthlyTotals[m.toString()];
          final byYear = _mapFrom(data?['byYear']);
          final sales = (data?['sales'] as num?)?.toDouble() ?? 0;
          final yoyTrend = data?['yoyTrend'] as String?;

          // Check if client is NEW (no sales in entire previous year)
          final isClientNew = _summary['isNewClient'] == true;
          final prevSales = (data?['prevSales'] as num?)?.toDouble() ?? 0;
          final prevIsZero = prevSales.abs() < 0.01;
          final currIsZero = sales.abs() < 0.01;

          var borderColor = AppTheme.borderColor.withValues(alpha: 0.3);
          var bgColor = AppTheme.raisedSurface;
          var showNewBadge = false;

          if (isClientNew && !currIsZero) {
            borderColor = AppTheme.info; // Distinct Blue
            bgColor = AppTheme.info.withValues(alpha: 0.20);
            showNewBadge = true;
          } else if (currIsZero && !prevIsZero) {
            borderColor = AppTheme.error;
            bgColor = AppTheme.error.withValues(alpha: 0.15);
          } else if (!currIsZero && prevIsZero) {
            // New month sales
            borderColor = AppTheme.info; // Distinct Blue
            bgColor = AppTheme.info.withValues(alpha: 0.20);
            showNewBadge = true;
          } else if (yoyTrend == 'up') {
            borderColor = AppTheme.success;
            bgColor = AppTheme.success.withValues(alpha: 0.15);
          } else if (yoyTrend == 'down') {
            borderColor = AppTheme.error;
            bgColor = AppTheme.error.withValues(alpha: 0.15);
          }

          return Container(
            width: years.length == 1 ? 76 : 96,
            margin: const EdgeInsets.only(right: 3),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: borderColor, width: 1.5),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      _mNames[m - 1].toUpperCase(),
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const Spacer(),
                    if (showNewBadge)
                      const Text(
                        'NUEVO',
                        style: TextStyle(
                          fontSize: 7,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.info,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                ...years.map((year) {
                  final yData = _yearData(byYear, year);
                  final ySales = _numValue(yData, 'sales');
                  final yUnits = _numValue(yData, 'units');
                  final rowColor = ySales.abs() < 0.01
                      ? AppTheme.textSecondary
                      : AppTheme.textPrimary;

                  return Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        '$year ${_formatCompact(ySales)} EUR / ${_formatUnits(yUnits)}u',
                        style: TextStyle(
                          fontSize: 8,
                          fontWeight: FontWeight.w600,
                          color: rowColor,
                        ),
                      ),
                    ),
                  );
                }),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, size: 40, color: AppTheme.error),
          const SizedBox(height: 8),
          ElevatedButton(onPressed: _loadData, child: const Text('Reintentar')),
        ],
      ),
    );
  }

  // ===== FI HIERARCHY WIDGETS (5 niveles) =====

  /// Recursively collects all products from any node in the FI hierarchy.
  List<Map<String, dynamic>> _collectAllProducts(Map<String, dynamic> node) {
    final results = <Map<String, dynamic>>[];
    final products = node['products'] as List?;
    if (products != null) {
      for (final product in products) {
        if (product is! Map) continue;
        results.add(Map<String, dynamic>.from(product));
      }
    }
    final children = node['children'] as List?;
    if (children != null) {
      for (final child in children) {
        if (child is! Map) continue;
        results.addAll(_collectAllProducts(Map<String, dynamic>.from(child)));
      }
    }
    return results;
  }

  /// Renders product tiles from all products in a node's subtree, loading
  /// them progressively: rendering hundreds of `Column` tiles at once (inside
  /// a ListView.builder item) froze the frame when a big family expanded.
  Widget _buildFlatProductsFromNode(Map<String, dynamic> node) {
    final allProducts = _collectAllProducts(node);
    if (allProducts.isEmpty) {
      return Padding(
        padding: EdgeInsets.all(8),
        child: Text(
          'Sin productos',
          style: TextStyle(color: AppTheme.textTertiary, fontSize: 11),
        ),
      );
    }
    final nodeKey = 'fiprods_${node['code'] ?? node['name'] ?? ''}';
    final shown = _fiProductsShown[nodeKey] ?? _fiProductChunk;
    final visible = allProducts.take(shown).toList();
    final hasMore = shown < allProducts.length;
    return Column(
      children: [
        ...visible.map(_buildFiProduct),
        if (hasMore)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: TextButton.icon(
              onPressed: () => setState(
                () => _fiProductsShown[nodeKey] = shown + _fiProductChunk,
              ),
              icon: const Icon(Icons.expand_more, size: 16),
              label: Text(
                'Ver más (${allProducts.length - shown} restantes)',
                style: const TextStyle(fontSize: 11),
              ),
            ),
          ),
      ],
    );
  }

  /// Always-visible grouping level bar – chip per depth level.
  Widget _buildGroupingBar() {
    const labels = [
      'Sin grupos',
      'FI1',
      'FI1+2',
      'FI1+2+3',
      'FI1+2+3+4',
      'Todos',
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.borderColor.withValues(alpha: 0.25),
          ),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            Text(
              'Grupos: ',
              style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
            ),
            const SizedBox(width: 4),
            ...List.generate(labels.length, (depth) {
              return Padding(
                padding: const EdgeInsets.only(right: 4),
                child: ChoiceChip(
                  label:
                      Text(labels[depth], style: const TextStyle(fontSize: 9)),
                  selected: _maxDepthLevel == depth,
                  onSelected: (_) {
                    setState(() => _maxDepthLevel = depth);
                  },
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  labelPadding: const EdgeInsets.symmetric(horizontal: 6),
                  selectedColor: AppTheme.info.withValues(alpha: 0.3),
                  checkmarkColor: AppTheme.info,
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildFiHierarchyList() {
    return ListView.builder(
      padding: const EdgeInsets.all(4),
      itemCount: _fiHierarchy.length,
      itemBuilder: (c, i) => _buildFi1Card(_fiHierarchy[i]),
    );
  }

  Widget _buildFi1Card(Map<String, dynamic> fi1) {
    final code = fi1['code'] as String? ?? '';
    final name = fi1['name'] as String? ?? code;
    final nodeKey = 'fi1_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final children = List<Map<String, dynamic>>.from(
      (fi1['children'] as List?)
              ?.map((e) => Map<String, dynamic>.from(e as Map))
              .toList() ??
          [],
    );
    final monthlyData = fi1['monthlyData'] as Map<String, dynamic>?;
    final childCount = (fi1['childCount'] as num?)?.toInt() ?? children.length;

    // Always expandable if has children; depth level controls what is shown when expanded
    final canExpand = children.isNotEmpty;

    return Card(
      color: AppTheme.accentIndigo.withValues(alpha: 0.08),
      margin: const EdgeInsets.only(bottom: 4),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: AppTheme.accentIndigo.withValues(alpha: 0.4),
          width: 2,
        ),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: canExpand
                ? () => setState(() {
                      if (expanded) {
                        _expandedFiNodes.remove(nodeKey);
                      } else {
                        _expandedFiNodes.add(nodeKey);
                      }
                    })
                : null,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                children: [
                  Row(
                    children: [
                      // Expand icon
                      if (canExpand)
                        Icon(
                          expanded
                              ? Icons.keyboard_arrow_down
                              : Icons.keyboard_arrow_right,
                          color: AppTheme.accentIndigo,
                          size: 20,
                        )
                      else
                        const SizedBox(width: 20),
                      const SizedBox(width: 6),
                      // Level badge
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.accentIndigo.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'FI1',
                          style: TextStyle(
                            fontSize: 8,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.accentIndigo,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Name - "Código - Descripción"
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '$childCount subcategorías',
                              style: TextStyle(
                                fontSize: 9,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Stats with YoY
                      _buildLevelStatsByYear(fi1, AppTheme.accentIndigo),
                    ],
                  ),
                  // Monthly breakdown if enabled
                  if (monthlyData != null)
                    _buildMonthlyBreakdownRow(monthlyData),
                ],
              ),
            ),
          ),
          if (expanded && canExpand)
            Padding(
              padding: const EdgeInsets.only(left: 12, bottom: 4),
              child: _maxDepthLevel <= 1
                  ? _buildFlatProductsFromNode(fi1)
                  : Column(
                      children: children
                          .map((fi2) => _buildFi2Card(fi2, code))
                          .toList(),
                    ),
            ),
        ],
      ),
    );
  }

  Widget _buildFi2Card(Map<String, dynamic> fi2, String parentCode) {
    final code = fi2['code'] as String? ?? '';
    final name = fi2['name'] as String? ?? code;
    final nodeKey = 'fi2_${parentCode}_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final children = List<Map<String, dynamic>>.from(
      (fi2['children'] as List?)
              ?.map((e) => Map<String, dynamic>.from(e as Map))
              .toList() ??
          [],
    );
    final monthlyData = fi2['monthlyData'] as Map<String, dynamic>?;
    final childCount = (fi2['childCount'] as num?)?.toInt() ?? children.length;

    final canExpand = children.isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(right: 4, bottom: 4),
      decoration: BoxDecoration(
        color: AppTheme.info.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(6),
        border:
            Border.all(color: AppTheme.info.withValues(alpha: 0.4), width: 1.5),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: canExpand
                ? () => setState(() {
                      if (expanded) {
                        _expandedFiNodes.remove(nodeKey);
                      } else {
                        _expandedFiNodes.add(nodeKey);
                      }
                    })
                : null,
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                children: [
                  Row(
                    children: [
                      if (canExpand)
                        Icon(
                          expanded
                              ? Icons.keyboard_arrow_down
                              : Icons.keyboard_arrow_right,
                          color: AppTheme.info,
                          size: 18,
                        )
                      else
                        const SizedBox(width: 18),
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.info.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(3),
                        ),
                        child: const Text(
                          'FI2',
                          style: TextStyle(
                            fontSize: 7,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.info,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '$childCount grupos',
                              style: TextStyle(
                                fontSize: 8,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      _buildLevelStatsByYear(
                        fi2,
                        AppTheme.info,
                        compact: true,
                      ),
                    ],
                  ),
                  if (monthlyData != null)
                    _buildMonthlyBreakdownRow(monthlyData, compact: true),
                ],
              ),
            ),
          ),
          if (expanded && canExpand)
            Padding(
              padding: const EdgeInsets.only(left: 12, bottom: 4),
              child: _maxDepthLevel <= 2
                  ? _buildFlatProductsFromNode(fi2)
                  : Column(
                      children: children
                          .map((fi3) => _buildFi3Card(fi3, nodeKey))
                          .toList(),
                    ),
            ),
        ],
      ),
    );
  }

  Widget _buildFi3Card(Map<String, dynamic> fi3, String parentKey) {
    final code = fi3['code'] as String? ?? '';
    final name = fi3['name'] as String? ?? code;
    final nodeKey = 'fi3_${parentKey}_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final children = List<Map<String, dynamic>>.from(
      (fi3['children'] as List?)
              ?.map((e) => Map<String, dynamic>.from(e as Map))
              .toList() ??
          [],
    );
    final monthlyData = fi3['monthlyData'] as Map<String, dynamic>?;
    final childCount = (fi3['childCount'] as num?)?.toInt() ?? children.length;

    final canExpand = children.isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.success.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: AppTheme.success.withValues(alpha: 0.35)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: canExpand
                ? () => setState(() {
                      if (expanded) {
                        _expandedFiNodes.remove(nodeKey);
                      } else {
                        _expandedFiNodes.add(nodeKey);
                      }
                    })
                : null,
            child: Padding(
              padding: const EdgeInsets.all(7),
              child: Column(
                children: [
                  Row(
                    children: [
                      if (canExpand)
                        Icon(
                          expanded
                              ? Icons.keyboard_arrow_down
                              : Icons.keyboard_arrow_right,
                          color: AppTheme.success,
                          size: 16,
                        )
                      else
                        const SizedBox(width: 16),
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.success.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(3),
                        ),
                        child: const Text(
                          'FI3',
                          style: TextStyle(
                            fontSize: 6,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.success,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '$childCount líneas',
                              style: TextStyle(
                                fontSize: 7,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      _buildLevelStatsByYear(
                        fi3,
                        AppTheme.success,
                        compact: true,
                      ),
                    ],
                  ),
                  if (monthlyData != null)
                    _buildMonthlyBreakdownRow(monthlyData, compact: true),
                ],
              ),
            ),
          ),
          if (expanded && canExpand)
            Padding(
              padding: const EdgeInsets.only(left: 12, bottom: 4),
              child: _maxDepthLevel <= 3
                  ? _buildFlatProductsFromNode(fi3)
                  : Column(
                      children: children
                          .map((fi4) => _buildFi4Card(fi4, nodeKey))
                          .toList(),
                    ),
            ),
        ],
      ),
    );
  }

  Widget _buildFi4Card(Map<String, dynamic> fi4, String parentKey) {
    final code = fi4['code'] as String? ?? '';
    final name = fi4['name'] as String? ?? code;
    final nodeKey = 'fi4_${parentKey}_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final products = List<Map<String, dynamic>>.from(
      (fi4['products'] as List?)
              ?.map((e) => Map<String, dynamic>.from(e as Map))
              .toList() ??
          [],
    );
    final monthlyData = fi4['monthlyData'] as Map<String, dynamic>?;
    final productCount =
        (fi4['productCount'] as num?)?.toInt() ?? products.length;

    final canExpand = products.isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.35)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: canExpand
                ? () => setState(() {
                      if (expanded) {
                        _expandedFiNodes.remove(nodeKey);
                      } else {
                        _expandedFiNodes.add(nodeKey);
                      }
                    })
                : null,
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: Column(
                children: [
                  Row(
                    children: [
                      if (canExpand)
                        Icon(
                          expanded
                              ? Icons.keyboard_arrow_down
                              : Icons.keyboard_arrow_right,
                          color: AppTheme.warning,
                          size: 14,
                        )
                      else
                        const SizedBox(width: 14),
                      const SizedBox(width: 3),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.warning.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(3),
                        ),
                        child: const Text(
                          'FI4',
                          style: TextStyle(
                            fontSize: 6,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.warning,
                          ),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '$productCount productos',
                              style: TextStyle(
                                fontSize: 7,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      _buildLevelStatsByYear(
                        fi4,
                        AppTheme.warning,
                        compact: true,
                      ),
                    ],
                  ),
                  if (monthlyData != null)
                    _buildMonthlyBreakdownRow(monthlyData, compact: true),
                ],
              ),
            ),
          ),
          if (expanded && canExpand)
            Padding(
              padding: const EdgeInsets.only(left: 8, right: 4, bottom: 4),
              child: Column(
                children: products.map(_buildFiProduct).toList(),
              ),
            ),
        ],
      ),
    );
  }

  /// Helper widget to show level aggregated stats
  Widget _buildLevelStats(
    double sales,
    double units,
    double margin,
    Color color, {
    bool compact = false,
  }) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              _formatCurrency(sales),
              style: TextStyle(
                fontSize: compact ? 10 : 12,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            Text(
              '${units.toStringAsFixed(0)} uds',
              style: TextStyle(
                fontSize: compact ? 7 : 9,
                color: AppTheme.textSecondary,
              ),
            ),
          ],
        ),
        if (widget.isJefeVentas) ...[
          const SizedBox(width: 8),
          Container(
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 4 : 6,
              vertical: compact ? 2 : 3,
            ),
            decoration: BoxDecoration(
              color: margin >= 0
                  ? AppTheme.success.withValues(alpha: 0.15)
                  : AppTheme.error.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              '${margin.toStringAsFixed(1)}%',
              style: TextStyle(
                fontSize: compact ? 9 : 10,
                fontWeight: FontWeight.bold,
                color: margin >= 0 ? AppTheme.success : AppTheme.error,
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildLevelStatsByYear(
    Map<String, dynamic> node,
    Color color, {
    bool compact = false,
  }) {
    final byYear = _mapFrom(node['byYear']);
    final comparison = _comparisonFrom(node);
    final fallbackYear = _selectedYearsDesc.isNotEmpty
        ? _selectedYearsDesc.first
        : DateTime.now().year;
    final referenceYear = (comparison['referenceYear'] as num?)?.toInt() ??
        int.tryParse(comparison['referenceYear']?.toString() ?? '') ??
        fallbackYear;
    final referenceData = _yearData(byYear, referenceYear);
    final referenceValue = (comparison['referenceValue'] as num?)?.toDouble() ??
        _numValue(referenceData, 'sales');
    final units = _numValue(referenceData, 'units');
    final margin = _numValue(referenceData, 'margin');
    final marginPercent = _numValue(referenceData, 'marginPercent');
    final comparisonColor = _comparisonColorFromName(
      comparison['color']?.toString(),
      fallback: color,
    );
    final width = widget.isJefeVentas
        ? (compact ? 150.0 : 178.0)
        : (compact ? 118.0 : 138.0);

    return SizedBox(
      width: width,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              '$referenceYear ${_formatCurrency(referenceValue)}',
              style: TextStyle(
                fontSize: compact ? 10 : 12,
                fontWeight: FontWeight.w800,
                color: comparisonColor,
              ),
            ),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              widget.isJefeVentas
                  ? '${_formatUnits(units)} uds | ${_formatCompact(margin)} EUR (${marginPercent.toStringAsFixed(1)}%)'
                  : '${_formatUnits(units)} uds',
              style: TextStyle(
                fontSize: compact ? 7 : 8,
                color: widget.isJefeVentas && marginPercent < 0
                    ? AppTheme.error
                    : AppTheme.textSecondary,
              ),
            ),
          ),
          const SizedBox(height: 3),
          _buildComparisonStrip(node, compact: true),
        ],
      ),
    );
  }

  /// Monthly breakdown row - vertical cards with ENE / 820€ / -73% format
  Color _monthlyTrendColor(double sales, double prevSales) {
    final currZero = sales.abs() < 0.01;
    final prevZero = prevSales.abs() < 0.01;
    if (!currZero && prevZero) return AppTheme.info;
    if (currZero && !prevZero) return AppTheme.error;
    if (!currZero && !prevZero) {
      return sales >= prevSales ? AppTheme.success : AppTheme.error;
    }
    return AppTheme.textSecondary;
  }

  Color _monthlyTrendBg(double sales, double prevSales) {
    final color = _monthlyTrendColor(sales, prevSales);
    if (color == AppTheme.textSecondary) return AppColors.transparent;
    return color.withValues(alpha: 0.12);
  }

  String _monthlyTrendSuffix(double sales, double prevSales) {
    final currZero = sales.abs() < 0.01;
    final prevZero = prevSales.abs() < 0.01;
    if (!currZero && prevZero) return 'NUEVO';
    if (currZero && !prevZero) return '-100%';
    if (!currZero && !prevZero) {
      final pct = ((sales - prevSales) / prevSales) * 100;
      return '${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(0)}%';
    }
    return '';
  }

  Widget _buildMonthlyBreakdownRow(
    Map<String, dynamic>? monthlyData, {
    bool compact = false,
  }) {
    if (monthlyData == null || monthlyData.isEmpty) {
      return const SizedBox.shrink();
    }

    final years = _selectedYearsDesc;
    final hasYearData = monthlyData.values.any((value) {
      final map = _mapFrom(value);
      return _mapFrom(map['byYear']).isNotEmpty;
    });

    if (hasYearData) {
      final height = (compact ? 34.0 : 40.0) + (years.length * 18.0);
      return Container(
        margin: EdgeInsets.only(top: compact ? 6 : 8),
        height: height,
        child: ListView.builder(
          scrollDirection: Axis.horizontal,
          itemCount: 12,
          itemBuilder: (context, index) {
            final monthNum = (index + 1).toString();
            final mData = _mapFrom(monthlyData[monthNum]);
            final byYear = _mapFrom(mData['byYear']);
            final hasSales = years.any(
              (year) =>
                  _numValue(_yearData(byYear, year), 'sales').abs() > 0.01,
            );

            return Container(
              width: compact ? 90 : 102,
              margin: const EdgeInsets.only(right: 5),
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 4),
              decoration: BoxDecoration(
                color: hasSales
                    ? AppTheme.raisedSurface
                    : AppTheme.raisedSurface.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: hasSales
                      ? AppTheme.info.withValues(alpha: 0.35)
                      : AppTheme.borderColor.withValues(alpha: 0.2),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _mNames[index],
                    style: TextStyle(
                      fontSize: compact ? 9 : 10,
                      fontWeight: FontWeight.bold,
                      color: hasSales ? AppTheme.textPrimary : AppTheme.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  ...years.map((year) {
                    final data = _yearData(byYear, year);
                    final sales = _numValue(data, 'sales');
                    final units = _numValue(data, 'units');
                    final prevSales =
                        _numValue(_yearData(byYear, year - 1), 'sales');
                    final trendColor = _monthlyTrendColor(sales, prevSales);
                    final trendSuffix = _monthlyTrendSuffix(sales, prevSales);
                    return Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 3,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: _monthlyTrendBg(sales, prevSales),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(
                            color: trendColor.withValues(alpha: 0.35),
                          ),
                        ),
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            '$year ${_formatCompact(sales)} EUR / ${_formatUnits(units)}u${trendSuffix.isEmpty ? '' : ' $trendSuffix'}',
                            style: TextStyle(
                              fontSize: compact ? 7 : 8,
                              fontWeight: FontWeight.w600,
                              color:
                                  sales.abs() < 0.01 && prevSales.abs() < 0.01
                                      ? AppTheme.textSecondary
                                      : trendColor,
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ],
              ),
            );
          },
        ),
      );
    }

    // Check if client is NEW (no sales in entire previous year)
    final isClientNew = _summary['isNewClient'] == true;

    return Container(
      margin: EdgeInsets.only(top: compact ? 6 : 8),
      height: compact ? 52 : 60,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: 12,
        itemBuilder: (context, index) {
          final monthNum = (index + 1).toString();
          final mData = monthlyData[monthNum] as Map<String, dynamic>?;
          final sales = (mData?['sales'] as num?)?.toDouble() ?? 0;
          final prevSales = (mData?['prevSales'] as num?)?.toDouble() ?? 0;

          // Sin ventas ni este año ni el anterior - gris
          if (sales == 0 && prevSales == 0) {
            return Container(
              width: compact ? 50 : 58,
              margin: const EdgeInsets.only(right: 4),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.raisedSurface.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: AppTheme.borderColor.withValues(alpha: 0.2),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    _mNames[index],
                    style: TextStyle(
                      fontSize: compact ? 9 : 10,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  Text(
                    '-',
                    style: TextStyle(
                      fontSize: compact ? 10 : 11,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ],
              ),
            );
          }

          // Calculate YoY percentage and determine color
          double yoyPct = 0;
          var yoySign = '';
          Color yoyColor;
          Color bgColor;
          var isNew = false;
          var isLost = false; // Vendió el año pasado pero no este año

          final prevIsZero = prevSales.abs() < 0.01;
          final currIsZero = sales.abs() < 0.01;

          // Si el cliente es NUEVO (sin ventas en todo el año anterior), todos los meses con ventas son NUEVO
          if (isClientNew && !currIsZero) {
            isNew = true;
            yoyColor = AppTheme.info; // Distinct Blue
            bgColor = AppTheme.info.withValues(alpha: 0.20);
          } else if (currIsZero && !prevIsZero) {
            // Perdió ventas - este año 0, año pasado vendió
            isLost = true;
            yoyPct = -100;
            yoyColor = AppTheme.error;
            bgColor = AppTheme.error.withValues(alpha: 0.15);
          } else if (!currIsZero && prevIsZero) {
            // Venta este mes, pero 0 el año pasado -> NUEVO (Blue)
            isNew = true;
            yoyColor = AppTheme.info; // Distinct Blue
            bgColor = AppTheme.info.withValues(alpha: 0.20);
          } else if (!prevIsZero && !currIsZero) {
            yoyPct = ((sales - prevSales) / prevSales) * 100;
            yoySign = yoyPct >= 0 ? '+' : '';
            yoyColor = yoyPct >= 0 ? AppTheme.success : AppTheme.error;
            bgColor = yoyColor.withValues(alpha: 0.12);
          } else {
            yoyColor = AppTheme.textSecondary;
            bgColor = AppTheme.raisedSurface;
          }

          return Container(
            width: compact ? 58 : 66,
            margin: const EdgeInsets.only(right: 5),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: yoyColor.withValues(alpha: 0.5)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Month name
                Text(
                  _mNames[index],
                  style: TextStyle(
                    fontSize: compact ? 9 : 10,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                // Sales amount (- si es 0 pero había ventas antes)
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    isLost ? '-' : '${_formatCompact(sales)} €',
                    style: TextStyle(
                      fontSize: compact ? 9 : 10,
                      fontWeight: FontWeight.bold,
                      color: isLost ? AppTheme.error : AppTheme.textPrimary,
                    ),
                  ),
                ),
                // YoY percentage, NEW badge, or LOST indicator
                if (isLost)
                  Text(
                    '-100%',
                    style: TextStyle(
                      fontSize: compact ? 8 : 9,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.error,
                    ),
                  )
                else if (prevSales > 0)
                  Text(
                    '$yoySign${yoyPct.toStringAsFixed(0)}%',
                    style: TextStyle(
                      fontSize: compact ? 8 : 9,
                      fontWeight: FontWeight.bold,
                      color: yoyColor,
                    ),
                  )
                else if (isNew)
                  Text(
                    'NUEVO',
                    style: TextStyle(
                      fontSize: compact ? 7 : 8,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.info,
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Map<String, dynamic> _productYearData(
    Map<String, dynamic> product,
    int year,
  ) {
    final data = _yearData(_mapFrom(product['byYear']), year);
    if (data.isNotEmpty || _selectedYearsDesc.length != 1) return data;

    final sales = (product['totalSales'] as num?)?.toDouble() ?? 0;
    final cost = (product['totalCost'] as num?)?.toDouble() ?? 0;
    final units = (product['totalUnits'] as num?)?.toDouble() ?? 0;
    final avgPrice = units > 0 ? sales / units : 0.0;
    final avgCost = units > 0 ? cost / units : 0.0;
    final margin = sales - cost;
    return {
      'sales': sales,
      'cost': cost,
      'units': units,
      'margin': margin,
      'marginPercent': sales > 0 ? (margin / sales) * 100 : 0.0,
      'avgUnitPrice': avgPrice,
      'avgUnitCost': avgCost,
      'marginPerUnit': avgPrice - avgCost,
    };
  }

  Widget _buildProductCommercialByYear(
    Map<String, dynamic> product,
    String unitLabel,
    Color accentColor,
    bool hasDiscount,
    double avgDiscountPct,
    double avgDiscountEur,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.accentIndigo.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        children: [
          Row(
            children: [
              SizedBox(
                width: 38,
                child: Text(
                  'Año',
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
              Expanded(
                child: Text(
                  'PVP',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
              Expanded(
                child: Text(
                  'Uds',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
              Expanded(
                flex: 2,
                child: Text(
                  'Ventas',
                  textAlign: TextAlign.right,
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          ..._selectedYearsDesc.map((year) {
            final data = _productYearData(product, year);
            final avgPrice = _numValue(data, 'avgUnitPrice');
            final units = _numValue(data, 'units');
            final sales = _numValue(data, 'sales');
            final rowColor =
                sales.abs() < 0.01 ? AppTheme.textSecondary : AppTheme.textPrimary;

            return Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                children: [
                  SizedBox(
                    width: 38,
                    child: Text(
                      '$year',
                      style: TextStyle(
                        fontSize: 8,
                        fontWeight: FontWeight.bold,
                        color: accentColor,
                      ),
                    ),
                  ),
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        '${_formatCurrency(avgPrice)}/$unitLabel',
                        style: TextStyle(fontSize: 9, color: rowColor),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      _formatUnits(units),
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 9, color: rowColor),
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: FittedBox(
                      alignment: Alignment.centerRight,
                      fit: BoxFit.scaleDown,
                      child: Text(
                        _formatCurrency(sales),
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: rowColor,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
          if (hasDiscount) ...[
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                avgDiscountPct > 0
                    ? 'Dto -${avgDiscountPct.toStringAsFixed(1)}%'
                    : 'Dto${avgDiscountEur > 0 ? " -${_formatCurrency(avgDiscountEur)}" : ""}',
                style: const TextStyle(
                  fontSize: 8,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.warning,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildProductMarginByYear(
    Map<String, dynamic> product,
    String unitLabel,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        children: [
          Row(
            children: [
              SizedBox(
                width: 38,
                child: Text(
                  'Año',
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
              Expanded(
                child: Text(
                  'Coste',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
              Expanded(
                child: Text(
                  'Margen',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
              Expanded(
                flex: 2,
                child: Text(
                  'Margen Total',
                  textAlign: TextAlign.right,
                  style: TextStyle(fontSize: 7, color: AppTheme.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          ..._selectedYearsDesc.map((year) {
            final data = _productYearData(product, year);
            final avgCost = _numValue(data, 'avgUnitCost');
            final marginPerUnit = _numValue(data, 'marginPerUnit');
            final margin = _numValue(data, 'margin');
            final marginPercent = _numValue(data, 'marginPercent');
            final marginColor =
                marginPercent >= 0 ? AppTheme.success : AppTheme.error;

            return Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                children: [
                  SizedBox(
                    width: 38,
                    child: Text(
                      '$year',
                      style: const TextStyle(
                        fontSize: 8,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.info,
                      ),
                    ),
                  ),
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        '${_formatCurrency(avgCost)}/$unitLabel',
                        style: TextStyle(
                          fontSize: 9,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        _formatCurrency(marginPerUnit),
                        style: TextStyle(fontSize: 9, color: marginColor),
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: FittedBox(
                      alignment: Alignment.centerRight,
                      fit: BoxFit.scaleDown,
                      child: Text(
                        '${_formatCurrency(margin)} (${marginPercent.toStringAsFixed(1)}%)',
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: marginColor,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildFiProduct(Map<String, dynamic> p) {
    final code = p['code'] as String? ?? '';
    final name = p['name'] as String? ?? code;
    final unitType = (p['unitType'] as String?)?.toUpperCase() ?? 'UDS';
    final yoyTrend = p['yoyTrend'] as String? ?? 'neutral';
    final comparison = _comparisonFrom(p);
    final hasDiscount = p['hasDiscount'] as bool? ?? false;
    final avgDiscountPct = (p['avgDiscountPct'] as num?)?.toDouble() ?? 0;
    final avgDiscountEur = (p['avgDiscountEur'] as num?)?.toDouble() ?? 0;
    final monthlyData = p['monthlyData'] as Map<String, dynamic>?;

    // Unit label
    String unitLabel;
    switch (unitType) {
      case 'CAJA':
        unitLabel = 'Caja';
      case 'KG':
      case 'KILO':
        unitLabel = 'Kg';
      case 'UNIDAD':
        unitLabel = 'Ud';
      default:
        unitLabel = unitType.isNotEmpty && unitType.length > 4
            ? unitType.substring(0, 4)
            : unitType;
    }

    var borderColor = AppTheme.raisedSurface;
    if (comparison.isNotEmpty) {
      borderColor = _comparisonColorFromName(comparison['color']?.toString());
    } else if (yoyTrend == 'up') {
      borderColor = AppTheme.success;
    } else if (yoyTrend == 'down') {
      borderColor = AppTheme.error;
    } else if (yoyTrend == 'new') {
      borderColor = AppTheme.info;
    }

    final baseUrl = ApiConfig.baseUrl;
    final imageUrl =
        '$baseUrl/products/${Uri.encodeComponent(code.trim())}/image';
    final fichaUrl =
        '$baseUrl/products/${Uri.encodeComponent(code.trim())}/ficha';

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: hasDiscount
              ? AppTheme.warning.withValues(alpha: 0.5)
              : borderColor.withValues(alpha: 0.3),
          width: hasDiscount ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Product header: Thumbnail + Code + Name + Ficha button
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Product thumbnail
              GestureDetector(
                onTap: () => _showFullscreenImage(
                  context,
                  imageUrl,
                  name,
                  code,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    width: 44,
                    height: 44,
                    color: AppTheme.inkSurface,
                    child: SmartProductImage(
                      imageUrl: imageUrl,
                      productCode: code,
                      productName: name,
                      width: 44,
                      height: 44,
                      headers: ApiClient.authHeaders,
                      showCodeOnFallback: false,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              // Code + badges + name
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.info.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            code,
                            style: const TextStyle(
                              fontSize: 8,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.info,
                            ),
                          ),
                        ),
                        if (hasDiscount) ...[
                          const SizedBox(width: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 4,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.warning.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(3),
                            ),
                            child: Text(
                              avgDiscountPct > 0
                                  ? '-${avgDiscountPct.toStringAsFixed(0)}%'
                                  : 'DTO',
                              style: const TextStyle(
                                fontSize: 6,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.warning,
                              ),
                            ),
                          ),
                        ],
                        if (comparison.isNotEmpty) ...[
                          const SizedBox(width: 4),
                          _buildComparisonBadge(p, compact: true),
                        ] else if (yoyTrend != 'neutral') ...[
                          const SizedBox(width: 4),
                          Icon(
                            yoyTrend == 'up'
                                ? Icons.trending_up
                                : yoyTrend == 'down'
                                    ? Icons.trending_down
                                    : Icons.fiber_new,
                            size: 12,
                            color: borderColor,
                          ),
                        ],
                        const Spacer(),
                        // Ficha Técnica button
                        Material(
                          color: AppColors.transparent,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(6),
                            onTap: () => _openFichaTecnica(
                              context,
                              code.trim(),
                              fichaUrl,
                            ),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 5,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: AppTheme.info.withValues(alpha: 0.4),
                                ),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.description_outlined,
                                    color: AppTheme.info,
                                    size: 11,
                                  ),
                                  SizedBox(width: 2),
                                  Text(
                                    'Ficha',
                                    style: TextStyle(
                                      color: AppTheme.info,
                                      fontSize: 8,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      name,
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),

          // === COMERCIAL: PVP, UDS, VENTAS con año pasado ===
          _buildProductCommercialByYear(
            p,
            unitLabel,
            borderColor == AppTheme.raisedSurface
                ? AppTheme.accentIndigo
                : borderColor,
            hasDiscount,
            avgDiscountPct,
            avgDiscountEur,
          ),
          // === JEFE VENTAS: Coste, Margen (con año anterior) ===
          if (widget.isJefeVentas) ...[
            const SizedBox(height: 4),
            _buildProductMarginByYear(p, unitLabel),
          ],
          // Monthly breakdown
          if (monthlyData != null)
            _buildMonthlyBreakdownRow(monthlyData, compact: true),
        ],
      ),
    );
  }

  /// Format number with Spanish locale: 8.120,30 (no € symbol, use _formatCurrency for that)
  String _formatCompact(double v) {
    // Formato español: miles con punto, decimales con coma
    final parts = v.toStringAsFixed(2).split('.');
    final intPart = parts[0];
    final decPart = parts.length > 1 ? parts[1] : '00';
    // Add thousand separators
    var formatted = '';
    var count = 0;
    for (var i = intPart.length - 1; i >= 0; i--) {
      if (count > 0 && count % 3 == 0 && intPart[i] != '-') {
        formatted = '.$formatted';
      }
      formatted = intPart[i] + formatted;
      count++;
    }
    return '$formatted,$decPart';
  }

  Widget _buildFamilyList() {
    return ListView.builder(
      padding: const EdgeInsets.all(4),
      itemCount: _families.length,
      itemBuilder: (c, i) => _buildFamilyCard(_families[i]),
    );
  }

  Widget _buildFamilyCard(Map<String, dynamic> f) {
    final code = f['familyCode'] as String? ?? '';
    final name = f['familyName'] as String? ?? code;
    final expanded = _expandedFamilies.contains(code);
    final rawSubs = f['subfamilies'] ?? [];
    final subs = (rawSubs as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final sales = (f['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (f['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (f['totalMarginPercent'] as num?)?.toDouble() ?? 0;
    final comparisonColor = _comparisonColorFromName(
      _comparisonFrom(f)['color']?.toString(),
      fallback: AppTheme.info,
    );

    var pCount = 0;
    for (final s in subs) {
      pCount += List.from((s['products'] as List?) ?? []).length;
    }

    return Card(
      color: AppTheme.raisedSurface,
      margin: const EdgeInsets.only(bottom: 4),
      child: Column(
        children: [
          ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            leading: CircleAvatar(
              radius: 12,
              backgroundColor: AppTheme.info.withValues(alpha: 0.2),
              child: Text(
                code,
                style: const TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.info,
                ),
              ),
            ),
            title: Text(
              name,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
            ),
            subtitle: Text(
              '$pCount productos • ${subs.length} subfam.',
              style:
                  TextStyle(fontSize: 9, color: AppTheme.textSecondary),
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  _formatCurrency(sales),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: comparisonColor,
                  ),
                ),
                Text(
                  '${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}',
                  style: TextStyle(
                    fontSize: 9,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                _buildComparisonBadge(f, compact: true),
              ],
            ),
            onTap: () => setState(() {
              if (expanded) {
                _expandedFamilies.remove(code);
              } else {
                _expandedFamilies.add(code);
              }
            }),
          ),
          if (expanded) ...subs.map((s) => _buildSubfamily(s, code)),
        ],
      ),
    );
  }

  Widget _buildSubfamily(Map<String, dynamic> s, String famCode) {
    final code = s['subfamilyCode'] as String? ?? '';
    final name = s['subfamilyName'] as String? ?? code;
    final rawProds = s['products'] ?? [];
    final prods = (rawProds as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final sales = (s['totalSales'] as num?)?.toDouble() ?? 0;
    final margin = (s['totalMarginPercent'] as num?)?.toDouble() ?? 0;
    final units = (s['totalUnits'] as num?)?.toDouble() ?? 0;
    final key = '$famCode|$code';
    final expanded = _expandedSubfamilies.contains(key);
    final comparisonColor = _comparisonColorFromName(
      _comparisonFrom(s)['color']?.toString(),
      fallback: AppTheme.accentIndigo,
    );

    return Container(
      margin: const EdgeInsets.only(left: 12, right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface,
        borderRadius: BorderRadius.circular(6),
        border: Border(
          left: BorderSide(
            color: AppTheme.accentIndigo.withValues(alpha: 0.5),
            width: 3,
          ),
        ),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() {
              if (expanded) {
                _expandedSubfamilies.remove(key);
              } else {
                _expandedSubfamilies.add(key);
              }
            }),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 8,
              ), // Increased padding for touch target
              child: Row(
                children: [
                  Icon(
                    expanded ? Icons.folder_open : Icons.folder,
                    size: 16,
                    color: AppTheme.textTertiary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      name.isNotEmpty ? name : 'General',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ), // Bolder
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        _formatCurrency(sales),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: comparisonColor,
                        ),
                      ),
                      if (widget.isJefeVentas)
                        Text(
                          '${margin.toStringAsFixed(1)}% Mrg',
                          style: TextStyle(
                            fontSize: 8,
                            color:
                                margin > 0 ? AppTheme.success : AppTheme.error,
                          ),
                        ),
                      const SizedBox(height: 2),
                      _buildComparisonBadge(s, compact: true),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (expanded) ...prods.map(_buildProduct),
        ],
      ),
    );
  }

  Widget _buildProduct(Map<String, dynamic> p) {
    final name = p['name'] as String? ?? '';
    final code = p['code'] as String? ?? '';
    final discount = p['hasDiscount'] as bool? ?? false;

    // Current year pricing data from backend
    final avgUnitPrice = (p['avgUnitPrice'] as num?)?.toDouble() ?? 0;
    final avgUnitCost = (p['avgUnitCost'] as num?)?.toDouble() ?? 0;
    final marginPerUnit = (p['marginPerUnit'] as num?)?.toDouble() ?? 0;
    final sales = (p['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (p['totalUnits'] as num?)?.toDouble() ?? 0;
    final marginPercent = (p['totalMarginPercent'] as num?)?.toDouble() ?? 0;
    final monthly = p['monthlyData'] as Map<String, dynamic>? ?? {};

    // Unit type from backend (CAJA, KG, UDS, etc.)
    final unitType = (p['unitType'] as String?)?.toUpperCase() ?? 'UDS';
    // Make display-friendly label
    String unitLabel;
    switch (unitType) {
      case 'CAJA':
        unitLabel = 'Caja';
      case 'KG':
        unitLabel = 'Kg';
      case 'KILO':
        unitLabel = 'Kg';
      case 'UNIDAD':
        unitLabel = 'Ud';
      default:
        unitLabel = unitType.isNotEmpty
            ? unitType.substring(0, unitType.length > 4 ? 4 : unitType.length)
            : 'Ud';
    }

    // Discount/Pricing extended info
    final avgDiscountPct = (p['avgDiscountPct'] as num?)?.toDouble() ?? 0;
    final avgDiscountEur = (p['avgDiscountEur'] as num?)?.toDouble() ?? 0;

    // Previous year data for YoY comparison
    final prevYearSales = (p['prevYearSales'] as num?)?.toDouble() ?? 0;
    final prevYearUnits = (p['prevYearUnits'] as num?)?.toDouble() ?? 0;
    final prevYearAvgPrice = (p['prevYearAvgPrice'] as num?)?.toDouble() ?? 0;

    // Calculate variations (kept for potential future use)
    final priceVariation = prevYearAvgPrice > 0
        ? ((avgUnitPrice - prevYearAvgPrice) / prevYearAvgPrice) * 100
        : 0.0;
    final unitsVariation = prevYearUnits > 0
        ? ((units - prevYearUnits) / prevYearUnits) * 100
        : 0.0;
    final salesVariation = prevYearSales > 0
        ? ((sales - prevYearSales) / prevYearSales) * 100
        : 0.0;

    final baseUrl = ApiConfig.baseUrl;
    final imageUrl =
        '$baseUrl/products/${Uri.encodeComponent(code.trim())}/image';
    final fichaUrl =
        '$baseUrl/products/${Uri.encodeComponent(code.trim())}/ficha';

    return Container(
      margin: const EdgeInsets.only(left: 8, right: 4, bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(8),
        border: discount
            ? Border.all(
                color: AppTheme.warning.withValues(alpha: 0.5),
                width: 1.5,
              )
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Product header with image
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Product thumbnail
              GestureDetector(
                onTap: () => _showFullscreenImage(
                  context,
                  imageUrl,
                  name,
                  code,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    width: 48,
                    height: 48,
                    color: AppTheme.inkSurface,
                    child: SmartProductImage(
                      imageUrl: imageUrl,
                      productCode: code,
                      productName: name,
                      width: 48,
                      height: 48,
                      headers: ApiClient.authHeaders,
                      showCodeOnFallback: false,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // Code badge + Name
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.info.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            code,
                            style: const TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        const Spacer(),
                        // Ficha Técnica button
                        Material(
                          color: AppColors.transparent,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(6),
                            onTap: () => _openFichaTecnica(
                              context,
                              code.trim(),
                              fichaUrl,
                            ),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: AppTheme.info.withValues(alpha: 0.4),
                                ),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.description_outlined,
                                    color: AppTheme.info,
                                    size: 12,
                                  ),
                                  SizedBox(width: 3),
                                  Text(
                                    'Ficha',
                                    style: TextStyle(
                                      color: AppTheme.info,
                                      fontSize: 9,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      name,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 2,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Pricing info row - INLINE YoY COMPARISON with actual values
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.accentIndigo.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              children: [
                // Unit Price with prev year value inline
                Expanded(
                  child: Column(
                    children: [
                      Text(
                        'PVP/$unitLabel',
                        style: TextStyle(
                          fontSize: 8,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            _formatCurrency(avgUnitPrice),
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.accentIndigo,
                            ),
                          ),
                          if (prevYearAvgPrice > 0)
                            Text(
                              ' (${_formatCurrency(prevYearAvgPrice)})',
                              style: TextStyle(
                                fontSize: 8,
                                color: AppTheme.textTertiary,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Unit Cost - only for jefe de ventas
                if (widget.isJefeVentas)
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          'Coste/$unitLabel',
                          style: TextStyle(
                            fontSize: 8,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        Text(
                          _formatCurrency(avgUnitCost),
                          style: TextStyle(
                            fontSize: 10,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                // Margin per unit - only for jefe de ventas
                if (widget.isJefeVentas)
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          'Margen/$unitLabel',
                          style: TextStyle(
                            fontSize: 8,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        Text(
                          _formatCurrency(marginPerUnit),
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: marginPerUnit >= 0
                                ? AppTheme.success
                                : AppTheme.error,
                          ),
                        ),
                      ],
                    ),
                  ),
                // Units with prev year value inline
                Expanded(
                  child: Column(
                    children: [
                      Text(
                        unitLabel,
                        style: TextStyle(
                          fontSize: 8,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            units >= 100
                                ? units.toStringAsFixed(0)
                                : units.toStringAsFixed(2),
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.info,
                            ),
                          ),
                          if (prevYearUnits > 0)
                            Text(
                              ' (${prevYearUnits >= 100 ? prevYearUnits.toStringAsFixed(0) : prevYearUnits.toStringAsFixed(2)})',
                              style: TextStyle(
                                fontSize: 8,
                                color: AppTheme.textTertiary,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),

          // Totals row with YoY comparison
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.inkSurface,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                // Total with prev year inline: "2025 (2024)"
                Column(
                  children: [
                    Text(
                      'Total ${_selectedYears.length == 1 ? _selectedYears.first : "Periodo"}',
                      style: TextStyle(
                        fontSize: 7,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _formatCurrency(sales),
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.info,
                          ),
                        ),
                        if (prevYearSales > 0)
                          Text(
                            ' (${_formatCurrency(prevYearSales)})',
                            style: TextStyle(
                              fontSize: 9,
                              color: AppTheme.textTertiary,
                            ),
                          ),
                      ],
                    ),
                    if (prevYearSales > 0)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            salesVariation >= 0
                                ? Icons.trending_up
                                : Icons.trending_down,
                            size: 10,
                            color: salesVariation >= 0
                                ? AppTheme.success
                                : AppTheme.error,
                          ),
                          Text(
                            ' ${salesVariation >= 0 ? "+" : ""}${salesVariation.toStringAsFixed(0)}%',
                            style: TextStyle(
                              fontSize: 8,
                              fontWeight: FontWeight.bold,
                              color: salesVariation >= 0
                                  ? AppTheme.success
                                  : AppTheme.error,
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
                if (widget.isJefeVentas)
                  _productStat(
                    'Margen',
                    '${marginPercent.toStringAsFixed(1)}%',
                    marginPercent >= 0 ? AppTheme.success : AppTheme.error,
                  ),
                if (discount || avgDiscountPct > 0 || avgDiscountEur > 0)
                  _productStat(
                    avgDiscountPct > 0
                        ? '-${avgDiscountPct.toStringAsFixed(0)}%'
                        : 'Dto',
                    avgDiscountEur > 0
                        ? '-${_formatCurrency(avgDiscountEur)}'
                        : (avgDiscountPct > 0
                            ? '${avgDiscountPct.toStringAsFixed(0)}%'
                            : '✓'),
                    AppTheme.warning,
                    isBold: true,
                  ),
              ],
            ),
          ),

          // Monthly breakdown with YoY %
          SizedBox(
            height: 48, // Taller to fit YoY %
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: 12,
              itemBuilder: (c, i) {
                final m = i + 1;
                if (!_selectedMonths.contains(m)) {
                  return const SizedBox.shrink();
                }
                final d = monthly[m.toString()];
                final s = (d?['sales'] as num?)?.toDouble() ?? 0;
                final prevS = (d?['prevSales'] as num?)?.toDouble() ?? 0;
                final trend = d?['yoyTrend'] as String?;
                final yoyVar = (d?['yoyVariation'] as num?)?.toDouble();

                // Determine State
                final isNew = prevS < 0.01 && s > 0;
                final isLost = s == 0 && prevS > 0;
                final isNeutral = trend == 'neutral' || trend == null;

                // Background & Border Colors
                var bc = AppTheme.mutedPanel;
                var bgColor = AppColors.transparent;
                var bWidth = 0.5;
                if (s > 0) bc = AppTheme.textTertiary;

                if (isNew) {
                  bc = AppTheme.info;
                  bgColor = AppTheme.info.withValues(alpha: 0.1);
                  bWidth = 1.0;
                } else if (!isNeutral) {
                  if (trend == 'up') {
                    bc = AppTheme.success;
                    bgColor = AppTheme.success.withValues(alpha: 0.15);
                    bWidth = 1.5;
                  }
                  if (trend == 'down') {
                    bc = AppTheme.error;
                    bgColor = AppTheme.error.withValues(alpha: 0.15);
                    bWidth = 1.5;
                  }
                }

                return Container(
                  width: 60,
                  margin: const EdgeInsets.only(right: 2),
                  decoration: BoxDecoration(
                    color: s > 0 ? bgColor : AppColors.transparent,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: bc, width: bWidth),
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Padding(
                      padding: const EdgeInsets.all(2),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            _mNames[m - 1],
                            style: TextStyle(
                              fontSize: 8,
                              color: AppTheme.textTertiary,
                            ),
                          ),

                          // SALES DISPLAY
                          if (s > 0)
                            Text(
                              _formatCurrency(s),
                              style: const TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            )
                          else if (isLost)
                            Text(
                              '(${_formatCurrency(prevS)})',
                              style: TextStyle(
                                fontSize: 8,
                                color: AppTheme.textTertiary,
                              ),
                            )
                          else
                            Text(
                              '-',
                              style: TextStyle(
                                fontSize: 8,
                                color: AppTheme.textTertiary,
                              ),
                            ),

                          // VARIATION DISPLAY (Strict Logic)
                          if (isNew)
                            const Text(
                              'NUEVO',
                              style: TextStyle(
                                fontSize: 7,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.info,
                              ),
                            )
                          else if (isLost)
                            const Text(
                              '-100%',
                              style: TextStyle(
                                fontSize: 7,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.error,
                              ),
                            )
                          else if (prevS > 0 && yoyVar != null)
                            _buildStrictPercentage(yoyVar, trend ?? 'neutral'),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStrictPercentage(double variation, String trend) {
    if (variation.abs() < 0.5) {
      // Strict check for negligible variation
      return const Text(
        '0%',
        style: TextStyle(
          fontSize: 7,
          fontWeight: FontWeight.bold,
          color: AppTheme.info,
        ),
      );
    }

    final isPositive = variation > 0;
    final color = trend == 'neutral'
        ? AppTheme.info
        : (isPositive ? AppTheme.success : AppTheme.error);
    final prefix =
        isPositive ? '+' : ''; // No prefix if 0, but logic above handles < 1.0

    return Text(
      '$prefix${variation.toStringAsFixed(0)}%',
      style: TextStyle(fontSize: 7, fontWeight: FontWeight.bold, color: color),
    );
  }

  // ===========================================================================
  // FULLSCREEN IMAGE VIEWER
  // ===========================================================================
  void _showFullscreenImage(
    BuildContext ctx,
    String imageUrl,
    String productName,
    String productCode,
  ) {
    FullscreenImageViewer.show(
      ctx,
      imageUrl: imageUrl,
      productName: productName,
      productCode: productCode,
      headers: ApiClient.authHeaders,
    );
  }

  // ===========================================================================
  // FICHA TÉCNICA – Download PDF and open viewer
  // ===========================================================================
  Future<void> _openFichaTecnica(
    BuildContext ctx,
    String productCode,
    String fichaUrl,
  ) async {
    final navigator = Navigator.of(ctx);
    final filePath =
        '${(await getTemporaryDirectory()).path}/${productCode}_ficha.pdf';

    showDialog<void>(
      context: ctx,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        content: Row(
          children: [
            SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.info,
              ),
            ),
            SizedBox(width: 16),
            Text(
              'Descargando ficha técnica...',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ],
        ),
      ),
    );

    try {
      await ApiClient.download(fichaUrl, filePath);

      if (navigator.canPop()) navigator.pop();

      if (!File(filePath).existsSync()) {
        ScaffoldMessenger.of(ctx).showSnackBar(
          const SnackBar(content: Text('No se encontró la ficha técnica')),
        );
        return;
      }

      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => Scaffold(
            backgroundColor: AppTheme.surfaceColor,
            appBar: AppBar(
              title: Text(
                'Ficha Técnica - $productCode',
                style: const TextStyle(fontSize: 14),
              ),
              backgroundColor: AppTheme.raisedSurface,
              elevation: 0,
            ),
            body: PDFView(
              filePath: filePath,
              onError: (error) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  SnackBar(content: Text('Error al abrir PDF: $error')),
                );
              },
            ),
          ),
        ),
      );
    } catch (e) {
      if (navigator.canPop()) navigator.pop();
      final msg = e.toString().contains('404')
          ? 'No hay ficha técnica para este producto'
          : 'Error al descargar: $e';
      ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(msg)));
    }
  }
}
