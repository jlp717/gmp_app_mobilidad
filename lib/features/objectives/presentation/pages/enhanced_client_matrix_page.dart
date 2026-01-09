import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/widgets/fi_filters_widget.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../features/sales_history/presentation/widgets/sales_summary_header.dart';

/// Enhanced Client Matrix Page v6 - Professional design, no overflow
class EnhancedClientMatrixPage extends StatefulWidget {
  final String clientCode;
  final String clientName;
  final bool isJefeVentas;

  const EnhancedClientMatrixPage({
    super.key,
    required this.clientCode,
    required this.clientName,
    this.isJefeVentas = false,
  });

  @override
  State<EnhancedClientMatrixPage> createState() => _EnhancedClientMatrixPageState();
}

class _EnhancedClientMatrixPageState extends State<EnhancedClientMatrixPage> {
  bool _isLoading = true;
  String? _error;
  bool _showFilters = false;
  
  // Legacy familia/subfamilia hierarchy
  List<Map<String, dynamic>> _families = [];
  // NEW: 5-level FI hierarchy (FI1 > FI2 > FI3 > FI4 > productos)
  List<Map<String, dynamic>> _fiHierarchy = [];
  // Toggle for hierarchy view mode
  bool _useFiHierarchy = true; // Default to FI hierarchy
  
  Map<String, dynamic> _grandTotal = {};
  Map<String, dynamic> _summary = {};
  Map<String, dynamic> _monthlyTotals = {};
  Map<String, dynamic> _availableFilters = {};
  
  // Client specific info
  Map<String, dynamic>? _editableNotes;
  Map<String, dynamic> _contactInfo = {};

  Set<int> _selectedYears = {DateTime.now().year};
  Set<int> _selectedMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  // Pending filter state (only apply when user clicks Apply)
  Set<int> _pendingYears = {DateTime.now().year};
  Set<int> _pendingMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  bool _filtersDirty = false; // Track if filters changed
  String _productCodeSearch = '';
  String _productNameSearch = '';
  
  // FI hierarchical filters state
  FiFilterState _fiFilters = const FiFilterState();
  FiFilterOptions? _fiOptions;
  
  final _codeCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  
  // Expansion state for legacy hierarchy
  final Set<String> _expandedFamilies = {};
  final Set<String> _expandedSubfamilies = {};
  // Expansion state for FI hierarchy (keyed by level-code)
  final Set<String> _expandedFiNodes = {};
  
