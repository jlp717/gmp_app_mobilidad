import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../objectives/presentation/pages/enhanced_client_matrix_page.dart';
import '../widgets/rutero_reorder_modal.dart';
import '../widgets/rutero_dialogs.dart'; // NEW: Import dialogs
import '../../../../core/widgets/smart_sync_header.dart'; // Import Sync Header
import '../../../../core/widgets/modern_loading.dart';
import 'package:provider/provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/providers/auth_provider.dart';

/// Rutero Page - Premium Design with Visit/Delivery Toggle
/// Shows clients to visit/deliver each day with YoY comparison
class RuteroPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;
  
  const RuteroPage({super.key, required this.employeeCode, this.isJefeVentas = false});

  @override
  State<RuteroPage> createState() => _RuteroPageState();
}

class _RuteroPageState extends State<RuteroPage> with SingleTickerProviderStateMixin {
  // Data state
  Map<String, int> _weekData = {};
  int _totalUniqueClients = 0; // Total de clientes únicos (no suma duplicada por días)
  List<Map<String, dynamic>> _dayClients = [];
  bool _isLoadingWeek = true;
  bool _isLoadingClients = false;
  String? _error;
  String _searchQuery = '';
  DateTime? _lastFetchTime; // Track last sync
  final TextEditingController _searchController = TextEditingController();
  
  // Selection state
  String _selectedRole = 'comercial'; // 'comercial' (visita) or 'repartidor' (reparto)
  String _selectedDay = 'lunes';
  String _todayName = 'lunes';
  
  late TabController _tabController;
  
  // Filters
  int _selectedYear = DateTime.now().year;
  int _selectedMonth = DateTime.now().month;
  int _selectedWeek = 1; // Week within the month (1-5)
  int _weeksInMonth = 4;
  
  // Jefe de ventas - Ver rutero como
  List<Map<String, dynamic>> _vendedoresDisponibles = [];
  String? _selectedVendedor; // null = ver su propio rutero
  
  final List<String> _monthNames = const [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  
  static const List<String> _weekdays = [
    'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'
  ];
  
  static const Map<String, String> _weekdayLabels = {
    'lunes': 'LUN', 'martes': 'MAR', 'miercoles': 'MIÉ', 
    'jueves': 'JUE', 'viernes': 'VIE', 'sabado': 'SÁB', 'domingo': 'DOM'
  };
  
  static const Map<String, String> _weekdayFullLabels = {
    'lunes': 'Lunes', 'martes': 'Martes', 'miercoles': 'Miércoles', 
    'jueves': 'Jueves', 'viernes': 'Viernes', 'sabado': 'Sábado', 'domingo': 'Domingo'
  };

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _initToday();
    // Si es jefe de ventas, cargar lista de vendedores
    _refreshData();
  }

  Future<void> _refreshData() async {
    await _loadWeekData();
    // _loadWeekData calls _loadDayClients internally, so we assume completion updates
    if (mounted) {
      setState(() => _lastFetchTime = DateTime.now());
    }
  }
  
