import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart'; // Import Sync Header
import 'package:gmp_app_mobilidad/features/kpi_alerts/data/kpi_alerts_service.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/pages/enhanced_client_matrix_page.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_dialogs.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_filter_bar.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_header.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_week_summary.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/widgets/rutero_client_list_item.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

/// Rutero Page - Premium Design with Visit/Delivery Toggle
/// Shows clients to visit/deliver each day with YoY comparison
class RuteroPage extends ConsumerStatefulWidget {
  const RuteroPage({
    required this.employeeCode,
    super.key,
    this.isJefeVentas = false,
    this.forceShowVendorSelector = false,
  });
  final String employeeCode;
  final bool isJefeVentas;
  final bool forceShowVendorSelector;

  @override
  ConsumerState<RuteroPage> createState() => _RuteroPageState();
}

class _RuteroPageState extends ConsumerState<RuteroPage>
    with SingleTickerProviderStateMixin {
  // Data state
  Map<String, int> _weekData = {};
  int _totalUniqueClients =
      0; // Total de clientes únicos (no suma duplicada por días)
  int _completedWeeks = 0; // NEW: Track completed weeks for YoY label
  String _periodLabel = ''; // NEW: Period label like "1 Ene - 12 Ene"
  List<Map<String, dynamic>> _dayClients = [];
  bool _isLoadingWeek = true;
  bool _isLoadingClients = false;
  bool _isCacheLoading = false; // true while backend cache is still warming up
  int _cacheRetryCount = 0;
  static const int _maxCacheRetries =
      8; // Increased from 4 to ensure cache warming
  String? _error;
  String _searchQuery = '';
  String _sortMode = 'custom'; // 'sales_desc', 'sales_asc', 'route', 'custom'
  DateTime? _lastFetchTime; // Track last sync
  final TextEditingController _searchController = TextEditingController();

  // Guards to prevent redundant/cascading refreshes
  bool _isInitialized = false;
  bool _isLoadingInProgress = false;
  Timer? _retryTimer; // Cancelable retry timer
  ProviderSubscription<String?>? _vendorSubscription;
  int _loadGeneration = 0;

  String _selectedAlertType = 'ALL';
  bool _onlyWithAlerts = false;
  Set<String> _kpiFilteredCodes = {};
  // Sort mode options - Professional labels
  static const Map<String, String> _sortModeLabels = {
    'sales_desc': 'Mayor Acumulado',
    'sales_asc': 'Menor Acumulado',
    'route': 'Ruta Original',
    'custom': 'Orden Personalizado',
  };

  // Selection state
  String _selectedRole =
      'comercial'; // 'comercial' (visita) or 'repartidor' (reparto)
  String _selectedDay = 'lunes';
  String _todayName = 'lunes';

  late TabController _tabController;

  // Filters
  int _selectedYear = DateTime.now().year;
  int _selectedMonth = DateTime.now().month;
  int _selectedWeek = 1; // Week within the month (1-5)
  int _weeksInMonth = 4;

  // Jefe de ventas - Ver rutero como
  final List<Map<String, dynamic>> _vendedoresDisponibles = [];
  String? _selectedVendedor; // null = ver su propio rutero

  final List<String> _monthNames = const [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  static const List<String> _weekdays = [
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'domingo',
  ];

  static const Map<String, String> _weekdayLabels = {
    'lunes': 'LUN',
    'martes': 'MAR',
    'miercoles': 'MIÉ',
    'jueves': 'JUE',
    'viernes': 'VIE',
    'sabado': 'SÁB',
    'domingo': 'DOM',
  };

  static const Map<String, String> _weekdayFullLabels = {
    'lunes': 'Lunes',
    'martes': 'Martes',
    'miercoles': 'Miércoles',
    'jueves': 'Jueves',
    'viernes': 'Viernes',
    'sabado': 'Sábado',
    'domingo': 'Domingo',
  };

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _initToday();
    _isInitialized = true;
    _loadWeekData();

    // Listen for vendor changes from OTHER pages (cross-page sync)
    // Do NOT use onChanged in GlobalVendorSelector - that would cause double refresh
    _vendorSubscription =
        ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
      if (_isInitialized && previous != next) {
        _retryTimer?.cancel();
        _cacheRetryCount = 0;
        _loadWeekData();
      }
    });
  }

  Future<void> _refreshData() async {
    if (_isLoadingInProgress) return;
    _isLoadingInProgress = true;
    _retryTimer?.cancel();
    _retryTimer = null;

    _cacheRetryCount = 0;
    await _loadWeekData(useDirectEndpoint: true);
    if (mounted) {
      setState(() => _lastFetchTime = DateTime.now());
    }
    _isLoadingInProgress = false;
  }

  // ... (dispose, initToday, formatters etc. same)

  @override
  void dispose() {
    _vendorSubscription?.close();
    _retryTimer?.cancel();
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
    final firstDay = DateTime(year, month);
    final lastDay = DateTime(year, month + 1, 0);
    // Calculate weeks: ceiling of (days + first day offset) / 7
    final firstWeekday = firstDay.weekday; // 1=Mon
    final totalDays = lastDay.day;
    return ((totalDays + firstWeekday - 1) / 7).ceil();
  }

  int _getCurrentWeekInMonth(DateTime date) {
    final firstDay = DateTime(date.year, date.month);
    final firstWeekday = firstDay.weekday;
    return ((date.day + firstWeekday - 2) ~/ 7) + 1;
  }

  /// Obtiene las fechas de inicio y fin de la semana seleccionada dentro del mes
  (int startDay, int endDay) _getWeekDates(int year, int month, int weekNum) {
    final firstOfMonth = DateTime(year, month);
    final lastOfMonth = DateTime(year, month + 1, 0);
    final firstWeekday = firstOfMonth.weekday; // 1=Lunes

    // Calcular día de inicio de la semana (Lunes de esa semana)
    var startDay = 1 + (weekNum - 1) * 7 - (firstWeekday - 1);
    if (startDay < 1) startDay = 1;

    // Día fin (Domingo o último día del mes)
    var endDay = startDay + 6;
    if (endDay > lastOfMonth.day) endDay = lastOfMonth.day;

    return (startDay, endDay);
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
  /// Para GETs: puede ser una lista comma-separated (todos los vendedores)
  String get _activeVendedorCode {
    if (!mounted) return widget.employeeCode;
    final filterCode = ref.read(filterProvider).selectedVendor;
    return filterCode ?? widget.employeeCode;
  }

  /// Para operaciones de escritura (POST): devuelve un ÃšNICO código de vendedor.
  /// Retorna null si hay múltiples vendedores y no se ha seleccionado uno específico.
  String? get _singleVendedorCode {
    if (!mounted) return null;
    final filterCode = ref.read(filterProvider).selectedVendor;
    if (filterCode != null) return filterCode;
    // Si employeeCode no contiene comas, es un solo vendedor
    if (!widget.employeeCode.contains(',')) return widget.employeeCode;
    // Jefe de ventas sin selección específica â†’ no se puede escribir
    return null;
  }

  /// Cambia el vendedor seleccionado para "Ver rutero como"
  void _onVendedorChanged(String? vendedorCode) {
    setState(() => _selectedVendedor = vendedorCode);
    _loadWeekData();
  }

  Future<void> _loadWeekData({bool useDirectEndpoint = false}) async {
    final generation = ++_loadGeneration;
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
          'ignoreOverrides': _sortMode == 'route',
        },
      );

      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _weekData = Map<String, int>.from(
          (response['week'] as Map)
              .map((k, v) => MapEntry(k.toString(), (v as num).toInt())),
        );
        // Usar totalUniqueClients del backend para el conteo real de clientes
        _totalUniqueClients =
            (response['totalUniqueClients'] as num?)?.toInt() ??
                _weekData.values.fold(0, (a, b) => a + b);
        _isLoadingWeek = false;
      });

      // If the backend cache is still warming, show indicator and schedule retry
      final weekCacheStatus = response['cacheStatus'] as String?;
      if (weekCacheStatus == 'loading' && _cacheRetryCount < _maxCacheRetries) {
        setState(() => _isCacheLoading = true);
        _cacheRetryCount++;
        _retryTimer?.cancel();
        _retryTimer = Timer(const Duration(seconds: 6), () {
          if (mounted && generation == _loadGeneration) {
            _loadWeekData(useDirectEndpoint: useDirectEndpoint);
          }
        });
        return;
      } else {
        if (!mounted || generation != _loadGeneration) return;
        setState(() {
          _isCacheLoading = false;
          _cacheRetryCount = 0;
        });
      }

      await _loadDayClients(
        useDirectEndpoint: useDirectEndpoint,
        generation: generation,
      );
    } catch (e) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error = e.toString();
        _isLoadingWeek = false;
      });
    }
  }

  Future<void> _loadDayClients({
    bool useDirectEndpoint = false,
    int? generation,
  }) async {
    if (!mounted) return;
    final currentGeneration = generation ?? ++_loadGeneration;
    setState(() {
      _isLoadingClients = true;
    });

    try {
      // If KPI filters are active, fetch the codes first
      if (_onlyWithAlerts || _selectedAlertType != 'ALL') {
        final alertCodes = await KpiAlertsService.instance.getClientsWithAlerts(
          vendedorCodes: _activeVendedorCode,
          type: _selectedAlertType,
        );
        _kpiFilteredCodes = alertCodes.toSet();
      } else {
        _kpiFilteredCodes = {};
      }

      // Use direct endpoint when refreshing to bypass cache
      final endpoint = useDirectEndpoint
          ? '${ApiConfig.ruteroDay}-direct/$_selectedDay'
          : '${ApiConfig.ruteroDay}/$_selectedDay';

      final response = await ApiClient.get(
        endpoint,
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'role': _selectedRole,
          'year': _selectedYear,
          'month': _selectedMonth,
          'week': _selectedWeek,
          'ignoreOverrides': _sortMode == 'route' ? 'true' : 'false',
        },
      );

      if (!mounted || currentGeneration != _loadGeneration) return;
      setState(() {
        final rawList = response['clients'] ?? <dynamic>[];
        _dayClients = (rawList as List)
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        // Parse completed weeks and period label from metadata
        if (response['period'] != null) {
          final period = response['period'] as Map<String, dynamic>;
          _completedWeeks = (period['weeks'] as num?)?.toInt() ?? 0;
          _periodLabel = period['current'] as String? ?? '';
        }
        _isLoadingClients = false;
      });

      // If the backend cache is still warming OR data is empty, retry
      final dayCacheStatus = response['cacheStatus'] as String?;
      final hasAnySales = _dayClients.any((client) {
        final status = client['status'] as Map<String, dynamic>?;
        final ytdSales = (status?['ytdSales'] as num?)?.toDouble() ?? 0;
        return ytdSales > 0.01;
      });

      // Only retry while the backend cache is still warming up.
      final isBackendCacheLoading = dayCacheStatus == 'loading';
      if (isBackendCacheLoading && _cacheRetryCount < _maxCacheRetries) {
        setState(() => _isCacheLoading = true);
        _cacheRetryCount++;
        _retryTimer?.cancel();
        _retryTimer = Timer(const Duration(seconds: 6), () {
          if (mounted && currentGeneration == _loadGeneration) {
            _loadDayClients(
              useDirectEndpoint: useDirectEndpoint,
              generation: currentGeneration,
            );
          }
        });
      } else {
        if (!mounted || currentGeneration != _loadGeneration) return;
        setState(() {
          _isCacheLoading = false;
          _cacheRetryCount = 0;
        });

        // day-direct is intentionally fast and can omit sales KPIs.
        // Enrich once from the cached endpoint, but do not enter a retry loop.
        if (useDirectEndpoint &&
            _dayClients.isNotEmpty &&
            !hasAnySales &&
            mounted) {
          debugPrint(
              '[Rutero] Day-direct returned clients without sales. Fetching sales data from normal endpoint...');
          await _enrichWithSalesData(generation: currentGeneration);
        }
      }
    } catch (e) {
      if (!mounted || currentGeneration != _loadGeneration) return;
      setState(() {
        _dayClients = [];
        _isLoadingClients = false;
      });
    }
  }

  /// Fetch sales data from normal endpoint and merge into existing clients
  Future<void> _enrichWithSalesData({required int generation}) async {
    try {
      final normalResponse = await ApiClient.get(
        '${ApiConfig.ruteroDay}/$_selectedDay',
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'role': _selectedRole,
          'year': _selectedYear,
          'month': _selectedMonth,
          'week': _selectedWeek,
          'ignoreOverrides': _sortMode == 'route' ? 'true' : 'false',
        },
      );

      if (!mounted || generation != _loadGeneration) return;

      final enrichedClients =
          (normalResponse['clients'] ?? <dynamic>[]) as List;
      if (enrichedClients.isEmpty) return;

      // Merge sales data into existing clients
      final salesMap = <String, Map<String, dynamic>>{};
      for (final item in enrichedClients) {
        final client = item as Map<String, dynamic>;
        final code = client['code'] as String?;
        final status = client['status'] as Map<String, dynamic>?;
        if (code != null && status != null) {
          salesMap[code] = status;
        }
      }

      // Update existing clients with sales data
      setState(() {
        for (var i = 0; i < _dayClients.length; i++) {
          final code = _dayClients[i]['code'] as String?;
          if (code != null && salesMap.containsKey(code)) {
            _dayClients[i]['status'] = salesMap[code];
          }
        }
      });

      debugPrint('[Rutero] Sales data enriched for ${salesMap.length} clients');
    } catch (e) {
      debugPrint('[Rutero] Failed to enrich with sales data: $e');
    }
  }

  void _onDaySelected(String day) {
    if (day != _selectedDay) {
      _cacheRetryCount = 0; // Reset retry counter when changing day
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
    final screenHeight = MediaQuery.of(context).size.height;
    final isSmallScreen = screenHeight < 850;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: SafeArea(
        child: Column(
          children: [
            SmartSyncHeader(
              title: 'Rutero Comercial',
              subtitle: _periodLabel.isNotEmpty
                  ? _periodLabel
                  : 'Planificación Semanal',
              lastSync: _lastFetchTime,
              isLoading: _isLoadingWeek || _isLoadingClients,
              onSync: _refreshData,
            ),
            if (_isCacheLoading) _buildCacheBanner(),
            RuteroHeader(
              selectedRole: _selectedRole,
              isJefeVentas: widget.isJefeVentas,
              isSmallScreen: isSmallScreen,
              onRoleChanged: _onRoleChanged,
              onSortTap: _openReorderModal,
              forceShowVendorSelector: widget.forceShowVendorSelector,
            ),
            RuteroWeekSummary(
              selectedYear: _selectedYear,
              selectedMonth: _selectedMonth,
              selectedWeek: _selectedWeek,
              weeksInMonth: _weeksInMonth,
              totalUniqueClients: _totalUniqueClients,
              weekData: _weekData,
              selectedDay: _selectedDay,
              onWeekChange: _changeWeek,
              onDaySelected: _onDaySelected,
              monthNames: _monthNames,
            ),
            Expanded(
              child: Column(
                children: [
                  RuteroFilterBar(
                    searchQuery: _searchQuery,
                    searchController: _searchController,
                    sortMode: _sortMode,
                    selectedAlertType: _selectedAlertType,
                    onlyWithAlerts: _onlyWithAlerts,
                    onSearchChanged: (v) =>
                        setState(() => _searchQuery = v.toLowerCase()),
                    onSortChanged: _onSortChanged,
                    onAlertTypeChanged: (v) => setState(() {
                      _selectedAlertType = v;
                      _loadDayClients();
                    }),
                    onOnlyWithAlertsChanged: (v) => setState(() {
                      _onlyWithAlerts = v;
                      _loadDayClients();
                    }),
                  ),
                  Expanded(
                    child: _buildClientList(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCacheBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
      color: AppTheme.neonBlue.withValues(alpha: 0.15),
      child: Row(
        children: [
          const SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: AppTheme.neonBlue,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Preparando datosâ€¦ se actualizará automáticamente',
            style: TextStyle(
              color: AppTheme.neonBlue.withValues(alpha: 0.9),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  void _onSortChanged(String value) {
    final oldMode = _sortMode;
    setState(() => _sortMode = value);
    if (value == 'route' || oldMode == 'route') {
      _loadWeekData();
    }
  }

  Widget _buildClientList() {
    if (_isLoadingWeek || _isLoadingClients) {
      return const Padding(
        padding: EdgeInsets.all(40),
        child: ModernLoading(message: 'Cargando rutas...'),
      );
    }

    if (_error != null) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 48, color: AppTheme.error),
            SizedBox(height: 16),
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
              _selectedRole == 'comercial'
                  ? Icons.shopping_bag_outlined
                  : Icons.local_shipping_outlined,
              size: 64,
              color: AppTheme.neonPink.withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'Sin clientes para ${_weekdayFullLabels[_selectedDay]}',
              style: TextStyle(fontSize: 16, color: Colors.grey.shade400),
            ),
            const SizedBox(height: 8),
            Text(
              'Prueba a cambiar de día o sincronizar',
              style: TextStyle(fontSize: 14, color: Colors.grey.shade600),
            ),
          ],
        ),
      );
    }

    // Filter clients based on search query AND KPI alerts
    final filteredClients = _dayClients.where((client) {
      final code = (client['code'] as String?) ?? '';

      // 1. KPI Filter (Alerts)
      if (_onlyWithAlerts || _selectedAlertType != 'ALL') {
        if (!_kpiFilteredCodes.contains(code)) return false;
      }

      // 2. Search Filter
      if (_searchQuery.isNotEmpty) {
        final name = (client['name'] as String?)?.toLowerCase() ?? '';
        final address = (client['address'] as String?)?.toLowerCase() ?? '';
        final city = (client['city'] as String?)?.toLowerCase() ?? '';

        final q = _searchQuery.toLowerCase();
        return name.contains(q) ||
            code.contains(q) ||
            address.contains(q) ||
            city.contains(q);
      }

      return true;
    }).toList();

    // Apply sorting based on _sortMode
    switch (_sortMode) {
      case 'sales_desc':
        filteredClients.sort((a, b) {
          final salesA =
              ((a['status'] as Map<String, dynamic>?)?['ytdSales'] as num?)
                      ?.toDouble() ??
                  0;
          final salesB =
              ((b['status'] as Map<String, dynamic>?)?['ytdSales'] as num?)
                      ?.toDouble() ??
                  0;
          return salesB.compareTo(salesA); // Descending
        });
      case 'sales_asc':
        filteredClients.sort((a, b) {
          final salesA =
              ((a['status'] as Map<String, dynamic>?)?['ytdSales'] as num?)
                      ?.toDouble() ??
                  0;
          final salesB =
              ((b['status'] as Map<String, dynamic>?)?['ytdSales'] as num?)
                      ?.toDouble() ??
                  0;
          return salesA.compareTo(salesB); // Ascending
        });
      case 'route':
        // Already sorted by API order
        break;
      case 'custom':
      default:
        filteredClients.sort((a, b) {
          final orderA = (a['order'] as int?) ?? 9999;
          final orderB = (b['order'] as int?) ?? 9999;
          if (orderA != orderB) return orderA.compareTo(orderB);
          final nameA = (a['name'] as String?) ?? '';
          final nameB = (b['name'] as String?) ?? '';
          return nameA.compareTo(nameB);
        });
    }

    // --- Empty States for Filtered Results ---

    // Case A: No results due to Alert filters
    if (filteredClients.isEmpty &&
        (_onlyWithAlerts || _selectedAlertType != 'ALL')) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.notifications_off_outlined,
              size: 60,
              color: AppTheme.neonPink.withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'Sin clientes con alertas',
              style: TextStyle(
                fontSize: 18,
                color: Colors.white.withValues(alpha: 0.9),
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _selectedAlertType == 'ALL'
                  ? 'Este día no tiene alertas detectadas'
                  : 'No hay alertas de tipo\n"${KpiAlertsService.instance.getKpiAlertTypeName(_selectedAlertType)}"',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: Colors.grey.shade400),
            ),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: () => setState(() {
                _onlyWithAlerts = false;
                _selectedAlertType = 'ALL';
              }),
              icon: const Icon(Icons.filter_list_off),
              label: const Text('Limpiar filtros de KPI'),
              style: TextButton.styleFrom(foregroundColor: AppTheme.neonPink),
            ),
          ],
        ),
      );
    }

    // Case B: No results due to Search query
    if (filteredClients.isEmpty && _searchQuery.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.search_off,
              size: 48,
              color: AppTheme.neonPink.withValues(alpha: 0.4),
            ),
            const SizedBox(height: 16),
            Text(
              'No se encontró ningún cliente para "$_searchQuery"',
              style: TextStyle(color: Colors.grey.shade400),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() {
                _searchController.clear();
                _searchQuery = '';
              }),
              child: const Text(
                'Limpiar búsqueda',
                style: TextStyle(color: AppTheme.neonPink),
              ),
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
          return RuteroClientListItem(
            client: client,
            index: index + 1,
            formatCurrency: _formatCurrency,
            formatVariation: _formatVariation,
            onTap: () => _navigateToMatrix(client),
            onMapTap: () => _openMaps(client),
            onCallTap: () => _makeCall(client),
            onWhatsAppTap: () => _openWhatsApp(client),
            onNotesTap: () => _openNotesDialog(client),
            showMargin: widget.isJefeVentas,
            selectedYear: _selectedYear,
            completedWeeks: _completedWeeks,
            periodLabel: _periodLabel,
          );
        },
      ),
    );
  }

  void _navigateToMatrix(Map<String, dynamic> client) {
    Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (context) => EnhancedClientMatrixPage(
          clientCode: (client['code'] as String?) ?? '',
          clientName: (client['name'] as String?) ?? 'Cliente',
          isJefeVentas: widget.isJefeVentas,
        ),
      ),
    );
  }

  Future<void> _openMaps(Map<String, dynamic> client) async {
    final latitude = client['latitude'] as num?;
    final longitude = client['longitude'] as num?;
    final address = (client['address'] as String?) ?? '';
    final city = (client['city'] as String?) ?? '';
    final name = (client['name'] as String?) ?? '';

    // If we have GPS coordinates, use them directly
    if (latitude != null &&
        longitude != null &&
        latitude != 0 &&
        longitude != 0) {
      final urls = [
        'geo:$latitude,$longitude?q=$latitude,$longitude',
        'https://www.google.com/maps/dir/?api=1&destination=$latitude,$longitude',
      ];

      for (final urlStr in urls) {
        try {
          final uri = Uri.parse(urlStr);
          final launched =
              await launchUrl(uri, mode: LaunchMode.externalApplication);
          if (launched) return;
        } catch (e) {
          // Try next
        }
      }
    }

    // Fallback to address search
    final searchQuery =
        name.isNotEmpty ? '$name, $address, $city' : '$address, $city';

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
        final launched =
            await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (launched) return;
      } catch (e) {
        // Try next
      }
    }
  }

  Future<void> _makeCall(Map<String, dynamic> client) async {
    final phones = (client['phones'] as List?)
            ?.map((p) => Map<String, dynamic>.from(p as Map))
            .toList() ??
        [];

    // Show selector with all phones + custom option
    showModalBottomSheet<void>(
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
            const Text(
              'Llamar',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            const SizedBox(height: 8),
            const Text(
              'Selecciona el número:',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 12),
            if (phones.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'No hay teléfonos guardados',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ),
            ...phones.map(
              (p) => ListTile(
                leading: const Icon(Icons.phone, color: AppTheme.neonBlue),
                title: Text((p['number'] as String?) ?? ''),
                subtitle: Text((p['type'] as String?) ?? 'Teléfono'),
                onTap: () {
                  Navigator.pop(ctx);
                  _launchPhoneCall((p['number'] as String?) ?? '');
                },
              ),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.dialpad, color: AppTheme.neonPink),
              title: const Text('Introducir número manualmente'),
              subtitle: const Text('Escribe un número personalizado'),
              onTap: () {
                Navigator.pop(ctx);
                _showCustomPhoneDialog(isWhatsApp: false);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _launchPhoneCall(String phone) async {
    final cleanPhone = phone.replaceAll(RegExp('[^0-9+]'), '');
    try {
      await launchUrl(Uri.parse('tel:$cleanPhone'));
    } catch (e) {
      // Ignore
    }
  }

  Future<void> _showCustomPhoneDialog({required bool isWhatsApp}) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        title: Text(isWhatsApp ? 'WhatsApp' : 'Llamar'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(
            labelText: 'Número de teléfono',
            hintText: 'Ej: 600 123 456',
            prefixIcon: Icon(isWhatsApp ? Icons.chat : Icons.phone),
            border: const OutlineInputBorder(),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            style: ElevatedButton.styleFrom(
              backgroundColor:
                  isWhatsApp ? const Color(0xFF25D366) : AppTheme.neonBlue,
            ),
            child: Text(isWhatsApp ? 'Enviar WhatsApp' : 'Llamar'),
          ),
        ],
      ),
    );

    if (result != null && result.trim().isNotEmpty) {
      if (isWhatsApp) {
        _launchWhatsApp(result.trim());
      } else {
        _launchPhoneCall(result.trim());
      }
    }
  }

  Future<void> _openNotesDialog(Map<String, dynamic> client) async {
    final currentNotes =
        Map<String, dynamic>.from((client['observaciones'] as Map?) ?? {});
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
    final obs = Map<String, dynamic>.from(
      (updatedClient['observaciones'] as Map?) ?? {},
    );
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
          'clientCode': (client['code'] as String?) ?? '',
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
          SnackBar(
            content: Text('Error guardando notas: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  void _openWhatsApp(Map<String, dynamic> client) {
    final phones = (client['phones'] as List?)
            ?.map((p) => Map<String, dynamic>.from(p as Map))
            .toList() ??
        [];

    // Always show selector with custom option
    showModalBottomSheet<void>(
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
            const Text(
              'Enviar WhatsApp',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            const SizedBox(height: 8),
            const Text(
              'Selecciona el número:',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 12),
            if (phones.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'No hay teléfonos guardados',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ),
            ...phones.map(
              (p) => ListTile(
                leading:
                    const Icon(Icons.phone_android, color: Color(0xFF25D366)),
                title: Text((p['number'] as String?) ?? ''),
                subtitle: Text((p['type'] as String?) ?? 'Teléfono'),
                onTap: () {
                  Navigator.pop(ctx);
                  _launchWhatsApp((p['number'] as String?) ?? '');
                },
              ),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.dialpad, color: AppTheme.neonPink),
              title: const Text('Introducir número manualmente'),
              subtitle: const Text('Escribe un número personalizado'),
              onTap: () {
                Navigator.pop(ctx);
                _showCustomPhoneDialog(isWhatsApp: true);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _launchWhatsApp(String phone) async {
    // Clean phone number - remove non-digits except +
    var cleanPhone = phone.replaceAll(RegExp('[^0-9+]'), '');
    // Add Spain prefix if not present
    if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('34')) {
      cleanPhone = '34$cleanPhone';
    }
    if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Personal identification
    final authState =
        ProviderScope.containerOf(context).read(authProvider).value;
    final nombreComercial = authState?.user?.name ?? 'tu comercial';
    final manana = DateTime.now().add(const Duration(days: 1));
    final fecha = '${manana.day}/${manana.month}/${manana.year}';

    // Professional message
    final message =
        Uri.encodeComponent('Hola, soy $nombreComercial de Mari Pepa. '
            'Mañana día $fecha tenemos visita. '
            'Â¿Necesitas cualquier cosilla?');

    final uri = Uri.parse('https://wa.me/$cleanPhone?text=$message');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openReorderModal() async {
    final vendedor = _singleVendedorCode;
    if (vendedor == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Selecciona un vendedor específico para reordenar'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
      return;
    }

    // Show FULL list in reorder dialog to ensure consistency
    final clientsToOrder = List<Map<String, dynamic>>.from(_dayClients);

    final result = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => ReorderDialog(
        clients: clientsToOrder,
        activeVendedor: vendedor,
        currentDay: _selectedDay,
      ),
    );

    if (result != null) {
      await _saveNewOrder(result);
    }

    // SIEMPRE refrescar después de cerrar el diálogo
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
            (countsResponse['counts'] as Map)
                .map((k, v) => MapEntry(k.toString(), (v as num).toInt())),
          );
          _totalUniqueClients =
              (countsResponse['totalUniqueClients'] as num?)?.toInt() ??
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
    final vendedor = _singleVendedorCode;
    if (vendedor == null) return;

    setState(() => _isLoadingWeek = true);
    try {
      final orderPayload = newOrder
          .asMap()
          .entries
          .map(
            (e) => <String, dynamic>{
              'cliente': (e.value['code'] as String?) ?? '',
              'posicion': e.key,
              'posicionOriginal':
                  (e.value['posicionOriginal'] as int?) ?? e.key,
            },
          )
          .toList();

      await ApiClient.post('/rutero/config', {
        'vendedor': vendedor,
        'dia': _selectedDay.toLowerCase(),
        'orden': orderPayload,
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

class ReorderDialog extends StatefulWidget {
  const ReorderDialog({
    required this.clients,
    required this.activeVendedor,
    required this.currentDay,
    super.key,
  });
  final List<Map<String, dynamic>> clients;
  final String activeVendedor;
  final String currentDay;

  @override
  _ReorderDialogState createState() => _ReorderDialogState();
}

class _ReorderDialogState extends State<ReorderDialog> {
  late List<Map<String, dynamic>> _items;
  final ScrollController _scrollController = ScrollController();
  bool _hasChanges = false; // Track if order has changed
  List<String> _originalOrder = []; // Store original order to detect changes
  final Map<String, int> _originalPositions =
      {}; // Store original position of each client

  @override
  void initState() {
    super.initState();
    _items = List.from(widget.clients);
    // Store original order for comparison
    _originalOrder = _items.map((c) => c['code'] as String).toList();
    // Store original position (index) of each client
    for (var i = 0; i < _items.length; i++) {
      _originalPositions[_items[i]['code'] as String] = i;
    }
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
    for (var i = 0; i < a.length; i++) {
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
      var targetIndex = newPos - 1;
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
    final clientName = (client['name'] as String?) ?? 'Cliente';
    final clientCode = (client['code'] as String?) ?? '';

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
    showDialog<void>(
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
            'client': (client['code'] as String?) ?? '',
            'toDay': toDay.toLowerCase(),
            'fromDay': widget.currentDay.toLowerCase(),
            'clientName': (client['name'] as String?) ?? '',
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
            content: Text(
              '${(client['name'] as String?) ?? ''} movido al ${toDay.toUpperCase()}',
            ),
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

    if (confirmed ?? false) {
      // Añadir posición original a cada item antes de retornar
      final itemsWithOriginalPos = _items.map((item) {
        final code = item['code'] as String;
        return {
          ...item,
          'posicionOriginal': _originalPositions[code] ?? 0,
        };
      }).toList();
      Navigator.pop(
        context,
        itemsWithOriginalPos,
      ); // Retornar items con posición original
    }
  }

  /// Confirmar descarte de cambios al cerrar
  Future<bool> _confirmDiscard() async {
    if (!_hasChanges) return true;

    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppTheme.warning),
            SizedBox(width: 8),
            Text('Â¿Descartar cambios?'),
          ],
        ),
        content: const Text(
          'Has modificado el orden de la ruta. Â¿Quieres descartar los cambios sin guardar?',
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

    return discard ?? false;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (!didPop) {
          await _confirmDiscard();
        }
      },
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
                  const Text(
                    'Organizar Rutero',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  if (_hasChanges)
                    Container(
                      margin: const EdgeInsets.only(left: 8),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.warning.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
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
              child: const Text(
                'Arrastra para ordenar o usa las flechas. Usa el icono ðŸ“… para mover a otro día.\n'
                'âš ï¸ Los cambios solo se aplican al pulsar GUARDAR CAMBIOS.',
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
                          Icon(
                            Icons.inbox,
                            size: 48,
                            color: Colors.grey.shade600,
                          ),
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
                            border: Border(
                              bottom: BorderSide(color: Colors.black12),
                            ),
                          ),
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 4,
                            ),
                            leading: ReorderableDragStartListener(
                              index: index,
                              child: const Padding(
                                padding: EdgeInsets.all(12),
                                child:
                                    Icon(Icons.drag_handle, color: Colors.grey),
                              ),
                            ),
                            title: Text(
                              (item['name'] as String?) ?? '',
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            subtitle: Text(
                              (item['code'] as String?) ?? '',
                              style: const TextStyle(
                                fontSize: 12,
                                color: Colors.grey,
                              ),
                            ),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                // Arrows
                                Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    InkWell(
                                      onTap: () => _moveItem(index, -1),
                                      child: const Icon(
                                        Icons.arrow_drop_up,
                                        size: 20,
                                      ),
                                    ),
                                    InkWell(
                                      onTap: () => _moveItem(index, 1),
                                      child: const Icon(
                                        Icons.arrow_drop_down,
                                        size: 20,
                                      ),
                                    ),
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
                                      isDense: true,
                                    ),
                                    controller:
                                        TextEditingController(text: '$pos')
                                          ..selection = TextSelection.collapsed(
                                            offset: '$pos'.length,
                                          ),
                                    onSubmitted: (val) =>
                                        _updatePositionManual(index, val),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                // Change Day Button
                                IconButton(
                                  icon: const Icon(
                                    Icons.calendar_month,
                                    color: AppTheme.neonBlue,
                                  ),
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
                    backgroundColor:
                        _hasChanges ? AppTheme.neonPink : Colors.grey,
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
