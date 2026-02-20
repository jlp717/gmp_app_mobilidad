/// WAREHOUSE DASHBOARD PAGE
/// Vista principal del Jefe de Almacén / Expediciones
/// Muestra los camiones del día con KPIs de carga

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';
import 'load_planner_3d_page.dart';

class WarehouseDashboardPage extends StatefulWidget {
  const WarehouseDashboardPage({super.key});

  @override
  State<WarehouseDashboardPage> createState() => _WarehouseDashboardPageState();
}

class _WarehouseDashboardPageState extends State<WarehouseDashboardPage>
    with TickerProviderStateMixin {
  List<TruckSummary> _trucks = [];
  bool _loading = true;
  String? _error;
  late DateTime _selectedDate;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    _loadDashboard();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _loadDashboard() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final trucks = await WarehouseDataService.getDashboard(
        year: _selectedDate.year,
        month: _selectedDate.month,
        day: _selectedDate.day,
      );
      if (mounted) {
        setState(() {
          _trucks = trucks;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  void _changeDate(int deltaDays) {
    setState(() {
      _selectedDate = _selectedDate.add(Duration(days: deltaDays));
    });
    _loadDashboard();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          _buildHeader(),
          _buildDateSelector(),
          if (!_loading && _error == null && _trucks.isNotEmpty) _buildKpiStrip(),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                        color: AppTheme.neonBlue))
                : _error != null
                    ? _buildError()
                    : _trucks.isEmpty
                        ? _buildEmpty()
                        : _buildTruckGrid(),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.darkBase,
            AppTheme.neonBlue.withValues(alpha: 0.08),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: AppTheme.neonBlue.withValues(alpha: 0.3)),
            ),
            child: const Icon(Icons.warehouse_rounded,
                color: AppTheme.neonBlue, size: 28),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'CENTRO DE EXPEDICIONES',
                  style: TextStyle(
                    color: AppTheme.neonBlue,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.5,
                  ),
                ),
                Text(
                  '${_trucks.length} camiones · ${_trucks.fold<int>(0, (s, t) => s + t.orderCount)} pedidos',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadDashboard,
            icon: const Icon(Icons.refresh_rounded,
                color: AppTheme.neonGreen, size: 24),
          ),
        ],
      ),
    );
  }

  Widget _buildDateSelector() {
    final months = [
      '', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
    ];
    final days = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    final dayName = days[_selectedDate.weekday];
    final isToday = _selectedDate.day == DateTime.now().day &&
        _selectedDate.month == DateTime.now().month &&
        _selectedDate.year == DateTime.now().year;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
            color: AppTheme.neonBlue.withValues(alpha: 0.2)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            onPressed: () => _changeDate(-1),
            icon: const Icon(Icons.chevron_left_rounded,
                color: Colors.white70, size: 28),
          ),
          GestureDetector(
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _selectedDate,
                firstDate: DateTime(2020),
                lastDate: DateTime(2030),
                builder: (ctx, child) => Theme(
                  data: ThemeData.dark().copyWith(
                    colorScheme: const ColorScheme.dark(
                        primary: AppTheme.neonBlue,
                        surface: AppTheme.darkCard),
                  ),
                  child: child!,
                ),
              );
              if (picked != null) {
                setState(() => _selectedDate = picked);
                _loadDashboard();
              }
            },
            child: Row(
              children: [
                const Icon(Icons.calendar_today_rounded,
                    color: AppTheme.neonBlue, size: 18),
                const SizedBox(width: 8),
                Text(
                  '$dayName ${_selectedDate.day} ${months[_selectedDate.month]} ${_selectedDate.year}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (isToday) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonGreen.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text('HOY',
                        style: TextStyle(
                            color: AppTheme.neonGreen,
                            fontSize: 10,
                            fontWeight: FontWeight.w800)),
                  ),
                ],
              ],
            ),
          ),
          IconButton(
            onPressed: () => _changeDate(1),
            icon: const Icon(Icons.chevron_right_rounded,
                color: Colors.white70, size: 28),
          ),
        ],
      ),
    );
  }

  Widget _buildTruckGrid() {
    return RefreshIndicator(
      onRefresh: _loadDashboard,
      color: AppTheme.neonBlue,
      child: GridView.builder(
        padding: const EdgeInsets.all(12),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: MediaQuery.of(context).size.width > 900 ? 3 : 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.15,
        ),
        itemCount: _trucks.length,
        itemBuilder: (ctx, i) => _buildTruckCard(_trucks[i]),
      ),
    );
  }

  Widget _buildTruckCard(TruckSummary truck) {
    return GestureDetector(
      onTap: () {
        Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => LoadPlanner3DPage(
            vehicleCode: truck.vehicleCode,
            vehicleName: truck.description,
            date: _selectedDate,
          ),
        ));
      },
      child: AnimatedBuilder(
        animation: _pulseController,
        builder: (ctx, child) {
          return Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: AppTheme.neonBlue.withValues(alpha: 0.25),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.neonBlue.withValues(alpha: 0.08),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Vehicle header
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.local_shipping_rounded,
                          color: AppTheme.neonBlue, size: 22),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            truck.vehicleCode,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            truck.matricula,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.5),
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // Description
                Text(
                  truck.description.isNotEmpty
                      ? truck.description
                      : 'Sin descripción',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.7),
                    fontSize: 12,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),

                // Driver
                Row(
                  children: [
                    Icon(Icons.person_outline_rounded,
                        color: AppTheme.neonGreen.withValues(alpha: 0.7),
                        size: 14),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        truck.driverName.isNotEmpty
                            ? truck.driverName
                            : truck.driverCode,
                        style: TextStyle(
                          color: AppTheme.neonGreen.withValues(alpha: 0.8),
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),

                const Spacer(),

                // KPIs row
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _kpi(
                      Icons.inventory_2_outlined,
                      '${truck.orderCount}',
                      'Pedidos',
                      AppTheme.neonBlue,
                    ),
                    _kpi(
                      Icons.list_alt_rounded,
                      '${truck.lineCount}',
                      'Líneas',
                      AppTheme.neonPurple,
                    ),
                    _kpi(
                      Icons.fitness_center_outlined,
                      '${truck.maxPayloadKg.toInt()} kg',
                      'Max',
                      AppTheme.neonGreen,
                    ),
                  ],
                ),

                const SizedBox(height: 8),

                // 3D Button
                Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.neonBlue.withValues(alpha: 0.3),
                        AppTheme.neonPurple.withValues(alpha: 0.2),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: AppTheme.neonBlue.withValues(alpha: 0.4)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.view_in_ar_rounded,
                          color: AppTheme.neonBlue, size: 16),
                      SizedBox(width: 6),
                      Text(
                        'TETRIS LOGÍSTICO 3D',
                        style: TextStyle(
                          color: AppTheme.neonBlue,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _kpi(IconData icon, String value, String label, Color color) {
    return Column(
      children: [
        Icon(icon, color: color.withValues(alpha: 0.8), size: 16),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.4),
            fontSize: 9,
          ),
        ),
      ],
    );
  }

  Widget _buildKpiStrip() {
    final totalPedidos = _trucks.fold(0, (s, t) => s + t.orderCount);
    final totalLineas = _trucks.fold(0, (s, t) => s + t.lineCount);
    final totalCamiones = _trucks.length;
    final totalPeso = _trucks.fold(0.0, (s, t) => s + t.maxPayloadKg);

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.neonBlue.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.1))),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
        _kpiItem('$totalPedidos', 'Pedidos', AppTheme.neonBlue),
        _kpiItem('$totalLineas', 'Lineas', AppTheme.neonPurple),
        _kpiItem('$totalCamiones', 'Vehiculos', AppTheme.neonGreen),
        _kpiItem('${totalPeso.toStringAsFixed(0)}', 'kg cap.', Colors.amber),
      ]),
    );
  }

  Widget _kpiItem(String value, String label, Color color) {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Text(value, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800)),
      const SizedBox(height: 2),
      Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.35), fontSize: 9)),
    ]);
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline_rounded,
              color: Colors.redAccent, size: 48),
          const SizedBox(height: 12),
          Text(_error ?? 'Error desconocido',
              style: const TextStyle(color: Colors.white70, fontSize: 14)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _loadDashboard,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonBlue,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.local_shipping_outlined,
              color: Colors.white.withValues(alpha: 0.3), size: 64),
          const SizedBox(height: 12),
          Text(
            'Sin expediciones para esta fecha',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.5), fontSize: 16),
          ),
        ],
      ),
    );
  }
}