  // ... (dispose, initToday, formatters etc. same)

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }
  
  void _initToday() {
    final now = DateTime.now();
    _selectedYear = now.year;
    _selectedMonth = now.month;
    final dayOfWeek = now.weekday; // 1=Monday, 7=Sunday
    _todayName = _weekdays[dayOfWeek - 1];
    _selectedDay = _todayName;
    // Calculate current week in month
    _weeksInMonth = _getWeeksInMonth(_selectedYear, _selectedMonth);
    _selectedWeek = _getCurrentWeekInMonth(now);
  }
  
  int _getWeeksInMonth(int year, int month) {
    final firstDay = DateTime(year, month, 1);
    final lastDay = DateTime(year, month + 1, 0);
    // Calculate weeks: ceiling of (days + first day offset) / 7
    final firstWeekday = firstDay.weekday; // 1=Mon
    final totalDays = lastDay.day;
    return ((totalDays + firstWeekday - 1) / 7).ceil();
  }
  
  int _getCurrentWeekInMonth(DateTime date) {
    final firstDay = DateTime(date.year, date.month, 1);
    final firstWeekday = firstDay.weekday;
    return ((date.day + firstWeekday - 2) ~/ 7) + 1;
  }

  void _changeMonth(int delta) {
    setState(() {
      _selectedMonth += delta;
      if (_selectedMonth < 1) {
        _selectedMonth = 12;
        _selectedYear--;
      } else if (_selectedMonth > 12) {
        _selectedMonth = 1;
        _selectedYear++;
      }
    });
    _weeksInMonth = _getWeeksInMonth(_selectedYear, _selectedMonth);
    _selectedWeek = 1; // Reset to first week when changing month
    _loadWeekData();
  }
  
  void _changeWeek(int delta) {
    setState(() {
      _selectedWeek += delta;
      if (_selectedWeek < 1) {
        _changeMonth(-1);
        _selectedWeek = _weeksInMonth;
      } else if (_selectedWeek > _weeksInMonth) {
        _changeMonth(1);
        _selectedWeek = 1;
      }
    });
    _loadWeekData();
  }

  void _onRoleChanged(String role) {
    if (_selectedRole != role) {
      setState(() => _selectedRole = role);
      _loadWeekData();
    }
  }
  
  /// Obtiene el código del vendedor a usar (seleccionado o el propio)
  String get _activeVendedorCode {
    if (!mounted) return widget.employeeCode;
    final filterCode = context.read<FilterProvider>().selectedVendor;
    return filterCode ?? widget.employeeCode;
  }
  

  
  /// Cambia el vendedor seleccionado para "Ver rutero como"
  void _onVendedorChanged(String? vendedorCode) {
    setState(() => _selectedVendedor = vendedorCode);
    _loadWeekData();
  }

  Future<void> _loadWeekData() async {
    setState(() {
      _isLoadingWeek = true;
      _error = null;
    });

    try {
      final response = await ApiClient.get(
        ApiConfig.ruteroWeek,
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'role': _selectedRole,
          'year': _selectedYear,
          'month': _selectedMonth,
        },
      );

      setState(() {
        _weekData = Map<String, int>.from(
          (response['week'] as Map).map((k, v) => MapEntry(k.toString(), (v as num).toInt()))
        );
        // Usar totalUniqueClients del backend para el conteo real de clientes
        _totalUniqueClients = (response['totalUniqueClients'] as num?)?.toInt() ?? 
          _weekData.values.fold(0, (a, b) => a + b);
        _isLoadingWeek = false;
      });
      
      await _loadDayClients();
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoadingWeek = false;
      });
    }
  }

  Future<void> _loadDayClients() async {
    setState(() {
      _isLoadingClients = true;
    });

    try {
      final response = await ApiClient.get(
        '${ApiConfig.ruteroDay}/$_selectedDay',
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'role': _selectedRole,
          'year': _selectedYear,
          'month': _selectedMonth,
          'week': _selectedWeek,
        },
      );

      setState(() {
        final rawList = response['clients'] ?? [];
        _dayClients = (rawList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        _isLoadingClients = false;
      });
    } catch (e) {
      setState(() {
        _dayClients = [];
        _isLoadingClients = false;
      });
    }
  }

  void _onDaySelected(String day) {
    if (day != _selectedDay) {
      setState(() => _selectedDay = day);
      _loadDayClients();
    }
  }



  // Currency formatting WITHOUT rounding
  String _formatCurrency(double value) {
    if (value.isNaN || value.isInfinite) return '0,00 €';
    return '${NumberFormat('#,##0.00', 'es_ES').format(value)} €';
  }

  String _formatVariation(double variation) {
    if (variation.isNaN || variation.isInfinite) return '+0,00 €';
    final sign = variation >= 0 ? '+' : '';
    return '$sign${NumberFormat('#,##0.00', 'es_ES').format(variation)} €';
  }

  @override
  Widget build(BuildContext context) {
    // Responsive sizing based on screen height
    final screenHeight = MediaQuery.of(context).size.height;
    final screenWidth = MediaQuery.of(context).size.width;
    final isSmallScreen = screenHeight < 850; // Smaller tablet threshold
    final isVerySmallScreen = screenHeight < 700;
    
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: SafeArea(
        child: Column(
          children: [
            // Smart Sync Header
            SmartSyncHeader(
              lastSync: _lastFetchTime,
              isLoading: _isLoadingWeek || _isLoadingClients,
              onSync: _refreshData,
              error: _error,
            ),
            
            // Unified Compact Header Region
            _buildUnifiedHeader(isSmallScreen),
            
            // Search Bar (dense)
            _buildSearchBar(isSmallScreen: isSmallScreen),
            
            // List Area
            Expanded(child: _buildClientList()),
          ],
        ),
      ),
    );
  }

  // Main layout wrapper to organize header elements effectively
  Widget _buildUnifiedHeader(bool isSmallScreen) {
    return Container(
      color: AppTheme.darkBase,
      child: Column(
        mainAxisSize: MainAxisSize.min, // Shrink to fit children
        children: [
             // 1. Top Bar: Back, Title, Role Toggle, Sort
             Padding(
               padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
               child: Row(
                 children: [
                   IconButton(
                     onPressed: () => Navigator.pop(context),
                     icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
                     padding: EdgeInsets.zero,
                     constraints: const BoxConstraints(),
                   ),
                   const SizedBox(width: 8),
                   // Title + Role Switcher in one row
                   Expanded(
                     child: InkWell(
                        onTap: () {
                           // Toggle role on title tap
                           _onRoleChanged(_selectedRole == 'comercial' ? 'repartidor' : 'comercial');
                        },
                        child: Row(
                          children: [
                             ShaderMask(
                                shaderCallback: (bounds) => LinearGradient(
                                  colors: [AppTheme.neonPink, AppTheme.neonPurple],
                                ).createShader(bounds),
                                child: Text(
                                  'RUTERO',
                                  style: TextStyle(
                                    fontSize: isSmallScreen ? 18 : 20,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 1,
                                    color: Colors.white,
                                  ),
                                ),
                             ),
                             const SizedBox(width: 8),
                             // Current Role Badge (Compact)
                             Container(
                               padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                               decoration: BoxDecoration(
                                 color: (_selectedRole == 'comercial' ? AppTheme.neonPink : AppTheme.neonBlue).withOpacity(0.2),
                                 borderRadius: BorderRadius.circular(8),
                                 border: Border.all(color: (_selectedRole == 'comercial' ? AppTheme.neonPink : AppTheme.neonBlue).withOpacity(0.5), width: 1),
                               ),
                               child: Row(
                                 mainAxisSize: MainAxisSize.min,
                                 children: [
                                   Icon(
                                      _selectedRole == 'comercial' ? Icons.shopping_bag_outlined : Icons.local_shipping_outlined,
                                      size: 12,
                                      color: _selectedRole == 'comercial' ? AppTheme.neonPink : AppTheme.neonBlue,
                                   ),
                                   const SizedBox(width: 4),
                                   Text(
                                     _selectedRole == 'comercial' ? 'VISITA' : 'REPARTO',
                                     style: TextStyle(
                                       fontSize: 10, 
                                       fontWeight: FontWeight.bold,
                                       color: _selectedRole == 'comercial' ? AppTheme.neonPink : AppTheme.neonBlue
                                      ),
                                   ),
                                 ],
                               ),
                             ),
                          ],
                        ),
                     ),
                   ),
                   // Sort Action
                   IconButton(
                     onPressed: _openReorderModal,
                     icon: const Icon(Icons.sort, color: Colors.white, size: 22),
                     tooltip: 'Ordenar',
                     padding: EdgeInsets.zero,
                     constraints: const BoxConstraints(),
                   ),
                 ],
               ),
             ),
             
             // 2. Vendor Selector for Manager
             if (widget.isJefeVentas)
               GlobalVendorSelector(
                 isJefeVentas: true,
                 onChanged: _refreshData,
               ),

             // 3. Compact Week/Month Navigator
             _buildCompactWeekSelector(),
             
             // 4. Horizontal Day Strip (Very compact)
             SizedBox(
               height: 50, // Fixed small height
               child: ListView.separated(
                 scrollDirection: Axis.horizontal,
                 padding: const EdgeInsets.symmetric(horizontal: 12),
                 itemCount: _weekdays.length,
                 separatorBuilder: (_, __) => const SizedBox(width: 8),
                 itemBuilder: (context, index) {
                   final day = _weekdays[index];
                   final isSelected = day == _selectedDay;
                   final count = _weekData[day] ?? 0;
                   return _buildCompactDayChip(day, count, isSelected);
                 },
               ),
             ),
             const SizedBox(height: 4),
        ],
      ),
    );
  }

  // Replacement for _buildHeader - removed to avoid duplication error if I kept the name
  // keeping empty to satisfy potential calls I missed replacing if any, but I replaced the call site.
  // Actually, I'll just rely on the new _buildUnifiedHeader.



  Widget _buildCompactWeekSelector() {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
             // Month/Week info
             Row(
               children: [
                 IconButton(
                    onPressed: () => _changeWeek(-1),
                    icon: const Icon(Icons.chevron_left, size: 20, color: Colors.white),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                 ),
                 const SizedBox(width: 8),
                 Text(
                   'Semana $_selectedWeek (${_monthNames[_selectedMonth-1]})', 
                   style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)
                 ),
                 const SizedBox(width: 8),
                 IconButton(
                    onPressed: () => _changeWeek(1),
                    icon: const Icon(Icons.chevron_right, size: 20, color: Colors.white),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                 ),
               ],
             ),
             // Total clients badge
             Container(
               padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
               decoration: BoxDecoration(
                 color: AppTheme.neonPink.withOpacity(0.2),
                 borderRadius: BorderRadius.circular(12),
               ),
               child: Text('Total: $_totalUniqueClients', style: TextStyle(color: AppTheme.neonPink, fontSize: 11, fontWeight: FontWeight.bold)),
             ),
          ],
        ),
      );
  }

  Widget _buildCompactDayChip(String day, int count, bool isSelected) {
      final label = _weekdayLabels[day] ?? day.substring(0,3).toUpperCase();
      return GestureDetector(
        onTap: () => _onDaySelected(day),
        child: Container(
           width: 50,
           decoration: BoxDecoration(
             color: isSelected ? AppTheme.neonPink : AppTheme.surfaceColor,
             borderRadius: BorderRadius.circular(8),
             border: isSelected ? null : Border.all(color: AppTheme.borderColor),
           ),
           child: Column(
             mainAxisAlignment: MainAxisAlignment.center,
             children: [
               Text(label, style: TextStyle(
                 fontSize: 10, 
                 color: isSelected ? Colors.white : AppTheme.textSecondary,
                 fontWeight: isSelected ? FontWeight.bold : FontWeight.normal
               )),
               const SizedBox(height: 2),
               Text('$count', style: TextStyle(
                 fontSize: 12,
                 color: isSelected ? Colors.white : AppTheme.textPrimary,
                 fontWeight: FontWeight.bold
               )),
             ],
           ),
        ),
      );
  }


  // Removed obsolete methods (_buildVendedorSelector, _buildRoleToggle, _buildMonthSelector, _buildDayHeader)
  // Replaced by _buildUnifiedHeader and compact components.



  Widget _buildSearchBar({bool isSmallScreen = false}) {
    return Container(
      height: 36, // Force compact height
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: TextField(
        controller: _searchController,
        style: const TextStyle(fontSize: 13),
        textAlignVertical: TextAlignVertical.center,
        onChanged: (value) {
          setState(() {
            _searchQuery = value.toLowerCase();
          });
        },
        decoration: InputDecoration(
          hintText: 'Buscar...',
          hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.7), fontSize: 13),
          prefixIcon: const Icon(Icons.search, size: 16, color: AppTheme.textSecondary),
          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
          isDense: true,
          filled: true,
          fillColor: AppTheme.surfaceColor,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }


  Widget _buildClientList() {
    if (_isLoadingWeek || _isLoadingClients) {
      return const Padding(
        padding: EdgeInsets.all(40.0),
        child: ModernLoading(message: 'Cargando rutas...'),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 48, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error al cargar', style: TextStyle(color: AppTheme.error)),
          ],
        ),
      );
    }

    if (_dayClients.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              _selectedRole == 'comercial' ? Icons.shopping_bag_outlined : Icons.local_shipping_outlined,
              size: 64, 
              color: AppTheme.neonPink.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'Sin clientes para ${_weekdayFullLabels[_selectedDay]}',
              style: TextStyle(fontSize: 16, color: Colors.grey.shade400),
            ),
            const SizedBox(height: 8),
            Text(
              'Selecciona otro día',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
            ),
          ],
        ),
      );
    }

    // Filter clients based on search query
    final filteredClients = _searchQuery.isEmpty
        ? _dayClients
        : _dayClients.where((client) {
            final code = (client['code'] as String? ?? '').toLowerCase();
            final name = (client['name'] as String? ?? '').toLowerCase();
            return code.contains(_searchQuery) || name.contains(_searchQuery);
          }).toList();

    if (filteredClients.isEmpty && _searchQuery.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.search_off, size: 48, color: AppTheme.neonPink.withOpacity(0.4)),
            const SizedBox(height: 16),
            Text(
              'No se encontraron clientes para "$_searchQuery"',
              style: TextStyle(color: Colors.grey.shade400),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () {
                setState(() {
                  _searchController.clear();
                  _searchQuery = '';
                });
              },
              child: Text('Limpiar búsqueda', style: TextStyle(color: AppTheme.neonPink)),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppTheme.neonPink,
      onRefresh: _loadDayClients,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        itemCount: filteredClients.length,
        itemBuilder: (context, index) {
          final client = filteredClients[index];
          return _ClientCard(
            client: client,
            formatCurrency: _formatCurrency,
            formatVariation: _formatVariation,
            onTap: () => _navigateToMatrix(client),
            onMapTap: () => _openMaps(client),
            onCallTap: () => _makeCall(client),
            onWhatsAppTap: () => _openWhatsApp(client),
            onNotesTap: () => _openNotesDialog(client),
            showMargin: widget.isJefeVentas,
            selectedYear: _selectedYear,
          );
        },
      ),
    );
  }

  void _navigateToMatrix(Map<String, dynamic> client) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => EnhancedClientMatrixPage(
          clientCode: client['code'] ?? '',
          clientName: client['name'] ?? 'Cliente',
          isJefeVentas: widget.isJefeVentas,
        ),
      ),
    );
  }

  Future<void> _openMaps(Map<String, dynamic> client) async {
    final latitude = client['latitude'] as num?;
    final longitude = client['longitude'] as num?;
    final address = client['address'] ?? '';
    final city = client['city'] ?? '';
    final name = client['name'] ?? '';
    
    // If we have GPS coordinates, use them directly
    if (latitude != null && longitude != null && latitude != 0 && longitude != 0) {
      final urls = [
        'geo:$latitude,$longitude?q=$latitude,$longitude',
        'https://www.google.com/maps/dir/?api=1&destination=$latitude,$longitude',
      ];
      
      for (final urlStr in urls) {
        try {
          final uri = Uri.parse(urlStr);
          final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
          if (launched) return;
        } catch (e) {
          // Try next
        }
      }
    }
    
    // Fallback to address search
    final searchQuery = name.isNotEmpty 
        ? '$name, $address, $city'
        : '$address, $city';
    
    if (searchQuery.trim().length < 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay dirección disponible')),
      );
      return;
    }
    
    final encoded = Uri.encodeComponent(searchQuery);
    final urls = [
      'geo:0,0?q=$encoded',
      'https://www.google.com/maps/dir/?api=1&destination=$encoded',
    ];
    
    for (final urlStr in urls) {
      try {
        final uri = Uri.parse(urlStr);
        final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (launched) return;
      } catch (e) {
        // Try next
      }
    }
  }

  Future<void> _makeCall(Map<String, dynamic> client) async {
    final phone = client['phone'] ?? '';
    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay teléfono disponible')),
      );
      return;
    }
    
    try {
      await launchUrl(Uri.parse('tel:$phone'));
    } catch (e) {
      // Ignore
    }
  }

  Future<void> _openNotesDialog(Map<String, dynamic> client) async {
    final Map<String, dynamic> currentNotes = Map<String, dynamic>.from(client['observaciones'] ?? {});
    final text = currentNotes['text'] as String? ?? '';
    final ctrl = TextEditingController(text: text);

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

    if (result != null && result != text) {
      await _saveNotes(client, result);
    }
  }

  Future<void> _saveNotes(Map<String, dynamic> client, String notes) async {
    // Optimistic update locally
    final updatedClient = Map<String, dynamic>.from(client);
    final obs = Map<String, dynamic>.from(updatedClient['observaciones'] ?? {});
    obs['text'] = notes;
    updatedClient['observaciones'] = obs;
    
    // Find index to update
    // Actually simpler: reload data or just show success for now.
    // _loadDayClients(); // This would refresh the full list.
    
    // Let's call API first
    try {
      await ApiClient.put(
        '${ApiConfig.clientsList}/notes',
        data: {
          'clientCode': client['code'],
          'notes': notes,
        },
      );
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Observaciones guardadas')),
        );
        _refreshData(); // Refresh to show update
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error guardando notas: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  void _openWhatsApp(Map<String, dynamic> client) {
    final phones = (client['phones'] as List?)?.map((p) => Map<String, dynamic>.from(p as Map)).toList() ?? [];
    if (phones.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay teléfono disponible')),
      );
      return;
    }

    // If only one phone, open directly
    if (phones.length == 1) {
      _launchWhatsApp(phones.first['number'] ?? '');
      return;
    }

    // Multiple phones - show selector
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Enviar WhatsApp', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 8),
            const Text('Selecciona el número:', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
            const SizedBox(height: 12),
            ...phones.map((p) => ListTile(
              leading: const Icon(Icons.phone_android, color: Color(0xFF25D366)),
              title: Text(p['number'] ?? ''),
              subtitle: Text(p['type'] ?? 'Teléfono'),
              onTap: () {
                Navigator.pop(ctx);
                _launchWhatsApp(p['number'] ?? '');
              },
            )).toList(),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _launchWhatsApp(String phone) async {
    // Clean phone number - remove non-digits except +
    String cleanPhone = phone.replaceAll(RegExp(r'[^0-9+]'), '');
    // Add Spain prefix if not present
    if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('34')) {
      cleanPhone = '34$cleanPhone';
    }
    if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Personal identification
    final auth = context.read<AuthProvider>();
    final nombreComercial = auth.currentUser?.name ?? 'tu comercial';
    final manana = DateTime.now().add(const Duration(days: 1));
    final fecha = '${manana.day}/${manana.month}/${manana.year}';

    // Professional message
    final message = Uri.encodeComponent(
      'Hola, soy $nombreComercial de Mari Pepa. '
      'Mañana día $fecha tenemos visita. '
      '¿Necesitas cualquier cosilla?'
    );

    final uri = Uri.parse('https://wa.me/$cleanPhone?text=$message');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
  void _openReorderModal() async {
    // Show FULL list in reorder dialog to ensure consistency
    final clientsToOrder = List<Map<String, dynamic>>.from(_dayClients);
    
    final result = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => ReorderDialog(
          clients: clientsToOrder, 
          activeVendedor: _activeVendedorCode,
          currentDay: _selectedDay,
      ),
    );
    
    if (result != null) {
       await _saveNewOrder(result);
    }
    
    // SIEMPRE refrescar después de cerrar el diálogo para actualizar contadores
    // ya que pueden haberse movido clientes a otros días
    await _refreshDataAndCounts();
  }

  /// Refresca datos y contadores después de cambios
  Future<void> _refreshDataAndCounts() async {
    // Primero refrescar contadores desde el backend
    try {
      final countsResponse = await ApiClient.get(
        '/rutero/counts',
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'role': _selectedRole,
        },
      );
      
      if (countsResponse['counts'] != null && mounted) {
        setState(() {
          _weekData = Map<String, int>.from(
            (countsResponse['counts'] as Map).map((k, v) => MapEntry(k.toString(), (v as num).toInt()))
          );
          _totalUniqueClients = (countsResponse['totalUniqueClients'] as num?)?.toInt() ?? 
            _weekData.values.fold(0, (a, b) => a + b);
        });
      }
    } catch (e) {
      // Si falla, hacer refresh completo
      await _loadWeekData();
      return;
    }
    
    // Luego refrescar la lista del día actual
    await _loadDayClients();
    
    if (mounted) {
      setState(() => _lastFetchTime = DateTime.now());
    }
  }

  Future<void> _saveNewOrder(List<Map<String, dynamic>> newOrder) async {
      setState(() => _isLoadingWeek = true);
      try {
          final orderPayload = newOrder.asMap().entries.map((e) => {
              'cliente': e.value['code'],
              'posicion': e.key
          }).toList();
          
          await ApiClient.post('/rutero/config', {
              'vendedor': _activeVendedorCode,
              'dia': _selectedDay.toLowerCase(),
              'orden': orderPayload
          });
          
          // Refrescar contadores y datos
          await _refreshDataAndCounts();
          
          if (mounted) {
            setState(() => _isLoadingWeek = false);
            ScaffoldMessenger.of(context).showSnackBar(
               const SnackBar(
                 content: Text('✅ Orden actualizado correctamente'),
                 backgroundColor: AppTheme.success,
               ),
            );
          }
      } catch (e) {
          if (mounted) {
            setState(() => _isLoadingWeek = false);
            ScaffoldMessenger.of(context).showSnackBar(
               SnackBar(
                 content: Text('Error guardando orden: $e'),
                 backgroundColor: AppTheme.error,
               ),
            );
          }
      }
  }
}

