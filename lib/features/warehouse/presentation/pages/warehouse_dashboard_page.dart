/// WAREHOUSE DASHBOARD PAGE
/// Vista principal del Jefe de Almacén / Expediciones
/// Muestra los camiones del día con KPIs de carga
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/config/feature_flags.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/error_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/offline_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/features/warehouse/data/warehouse_data_service.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/load_planner_3d_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/load_planner_v2_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/warehouse_ui.dart';

class WarehouseDashboardPage extends StatefulWidget {
  const WarehouseDashboardPage({super.key});

  @override
  State<WarehouseDashboardPage> createState() => _WarehouseDashboardPageState();
}

class _WarehouseDashboardPageState extends State<WarehouseDashboardPage> {
  List<TruckSummary> _trucks = [];
  bool _loading = true;
  String? _error;
  late DateTime _selectedDate;

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _loadDashboard();
  }

  Future<void> _loadDashboard({bool forceRefresh = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final trucks = await WarehouseDataService.getDashboard(
        year: _selectedDate.year,
        month: _selectedDate.month,
        day: _selectedDate.day,
        forceRefresh: forceRefresh,
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
      backgroundColor: AppTheme.inkSurface,
      body: WarehouseUi.pageShell(
        child: Column(
          children: [
            _buildHeader(),
            _buildDateSelector(),
            const OfflineBanner(),
            if (!_loading && _error == null && _trucks.isNotEmpty)
              _buildKpiStrip(),
            Expanded(
              child: _loading
                  ? const SkeletonList(itemCount: 4)
                  : _error != null
                      ? ErrorStateWidget(
                          message: _error!,
                          onRetry: () => _loadDashboard(forceRefresh: true),
                        )
                      : _trucks.isEmpty
                          ? _buildEmpty()
                          : _buildTruckGrid(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      padding: EdgeInsets.fromLTRB(
        Responsive.padding(context, small: 14, large: 20),
        14,
        Responsive.padding(context, small: 14, large: 20),
        10,
      ),
      decoration: WarehouseUi.headerSurface(accent: AppTheme.info),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: WarehouseUi.surface(
              color: AppTheme.info.withValues(alpha: 0.12),
              borderColor: AppTheme.info,
              borderAlpha: 0.28,
            ),
            child: Icon(
              Icons.warehouse_rounded,
              color: AppTheme.info,
              size: Responsive.iconSize(context, phone: 22, desktop: 28),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CENTRO DE EXPEDICIONES',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize:
                        Responsive.fontSize(context, small: 14, large: 18),
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0,
                  ),
                ),
                Text(
                  '${_trucks.length} camiones · ${_trucks.fold<int>(0, (s, t) => s + t.orderCount)} pedidos',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Actualizar datos',
            onPressed: () => _loadDashboard(forceRefresh: true),
            icon: const Icon(
              Icons.refresh_rounded,
              color: AppTheme.success,
              size: 24,
            ),
            style: WarehouseUi.iconButtonStyle(AppTheme.success),
          ),
        ],
      ),
    );
  }

  Widget _buildDateSelector() {
    final months = [
      '',
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    final days = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    final dayName = days[_selectedDate.weekday];
    final isToday = _selectedDate.day == DateTime.now().day &&
        _selectedDate.month == DateTime.now().month &&
        _selectedDate.year == DateTime.now().year;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: WarehouseUi.executiveSurface(
        accent: isToday ? AppTheme.success : AppTheme.info,
        borderAlpha: isToday ? 0.28 : 0.18,
        accentAlpha: 0.06,
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Día anterior',
            onPressed: () => _changeDate(-1),
            icon: Icon(
              Icons.chevron_left_rounded,
              color: AppTheme.textSecondary,
              size: 28,
            ),
            constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          ),
          Expanded(
            child: Center(
              child: GestureDetector(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _selectedDate,
                    firstDate: DateTime(2020),
                    lastDate: DateTime(2030),
                    builder: (ctx, child) => Theme(
                      data: ThemeData.dark().copyWith(
                        colorScheme: ColorScheme.dark(
                          primary: AppTheme.info,
                          surface: AppTheme.raisedSurface,
                        ),
                      ),
                      child: child!,
                    ),
                  );
                  if (picked != null) {
                    setState(() => _selectedDate = picked);
                    _loadDashboard();
                  }
                },
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.calendar_today_rounded,
                        color: AppTheme.info,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '$dayName ${_selectedDate.day} ${months[_selectedDate.month]} ${_selectedDate.year}',
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (isToday) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.success.withValues(alpha: 0.14),
                            borderRadius:
                                BorderRadius.circular(AppTheme.radiusSm),
                          ),
                          child: const Text(
                            'HOY',
                            style: TextStyle(
                              color: AppTheme.success,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: 'Día siguiente',
            onPressed: () => _changeDate(1),
            icon: Icon(
              Icons.chevron_right_rounded,
              color: AppTheme.textSecondary,
              size: 28,
            ),
            constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          ),
        ],
      ),
    );
  }

  Widget _buildTruckGrid() {
    return RefreshIndicator(
      onRefresh: () => _loadDashboard(forceRefresh: true),
      color: AppTheme.info,
      child: GridView.builder(
        padding: const EdgeInsets.all(12),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 390,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.08,
        ),
        itemCount: _trucks.length,
        itemBuilder: (ctx, i) => _buildTruckCard(_trucks[i]),
      ),
    );
  }

  Widget _buildTruckCard(TruckSummary truck) {
    void openPlanner() {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => FeatureFlags.newLoadPlanner
              ? LoadPlannerV2Page(
                  vehicleCode: truck.vehicleCode,
                  vehicleName: truck.description,
                  date: _selectedDate,
                )
              : LoadPlanner3DPage(
                  vehicleCode: truck.vehicleCode,
                  vehicleName: truck.description,
                  date: _selectedDate,
                ),
        ),
      );
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: openPlanner,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        child: Ink(
          padding: EdgeInsets.all(
            Responsive.padding(context, small: 10, large: 14),
          ),
          decoration: WarehouseUi.executiveSurface(
            accent: AppTheme.info,
            borderAlpha: 0.22,
            accentAlpha: 0.08,
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
                      color: AppTheme.info.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      border: Border.all(
                        color: AppTheme.info.withValues(alpha: 0.24),
                      ),
                    ),
                    child: const Icon(
                      Icons.local_shipping_rounded,
                      color: AppTheme.info,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          truck.vehicleCode,
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          truck.matricula,
                          style: TextStyle(
                            color: AppTheme.textTertiary,
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
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 6),

              // Driver
              Row(
                children: [
                  const Icon(
                    Icons.person_outline_rounded,
                    color: AppTheme.success,
                    size: 14,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      truck.driverName.isNotEmpty
                          ? truck.driverName
                          : truck.driverCode,
                      style: const TextStyle(
                        color: AppTheme.success,
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
                    AppTheme.info,
                  ),
                  _kpi(
                    Icons.list_alt_rounded,
                    '${truck.lineCount}',
                    'Líneas',
                    AppTheme.accentIndigo,
                  ),
                  _kpi(
                    Icons.fitness_center_outlined,
                    '${truck.maxPayloadKg.toInt()} kg',
                    'Max',
                    AppTheme.success,
                  ),
                ],
              ),

              const SizedBox(height: 8),

              // 3D Button
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 8),
                decoration: BoxDecoration(
                  color: AppTheme.info.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  border: Border.all(
                    color: AppTheme.info.withValues(alpha: 0.28),
                  ),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.view_in_ar_rounded,
                      color: AppTheme.info,
                      size: 16,
                    ),
                    SizedBox(width: 6),
                    Text(
                      'Abrir planificación de carga',
                      style: TextStyle(
                        color: AppTheme.info,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
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
          style: TextStyle(color: AppTheme.textTertiary, fontSize: 9),
        ),
      ],
    );
  }

  Widget _buildKpiStrip() {
    final totalPedidos = _trucks.fold(0, (s, t) => s + t.orderCount);
    final totalLineas = _trucks.fold(0, (s, t) => s + t.lineCount);
    final totalCamiones = _trucks.length;
    final totalPeso = _trucks.fold<double>(0.0, (s, t) => s + t.maxPayloadKg);

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: WarehouseUi.executiveSurface(
        accent: AppTheme.success,
        borderAlpha: 0.18,
        accentAlpha: 0.05,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _kpiItem('$totalPedidos', 'Pedidos', AppTheme.info),
          _kpiItem('$totalLineas', 'Lineas', AppTheme.accentIndigo),
          _kpiItem('$totalCamiones', 'Vehiculos', AppTheme.success),
          _kpiItem(totalPeso.toStringAsFixed(0), 'kg cap.', AppTheme.warning),
        ],
      ),
    );
  }

  Widget _kpiItem(String value, String label, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: Responsive.fontSize(context, small: 14, large: 18),
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(color: AppTheme.textTertiary, fontSize: 9),
        ),
      ],
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: AppTheme.error,
            size: 48,
          ),
          const SizedBox(height: 12),
          Text(
            _error ?? 'Error desconocido',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: () => _loadDashboard(forceRefresh: true),
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.info.withValues(alpha: 0.14),
              foregroundColor: AppTheme.info,
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
          Icon(
            Icons.local_shipping_outlined,
            color: AppTheme.textTertiary,
            size: 64,
          ),
          SizedBox(height: 12),
          Text(
            'Sin expediciones para esta fecha',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }
}
