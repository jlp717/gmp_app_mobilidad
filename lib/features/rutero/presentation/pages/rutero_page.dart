import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../objectives/presentation/pages/enhanced_client_matrix_page.dart';
import '../widgets/rutero_reorder_modal.dart';

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
    if (widget.isJefeVentas) {
      _loadVendedores();
    }
    _loadWeekData();
  }
  
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
  String get _activeVendedorCode => _selectedVendedor ?? widget.employeeCode;
  
  /// Carga la lista de vendedores disponibles (solo para jefe de ventas)
  Future<void> _loadVendedores() async {
    try {
      final response = await ApiClient.get(
        '/rutero/vendedores',
      );
      
      setState(() {
        _vendedoresDisponibles = List<Map<String, dynamic>>.from(response['vendedores'] ?? []);
      });
    } catch (e) {
      // Silently fail - vendedores list is optional for jefe
      debugPrint('Error loading vendedores: $e');
    }
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
      
      _loadDayClients();
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
        _dayClients = List<Map<String, dynamic>>.from(response['clients'] ?? []);
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

  Future<void> _openReorderModal() async {
    if (_dayClients.isEmpty) return;
    
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => RuteroReorderModal(
          clients: _dayClients,
          employeeCode: _activeVendedorCode,
          day: _selectedDay,
        ),
      ),
    );
    
    if (result == true) {
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
            _buildHeader(isSmallScreen: isSmallScreen),
            // Selector de vendedor para jefe de ventas
            if (widget.isJefeVentas) _buildVendedorSelector(isSmallScreen: isSmallScreen),
            _buildRoleToggle(isSmallScreen: isSmallScreen),
            _buildMonthSelector(isSmallScreen: isSmallScreen),
            _buildWeekdayChips(isSmallScreen: isSmallScreen, isVerySmallScreen: isVerySmallScreen),
            _buildDayHeader(isSmallScreen: isSmallScreen),
            _buildSearchBar(isSmallScreen: isSmallScreen),
            Expanded(child: _buildClientList()),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader({bool isSmallScreen = false}) {
    return Container(
      padding: EdgeInsets.fromLTRB(8, isSmallScreen ? 6 : 12, 16, isSmallScreen ? 4 : 8),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
          ),
          IconButton(
            onPressed: _openReorderModal,
            icon: const Icon(Icons.sort, color: Colors.white, size: 24),
            tooltip: 'Ordenar Rutero',
          ),
          const SizedBox(width: 4),
          // Pink gradient title
          ShaderMask(
            shaderCallback: (bounds) => LinearGradient(
              colors: [AppTheme.neonPink, AppTheme.neonPurple],
            ).createShader(bounds),
            child:            Text(
              'RUTERO',
              style: TextStyle(
                fontSize: isSmallScreen ? 18 : 24,
                fontWeight: FontWeight.bold,
                letterSpacing: 2,
                color: Colors.white,
              ),
            ),
          ),
          const Spacer(),
          // Total clients badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.neonPink.withOpacity(0.3), AppTheme.neonPurple.withOpacity(0.3)],
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.people, color: AppTheme.neonPink, size: 16),
                const SizedBox(width: 6),
                Text(
                  '$_totalUniqueClients',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Widget de selección de vendedor para "Ver rutero como" (solo jefe de ventas)
  Widget _buildVendedorSelector({bool isSmallScreen = false}) {
    // Ensure selected value exists in items, otherwise reset to empty
    final validVendedorCodes = _vendedoresDisponibles.map((v) => v['code']?.toString() ?? '').toSet();
    final currentValue = (_selectedVendedor != null && validVendedorCodes.contains(_selectedVendedor)) 
        ? _selectedVendedor! 
        : '';
    
    return Container(
      margin: EdgeInsets.symmetric(horizontal: 16, vertical: isSmallScreen ? 4 : 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.neonBlue.withOpacity(0.15), AppTheme.neonPurple.withOpacity(0.15)],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.visibility, color: AppTheme.neonBlue, size: 20),
          const SizedBox(width: 8),
          Text(
            'Ver rutero como:',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: isSmallScreen ? 11 : 12,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.darkSurface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: currentValue,
                  isExpanded: true,
                  dropdownColor: AppTheme.darkCard,
                  icon: Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue),
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                  items: [
                    const DropdownMenuItem<String>(
                      value: '',
                      child: Text(
                        'Todos los comerciales',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      ),
                    ),
                    ..._vendedoresDisponibles.map((v) {
                      final code = v['code']?.toString() ?? '';
                      final name = v['name']?.toString() ?? '';
                      final clients = (v['clients'] as num?)?.toInt() ?? 0;
                      final displayName = name.isNotEmpty ? name : 'Vendedor $code';
                      return DropdownMenuItem<String>(
                        value: code,
                        child: Text(
                          '$displayName ($clients clientes)',
                          style: const TextStyle(color: Colors.white),
                        ),
                      );
                    }),
                  ],
                  onChanged: (value) {
                    final newValue = value?.isEmpty == true ? null : value;
                    setState(() => _selectedVendedor = newValue);
                    _loadWeekData();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoleToggle({bool isSmallScreen = false}) {
    return Container(
      margin: EdgeInsets.symmetric(horizontal: 16, vertical: isSmallScreen ? 2 : 4),
      padding: EdgeInsets.all(isSmallScreen ? 2 : 4),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonPink.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Expanded(
            child: _RoleButton(
              label: 'Día de Visita',
              icon: Icons.shopping_bag_outlined,
              isSelected: _selectedRole == 'comercial',
              color: AppTheme.neonPink,
              onTap: () => _onRoleChanged('comercial'),
            ),
          ),
          Expanded(
            child: _RoleButton(
              label: 'Día de Reparto',
              icon: Icons.local_shipping_outlined,
              isSelected: _selectedRole == 'repartidor',
              color: AppTheme.neonBlue,
              onTap: () => _onRoleChanged('repartidor'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMonthSelector({bool isSmallScreen = false}) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: isSmallScreen ? 4 : 8),
      child: Column(
        children: [
          // Month selector row
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: () => _changeMonth(-1),
                icon: Icon(Icons.chevron_left, color: AppTheme.neonPink),
                splashRadius: 20,
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppTheme.neonPink.withOpacity(0.15), AppTheme.neonPurple.withOpacity(0.15)],
                  ),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppTheme.neonPink.withOpacity(0.4)),
                ),
                child: Text(
                  '${_monthNames[_selectedMonth - 1]} $_selectedYear',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
              ),
              IconButton(
                onPressed: () => _changeMonth(1),
                icon: Icon(Icons.chevron_right, color: AppTheme.neonPink),
                splashRadius: 20,
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Week selector row
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: () => _changeWeek(-1),
                icon: Icon(Icons.keyboard_arrow_left, color: AppTheme.neonBlue, size: 20),
                splashRadius: 16,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                ),
                child: Text(
                  'Semana $_selectedWeek de $_weeksInMonth',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: AppTheme.neonBlue),
                ),
              ),
              IconButton(
                onPressed: () => _changeWeek(1),
                icon: Icon(Icons.keyboard_arrow_right, color: AppTheme.neonBlue, size: 20),
                splashRadius: 16,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
            ],
          ),
        ],
      ),
    );
  }


  Widget _buildWeekdayChips({bool isSmallScreen = false, bool isVerySmallScreen = false}) {
    // Responsive chip sizes
    final chipWidth = isVerySmallScreen ? 48.0 : (isSmallScreen ? 55.0 : 65.0);
    final selectedChipWidth = isVerySmallScreen ? 58.0 : (isSmallScreen ? 65.0 : 80.0);
    final chipHeight = isVerySmallScreen ? 45.0 : (isSmallScreen ? 50.0 : 60.0);
    final selectedChipHeight = isVerySmallScreen ? 52.0 : (isSmallScreen ? 58.0 : 70.0);
    final labelFontSize = isVerySmallScreen ? 9.0 : (isSmallScreen ? 10.0 : 12.0);
    final selectedLabelFontSize = isVerySmallScreen ? 10.0 : (isSmallScreen ? 12.0 : 14.0);
    final countFontSize = isVerySmallScreen ? 10.0 : (isSmallScreen ? 11.0 : 13.0);
    
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: isSmallScreen ? 4 : 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppTheme.darkSurface.withOpacity(0.8),
            AppTheme.darkBase,
          ],
        ),
      ),
      child: Column(
        children: [
          // Title
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                _selectedRole == 'comercial' ? Icons.shopping_bag : Icons.local_shipping,
                color: AppTheme.neonPink,
                size: 18,
              ),
              const SizedBox(width: 8),
              Text(
                _selectedRole == 'comercial' ? 'DÍAS DE VISITA' : 'DÍAS DE REPARTO',
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 2,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Day chips grid - centered wrap
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: _weekdays.map((day) {
              final isSelected = day == _selectedDay;
              final isToday = day == _todayName;
              final count = _weekData[day] ?? 0;
              
              return GestureDetector(
                onTap: () => _onDaySelected(day),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: isSelected ? selectedChipWidth : chipWidth,
                  height: isSelected ? selectedChipHeight * 0.8 : chipHeight * 0.8,
                  decoration: BoxDecoration(
                    gradient: isSelected ? const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFFF6B9D), Color(0xFFBB86FC)],
                    ) : null,
                    color: isSelected ? null : (isToday ? AppTheme.darkCard : AppTheme.darkSurface),
                    borderRadius: BorderRadius.circular(isSmallScreen ? 12 : 16),
                    border: Border.all(
                      color: isSelected 
                          ? Colors.transparent 
                          : (isToday ? AppTheme.neonPink : AppTheme.borderColor),
                      width: isToday ? 2 : 1,
                    ),
                    boxShadow: isSelected ? [
                      BoxShadow(
                        color: AppTheme.neonPink.withOpacity(0.4),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ] : null,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Day label
                      Text(
                        _weekdayLabels[day] ?? day.substring(0, 3).toUpperCase(),
                        style: TextStyle(
                          fontSize: isSelected ? selectedLabelFontSize : labelFontSize,
                          fontWeight: FontWeight.bold,
                          color: isSelected ? Colors.white : AppTheme.textSecondary,
                          letterSpacing: isSmallScreen ? 0.5 : 1,
                        ),
                      ),
                      SizedBox(height: isSmallScreen ? 2 : 4),
                      // Client count badge
                      Container(
                        padding: EdgeInsets.symmetric(horizontal: isSmallScreen ? 6 : 10, vertical: isSmallScreen ? 2 : 4),
                        decoration: BoxDecoration(
                          color: isSelected 
                              ? Colors.white.withOpacity(0.25) 
                              : AppTheme.neonPink.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '$count',
                          style: TextStyle(
                            fontSize: isSelected ? (countFontSize + 2) : countFontSize,
                            fontWeight: FontWeight.bold,
                            color: isSelected ? Colors.white : AppTheme.neonPink,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildDayHeader({bool isSmallScreen = false}) {
    final count = _weekData[_selectedDay] ?? 0;
    final dayLabel = _weekdayFullLabels[_selectedDay] ?? _selectedDay;
    
    // Count positive/negative clients
    int positive = 0, negative = 0;
    for (final c in _dayClients) {
      final status = c['status'] as Map<String, dynamic>?;
      if (status?['isPositive'] == true) {
        positive++;
      } else {
        negative++;
      }
    }
    
    return Container(
      margin: EdgeInsets.symmetric(horizontal: 16, vertical: isSmallScreen ? 4 : 8),
      padding: EdgeInsets.symmetric(horizontal: isSmallScreen ? 12 : 16, vertical: isSmallScreen ? 8 : 12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.neonPink.withOpacity(0.1), AppTheme.neonPurple.withOpacity(0.1)],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonPink.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Icon(
            _selectedRole == 'comercial' ? Icons.shopping_bag : Icons.local_shipping,
            color: AppTheme.neonPink,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  dayLabel,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                Text(
                  '$count clientes para ${_selectedRole == 'comercial' ? 'visitar' : 'repartir'}',
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade400),
                ),
              ],
            ),
          ),
          // Status badges
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.success.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.arrow_upward, color: AppTheme.success, size: 12),
                const SizedBox(width: 2),
                Text('$positive', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.success)),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.error.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.arrow_downward, color: AppTheme.error, size: 12),
                const SizedBox(width: 2),
                Text('$negative', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.error)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar({bool isSmallScreen = false}) {
    return Container(
      margin: EdgeInsets.symmetric(horizontal: 16, vertical: isSmallScreen ? 4 : 8),
      child: TextField(
        controller: _searchController,
        onChanged: (value) {
          setState(() {
            _searchQuery = value.toLowerCase();
          });
        },
        decoration: InputDecoration(
          hintText: 'Buscar por código o nombre...',
          hintStyle: TextStyle(color: Colors.grey.shade500, fontSize: 14),
          prefixIcon: Icon(Icons.search, color: AppTheme.neonPink, size: 20),
          suffixIcon: _searchQuery.isNotEmpty
              ? IconButton(
                  icon: Icon(Icons.clear, color: Colors.grey.shade400, size: 18),
                  onPressed: () {
                    setState(() {
                      _searchController.clear();
                      _searchQuery = '';
                    });
                  },
                )
              : null,
          filled: true,
          fillColor: AppTheme.surfaceColor,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.neonPink.withOpacity(0.2)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: AppTheme.neonPink, width: 1.5),
          ),
        ),
        style: const TextStyle(fontSize: 14, color: Colors.white),
      ),
    );
  }

  Widget _buildClientList() {
    if (_isLoadingWeek || _isLoadingClients) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: AppTheme.neonPink),
            const SizedBox(height: 16),
            Text('Cargando...', style: TextStyle(color: Colors.grey.shade400)),
          ],
        ),
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
            showMargin: widget.isJefeVentas,
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
  final bool showMargin;

  const _ClientCard({
    required this.client,
    required this.formatCurrency,
    required this.formatVariation,
    required this.onTap,
    required this.onMapTap,
    required this.onCallTap,
    this.showMargin = false,
  });

  @override
  Widget build(BuildContext context) {
    final name = client['name'] as String? ?? 'Sin nombre';
    final code = client['code'] as String? ?? '';
    final address = client['address'] as String? ?? '';
    final city = client['city'] as String? ?? '';
    final status = client['status'] as Map<String, dynamic>? ?? {};
    
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
    
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: accentColor.withOpacity(0.5),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: accentColor.withOpacity(0.1),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
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
                      'vs 2024',
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
      ),
    );
  }
}