// Role toggle button widget
class _RoleButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool isSelected;
  final Color color;
  final VoidCallback onTap;

  const _RoleButton({
    required this.label,
    required this.icon,
    required this.isSelected,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          gradient: isSelected ? LinearGradient(
            colors: [color.withOpacity(0.3), color.withOpacity(0.1)],
          ) : null,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: isSelected ? color : Colors.grey, size: 18),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: isSelected ? color : Colors.grey,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Premium client card with YoY display
class _ClientCard extends StatelessWidget {
  final Map<String, dynamic> client;
  final String Function(double) formatCurrency;
  final String Function(double) formatVariation;
  final VoidCallback onTap;
  final VoidCallback onMapTap;
  final VoidCallback onCallTap;
  final VoidCallback? onWhatsAppTap;
  final VoidCallback? onNotesTap;
  final bool showMargin;
  final int selectedYear;

  const _ClientCard({
    required this.client,
    required this.formatCurrency,
    required this.formatVariation,
    required this.onTap,
    required this.onMapTap,
    required this.onCallTap,
    this.onWhatsAppTap,
    this.onNotesTap, // NEW
    this.showMargin = false,
    required this.selectedYear,
  });

  @override
  Widget build(BuildContext context) {
    final name = client['name'] as String? ?? 'Sin nombre';
    final code = client['code'] as String? ?? '';
    final address = client['address'] as String? ?? '';
    final city = client['city'] as String? ?? '';
    final status = client['status'] as Map<String, dynamic>? ?? {};
    final observaciones = client['observaciones'] as Map<String, dynamic>?;
    final phones = (client['phones'] as List?)?.map((p) => Map<String, dynamic>.from(p as Map)).toList() ?? [];
    
    final isPositive = status['isPositive'] == true;
    // Use ytdSales (YTD accumulated sales) as main value
    final ytdSales = (status['ytdSales'] as num?)?.toDouble() ?? 
                     (status['currentMonthSales'] as num?)?.toDouble() ?? 0;
    final margin = (status['margin'] as num?)?.toDouble() ?? 0;
    // Use yoyVariation (Year-over-Year % change)
    final yoyVariation = (status['yoyVariation'] as num?)?.toDouble() ?? 
                         (status['variation'] as num?)?.toDouble() ?? 0;
    final ytdPrevYear = (status['ytdPrevYear'] as num?)?.toDouble() ?? 
                        (status['prevMonthSales'] as num?)?.toDouble() ?? 0;

    final accentColor = isPositive ? AppTheme.success : AppTheme.error;
    
    // Check if has observations
    final hasObservaciones = observaciones != null && 
        observaciones['text'] != null && 
        (observaciones['text'] as String).isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasObservaciones ? AppTheme.warning.withOpacity(0.8) : accentColor.withOpacity(0.5),
          width: hasObservaciones ? 2 : 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: (hasObservaciones ? AppTheme.warning : accentColor).withOpacity(0.1),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Observations Banner
            if (hasObservaciones) 
              InkWell( // Make banner clickable to edit
                onTap: onNotesTap, 
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: const BoxDecoration(
                    color: AppTheme.warning,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(12),
                      topRight: Radius.circular(12),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Colors.black87, size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          observaciones!['text'] as String,
                          style: const TextStyle(color: Colors.black87, fontSize: 11, fontWeight: FontWeight.bold),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const Icon(Icons.edit, size: 14, color: Colors.black54), // Edit hint
                    ],
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
              // Progress indicator - shows YoY variation
              Container(
                width: 85,
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: accentColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  children: [
                    Icon(
                      isPositive ? Icons.trending_up : Icons.trending_down,
                      color: accentColor,
                      size: 26,
                    ),
                    const SizedBox(height: 4),
                    // Show YoY variation percentage
                    Text(
                      '${yoyVariation >= 0 ? '+' : ''}${yoyVariation.toStringAsFixed(1)}%',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: accentColor,
                      ),
                    ),
                    Text(
                      'vs ${selectedYear - 1}',
                      style: TextStyle(
                        fontSize: 9,
                        color: accentColor.withOpacity(0.8),
                      ),
                    ),
                    // Margin badge - only for jefe de ventas
                    if (margin > 0 && showMargin)
                      Container(
                        margin: const EdgeInsets.only(top: 4),
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: margin >= 15 ? AppTheme.success.withOpacity(0.2) : AppTheme.warning.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'M:${margin.toStringAsFixed(0)}%',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: margin >= 15 ? AppTheme.success : AppTheme.warning,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              
              // Client info - larger fonts
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Client name - larger
                    Text(
                      name,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    // Code badge
                    if (code.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.neonBlue.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          code,
                          style: TextStyle(fontSize: 11, color: AppTheme.neonBlue, fontWeight: FontWeight.w500),
                        ),
                      ),
                    const SizedBox(height: 6),
                    if (address.isNotEmpty || city.isNotEmpty)
                      Row(
                        children: [
                          Icon(Icons.place, size: 14, color: Colors.grey.shade500),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              [address, city].where((s) => s.isNotEmpty).join(', '),
                              style: TextStyle(fontSize: 13, color: Colors.grey.shade400),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    const SizedBox(height: 8),
                    // Sales and comparison row
                    Row(
                      children: [
                        Text('Acumulado: ', style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                        Text(
                          formatCurrency(ytdSales),
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                        ),
                        if (ytdPrevYear > 0) ...[
                          Text(' / ', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                          Text(
                            formatCurrency(ytdPrevYear),
                            style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                          ),
                        ] else if (selectedYear == DateTime.now().year && DateTime.now().day <= 7 && DateTime.now().month == 1) ...[
                           // Week 1 Logic Explanation Tooltip
                           const SizedBox(width: 4),
                           Tooltip(
                             triggerMode: TooltipTriggerMode.tap,
                             showDuration: const Duration(seconds: 4),
                             margin: const EdgeInsets.symmetric(horizontal: 20),
                             padding: const EdgeInsets.all(12),
                             decoration: BoxDecoration(color: AppTheme.darkBase, borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.grey.shade700)),
                             textStyle: const TextStyle(color: Colors.white, fontSize: 13),
                             message: 'El acumulado del año anterior aparecerá a partir de la 2ª semana, comparando semanas cerradas.',
                             child: Icon(Icons.info_outline, size: 14, color: Colors.grey.shade600),
                           ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              
              // Action buttons - larger
              Column(
                children: [
                  IconButton(
                    onPressed: onMapTap,
                    icon: Icon(Icons.directions, color: AppTheme.neonPink, size: 26),
                    tooltip: 'Cómo llegar',
                    splashRadius: 24,
                    padding: const EdgeInsets.all(4),
                    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                  ),
                  if (onNotesTap != null)
                     IconButton(
                      onPressed: onNotesTap,
                      icon: Icon(
                        hasObservaciones ? Icons.edit_note : Icons.note_add, 
                        color: hasObservaciones ? AppTheme.warning : Colors.grey.shade400,
                        size: 26
                      ),
                      tooltip: 'Observaciones',
                      splashRadius: 24,
                      padding: const EdgeInsets.all(4),
                      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                    ),
                  if (phones.isNotEmpty && onWhatsAppTap != null)
                    IconButton(
                      onPressed: onWhatsAppTap,
                      icon: const Icon(Icons.chat, color: Color(0xFF25D366), size: 26),
                      tooltip: 'WhatsApp',
                      splashRadius: 24,
                      padding: const EdgeInsets.all(4),
                      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                    ),
                  IconButton(
                    onPressed: onCallTap,
                    icon: Icon(Icons.phone, color: AppTheme.neonBlue, size: 26),
                    tooltip: 'Llamar',
                    splashRadius: 24,
                    padding: const EdgeInsets.all(4),
                    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                  ),
                ],
              ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ReorderDialog extends StatefulWidget {
  final List<Map<String, dynamic>> clients;
  final String activeVendedor;
  final String currentDay;

  const ReorderDialog({
    Key? key, 
    required this.clients, 
    required this.activeVendedor,
    required this.currentDay,
  }) : super(key: key);

  @override
  _ReorderDialogState createState() => _ReorderDialogState();
}

class _ReorderDialogState extends State<ReorderDialog> {
  late List<Map<String, dynamic>> _items;
  final ScrollController _scrollController = ScrollController();
  bool _hasChanges = false; // Track if order has changed
  List<String> _originalOrder = []; // Store original order to detect changes

  @override
  void initState() {
    super.initState();
    _items = List.from(widget.clients);
    // Store original order for comparison
    _originalOrder = _items.map((c) => c['code'] as String).toList();
  }

  void _onReorder(int oldIndex, int newIndex) {
    setState(() {
      if (newIndex > oldIndex) newIndex -= 1;
      final item = _items.removeAt(oldIndex);
      _items.insert(newIndex, item);
      _checkForChanges();
    });
  }
  
  void _checkForChanges() {
    final currentOrder = _items.map((c) => c['code'] as String).toList();
    _hasChanges = !_listEquals(currentOrder, _originalOrder);
  }
  
  bool _listEquals(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
  
  void _moveItem(int index, int delta) {
      final newIndex = index + delta;
      if (newIndex >= 0 && newIndex < _items.length) {
          _onReorder(index, delta > 0 ? newIndex + 1 : newIndex);
      }
  }

  void _updatePositionManual(int index, String val) {
     final newPos = int.tryParse(val);
     if (newPos != null) {
         // Convert form 1-based user input to 0-based index
         int targetIndex = newPos - 1;
         if (targetIndex < 0) targetIndex = 0;
         if (targetIndex >= _items.length) targetIndex = _items.length - 1;
         
         if (targetIndex != index) {
             setState(() {
                 final item = _items.removeAt(index);
                 _items.insert(targetIndex, item);
                 _checkForChanges();
             });
         }
     }
  }

  /// NUEVO FLUJO: Mover cliente a otro día con confirmación completa
  Future<void> _moveClientToDay(int index) async {
      final client = _items[index];
      final clientName = client['name'] ?? 'Cliente';
      final clientCode = client['code'] ?? '';
      
      // PASO 1: Selector de día destino (excluye Domingo)
      final selectedDay = await showDialog<String>(
          context: context,
          builder: (ctx) => DaySelectorDialog(
            currentDay: widget.currentDay,
            clientName: clientName,
            clientCode: clientCode,
          ),
      );
      
      if (selectedDay == null) return; // Usuario canceló
      
      // PASO 2: Selector de posición en día destino
      final selectedPosition = await showDialog<String>(
          context: context,
          builder: (ctx) => PositionSelectorDialog(
            targetDay: selectedDay,
            vendorCode: widget.activeVendedor,
            role: 'comercial',
            clientName: clientName,
          ),
      );
      
      if (selectedPosition == null) return; // Usuario canceló
      
      // PASO 3: Confirmación final con resumen
      final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => MoveConfirmationDialog(
            clientName: clientName,
            clientCode: clientCode,
            fromDay: widget.currentDay,
            toDay: selectedDay,
            position: selectedPosition,
          ),
      );
      
      if (confirmed != true) return; // Usuario canceló
      
      // PASO 4: Ejecutar el movimiento
      await _executeMove(client, selectedDay, selectedPosition, index);
  }
  
  Future<void> _executeMove(
    Map<String, dynamic> client,
    String toDay,
    String position,
    int index,
  ) async {
    // Mostrar loading
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => const AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        content: Row(
          children: [
            CircularProgressIndicator(color: AppTheme.neonPink),
            SizedBox(width: 16),
            Text('Moviendo cliente...'),
          ],
        ),
      ),
    );
    
    try {
      // Determinar la posición numérica
      dynamic targetPosition;
      if (position == 'start') {
        targetPosition = 'start';
      } else if (position == 'end') {
        targetPosition = 'end';
      } else {
        targetPosition = int.tryParse(position) ?? 'end';
      }
      
      await ApiClient.post('/rutero/move_clients', {
        'vendedor': widget.activeVendedor,
        'moves': [
          {
            'client': client['code'],
            'toDay': toDay.toLowerCase(),
            'clientName': client['name'],
            'position': targetPosition,
          }
        ],
        'targetPosition': targetPosition,
      });
      
      // Cerrar loading
      if (mounted) Navigator.pop(context);
      
      // Actualizar lista local
      setState(() {
        _items.removeAt(index);
        _checkForChanges();
      });
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${client['name']} movido al ${toDay.toUpperCase()}'),
            backgroundColor: AppTheme.success,
          ),
        );
      }
    } catch (e) {
      // Cerrar loading
      if (mounted) Navigator.pop(context);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error moviendo cliente: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }
  
  /// Confirmación antes de guardar el nuevo orden
  Future<void> _confirmSave() async {
    if (!_hasChanges && _items.length == widget.clients.length) {
      // No hay cambios de orden
      Navigator.pop(context);
      return;
    }
    
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => ReorderConfirmationDialog(
        changesCount: _items.length,
        day: widget.currentDay,
      ),
    );
    
    if (confirmed == true) {
      Navigator.pop(context, _items); // Retornar items para guardar
    }
  }
  
  /// Confirmar descarte de cambios al cerrar
  Future<bool> _confirmDiscard() async {
    if (!_hasChanges) return true;
    
    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        title: Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppTheme.warning),
            const SizedBox(width: 8),
            const Text('¿Descartar cambios?'),
          ],
        ),
        content: const Text(
          'Has modificado el orden de la ruta. ¿Quieres descartar los cambios sin guardar?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Continuar editando'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.error),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    
    return discard == true;
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: _confirmDiscard,
      child: Dialog(
        insetPadding: const EdgeInsets.all(10),
        backgroundColor: AppTheme.darkBase,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Column(
            children: [
                // Header
                Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                        children: [
                            const Text('Organizar Rutero', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                            if (_hasChanges)
                              Container(
                                margin: const EdgeInsets.only(left: 8),
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppTheme.warning.withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  'Cambios sin guardar',
                                  style: TextStyle(fontSize: 10, color: AppTheme.warning),
                                ),
                              ),
                            const Spacer(),
                            IconButton(
                              icon: const Icon(Icons.close),
                              onPressed: () async {
                                if (await _confirmDiscard()) {
                                  Navigator.pop(context);
                                }
                              },
                            ),
                        ],
                    ),
                ),
                const Divider(height: 1),
                
                // Hint
                Container(
                    width: double.infinity,
                    color: AppTheme.surfaceColor,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Text(
                      'Arrastra para ordenar o usa las flechas. Usa el icono 📅 para mover a otro día.\n'
                      '⚠️ Los cambios solo se aplican al pulsar GUARDAR CAMBIOS.',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                ),
                
                // List
                Expanded(
                    child: _items.isEmpty 
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.inbox, size: 48, color: Colors.grey.shade600),
                              const SizedBox(height: 8),
                              const Text('No hay clientes en este día'),
                            ],
                          ),
                        )
                      : ReorderableListView.builder(
                          scrollController: _scrollController,
                          onReorder: _onReorder,
                          itemCount: _items.length,
                          itemBuilder: (ctx, index) {
                              final item = _items[index];
                              final pos = index + 1;
                              
                              return Container(
                                  key: ValueKey(item['code']),
                                  decoration: const BoxDecoration(
                                      border: Border(bottom: BorderSide(color: Colors.black12))
                                  ),
                                  child: ListTile(
                                      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
                                      leading: ReorderableDragStartListener(
                                          index: index,
                                          child: const Padding(
                                              padding: EdgeInsets.all(12),
                                              child: Icon(Icons.drag_handle, color: Colors.grey),
                                          ),
                                      ),
                                      title: Text(item['name'] ?? '', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                      subtitle: Text(item['code'] ?? '', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                                      trailing: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                              // Arrows
                                              Column(
                                                  mainAxisAlignment: MainAxisAlignment.center,
                                                  children: [
                                                      InkWell(onTap: () => _moveItem(index, -1), child: const Icon(Icons.arrow_drop_up, size: 20)),
                                                      InkWell(onTap: () => _moveItem(index, 1), child: const Icon(Icons.arrow_drop_down, size: 20)),
                                                  ],
                                              ),
                                              const SizedBox(width: 8),
                                              // Numeric Input
                                              SizedBox(
                                                  width: 40,
                                                  height: 35,
                                                  child: TextField(
                                                      keyboardType: TextInputType.number,
                                                      textAlign: TextAlign.center,
                                                      decoration: const InputDecoration(
                                                          contentPadding: EdgeInsets.zero,
                                                          border: OutlineInputBorder(),
                                                          isDense: true
                                                      ),
                                                      controller: TextEditingController(text: '$pos')
                                                        ..selection = TextSelection.collapsed(offset: '$pos'.length),
                                                      onSubmitted: (val) => _updatePositionManual(index, val),
                                                  ),
                                              ),
                                              const SizedBox(width: 8),
                                              // Change Day Button
                                              IconButton(
                                                  icon: const Icon(Icons.calendar_month, color: AppTheme.neonBlue),
                                                  tooltip: 'Mover a otro día',
                                                  onPressed: () => _moveClientToDay(index),
                                              ),
                                          ],
                                      ),
                                  ),
                              );
                          },
                      ),
                ),
                
                // Footer
                Padding(
                    padding: const EdgeInsets.all(16),
                    child: SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _hasChanges ? AppTheme.neonPink : Colors.grey,
                            ),
                            onPressed: _confirmSave,
                            icon: const Icon(Icons.save),
                            label: Text(
                              _hasChanges ? 'GUARDAR CAMBIOS' : 'CERRAR',
                              style: const TextStyle(fontWeight: FontWeight.bold),
                            ),
                        ),
                    ),
                ),
            ],
        ),
      ),
    );
  }
}
