/// LOAD HISTORY PAGE — Historial de planificaciones de carga
/// Desglose por cliente, importes EUR, filtros de fecha en espanol
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/warehouse/data/warehouse_data_service.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/warehouse_ui.dart';

class LoadHistoryPage extends StatefulWidget {
  const LoadHistoryPage({super.key});

  @override
  State<LoadHistoryPage> createState() => _LoadHistoryPageState();
}

class _LoadHistoryPageState extends State<LoadHistoryPage> {
  List<LoadHistoryEntry> _entries = [];
  List<VehicleConfig> _vehicles = [];
  bool _loading = true;
  String? _error;
  String? _selectedVehicle;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  int? _expandedId;

  static const _meses = [
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
  static const _diasSemana = [
    'Lun',
    'Mar',
    'Mie',
    'Jue',
    'Vie',
    'Sab',
    'Dom',
  ];

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  String _formatDateEs(String raw) {
    try {
      final d = DateTime.parse(raw);
      return '${_diasSemana[d.weekday - 1]} ${d.day} '
          '${_meses[d.month - 1]} ${d.year}';
    } catch (_) {
      return raw;
    }
  }

  String _formatTimestamp(String raw) {
    try {
      final d = DateTime.parse(raw);
      return '${d.day}/${d.month}/${d.year} '
          '${d.hour.toString().padLeft(2, '0')}:'
          '${d.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return raw;
    }
  }

  String _dateToStr(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}'
      '-${d.day.toString().padLeft(2, '0')}';

  Future<void> _loadAll({bool forceRefresh = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        WarehouseDataService.getLoadHistory(
          vehicleCode: _selectedVehicle,
          dateFrom: _dateFrom != null ? _dateToStr(_dateFrom!) : null,
          dateTo: _dateTo != null ? _dateToStr(_dateTo!) : null,
          forceRefresh: forceRefresh,
        ),
        WarehouseDataService.getVehicles(forceRefresh: forceRefresh),
      ]);
      if (mounted) {
        setState(() {
          _entries = results[0] as List<LoadHistoryEntry>;
          _vehicles = results[1] as List<VehicleConfig>;
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

  Future<void> _loadHistory({bool forceRefresh = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final entries = await WarehouseDataService.getLoadHistory(
        vehicleCode: _selectedVehicle,
        dateFrom: _dateFrom != null ? _dateToStr(_dateFrom!) : null,
        dateTo: _dateTo != null ? _dateToStr(_dateTo!) : null,
        forceRefresh: forceRefresh,
      );
      if (mounted)
        setState(() {
          _entries = entries;
          _loading = false;
        });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _pickDateRange() async {
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 30)),
      initialDateRange: _dateFrom != null && _dateTo != null
          ? DateTimeRange(start: _dateFrom!, end: _dateTo!)
          : null,
      locale: const Locale('es', 'ES'),
      builder: (context, child) {
        return Theme(
          data: ThemeData.dark().copyWith(
            colorScheme: const ColorScheme.dark(
              primary: AppTheme.info,
              onPrimary: AppTheme.textPrimary,
              surface: AppTheme.raisedSurface,
            ),
          ),
          child: child!,
        );
      },
    );
    if (range != null) {
      setState(() {
        _dateFrom = range.start;
        _dateTo = range.end;
      });
      _loadHistory();
    }
  }

  Color _statusColor(String s) {
    if (s == 'EXCESO') return AppTheme.error;
    if (s == 'OPTIMO') return AppTheme.warning;
    return AppTheme.success;
  }

  @override
  Widget build(BuildContext context) {
    return WarehouseUi.pageShell(
      child: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            _buildDateFilter(),
            _buildVehicleFilter(),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.info),
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 40),
            const SizedBox(height: 8),
            Text(
              _error!,
              style:
                  const TextStyle(color: AppTheme.textTertiary, fontSize: 13),
            ),
          ],
        ),
      );
    }
    if (_entries.isEmpty) {
      return const Center(
        child: Text(
          'Sin historial de cargas',
          style: TextStyle(color: AppTheme.textTertiary, fontSize: 13),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _loadHistory(forceRefresh: true),
      color: AppTheme.info,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: _entries.length,
        itemBuilder: (_, i) => _entryCard(_entries[i]),
      ),
    );
  }

  Widget _buildHeader() {
    double totalImporte = 0;
    for (final e in _entries) {
      totalImporte += e.importeTotal;
    }

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      padding: EdgeInsets.fromLTRB(
        Responsive.padding(context, small: 12, large: 16),
        12,
        Responsive.padding(context, small: 12, large: 16),
        4,
      ),
      decoration: WarehouseUi.headerSurface(accent: AppTheme.info),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(
              Responsive.padding(context, small: 6, large: 8),
            ),
            decoration: WarehouseUi.surface(
              color: AppTheme.info.withValues(alpha: 0.1),
              borderColor: AppTheme.info,
              borderAlpha: 0.22,
            ),
            child: Icon(
              Icons.history_rounded,
              color: AppTheme.info,
              size: Responsive.iconSize(context, phone: 18, desktop: 22),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'HISTORIAL DE CARGAS',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: Responsive.fontSize(
                      context,
                      small: 13,
                      large: 16,
                    ),
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0,
                  ),
                ),
                Text(
                  '${_entries.length} cargas registradas',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          if (totalImporte > 0)
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 8,
                vertical: 4,
              ),
              decoration: WarehouseUi.surface(
                color: AppTheme.success.withValues(alpha: 0.12),
                borderColor: AppTheme.success,
                borderAlpha: 0.22,
                radius: AppTheme.radiusSm,
              ),
              child: Text(
                '${totalImporte.toStringAsFixed(0)} EUR',
                style: const TextStyle(
                  color: AppTheme.success,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDateFilter() {
    final hasFilter = _dateFrom != null || _dateTo != null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 2),
      child: InkWell(
        onTap: _pickDateRange,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 8,
          ),
          decoration: WarehouseUi.executiveSurface(
            accent: hasFilter ? AppTheme.info : AppTheme.textTertiary,
            borderAlpha: hasFilter ? 0.34 : 0.16,
            accentAlpha: hasFilter ? 0.08 : 0.03,
            elevated: false,
          ),
          child: Row(
            children: [
              Icon(
                Icons.calendar_today_rounded,
                size: 14,
                color: hasFilter ? AppTheme.info : AppTheme.textTertiary,
              ),
              const SizedBox(width: 8),
              Text(
                hasFilter ? _buildDateLabel() : 'Filtrar por fecha...',
                style: TextStyle(
                  color: hasFilter ? AppTheme.info : AppTheme.textTertiary,
                  fontSize: 11,
                ),
              ),
              const Spacer(),
              if (hasFilter)
                InkWell(
                  onTap: () {
                    setState(() {
                      _dateFrom = null;
                      _dateTo = null;
                    });
                    _loadHistory();
                  },
                  child: const Icon(
                    Icons.close_rounded,
                    size: 16,
                    color: AppTheme.textTertiary,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _buildDateLabel() {
    final from = _dateFrom != null
        ? '${_dateFrom!.day}/${_dateFrom!.month}/${_dateFrom!.year}'
        : '...';
    final to = _dateTo != null
        ? '${_dateTo!.day}/${_dateTo!.month}/${_dateTo!.year}'
        : '...';
    return '$from — $to';
  }

  Widget _buildVehicleFilter() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _filterChip('Todos', null),
          ..._vehicles.map((v) => _filterChip(v.code, v.code)),
        ],
      ),
    );
  }

  Widget _filterChip(String label, String? code) {
    final sel = _selectedVehicle == code;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: FilterChip(
        selected: sel,
        label: Text(
          label,
          style: TextStyle(
            fontSize: 10,
            color: sel ? AppTheme.info : AppTheme.textTertiary,
          ),
        ),
        onSelected: (_) {
          setState(() => _selectedVehicle = code);
          _loadHistory();
        },
        selectedColor: AppTheme.info.withValues(alpha: 0.15),
        backgroundColor: AppTheme.raisedSurface,
        checkmarkColor: AppTheme.info,
        side: BorderSide(
          color:
              sel ? AppTheme.info.withValues(alpha: 0.3) : AppTheme.borderColor,
        ),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),
    );
  }

  Widget _entryCard(LoadHistoryEntry e) {
    final sc = _statusColor(e.status);
    final volPct = e.volumePct.clamp(0.0, 100.0);
    final isExpanded = _expandedId == e.id;

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: WarehouseUi.executiveSurface(
        accent: sc,
        borderAlpha: isExpanded ? 0.34 : 0.18,
        accentAlpha: isExpanded ? 0.09 : 0.05,
      ),
      child: Column(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () => setState(
              () => _expandedId = isExpanded ? null : e.id,
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildCardHeader(e, sc),
                  const SizedBox(height: 6),
                  _buildCardDate(e),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(3),
                    child: LinearProgressIndicator(
                      value: volPct / 100,
                      backgroundColor:
                          AppTheme.textPrimary.withValues(alpha: 0.05),
                      valueColor: AlwaysStoppedAnimation(sc),
                      minHeight: 6,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _buildMetricsRow(e, sc, volPct),
                  if (e.detalles != null)
                    Center(
                      child: Icon(
                        isExpanded
                            ? Icons.keyboard_arrow_up_rounded
                            : Icons.keyboard_arrow_down_rounded,
                        size: 18,
                        color: AppTheme.textTertiary,
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (isExpanded && e.detalles != null)
            _buildDetailBreakdown(e.detalles!),
        ],
      ),
    );
  }

  Widget _buildCardHeader(LoadHistoryEntry e, Color sc) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 8,
            vertical: 3,
          ),
          decoration: BoxDecoration(
            color: AppTheme.info.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            e.vehicleCode,
            style: const TextStyle(
              color: AppTheme.info,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        if (e.vehicleDesc.isNotEmpty) ...[
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              e.vehicleDesc,
              style: TextStyle(
                color: AppTheme.textPrimary.withValues(alpha: 0.3),
                fontSize: 9,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
        const Spacer(),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 8,
            vertical: 3,
          ),
          decoration: BoxDecoration(
            color: sc.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            e.status,
            style: TextStyle(
              color: sc,
              fontSize: 10,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCardDate(LoadHistoryEntry e) {
    return Row(
      children: [
        Icon(
          Icons.calendar_today_rounded,
          size: 12,
          color: AppTheme.textPrimary.withValues(alpha: 0.3),
        ),
        const SizedBox(width: 4),
        Text(
          _formatDateEs(e.date),
          style: TextStyle(
            color: AppTheme.textPrimary.withValues(alpha: 0.6),
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (e.matricula.isNotEmpty) ...[
          const SizedBox(width: 8),
          Text(
            e.matricula,
            style: TextStyle(
              color: AppTheme.textPrimary.withValues(alpha: 0.25),
              fontSize: 9,
            ),
          ),
        ],
        const Spacer(),
        Text(
          _formatTimestamp(e.createdAt),
          style: TextStyle(
            color: AppTheme.textPrimary.withValues(alpha: 0.2),
            fontSize: 9,
          ),
        ),
      ],
    );
  }

  Widget _buildMetricsRow(
    LoadHistoryEntry e,
    Color sc,
    double volPct,
  ) {
    return Row(
      children: [
        _metric('Volumen', '${volPct.toStringAsFixed(0)}%', sc),
        _metric(
          'Peso',
          '${e.weightKg.toStringAsFixed(0)} kg',
          AppTheme.warning,
        ),
        _metric('Pedidos', '${e.orderCount}', AppTheme.info),
        _metric('Bultos', '${e.boxCount}', AppTheme.success),
        if (e.importeTotal > 0)
          _metric(
            'Importe',
            '${e.importeTotal.toStringAsFixed(0)} EUR',
            AppTheme.success,
          ),
      ],
    );
  }

  Widget _buildDetailBreakdown(Map<String, dynamic> detalles) {
    final clients = (detalles['clients'] as List?) ?? [];
    if (clients.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.info_outline_rounded,
              color: AppTheme.textPrimary.withValues(alpha: 0.15),
              size: 28,
            ),
            const SizedBox(height: 6),
            const Text(
              'Sin desglose disponible',
              style: TextStyle(color: AppTheme.textTertiary, fontSize: 11),
            ),
            Text(
              'Las cargas antiguas no incluyen detalle',
              style: TextStyle(
                color: AppTheme.textPrimary.withValues(alpha: 0.15),
                fontSize: 9,
              ),
            ),
          ],
        ),
      );
    }

    // Calculate totals for summary
    var totalBoxes = 0;
    double totalWeight = 0;
    double totalEur = 0;
    for (final c in clients) {
      final cm = c as Map<String, dynamic>;
      totalBoxes += ((cm['boxes'] ?? 0) as num).toInt();
      totalWeight += ((cm['weightKg'] ?? 0) as num).toDouble();
      totalEur += ((cm['importeEur'] ?? 0) as num).toDouble();
    }

    return Container(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(
            color: AppTheme.info.withValues(alpha: 0.1),
          ),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Summary header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: AppTheme.info.withValues(alpha: 0.1),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.receipt_long_rounded,
                  size: 12,
                  color: AppTheme.info.withValues(alpha: 0.5),
                ),
                const SizedBox(width: 6),
                Text(
                  'DESGLOSE',
                  style: TextStyle(
                    color: AppTheme.info.withValues(alpha: 0.7),
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0,
                  ),
                ),
                const Spacer(),
                Text(
                  '${clients.length} clientes',
                  style: TextStyle(
                    color: AppTheme.textPrimary.withValues(alpha: 0.35),
                    fontSize: 9,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '$totalBoxes bultos',
                  style: TextStyle(
                    color: AppTheme.textPrimary.withValues(alpha: 0.35),
                    fontSize: 9,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${totalWeight.toStringAsFixed(0)} kg',
                  style: TextStyle(
                    color: AppTheme.warning.withValues(alpha: 0.5),
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (totalEur > 0) ...[
                  const SizedBox(width: 8),
                  Text(
                    '${totalEur.toStringAsFixed(0)} EUR',
                    style: TextStyle(
                      color: AppTheme.success.withValues(alpha: 0.7),
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
          // Client rows
          ...clients.asMap().entries.map<Widget>((entry) {
            final c = entry.value as Map<String, dynamic>;
            final isLast = entry.key == clients.length - 1;
            return Column(
              children: [
                _buildClientRow(c),
                if (!isLast)
                  Divider(
                    color: AppTheme.textPrimary.withValues(alpha: 0.03),
                    height: 2,
                  ),
              ],
            );
          }),
          if (((detalles['overflowCount'] ?? 0) as num) > 0)
            Container(
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.symmetric(
                horizontal: 8,
                vertical: 4,
              ),
              decoration: BoxDecoration(
                color: AppTheme.error.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: AppTheme.error.withValues(alpha: 0.15),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    color: AppTheme.error,
                    size: 12,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${detalles['overflowCount']} bultos no cargados',
                    style: const TextStyle(
                      color: AppTheme.error,
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildClientRow(Map<String, dynamic> client) {
    final articles = (client['articles'] as List?) ?? [];
    final impEur = (client['importeEur'] ?? 0) as num;
    final mrgEur = (client['margenEur'] ?? 0) as num;
    final wKg = (client['weightKg'] ?? 0) as num;
    final boxes = (client['boxes'] ?? 0) as num;

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.textPrimary.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 4,
                height: 20,
                decoration: BoxDecoration(
                  color: AppTheme.info.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${client['clientCode'] ?? ''} — '
                  '${client['clientName'] ?? ''}',
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (impEur > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    '${impEur.toStringAsFixed(2)} EUR',
                    style: const TextStyle(
                      color: AppTheme.success,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 12),
            child: Row(
              children: [
                _detailChip(
                  Icons.all_inbox_rounded,
                  '${boxes.toInt()} bultos',
                  AppTheme.info,
                ),
                const SizedBox(width: 8),
                _detailChip(
                  Icons.scale_rounded,
                  '${wKg.toStringAsFixed(1)} kg',
                  AppTheme.warning,
                ),
                if (mrgEur > 0) ...[
                  const SizedBox(width: 8),
                  _detailChip(
                    Icons.trending_up_rounded,
                    '${mrgEur.toStringAsFixed(2)} margen',
                    AppTheme.success,
                  ),
                ],
              ],
            ),
          ),
          if (articles.isNotEmpty) ...[
            const SizedBox(height: 4),
            ...articles.map<Widget>(
              (art) => _buildArticleRow(art as Map<String, dynamic>),
            ),
          ],
        ],
      ),
    );
  }

  Widget _detailChip(IconData icon, String text, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 10, color: color.withValues(alpha: 0.5)),
        const SizedBox(width: 3),
        Text(
          text,
          style: TextStyle(
            color: color.withValues(alpha: 0.6),
            fontSize: 9,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildArticleRow(Map<String, dynamic> a) {
    final impEur = (a['importeEur'] ?? 0) as num;
    final wKg = (a['weightKg'] ?? a['weight'] ?? 0) as num;
    final largo = (a['largoCm'] ?? a['w'] ?? 0) as num;
    final ancho = (a['anchoCm'] ?? a['d'] ?? 0) as num;
    final alto = (a['altoCm'] ?? a['h'] ?? 0) as num;
    final hasDims = largo > 0 && ancho > 0 && alto > 0;

    return Container(
      margin: const EdgeInsets.only(left: 8, top: 2),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.textPrimary.withValues(alpha: 0.02),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 3,
                height: 3,
                decoration: BoxDecoration(
                  color: AppTheme.textPrimary.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${a['code'] ?? ''} ${a['name'] ?? ''}',
                  style: TextStyle(
                    color: AppTheme.textPrimary.withValues(alpha: 0.5),
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                'x${a['boxes'] ?? 0}',
                style: TextStyle(
                  color: AppTheme.info.withValues(alpha: 0.7),
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (impEur > 0) ...[
                const SizedBox(width: 6),
                Text(
                  '${impEur.toStringAsFixed(2)} EUR',
                  style: TextStyle(
                    color: AppTheme.success.withValues(alpha: 0.7),
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ],
          ),
          // Detail row: dimensions + weight
          Padding(
            padding: const EdgeInsets.only(left: 9, top: 2),
            child: Row(
              children: [
                if (hasDims) ...[
                  Icon(
                    Icons.straighten_rounded,
                    size: 8,
                    color: AppTheme.textPrimary.withValues(alpha: 0.2),
                  ),
                  const SizedBox(width: 3),
                  Text(
                    '${largo.toInt()}x${ancho.toInt()}x${alto.toInt()} cm',
                    style: TextStyle(
                      color: AppTheme.textPrimary.withValues(alpha: 0.25),
                      fontSize: 8,
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                if (wKg > 0) ...[
                  Icon(
                    Icons.scale_rounded,
                    size: 8,
                    color: AppTheme.textPrimary.withValues(alpha: 0.2),
                  ),
                  const SizedBox(width: 3),
                  Text(
                    '${wKg.toStringAsFixed(1)} kg',
                    style: TextStyle(
                      color: AppTheme.textPrimary.withValues(alpha: 0.25),
                      fontSize: 8,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value, Color color) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: AppTheme.textPrimary.withValues(alpha: 0.25),
              fontSize: 8,
            ),
          ),
        ],
      ),
    );
  }
}
