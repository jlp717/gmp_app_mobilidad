import 'package:flutter/material.dart';
import 'dart:async';
// ignore: unused_import
import 'dart:ui'; 
import 'package:flutter/foundation.dart'; // For compute
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/providers/dashboard_provider.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/widgets/multi_select_dialog.dart';
import '../../../../core/widgets/fi_filters_widget.dart';
import '../../../../core/widgets/error_state_widget.dart';
import '../../../../core/utils/date_formatter.dart';
// SmartSyncHeader already imported in line 10 theoretically, but let's just keep one. 
// Step 1420 lines 10 & 11 were both SmartSyncHeader.
import '../../../../core/widgets/smart_sync_header.dart'; // Import Sync Header
import '../widgets/matrix_data_table.dart';
import '../widgets/hierarchy_selector.dart';
import '../widgets/hierarchy_section.dart'; // New import
import '../widgets/advanced_sales_chart.dart'; // Kept for HierarchySection internal use
import '../widgets/dashboard_chart_factory.dart'; // Add factory import

/// Professional Dashboard - Power BI Style for Sales Manager
/// Multi-select filters: Years, Months, Vendors, Clients
/// Drill-down capabilites
class DashboardContent extends StatefulWidget {
  const DashboardContent({super.key});

  @override
  State<DashboardContent> createState() => _DashboardContentState();
}