  static const _mNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  static List<int> get _years => ApiConfig.availableYears;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  int get _startMonth => _selectedMonths.isEmpty ? 1 : _selectedMonths.reduce((a, b) => a < b ? a : b);
  int get _endMonth => _selectedMonths.isEmpty ? 12 : _selectedMonths.reduce((a, b) => a > b ? a : b);
  String get _yearsParam => _selectedYears.isNotEmpty ? _selectedYears.toList().join(',') : DateTime.now().year.toString();

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });

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
          if (_fiFilters.fi1 != null) 'fi1': _fiFilters.fi1!,
          if (_fiFilters.fi2 != null) 'fi2': _fiFilters.fi2!,
          if (_fiFilters.fi3 != null) 'fi3': _fiFilters.fi3!,
          if (_fiFilters.fi4 != null) 'fi4': _fiFilters.fi4!,
          if (_fiFilters.fi5 != null) 'fi5': _fiFilters.fi5!,
          'includeYoY': 'true',
        },
      );

      setState(() {
        // Legacy family/subfamily hierarchy
        final rawFamilies = response['families'] ?? [];
        _families = (rawFamilies as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        
        // NEW: 5-level FI hierarchy
        final rawFiHierarchy = response['fiHierarchy'] ?? [];
        _fiHierarchy = (rawFiHierarchy as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        
        _grandTotal = response['grandTotal'] ?? {};
        _summary = response['summary'] ?? {};
        _monthlyTotals = response['monthlyTotals'] ?? {};
        _availableFilters = response['availableFilters'] ?? {};
        _editableNotes = response['editableNotes'];
        _contactInfo = response['contactInfo'] ?? {};
        
        // Parse FI options from availableFilters
        _fiOptions = FiFilterOptions(
          fi1: _parseFiOptions(_availableFilters['fi1']),
          fi2: _parseFiOptions(_availableFilters['fi2']),
          fi3: _parseFiOptions(_availableFilters['fi3']),
          fi4: _parseFiOptions(_availableFilters['fi4']),
          fi5: _parseFiOptions(_availableFilters['fi5']),
        );
        
        _isLoading = false;
        
        // Auto-expand first item if only one
        if (_fiHierarchy.length == 1) {
          _expandedFiNodes.add('fi1_${_fiHierarchy.first['fi1Code'] ?? ''}');
        }
        if (_families.length == 1) {
          _expandedFamilies.add(_families.first['familyCode'] ?? '');
        }
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
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

  Future<void> _openNotesDialog() async {
    final currentNotes = _editableNotes?['text'] as String? ?? '';
    final ctrl = TextEditingController(text: currentNotes);

    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
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
            child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonPink),
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
      
      // Reload to reflect changes (and get modifiedBy info correct)
      await _loadData();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Observaciones guardadas correctaemnte')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false); // Stop loading if error
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error guardando notas: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        backgroundColor: AppTheme.surfaceColor,
        elevation: 0,
        toolbarHeight: 50,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${widget.clientCode} - ${widget.clientName}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
            Text('Historial de Compras', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
          ],
        ),
        actions: [
          if (!_isLoading && _error == null)
            IconButton(
              icon: Icon(
                _editableNotes != null && (_editableNotes!['text'] as String).isNotEmpty 
                    ? Icons.edit_note 
                    : Icons.note_add,
                color: _editableNotes != null && (_editableNotes!['text'] as String).isNotEmpty 
                    ? AppTheme.warning 
                    : Colors.white,
              ),
              onPressed: _openNotesDialog,
              tooltip: 'Observaciones',
            ),
          IconButton(
            icon: Icon(_showFilters ? Icons.filter_list_off : Icons.filter_list, size: 20),
            onPressed: () => setState(() => _showFilters = !_showFilters),
          ),
          IconButton(icon: const Icon(Icons.refresh, size: 20), onPressed: _loadData),
        ],
      ),
      body: _isLoading 
        ? const Center(child: ModernLoading(message: 'Cargando matriz...'))
        : _error != null 
          ? _buildError()
          : SafeArea(
              child: Column(
                children: [
                  if (_editableNotes != null && (_editableNotes!['text'] as String).isNotEmpty) 
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppTheme.warning.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppTheme.warning.withOpacity(0.5)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.warning_amber_rounded, color: AppTheme.warning, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _editableNotes!['text'] as String,
                              style: const TextStyle(color: Colors.white, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (_showFilters) _buildFilters(),
                  _buildSummaryRow(),
                  _buildMonthlyRow(),
                  // Toggle between FI hierarchy and legacy family view
                  _buildHierarchyToggle(),
                  Expanded(
                    child: _useFiHierarchy 
                      ? (_fiHierarchy.isEmpty 
                          ? const Center(child: Text('Sin datos FI', style: TextStyle(color: Colors.grey)))
                          : _buildFiHierarchyList())
                      : (_families.isEmpty 
                          ? const Center(child: Text('Sin datos', style: TextStyle(color: Colors.grey)))
                          : _buildFamilyList()),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildFilters() {
    return Container(
      constraints: const BoxConstraints(maxHeight: 340), // Increased for all 5 FI filters
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(bottom: BorderSide(color: Colors.grey.withOpacity(0.3))),
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Years Row
            Row(
              children: [
                const Text('Años: ', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                ...List.generate(_years.length, (i) => Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: ChoiceChip(
                    label: Text('${_years[i]}', style: const TextStyle(fontSize: 10)),
                    selected: _pendingYears.contains(_years[i]),
                    onSelected: (s) => setState(() {
                      if (s) _pendingYears.add(_years[i]);
                      else if (_pendingYears.length > 1) _pendingYears.remove(_years[i]);
                      _filtersDirty = true;
                    }),
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    labelPadding: const EdgeInsets.symmetric(horizontal: 6),
                    selectedColor: AppTheme.neonBlue.withOpacity(0.3),
                  ),
                )),
              ],
            ),
            const SizedBox(height: 6),
            // Months Row with All/None buttons
            Row(
              children: [
                const Text('Meses: ', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                GestureDetector(
                  onTap: () => setState(() { _pendingMonths = {1,2,3,4,5,6,7,8,9,10,11,12}; _filtersDirty = true; }),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: AppTheme.neonBlue.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                    child: const Text('Todos', style: TextStyle(fontSize: 9)),
                  ),
                ),
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: () => setState(() { _pendingMonths = {DateTime.now().month}; _filtersDirty = true; }), // Keep at least current month
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: AppTheme.error.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                    child: const Text('Ninguno', style: TextStyle(fontSize: 9)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SizedBox(
                    height: 26,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: List.generate(12, (i) => Padding(
                        padding: const EdgeInsets.only(right: 3),
                        child: ChoiceChip(
                          label: Text(_mNames[i], style: const TextStyle(fontSize: 8)),
                          selected: _pendingMonths.contains(i + 1),
                          onSelected: (s) => setState(() {
                            if (s) _pendingMonths.add(i + 1);
                            else if (_pendingMonths.length > 1) _pendingMonths.remove(i + 1);
                            _filtersDirty = true;
                          }),
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                          labelPadding: const EdgeInsets.symmetric(horizontal: 3),
                          selectedColor: AppTheme.neonPurple.withOpacity(0.3),
                        ),
                      )),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            // Search fields row
            Row(
              children: [
                Expanded(child: _buildTextField(_codeCtrl, 'Código', (v) { _productCodeSearch = v; _filtersDirty = true; setState(() {}); })),
                const SizedBox(width: 6),
                Expanded(child: _buildTextField(_nameCtrl, 'Descripción', (v) { _productNameSearch = v; _filtersDirty = true; setState(() {}); })),
              ],
            ),
            const SizedBox(height: 8),
            // NEW: FI Hierarchical Filters (replaces Familia/Subfamilia)
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.darkBase,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.grey.shade700),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.filter_alt, size: 14, color: AppTheme.neonBlue),
                      const SizedBox(width: 4),
                      const Text('Filtros de Producto', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  FiFiltersWidget(
                    compact: true,
                    showAdvanced: true, // Show all 5 FI levels
                    initialFilters: _fiFilters,
                    availableOptions: _fiOptions,
                    onFiltersChanged: (newFilters) {
                      setState(() {
                        _fiFilters = newFilters;
                        _filtersDirty = true;
                      });
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            // APPLY BUTTON
            Center(
              child: ElevatedButton.icon(
                onPressed: _filtersDirty ? () {
                  setState(() {
                    _selectedYears = Set.from(_pendingYears);
                    _selectedMonths = Set.from(_pendingMonths);
                    _filtersDirty = false;
                  });
                  _loadData();
                } : null,
                icon: const Icon(Icons.check, size: 16),
                label: Text(_filtersDirty ? 'Aplicar Filtros' : 'Filtros Aplicados', style: const TextStyle(fontSize: 11)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _filtersDirty ? AppTheme.neonBlue : Colors.grey,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField(TextEditingController ctrl, String hint, Function(String) onSubmit) {
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
            contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
            isDense: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(6)),
            suffixIcon: ctrl.text.isNotEmpty ? IconButton(
              icon: const Icon(Icons.clear, size: 14),
              onPressed: () { ctrl.clear(); onSubmit(''); },
              padding: EdgeInsets.zero,
            ) : null,
          ),
          onSubmitted: onSubmit,
        ),
      ),
    );
  }

  Widget _buildDropdown(String label, String? value, List<Map<String, dynamic>> options, Function(String?) onChange) {
    return SizedBox(
      height: 32,
      child: DropdownButtonFormField<String?>(
        value: value,
        decoration: InputDecoration(
          hintText: label,
          hintStyle: const TextStyle(fontSize: 10),
          contentPadding: const EdgeInsets.symmetric(horizontal: 8),
          isDense: true,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(6)),
        ),
        style: const TextStyle(fontSize: 10),
        items: [
          DropdownMenuItem(value: null, child: Text('Todas', style: const TextStyle(fontSize: 10))),
          ...options.map((o) => DropdownMenuItem(
            value: o['code'] as String, 
            child: Text(o['name'] as String, style: const TextStyle(fontSize: 10), overflow: TextOverflow.ellipsis)
          )),
        ],
        onChanged: onChange,
      ),
    );
  }

  Widget _buildSummaryRow() {
    if (_summary.isEmpty) {
       // Fallback to old manually calculated headers if summary missing (compatibility)
       // But backend should now send it.
    }
    // Inject breakdown if multiple years selected
    final years = _selectedYears.toList()..sort();
    if (years.length > 1) {
       // Map yearly totals from _monthlyTotals? No, backend doesn't send explicit yearly breakdown in summary yet?
       // Actually I left breakdown: [] in backend.
       // But SalesSummaryHeader handles empty breakdown gracefully (just doesn't show it).
    }
    return SalesSummaryHeader(
      summary: _summary,
      showMargin: widget.isJefeVentas,
    );
  }

  Widget _summaryItem(String value, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
          Text(label, style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }
  
  Widget _productStat(String label, String value, Color color, {bool isBold = false}) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: isBold ? 12 : 10, fontWeight: isBold ? FontWeight.bold : FontWeight.w500, color: color)),
        Text(label, style: TextStyle(fontSize: 7, color: AppTheme.textSecondary)),
      ],
    );
  }

  Widget _buildMonthlyRow() {
    return Container(
      height: 54, // Increased to accommodate content
      padding: const EdgeInsets.only(bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.darkBase, 
        border: Border(bottom: BorderSide(color: AppTheme.neonBlue, width: 2)),
        boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 4, offset: Offset(0, 2))]
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        itemCount: 12,
        itemBuilder: (c, i) {
          final m = i + 1;
          if (!_selectedMonths.contains(m)) return const SizedBox.shrink();
          
          final data = _monthlyTotals[m.toString()];
          final sales = (data?['sales'] as num?)?.toDouble() ?? 0;
          final yoyTrend = data?['yoyTrend'] as String?;
          final yoyVar = (data?['yoyVariation'] as num?)?.toDouble();
          
          Color borderColor = Colors.grey.withOpacity(0.3);
          Color bgColor = AppTheme.surfaceColor;
          
          if (yoyTrend == 'up') {
             borderColor = AppTheme.success;
             bgColor = AppTheme.success.withOpacity(0.15);
          } else if (yoyTrend == 'down') {
             borderColor = AppTheme.error;
             bgColor = AppTheme.error.withOpacity(0.15);
          }
          
          return Container(
            width: 60,
            margin: const EdgeInsets.only(right: 3),
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: borderColor, width: 1.5),
            ),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(_mNames[m - 1].toUpperCase(), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                  Text(_formatCurrency(sales), style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600)),
                  if (yoyVar != null && yoyVar != 0)
                    Text('${yoyVar >= 0 ? "+" : ""}${yoyVar.toStringAsFixed(0)}%', 
                      style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: yoyTrend == 'up' ? AppTheme.success : AppTheme.error)),
                ],
              ),
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

  // ===== FI HIERARCHY WIDGETS =====
  
  Widget _buildHierarchyToggle() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Text(
            _useFiHierarchy ? 'Jerarquía FI' : 'Familia/Subfamilia',
            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
          ),
          const SizedBox(width: 8),
          Transform.scale(
            scale: 0.8,
            child: Switch(
              value: _useFiHierarchy,
              onChanged: (v) => setState(() => _useFiHierarchy = v),
              activeColor: AppTheme.neonBlue,
              activeTrackColor: AppTheme.neonBlue.withOpacity(0.3),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFiHierarchyList() {
    if (_fiHierarchy.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.folder_off, size: 40, color: AppTheme.textSecondary.withOpacity(0.5)),
            const SizedBox(height: 8),
            Text('No hay jerarquía FI disponible', style: TextStyle(color: AppTheme.textSecondary)),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() => _useFiHierarchy = false),
              child: const Text('Ver Familia/Subfamilia'),
            ),
          ],
        ),
      );
    }
    
    return ListView.builder(
      padding: const EdgeInsets.all(4),
      itemCount: _fiHierarchy.length,
      itemBuilder: (c, i) => _buildFi1Card(_fiHierarchy[i]),
    );
  }

  Widget _buildFi1Card(Map<String, dynamic> fi1) {
    final code = fi1['fi1Code'] as String? ?? '';
    final name = fi1['fi1Name'] as String? ?? code;
    final nodeKey = 'fi1_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final children = List<Map<String, dynamic>>.from(
      (fi1['children'] as List?)?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? []
    );
    final sales = (fi1['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (fi1['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (fi1['totalMarginPercent'] as num?)?.toDouble() ?? 0;

    return Card(
      color: AppTheme.surfaceColor,
      margin: const EdgeInsets.only(bottom: 4),
      child: Column(
        children: [
          ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            leading: CircleAvatar(
              radius: 14, backgroundColor: AppTheme.neonPurple.withOpacity(0.2),
              child: const Text('F1', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            subtitle: Text('$code • ${children.length} FI2', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_formatCurrency(sales), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
                Text('${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
              ],
            ),
            onTap: () => setState(() { if (expanded) _expandedFiNodes.remove(nodeKey); else _expandedFiNodes.add(nodeKey); }),
          ),
          if (expanded) ...children.map((fi2) => _buildFi2Card(fi2, code)),
        ],
      ),
    );
  }

  Widget _buildFi2Card(Map<String, dynamic> fi2, String parentCode) {
    final code = fi2['fi2Code'] as String? ?? '';
    final name = fi2['fi2Name'] as String? ?? code;
    final nodeKey = 'fi2_${parentCode}_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final children = List<Map<String, dynamic>>.from(
      (fi2['children'] as List?)?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? []
    );
    final sales = (fi2['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (fi2['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (fi2['totalMarginPercent'] as num?)?.toDouble() ?? 0;

    return Container(
      margin: const EdgeInsets.only(left: 16, right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            leading: CircleAvatar(
              radius: 12, backgroundColor: AppTheme.neonBlue.withOpacity(0.2),
              child: const Text('F2', style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
            subtitle: Text('$code • ${children.length} FI3', style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_formatCurrency(sales), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                Text('${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}', style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)),
              ],
            ),
            onTap: () => setState(() { if (expanded) _expandedFiNodes.remove(nodeKey); else _expandedFiNodes.add(nodeKey); }),
          ),
          if (expanded) ...children.map((fi3) => _buildFi3Card(fi3, nodeKey)),
        ],
      ),
    );
  }

  Widget _buildFi3Card(Map<String, dynamic> fi3, String parentKey) {
    final code = fi3['fi3Code'] as String? ?? '';
    final name = fi3['fi3Name'] as String? ?? code;
    final nodeKey = 'fi3_${parentKey}_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final children = List<Map<String, dynamic>>.from(
      (fi3['children'] as List?)?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? []
    );
    final sales = (fi3['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (fi3['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (fi3['totalMarginPercent'] as num?)?.toDouble() ?? 0;

    return Container(
      margin: const EdgeInsets.only(left: 24, right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.darkBase,
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: 6),
            leading: CircleAvatar(
              radius: 10, backgroundColor: AppTheme.neonGreen.withOpacity(0.2),
              child: const Text('F3', style: TextStyle(fontSize: 7, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600)),
            subtitle: Text('$code • ${children.length} FI4', style: TextStyle(fontSize: 7, color: AppTheme.textSecondary)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_formatCurrency(sales), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
                Text('${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}', style: TextStyle(fontSize: 7, color: AppTheme.textSecondary)),
              ],
            ),
            onTap: () => setState(() { if (expanded) _expandedFiNodes.remove(nodeKey); else _expandedFiNodes.add(nodeKey); }),
          ),
          if (expanded) ...children.map((fi4) => _buildFi4Card(fi4, nodeKey)),
        ],
      ),
    );
  }

  Widget _buildFi4Card(Map<String, dynamic> fi4, String parentKey) {
    final code = fi4['fi4Code'] as String? ?? '';
    final name = fi4['fi4Name'] as String? ?? code;
    final nodeKey = 'fi4_${parentKey}_$code';
    final expanded = _expandedFiNodes.contains(nodeKey);
    final products = List<Map<String, dynamic>>.from(
      (fi4['products'] as List?)?.map((e) => Map<String, dynamic>.from(e as Map)).toList() ?? []
    );
    final sales = (fi4['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (fi4['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (fi4['totalMarginPercent'] as num?)?.toDouble() ?? 0;

    return Container(
      margin: const EdgeInsets.only(left: 32, right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor.withOpacity(0.5),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppTheme.warning.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: 6),
            leading: CircleAvatar(
              radius: 9, backgroundColor: AppTheme.warning.withOpacity(0.2),
              child: const Text('F4', style: TextStyle(fontSize: 6, fontWeight: FontWeight.bold, color: AppTheme.warning)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w500)),
            subtitle: Text('$code • ${products.length} prod.', style: TextStyle(fontSize: 7, color: AppTheme.textSecondary)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_formatCurrency(sales), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.warning)),
                Text('${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}', style: TextStyle(fontSize: 7, color: AppTheme.textSecondary)),
              ],
            ),
            onTap: () => setState(() { if (expanded) _expandedFiNodes.remove(nodeKey); else _expandedFiNodes.add(nodeKey); }),
          ),
          if (expanded) 
            Padding(
              padding: const EdgeInsets.only(left: 8, right: 4, bottom: 4),
              child: Column(
                children: products.map((p) => _buildFiProduct(p)).toList(),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildFiProduct(Map<String, dynamic> p) {
    final code = p['code'] as String? ?? '';
    final name = p['name'] as String? ?? code;
    final sales = (p['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (p['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (p['marginPercent'] as num?)?.toDouble() ?? 0;
    final yoyTrend = p['yoyTrend'] as String? ?? '';
    final monthly = p['monthly'] as Map<String, dynamic>? ?? {};

    Color borderColor = AppTheme.surfaceColor;
    if (yoyTrend == 'up') borderColor = AppTheme.success;
    else if (yoyTrend == 'down') borderColor = AppTheme.error;

    return Container(
      margin: const EdgeInsets.only(bottom: 3),
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: borderColor.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(code, style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(_formatCurrency(sales), style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: borderColor == AppTheme.surfaceColor ? AppTheme.textPrimary : borderColor)),
                  Text('${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}', style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)),
                ],
              ),
            ],
          ),
          if (monthly.isNotEmpty) ...[
            const SizedBox(height: 4),
            SizedBox(
              height: 28,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: 12,
                itemBuilder: (ctx, m) {
                  final mKey = (m + 1).toString();
                  final mData = monthly[mKey] as Map<String, dynamic>? ?? {};
                  final mSales = (mData['sales'] as num?)?.toDouble() ?? 0;
                  final mYoy = mData['yoyVar'] as String? ?? '';
                  
                  Color mColor = AppTheme.surfaceColor;
                  if (mYoy == 'up') mColor = AppTheme.success;
                  else if (mYoy == 'down') mColor = AppTheme.error;

                  return Container(
                    width: 32,
                    margin: const EdgeInsets.only(right: 2),
                    padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
                    decoration: BoxDecoration(
                      color: mColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(3),
                      border: Border.all(color: mColor.withOpacity(0.3)),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(_mNames[m].substring(0, 1).toUpperCase(), style: const TextStyle(fontSize: 7, fontWeight: FontWeight.bold)),
                        Text(_formatCompact(mSales), style: const TextStyle(fontSize: 7)),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatCompact(double v) {
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return v.toStringAsFixed(0);
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
    final subs = (rawSubs as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
    final sales = (f['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (f['totalUnits'] as num?)?.toDouble() ?? 0;
    final margin = (f['totalMarginPercent'] as num?)?.toDouble() ?? 0;
    
    int pCount = 0;
    for (var s in subs) pCount += (List.from(s['products'] ?? [])).length;

    return Card(
      color: AppTheme.surfaceColor,
      margin: const EdgeInsets.only(bottom: 4),
      child: Column(
        children: [
          ListTile(
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            leading: CircleAvatar(
              radius: 12, backgroundColor: AppTheme.neonBlue.withOpacity(0.2),
              child: Text(code, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            subtitle: Text('$pCount productos • ${subs.length} subfam.', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_formatCurrency(sales), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                Text('${units.toStringAsFixed(0)} uds${widget.isJefeVentas ? " • ${margin.toStringAsFixed(1)}%" : ""}', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
              ],
            ),
            onTap: () => setState(() { if (expanded) _expandedFamilies.remove(code); else _expandedFamilies.add(code); }),
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
    final prods = (rawProds as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
    final sales = (s['totalSales'] as num?)?.toDouble() ?? 0;
    final margin = (s['totalMarginPercent'] as num?)?.toDouble() ?? 0;
    final units = (s['totalUnits'] as num?)?.toDouble() ?? 0;
    final key = '$famCode|$code';
    final expanded = _expandedSubfamilies.contains(key);

    return Container(
      margin: const EdgeInsets.only(left: 12, right: 4, bottom: 2),
      decoration: BoxDecoration(
        color: AppTheme.darkBase,
        borderRadius: BorderRadius.circular(6),
        border: Border(left: BorderSide(color: AppTheme.neonPurple.withOpacity(0.5), width: 3))
      ),
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() { if (expanded) _expandedSubfamilies.remove(key); else _expandedSubfamilies.add(key); }),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), // Increased padding for touch target
              child: Row(
                children: [
                  Icon(expanded ? Icons.folder_open : Icons.folder, size: 16, color: Colors.grey),
                  const SizedBox(width: 8),
                  Expanded(child: Text(name.isNotEmpty ? name : 'General', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600))), // Bolder
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                       Text(_formatCurrency(sales), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                       if (widget.isJefeVentas) Text('${margin.toStringAsFixed(1)}% Mrg', style: TextStyle(fontSize: 8, color: margin > 0 ? AppTheme.success : AppTheme.error)),
                    ]
                  )
                ],
              ),
            ),
          ),
          if (expanded) ...prods.map((p) => _buildProduct(p)),
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
      case 'CAJA': unitLabel = 'Caja'; break;
      case 'KG': unitLabel = 'Kg'; break;
      case 'KILO': unitLabel = 'Kg'; break;
      case 'UNIDAD': unitLabel = 'Ud'; break;
      default: unitLabel = unitType.isNotEmpty ? unitType.substring(0, unitType.length > 4 ? 4 : unitType.length) : 'Ud';
    }
    
    // Discount/Pricing extended info
    final avgDiscountPct = (p['avgDiscountPct'] as num?)?.toDouble() ?? 0;
    final avgDiscountEur = (p['avgDiscountEur'] as num?)?.toDouble() ?? 0;
    
    // Previous year data for YoY comparison
    final prevYearSales = (p['prevYearSales'] as num?)?.toDouble() ?? 0;
    final prevYearUnits = (p['prevYearUnits'] as num?)?.toDouble() ?? 0;
    final prevYearAvgPrice = (p['prevYearAvgPrice'] as num?)?.toDouble() ?? 0;
    
    // Calculate variations (kept for potential future use)
    final priceVariation = prevYearAvgPrice > 0 ? ((avgUnitPrice - prevYearAvgPrice) / prevYearAvgPrice) * 100 : 0.0;
    final unitsVariation = prevYearUnits > 0 ? ((units - prevYearUnits) / prevYearUnits) * 100 : 0.0;
    final salesVariation = prevYearSales > 0 ? ((sales - prevYearSales) / prevYearSales) * 100 : 0.0;

    return Container(
      margin: const EdgeInsets.only(left: 8, right: 4, bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(8),
        border: discount ? Border.all(color: Colors.orange.withOpacity(0.5), width: 1.5) : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Product header
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Code badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(color: AppTheme.neonBlue.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                child: Text(code, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 8),
              // Name
              Expanded(
                child: Text(name, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis, maxLines: 2),
              ),
            ],
          ),
          const SizedBox(height: 8),
          
          // Pricing info row - INLINE YoY COMPARISON with actual values
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.neonPurple.withOpacity(0.08),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              children: [
                // Unit Price with prev year value inline
                Expanded(
                  child: Column(
                    children: [
                      Text('PVP/$unitLabel', style: TextStyle(fontSize: 8, color: Colors.grey.shade400)),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(_formatCurrency(avgUnitPrice), style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
                          if (prevYearAvgPrice > 0)
                            Text(' (${_formatCurrency(prevYearAvgPrice)})', style: TextStyle(fontSize: 8, color: Colors.grey.shade500)),
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
                        Text('Coste/$unitLabel', style: TextStyle(fontSize: 8, color: Colors.grey.shade400)),
                        Text(_formatCurrency(avgUnitCost), style: TextStyle(fontSize: 10, color: Colors.grey.shade300)),
                      ],
                    ),
                  ),
                // Margin per unit - only for jefe de ventas
                if (widget.isJefeVentas)
                  Expanded(
                    child: Column(
                      children: [
                        Text('Margen/$unitLabel', style: TextStyle(fontSize: 8, color: Colors.grey.shade400)),
                        Text(_formatCurrency(marginPerUnit), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: marginPerUnit >= 0 ? AppTheme.success : AppTheme.error)),
                      ],
                    ),
                  ),
                // Units with prev year value inline
                Expanded(
                  child: Column(
                    children: [
                      Text(unitLabel, style: TextStyle(fontSize: 8, color: Colors.grey.shade400)),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(units >= 100 ? units.toStringAsFixed(0) : units.toStringAsFixed(2), 
                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.neonBlue)),
                          if (prevYearUnits > 0)
                            Text(' (${prevYearUnits >= 100 ? prevYearUnits.toStringAsFixed(0) : prevYearUnits.toStringAsFixed(2)})', 
                              style: TextStyle(fontSize: 8, color: Colors.grey.shade500)),
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
              color: AppTheme.darkBase,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                // Total with prev year inline: "2025 (2024)"
                Column(
                  children: [
                    Text('Total ${_selectedYears.length == 1 ? _selectedYears.first : "Periodo"}', style: TextStyle(fontSize: 7, color: AppTheme.textSecondary)),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_formatCurrency(sales), style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                        if (prevYearSales > 0)
                          Text(' (${_formatCurrency(prevYearSales)})', style: TextStyle(fontSize: 9, color: Colors.grey.shade500)),
                      ],
                    ),
                    if (prevYearSales > 0)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(salesVariation >= 0 ? Icons.trending_up : Icons.trending_down, size: 10, color: salesVariation >= 0 ? AppTheme.success : AppTheme.error),
                          Text(
                            ' ${salesVariation >= 0 ? "+" : ""}${salesVariation.toStringAsFixed(0)}%',
                            style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: salesVariation >= 0 ? AppTheme.success : AppTheme.error),
                          ),
                        ],
                      ),
                  ],
                ),
                if (widget.isJefeVentas) _productStat('Margen', '${marginPercent.toStringAsFixed(1)}%', marginPercent >= 0 ? AppTheme.success : AppTheme.error),
                if (discount || avgDiscountPct > 0 || avgDiscountEur > 0)
                 _productStat(
                   avgDiscountPct > 0 ? '-${avgDiscountPct.toStringAsFixed(0)}%' : 'Dto', 
                   avgDiscountEur > 0 ? '-${_formatCurrency(avgDiscountEur)}' : (avgDiscountPct > 0 ? '${avgDiscountPct.toStringAsFixed(0)}%' : '✓'),
                   Colors.orange,
                   isBold: true
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
                if (!_selectedMonths.contains(m)) return const SizedBox.shrink();
                final d = monthly[m.toString()];
                final s = (d?['sales'] as num?)?.toDouble() ?? 0;
                final prevS = (d?['prevSales'] as num?)?.toDouble() ?? 0; 
                final trend = d?['yoyTrend'] as String?;
                final yoyVar = (d?['yoyVariation'] as num?)?.toDouble();
                
                // Determine State
                bool isNew = prevS < 0.01 && s > 0;
                bool isLost = s == 0 && prevS > 0;
                bool isNeutral = trend == 'neutral' || trend == null;
                
                // Background & Border Colors
                Color bc = Colors.grey.shade800;
                Color bgColor = Colors.transparent;
                double bWidth = 0.5;
                if (s > 0) bc = Colors.grey.shade600;
                
                if (isNew) {
                   bc = AppTheme.neonBlue; 
                   bgColor = AppTheme.neonBlue.withOpacity(0.1); 
                   bWidth = 1.0;
                } else if (!isNeutral) {
                   if (trend == 'up') { bc = AppTheme.success; bgColor = AppTheme.success.withOpacity(0.15); bWidth = 1.5; }
                   if (trend == 'down') { bc = AppTheme.error; bgColor = AppTheme.error.withOpacity(0.15); bWidth = 1.5; }
                }

                return Container(
                  width: 60,
                  margin: const EdgeInsets.only(right: 2),
                  decoration: BoxDecoration(
                    color: s > 0 ? bgColor : Colors.transparent,
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: bc, width: bWidth),
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Padding(
                      padding: const EdgeInsets.all(2),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                           Text(_mNames[m-1], style: TextStyle(fontSize: 8, color: Colors.grey)),
                           
                           // SALES DISPLAY
                           if (s > 0) 
                             Text(_formatCurrency(s), style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold))
                           else if (isLost)
                             Text('(${_formatCurrency(prevS)})', style: TextStyle(fontSize: 8, color: Colors.white38)) 
                           else
                             const Text('-', style: TextStyle(fontSize: 8, color: Colors.grey)),

                           // VARIATION DISPLAY (Strict Logic)
                           if (isNew)
                             const Text('NUEVO', style: TextStyle(fontSize: 7, fontWeight: FontWeight.bold, color: AppTheme.neonBlue))
                           else if (isLost)
                             const Text('-100%', style: TextStyle(fontSize: 7, fontWeight: FontWeight.bold, color: AppTheme.error))
                           else if (prevS > 0 && yoyVar != null)
                             _buildStrictPercentage(yoyVar, trend ?? 'neutral')
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
     if (variation.abs() < 1.0) { // Strict check for negligible variation
         return const Text('0%', style: TextStyle(fontSize: 7, fontWeight: FontWeight.bold, color: Colors.grey));
     }
     
     final isPositive = variation > 0;
     final color = trend == 'neutral' ? Colors.grey : (isPositive ? AppTheme.success : AppTheme.error);
     final prefix = isPositive ? "+" : ""; // No prefix if 0, but logic above handles < 1.0
     
     return Text('$prefix${variation.toStringAsFixed(0)}%', 
         style: TextStyle(fontSize: 7, fontWeight: FontWeight.bold, color: color));
  }
}