class _DashboardContentState extends State<DashboardContent> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;
  // Multi-select date filters
  Set<int> _selectedYears = {DateTime.now().year};
  Set<int> _selectedMonths = {for (var i = 1; i <= DateTime.now().month; i++) i}; // Default YTD
  
  // Filters
  String? _selectedVendedor; // Sales Rep Code
  Set<String> _selectedClientCodes = {};

  Set<String> _selectedProductCodes = {};
  // NEW: FI hierarchical filters (replaces _selectedFamilyCodes)
  FiFilterState _fiFilters = const FiFilterState();

  // Pending changes for manual apply
  Set<int> _pendingYears = {};
  Set<int> _pendingMonths = {};
  bool _hasPendingChanges = false;
  
  // Metadata for filters
  List<Map<String, dynamic>> _vendedoresDisponibles = [];

  List<Map<String, dynamic>> _clientsDisponibles = [];
  // REMOVED: _familiesDisponibles - now using FI API directly
  
  // HIERARCHY STATE - Supports any hierarchy combination with 2-step backend approach
  List<String> _hierarchy = ['vendor', 'client']; // User can customize via HierarchySelector
  
  // Data state
  Map<String, dynamic>? _kpiData;
  List<MatrixNode> _matrixData = []; // Hierarchical Data
  List<String> _matrixPeriods = [];
  bool _isLoading = false;
  String? _error;
  DateTime? _lastFetchTime; // Track last sync time

  // State for Chart Drill Down
  // State for Cascading Selection
  List<MatrixNode> _selectionPath = []; // Path of selected nodes (e.g. [VendorNode, ClientNode])

  static const List<String> _monthNamesShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  @override
  void initState() {
    super.initState();
    _pendingYears = Set.from(_selectedYears);
    _pendingMonths = Set.from(_selectedMonths);
    _loadVendedores();
    // Optimization: Don't load massive client list on init for Jefe de Ventas. 
    // Wait for filter interaction or specific vendor selection.
    // _loadClients(); 
    _fetchAllData();
  }

  /// REMOVED: _loadFamilies - FI options are loaded by FiFiltersWidget

  /// FI Filters Dialog (replaces Family Filter)
  void _openFiFiltersDialog() async {
    final result = await showDialog<FiFilterState>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: AppTheme.surfaceColor,
        child: Container(
          padding: const EdgeInsets.all(16),
          constraints: const BoxConstraints(maxWidth: 400, maxHeight: 400),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.filter_alt, color: AppTheme.neonBlue),
                  const SizedBox(width: 8),
                  const Text('Filtros de Producto', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Expanded(
                child: SingleChildScrollView(
                  child: _FiFilterDialogContent(
                    initialFilters: _fiFilters,
                    onApply: (newFilters) {
                      Navigator.pop(context, newFilters);
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (result != null) {
      setState(() {
        _fiFilters = result;
      });
      _fetchAllData();
    }
  }

  /// Load available vendors for filter
  Future<void> _loadVendedores() async {
    try {
      final response = await ApiClient.get('/rutero/vendedores', cacheKey: 'vendedores_list', cacheTTL: const Duration(hours: 1));
      debugPrint('📋 Vendedores API response: ${response.runtimeType} - keys: ${response is Map ? response.keys : 'not a map'}');
      if (mounted) {
        setState(() {
          // Safe conversion - convert each item explicitly to Map<String, dynamic>
          final Map<String, dynamic> data = Map<String, dynamic>.from(response as Map);
          final rawList = data['vendedores'] ?? [];
          debugPrint('📋 Raw vendedores list length: ${rawList is List ? rawList.length : 'not a list'}');
          _vendedoresDisponibles = (rawList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
          debugPrint('📋 Vendedores disponibles loaded: ${_vendedoresDisponibles.length}');
        });
      }
    } catch (e) {
      debugPrint('❌ Error loading vendedores: $e');
    }
  }

  /// Load clients - Optimize for Jefe de Ventas (High volume)
  Future<void> _loadClients({bool initial = false}) async {
    // If specific vendor selected, load all their clients (usually small subset).
    // If Jefe de Ventas (no vendor selected), load only Top 50 initially to prevent lag.
    final limit = _selectedVendedor != null ? '1000' : '50';
    
    try {
      final params = <String, dynamic>{'limit': limit};
      if (_selectedVendedor != null) params['vendedorCodes'] = _selectedVendedor;
      
      final response = await ApiClient.get('/clients/list', 
        queryParameters: params, 
        cacheKey: 'clients_dropdown_${_selectedVendedor ?? 'top50'}', 
        cacheTTL: const Duration(minutes: 30)
      );
      
      if (mounted) {
        setState(() {
          final Map<String, dynamic> data = Map<String, dynamic>.from(response as Map);
          final rawList = data['clients'] ?? [];
          _clientsDisponibles = (rawList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        });
      }
    } catch (e) {
      debugPrint('Error loading clients: $e');
    }
  }

  /// Open MultiSelect for Clients with Remote Search Support
  void _openClientFilter() async {
    // Load initial batch if empty (e.g. first open)
    if (_clientsDisponibles.isEmpty) await _loadClients(initial: true);

    if (!mounted) return;

    final result = await showDialog<Set<Map<String, dynamic>>>(
      context: context,
      builder: (context) => MultiSelectDialog<Map<String, dynamic>>(
        items: _clientsDisponibles,
        // Reconstruct selection from codes
        // We might need to keep the full objects of selected clients? 
        // For now, we only have codes. We find matches in _clientsDisponibles or create dummy objects if missing (not ideal but visual only)
        selectedItems: _clientsDisponibles.where((c) => _selectedClientCodes.contains(c['code'])).toSet(),
        title: 'Filtrar Clientes',
        labelBuilder: (item) => '${item['name']} (${item['code']})',
        // Server-side search implementation
        onRemoteSearch: (query) async {
           if (query.length < 3) return _clientsDisponibles; // Return default if query too short
           final params = <String, dynamic>{'search': query, 'limit': '50'};
           if (_selectedVendedor != null) params['vendedorCodes'] = _selectedVendedor;
           
           final res = await ApiClient.get('/clients/list', queryParameters: params); // No cache for search or short TTL
           final rawList = res['clients'] ?? [];
           return (rawList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        },
      ),
    );

    if (result != null) {
      setState(() {
        _selectedClientCodes = result.map((c) => c['code'].toString()).toSet();
      });
      _fetchAllData();
    }

  }

  // REMOVED: _openFamilyFilter - replaced by _openFiFiltersDialog above

  Future<void> _fetchAllData() async {
    if (!mounted) return;
    setState(() { 
      _isLoading = true; 
      _error = null;
      
      // Dynamic Hierarchy Optimization
      // Removed to respect User's manual hierarchy choice as requested.
      // Users can now manually add/remove 'product' or 'family' via the selector.

    });
    
    final provider = Provider.of<DashboardProvider>(context, listen: false);
    
    try {
      final params = <String, String>{};
      
      // Vendor codes
      if (_selectedVendedor != null && _selectedVendedor!.isNotEmpty) {
        params['vendedorCodes'] = _selectedVendedor!;
      } else if (provider.vendedorCodes.isNotEmpty) {
        params['vendedorCodes'] = provider.vendedorCodes.join(',');
      }

      // Client Codes
      if (_selectedClientCodes.isNotEmpty) {
        params['clientCodes'] = _selectedClientCodes.join(',');
      }

      // Product Codes
      if (_selectedProductCodes.isNotEmpty) {
        params['productCodes'] = _selectedProductCodes.join(',');
      }

      // NEW: FI Hierarchical Filters (replaces Family Codes)
      if (_fiFilters.fi1 != null) params['fi1'] = _fiFilters.fi1!;
      if (_fiFilters.fi2 != null) params['fi2'] = _fiFilters.fi2!;
      if (_fiFilters.fi3 != null) params['fi3'] = _fiFilters.fi3!;
      if (_fiFilters.fi4 != null) params['fi4'] = _fiFilters.fi4!;
      if (_fiFilters.fi5 != null) params['fi5'] = _fiFilters.fi5!;
      
      // Add year filter (Multi-select)
      params['years'] = _selectedYears.join(',');
      params['year'] = _selectedYears.reduce((a, b) => a > b ? a : b).toString(); // Primary year for some legacy logic checks
      
      params['groupBy'] = _hierarchy.join(','); // Send full hierarchy
      
      // Fetch data
      final results = await Future.wait([
        ApiClient.get('/dashboard/matrix-data', 
          queryParameters: params,
          cacheKey: 'dash_matrix_${params.toString()}_v2', // Changed key (v2)
          cacheTTL: const Duration(minutes: 15),
        ),
        ApiClient.get('/dashboard/metrics', 
          queryParameters: params,
          cacheKey: 'dashboard_metrics_${params.toString()}',
          cacheTTL: const Duration(minutes: 5),
        ),
      ]);
      
      if (!mounted) return;
      
      if (!mounted) return;

      // Safe type conversion for API response
      final matrixData = Map<String, dynamic>.from(results[0] as Map);
      final rawList = matrixData['rows'] ?? [];
      var rawRows = (rawList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
      
      // Filter by selected year and months
      final filteredRows = rawRows.where((row) {
        final dynamic yearVal = row['YEAR'] ?? row['year'];
        final dynamic monthVal = row['MONTH'] ?? row['month'];
        
        int? year;
        int? month;
        
        if (yearVal is int) year = yearVal;
        else if (yearVal is num) year = yearVal.toInt();
        else if (yearVal is String) year = int.tryParse(yearVal);
        
        if (monthVal is int) month = monthVal;
        else if (monthVal is num) month = monthVal.toInt();
        else if (monthVal is String) month = int.tryParse(monthVal);
        
        if (year == null || !_selectedYears.contains(year)) return false;
        
        if (_selectedMonths.isNotEmpty && month != null) {
          if (!_selectedMonths.contains(month)) return false;
        }
        
        return true;
      }).toList();
      
      // Process Flat Rows into Tree (Outside setState)
      final treeData = await compute(buildTreeIsolate, TreeBuildParams(rows: filteredRows, hierarchy: _hierarchy));
      
      if (!mounted) return;
      
      setState(() {
        _matrixData = treeData;
        _selectionPath = []; // Reset selection on new fetch
        _matrixPeriods = List<String>.from((matrixData['periods'] as List?) ?? []);
        _kpiData = Map<String, dynamic>.from(results[1] as Map);
        _isLoading = false;
        _lastFetchTime = DateTime.now();
      });
    } catch (e) {
      debugPrint('Error fetching dashboard: $e');
      if (mounted) {
        setState(() { _error = e.toString(); _isLoading = false; });
      }
    }
  }

  /// Safe value extraction
  double _safeDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    if (value is Map) {
      final v = value['value'];
      if (v != null) return _safeDouble(v);
    }
    return 0.0;
  }

  int _safeInt(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? 0;
    if (value is Map) {
      final v = value['value'];
      if (v != null) return _safeInt(v);
    }
    return 0;
  }

  void _onNodeTap(MatrixNode node, int level) {
    setState(() {
       // Check if this node is already in the selection path at this level
       final bool isAlreadySelected = level < _selectionPath.length && 
                                       _selectionPath[level].id == node.id;
       
       if (isAlreadySelected) {
         // COLLAPSE: User tapped the same node - remove it and all deeper selections
         _selectionPath = _selectionPath.sublist(0, level);
       } else {
         // EXPAND NEW: User tapped a different node at this level
         // First, trim the path to remove any existing selection at this level and deeper
         _selectionPath = _selectionPath.sublist(0, level);
         
         // Then add this node if it has children to expand
         if (node.children.isNotEmpty) {
            _selectionPath.add(node);
         }
       }
    }); 
  }



  
  void _resetFilters() {
    setState(() {
      _selectedVendedor = null;
      _selectedClientCodes.clear();
      _fiFilters = const FiFilterState(); // Reset FI filters
      _hierarchy = ['vendor', 'client']; // Reset hierarchy
      _selectedYears = {DateTime.now().year};
      _selectedMonths = {for (var i = 1; i <= DateTime.now().month; i++) i};
      _selectionPath = [];
    });
    _loadClients(initial: true);
    _fetchAllData();
  }

  /// Build summary text for active FI filters
  String _buildFiFilterSummary() {
    final parts = <String>[];
    if (_fiFilters.fi1 != null) parts.add('Cat');
    if (_fiFilters.fi2 != null) parts.add('Sub');
    if (_fiFilters.fi5 != null) parts.add('Tipo');
    if (_fiFilters.fi3 != null) parts.add('Det');
    if (_fiFilters.fi4 != null) parts.add('Esp');
    return parts.isEmpty ? 'Categorías' : parts.join('+');
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // Required for AutomaticKeepAliveClientMixin
    final provider = Provider.of<DashboardProvider>(context);
    final isJefeVentas = provider.isJefeVentas;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: RefreshIndicator(
        onRefresh: _fetchAllData,
        child: SingleChildScrollView(
          padding: EdgeInsets.zero, // Zero padding because Header is top-full-width
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Smart Sync Header
              SmartSyncHeader(
                title: 'Panel de Control',
                subtitle: 'Visión General del Negocio',
                lastSync: _lastFetchTime,
                isLoading: _isLoading,
                onSync: _fetchAllData,
              ),
              
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHeader(),
                    const SizedBox(height: 16),
                    if (isJefeVentas) ...[
                      _buildFiltersSection(),
                      const SizedBox(height: 12),
                    ],
                    _buildDateFilters(),
                    const SizedBox(height: 16),
                      if (_isLoading && _matrixData.isEmpty) 
                        const Padding(
                          padding: EdgeInsets.all(60.0),
                          child: ModernLoading(message: 'Analizando tendencias...'),
                        )
                      else if (_error != null && _matrixData.isEmpty)
                        _buildErrorWidget()
                      else ...[
                        if (_isLoading) const LinearProgressIndicator(color: AppTheme.neonBlue),
                        _buildKPISection(),
                        const SizedBox(height: 24),
                        // Hierarchy Selector Replaces Fixed Breadcrumbs
                        // Loading overlay indicator when hierarchy changes
                        Stack(
                          alignment: Alignment.center,
                          children: [
                            HierarchySelector(
                              currentHierarchy: _hierarchy,
                              onChanged: (newHierarchy) {
                                setState(() {
                                  _hierarchy = newHierarchy;
                                  _selectionPath = []; // Clear selection on hierarchy change
                                });
                                _fetchAllData();
                              },
                            ),
                            if (_isLoading)
                              Positioned.fill(
                                child: Container(
                                  color: Colors.black.withOpacity(0.3),
                                  child: const Center(
                                    child: SizedBox(
                                      width: 20, height: 20,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonBlue),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        if (_matrixData.isNotEmpty) _buildCascadingSections(),
                      ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        const Icon(Icons.dashboard, color: AppTheme.neonBlue, size: 28),
        const SizedBox(width: 12),
        const Text('Panel de Control', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
        const Spacer(),
        IconButton(
          icon: const Icon(Icons.cleaning_services_outlined, color: AppTheme.neonBlue),
          onPressed: _resetFilters,
          tooltip: 'Resetear Filtros',
        ),
        // Removed separate Refresh button as it's now in SmartSyncHeader
      ],
    );
  }

  Widget _buildFiltersSection() {
    return Row(
      children: [
        // Vendor Dropdown
        Expanded(
          flex: 2,
          child: DropdownButtonFormField<String>(
            value: _vendedoresDisponibles.any((v) => v['code'].toString() == _selectedVendedor) ? _selectedVendedor : '',
            isExpanded: true,
            decoration: InputDecoration(
              filled: true,
              fillColor: AppTheme.surfaceColor,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: _selectedVendedor != null ? AppTheme.neonBlue : Colors.transparent)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.neonBlue)),
              prefixIcon: const Icon(Icons.person, color: AppTheme.neonBlue, size: 20),
            ),
            dropdownColor: AppTheme.darkCard,
            icon: const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue),
            style: const TextStyle(color: Colors.white, fontSize: 13),
            items: [
               const DropdownMenuItem<String>(value: '', child: Text('Todos')),
               ..._vendedoresDisponibles.map((v) {
                 return DropdownMenuItem<String>(
                   value: v['code'].toString(),
                   child: Text((v['name'] as String?) ?? v['code'].toString(), overflow: TextOverflow.ellipsis),
                 );
               }),
            ],
            onChanged: (val) async {
                 setState(() {
                    _selectedVendedor = val?.isEmpty == true ? null : val;
                    // Clear dependent filters when vendor changes (interdependent filters)
                    _selectedClientCodes.clear();
                    _clientsDisponibles.clear(); // Force reload
                 });
                 // Reload clients for the new vendor selection
                 await _loadClients();
                 _fetchAllData();
            },
          ),
        ),
        const SizedBox(width: 8),
        // Client Filter Button
        Expanded(
          flex: 2,
          child: GestureDetector(
            onTap: _openClientFilter, // Use dedicated method with proper loading
            child: Container(
              height: 44,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppTheme.surfaceColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _selectedClientCodes.isNotEmpty ? AppTheme.neonPurple : Colors.transparent),
              ),
              child: Row(
                children: [
                  Icon(Icons.people_alt, color: _selectedClientCodes.isNotEmpty ? AppTheme.neonPurple : AppTheme.textSecondary, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _selectedClientCodes.isEmpty 
                        ? 'Clientes' 
                        : '${_selectedClientCodes.length} selec.',
                      style: TextStyle(color: _selectedClientCodes.isNotEmpty ? Colors.white : Colors.white54, fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.arrow_drop_down, color: Colors.white54),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        // FI Filters Button (replaces Family Filter)
        Expanded(
          flex: 2,
          child: GestureDetector(
            onTap: _openFiFiltersDialog,
            child: Container(
              height: 44,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppTheme.surfaceColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _fiFilters.isNotEmpty ? AppTheme.neonBlue : Colors.transparent),
              ),
              child: Row(
                children: [
                  Icon(Icons.filter_alt, color: _fiFilters.isNotEmpty ? AppTheme.neonBlue : AppTheme.textSecondary, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _fiFilters.isEmpty 
                        ? 'Categorías' 
                        : _buildFiFilterSummary(),
                      style: TextStyle(color: _fiFilters.isNotEmpty ? Colors.white : Colors.white54, fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.arrow_drop_down, color: Colors.white54),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        // Product Filter Button
        Expanded(
          flex: 2,
          child: GestureDetector(
            onTap: () async {
               // Show product search dialog
               final result = await showDialog<Set<Map<String, dynamic>>>(
                 context: context,
                 builder: (context) => _ProductSearchDialog(
                   initialSelection: _selectedProductCodes,
                 ),
               );
               
               if (result != null) {
                 setState(() {
                   _selectedProductCodes = result.map((m) => m['code'].toString()).toSet();
                 });
                 _fetchAllData();
               }
            },
            child: Container(
              height: 44,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppTheme.surfaceColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _selectedProductCodes.isNotEmpty ? AppTheme.neonPurple : Colors.transparent),
              ),
              child: Row(
                children: [
                  Icon(Icons.inventory_2, color: _selectedProductCodes.isNotEmpty ? AppTheme.neonPurple : AppTheme.textSecondary, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _selectedProductCodes.isEmpty 
                        ? 'Productos' 
                        : '${_selectedProductCodes.length} selec.',
                      style: TextStyle(color: _selectedProductCodes.isNotEmpty ? Colors.white : Colors.white54, fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.arrow_drop_down, color: Colors.white54),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDateFilters() {
    return ExpansionTile(
      title: Row(
        children: [
          const Text('Filtros de Fecha', style: TextStyle(color: AppTheme.neonBlue, fontSize: 14)),
          if (_hasPendingChanges) ...[
             const SizedBox(width: 12),
             Container(
               padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
               decoration: BoxDecoration(color: Colors.amber.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
               child: const Text('Cambios pendientes', style: TextStyle(color: Colors.amber, fontSize: 10)),
             )
          ]
        ],
      ),
      initiallyExpanded: false,
      collapsedBackgroundColor: AppTheme.surfaceColor.withOpacity(0.5),
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      collapsedShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      childrenPadding: const EdgeInsets.all(12),
      children: [
        // Years
        Row(
           crossAxisAlignment: CrossAxisAlignment.start,
           children: [
             const Padding(
               padding: EdgeInsets.only(top: 8),
               child: Text('Años:', style: TextStyle(color: Colors.white, fontSize: 12)),
             ),
             const SizedBox(width: 12),
             Expanded(
               child: Wrap(
                 spacing: 8,
                 children: ApiConfig.availableYears.map((year) => FilterChip(
                   label: Text('$year', style: const TextStyle(fontSize: 11)),
                   selected: _pendingYears.contains(year),
                   onSelected: (selected) {
                     setState(() {
                       if (selected) _pendingYears.add(year);
                       else if (_pendingYears.length > 1) _pendingYears.remove(year); // Prevent empty
                       _hasPendingChanges = true;
                     });
                   },
                   selectedColor: AppTheme.neonPurple.withOpacity(0.3),
                   checkmarkColor: AppTheme.neonPurple,
                   shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                 )).toList(),
               ),
             ),
           ],
        ),
        const SizedBox(height: 12),
        // Months
        Row(
          children: [
             const Text('Meses:', style: TextStyle(color: Colors.white, fontSize: 12)),
             const Spacer(),
             TextButton(
               child: const Text('YTD', style: TextStyle(fontSize: 11)),
               onPressed: () {
                 setState(() {
                   _pendingMonths = {for (var i = 1; i <= DateTime.now().month; i++) i};
                   _hasPendingChanges = true;
                 });
               },
             ),
             TextButton(
               child: const Text('Todos', style: TextStyle(fontSize: 11)),
               onPressed: () {
                 setState(() {
                   _pendingMonths = {for (var i = 1; i <= 12; i++) i};
                   _hasPendingChanges = true;
                 });
               },
             ),
             TextButton(
               child: const Text('Limpiar', style: TextStyle(fontSize: 11, color: AppTheme.neonBlue)),
               onPressed: () {
                 setState(() {
                   _pendingMonths.clear();
                   _hasPendingChanges = true;
                 });
               },
             ),
          ],
        ),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: List.generate(12, (i) => FilterChip(
            label: Text(_monthNamesShort[i], style: const TextStyle(fontSize: 10)),
            selected: _pendingMonths.contains(i + 1),
            onSelected: (selected) {
              setState(() {
                if (selected) _pendingMonths.add(i + 1);
                else _pendingMonths.remove(i + 1);
                _hasPendingChanges = true;
              });
            },
            selectedColor: AppTheme.neonBlue.withOpacity(0.3),
            checkmarkColor: AppTheme.neonBlue,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
          )),
        ),
        const SizedBox(height: 16),
        // Apply Button
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _hasPendingChanges ? () {
              setState(() {
                _selectedYears = Set.from(_pendingYears);
                _selectedMonths = Set.from(_pendingMonths);
                _hasPendingChanges = false;
              });
              _fetchAllData();
            } : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              disabledBackgroundColor: Colors.white10,
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('Aplicar Cambios', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ),
      ],
    );
  }


  // Removed _buildHierarchyBreadcrumbs as we use HierarchySelector now

  Widget _buildKPISection() {
    if (_kpiData == null) return const SizedBox();
    
    final totalSales = _safeDouble(_kpiData!['totalSales']);
    final totalOrders = _safeInt(_kpiData!['totalOrders']);
    final uniqueClients = _safeInt(_kpiData!['uniqueClients']);
    final todaySales = _safeDouble(_kpiData!['todaySales']);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Indicadores Clave', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            if (_kpiData != null)
               Text('${DateFormatter.getMonthName(_kpiData!['period']['month'] as int)} ${_kpiData!['period']['year']}', style: const TextStyle(color: Colors.white30, fontSize: 11)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildKPICard('Ventas Período', CurrencyFormatter.format(totalSales), Icons.euro, AppTheme.neonBlue)),
            const SizedBox(width: 12),
            Expanded(child: _buildKPICard('Cartera Activa', uniqueClients.toString(), Icons.people, AppTheme.neonPurple)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildKPICard('Ventas Hoy', CurrencyFormatter.format(todaySales), Icons.today, Colors.amber)),
            const SizedBox(width: 12),
            Expanded(child: _buildKPICard('Pedidos Hoy', totalOrders.toString(), Icons.shopping_cart, AppTheme.neonGreen)),
          ],
        ),
      ],
    );
  }

  Widget _buildKPICard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
        boxShadow: [
          BoxShadow(color: color.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: const TextStyle(color: Colors.white70, fontSize: 11), overflow: TextOverflow.ellipsis)),
            ],
          ),
          const SizedBox(height: 12),
          Text(value, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }

  Widget _buildErrorWidget() {
    return ErrorStateWidget(
      message: 'Error: $_error',
      onRetry: _fetchAllData,
    );
  }

  // Calculate total margin for a list of nodes
  double _calculateTotalMargin(List<MatrixNode> nodes) {
    return nodes.fold(0.0, (sum, node) => sum + node.margin);
  }
  
  double _calculateTotalSales(List<MatrixNode> nodes) {
    return nodes.fold(0.0, (sum, node) => sum + node.sales);
  }

  Widget _buildMarginTotalBanner(String level, double margin, double sales, int depth) {
    final marginPct = sales > 0 ? (margin / sales) * 100 : 0.0;
    return Container(
      margin: EdgeInsets.only(left: depth * 16.0, bottom: 8, top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.orange.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.orange.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.analytics_outlined, color: Colors.orange, size: 16),
          const SizedBox(width: 8),
          Text(
            'MARGEN $level: ',
            style: const TextStyle(color: Colors.orange, fontSize: 11, fontWeight: FontWeight.bold),
          ),
          Text(
            '${CurrencyFormatter.format(margin)} (${marginPct.toStringAsFixed(1)}%)',
            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  // Helper to build HierarchySection with proper level capture
  Widget _buildHierarchySectionWithLevel({
    required String title,
    required String levelName,
    required List<MatrixNode> data,
    required MatrixNode? selectedNode,
    required Color color,
    required ChartType chartType,
    required int level,
  }) {
    // IMPORTANT: Capture level in local variable for closure
    final capturedLevel = level;
    
    return HierarchySection(
      title: title,
      levelName: levelName,
      data: data,
      hierarchy: _hierarchy,
      periods: _matrixPeriods,
      selectedNode: selectedNode,
      color: color,
      chartType: chartType,
      onNodeTap: (node) => _onNodeTap(node, capturedLevel),
    );
  }


  Widget _buildCascadingSections() {
    if (_matrixData.isEmpty) return const SizedBox();
    
    // Single section with tree-style table (expansion happens within the table)
    return HierarchySection(
      title: _getSectionTitle(0, null),
      levelName: _hierarchy.isNotEmpty ? _hierarchy[0] : 'Item', 
      data: _matrixData,
      hierarchy: _hierarchy,
      periods: _matrixPeriods,
      selectedNode: null, // Tree handles its own selection internally
      color: AppTheme.neonBlue,
      chartType: ChartType.bar,
      onNodeTap: (node) {
        // Optional: track selection if needed for other purposes
      },
    );
  }




  String _getSectionTitle(int level, MatrixNode? parent) {
     if (level >= _hierarchy.length) return 'Detalle';
     final type = _hierarchy[level].toLowerCase();
     final map = {'vendor': 'Comerciales', 'client': 'Clientes', 'product': 'Productos', 'family': 'Familias'};
     final name = map[type]?.toUpperCase() ?? type.toUpperCase();
     
     if (parent != null) {
       return '$name DE ${parent.name}';
     }
     return 'RANKING GENERAL DE $name';
  }

  String get _activeHierarchyLabel {
    if (_hierarchy.isEmpty) return 'Elementos';
    final map = {'vendor': 'Comerciales', 'client': 'Clientes', 'product': 'Productos', 'family': 'Familias'};
    return map[_hierarchy.first] ?? 'Elementos';
  }
}

// Mutable Helper Class
class _ProductSearchDialog extends StatefulWidget {
  final Set<String> initialSelection;
  const _ProductSearchDialog({Key? key, required this.initialSelection}) : super(key: key);

  @override
  State<_ProductSearchDialog> createState() => _ProductSearchDialogState();
}

class _ProductSearchDialogState extends State<_ProductSearchDialog> {
  final TextEditingController _searchController = TextEditingController();
  List<Map<String, dynamic>> _searchResults = [];
  Set<String> _selectedCodes = {};
  bool _isLoading = false;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _selectedCodes = Set.from(widget.initialSelection);
    _searchProducts(); // Load initial top products
  }

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    if (_debounce?.isActive ?? false) _debounce!.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      _searchProducts(query);
    });
  }

  Future<void> _searchProducts([String query = '']) async {
    setState(() => _isLoading = true);
    try {
      final results = await ApiClient.getList('/dashboard/products-search', queryParameters: {'query': query, 'limit': '50'});
      if (mounted) {
        setState(() {
          _searchResults = (results as List).map((i) => Map<String, dynamic>.from(i as Map)).toList();
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Error searching products: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _toggleSelection(String code, String name) {
    setState(() {
      if (_selectedCodes.contains(code)) {
        _selectedCodes.remove(code);
      } else {
        _selectedCodes.add(code);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(16),
        constraints: const BoxConstraints(maxHeight: 600, maxWidth: 500),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Filtrar Productos', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                Text('${_selectedCodes.length} seleccionados', style: const TextStyle(color: AppTheme.neonBlue, fontSize: 14)),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Buscar por código o nombre...',
                hintStyle: const TextStyle(color: Colors.white30),
                prefixIcon: const Icon(Icons.search, color: Colors.white54),
                filled: true,
                fillColor: AppTheme.darkCard,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
                  : _searchResults.isEmpty
                      ? const Center(child: Text('No hay resultados', style: TextStyle(color: Colors.white30)))
                      : ListView.builder(
                          itemCount: _searchResults.length,
                          itemBuilder: (context, index) {
                            final item = _searchResults[index];
                            final code = item['code']?.toString() ?? '';
                            final name = item['name']?.toString() ?? '';
                            final isSelected = _selectedCodes.contains(code);

                            return ListTile(
                              onTap: () => _toggleSelection(code, name),
                              leading: Icon(
                                isSelected ? Icons.check_circle : Icons.circle_outlined,
                                color: isSelected ? AppTheme.neonBlue : Colors.white24,
                              ),
                              title: Text(name, style: TextStyle(color: isSelected ? Colors.white : Colors.white70)),
                              subtitle: Text(code, style: const TextStyle(color: Colors.white30, fontSize: 12)),
                            );
                          },
                        ),
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () {
                    final selectedItems = _searchResults.where((i) => _selectedCodes.contains(i['code'])).toSet();
                    // Just pass back dummy objects with code, as caller only needs codes
                     final resultSet = _selectedCodes.map((c) => {'code': c}).toSet();
                    Navigator.pop(context, resultSet);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text('Aplicar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MutableNode {
  final String id;
  final String name;
  final String type;
  double sales = 0;
  double margin = 0;
  List<_MutableNode> children = [];

  _MutableNode({required this.id, required this.name, required this.type});

  MatrixNode toMatrixNode() {
    return MatrixNode(
      id: id,
      name: name,
      type: type,
      sales: sales,
      margin: margin,
      growth: 0,
      children: children.map((c) => c.toMatrixNode()).toList()..sort((a,b) => b.sales.compareTo(a.sales)),
    );
  }
}

class TreeBuildParams {
  final List<Map<String, dynamic>> rows;
  final List<String> hierarchy;
  TreeBuildParams({required this.rows, required this.hierarchy});
}

// Top level function for compute
List<MatrixNode> buildTreeIsolate(TreeBuildParams params) {
  final rows = params.rows;
  final hierarchy = params.hierarchy;
  
  if (rows.isEmpty || hierarchy.isEmpty) return [];

  final Map<String, _MutableNode> encMap = {}; // Key: Path

  for (final row in rows) {
     String path = '';
     double getDouble(dynamic v) {
       if (v == null) return 0.0;
       if (v is num) return v.toDouble();
       return double.tryParse(v.toString()) ?? 0.0;
     }
     
     double sales = getDouble(row['SALES'] ?? row['sales']);
     double margin = getDouble(row['MARGIN'] ?? row['margin']);
     
     // Traverse hierarchy levels for this row
     for (int i = 0; i < hierarchy.length; i++) {
        final levelIndex = i + 1;
        dynamic getVal(String k) => row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
        
        final idVal = getVal('ID_$levelIndex');
        final nameVal = getVal('NAME_$levelIndex');
        
        if (idVal == null) break;
        
         final type = hierarchy[i];
         final currentId = idVal.toString();
         final currentName = nameVal?.toString() ?? currentId;
         
         // Use pipe separator to avoid conflicts with IDs containing slashes
         path = i == 0 ? currentId : '$path|$currentId';
         
         if (!encMap.containsKey(path)) {
            encMap[path] = _MutableNode(
              id: currentId,
              name: currentName,
              type: type,
            );
            if (i > 0) {
              final parentPath = path.substring(0, path.lastIndexOf('|'));
              if (encMap.containsKey(parentPath)) {
                encMap[parentPath]!.children.add(encMap[path]!);
              }
            }
         }
         
         encMap[path]!.sales += sales;
         encMap[path]!.margin += margin;
      }
   }
   
   return encMap.values
       .where((n) => n.type == hierarchy[0])
       .map((n) => n.toMatrixNode())
       .toList()
       ..sort((a,b) => b.sales.compareTo(a.sales)); // Sort root nodes too
}

/// Dialog content for FI filters
class _FiFilterDialogContent extends StatefulWidget {
  final FiFilterState initialFilters;
  final Function(FiFilterState) onApply;

  const _FiFilterDialogContent({
    required this.initialFilters,
    required this.onApply,
  });

  @override
  State<_FiFilterDialogContent> createState() => _FiFilterDialogContentState();
}

class _FiFilterDialogContentState extends State<_FiFilterDialogContent> {
  late FiFilterState _currentFilters;

  @override
  void initState() {
    super.initState();
    _currentFilters = widget.initialFilters;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        FiFiltersWidget(
          compact: false, // Expanded layout for dialog
          showAdvanced: true, // Show all FI levels
          initialFilters: _currentFilters,
          onFiltersChanged: (newFilters) {
            setState(() => _currentFilters = newFilters);
          },
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: () => widget.onApply(_currentFilters),
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue),
              child: const Text('Aplicar'),
            ),
          ],
        ),
      ],
    );
  }
}
