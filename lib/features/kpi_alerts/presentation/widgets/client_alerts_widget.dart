// client_alerts_widget.dart: Widget premium para alertas KPI Glacius
// Diseño futurista con colores neon, agrupación por tipo, y visibilidad por rol

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_provider.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/data/kpi_alerts_service.dart';

/// Widget que muestra las alertas KPI Glacius de un cliente.
/// Se adapta al rol del usuario: JEFE_VENTAS ve datos financieros (márgenes, €),
/// COMERCIAL ve alertas de acción sin datos sensibles.
class ClientAlertsWidget extends StatefulWidget {
  const ClientAlertsWidget({
    super.key,
    required this.clientId,
    this.compact = false,
  });

  final String clientId;
  final bool compact;

  @override
  State<ClientAlertsWidget> createState() => _ClientAlertsWidgetState();
}

class _ClientAlertsWidgetState extends State<ClientAlertsWidget> {
  final _service = KpiAlertsService.instance;
  List<KpiAlert> _alerts = [];
  bool _loading = true;
  bool _expanded = true;

  @override
  void initState() {
    super.initState();
    _loadAlerts();
  }

  @override
  void didUpdateWidget(ClientAlertsWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clientId != widget.clientId) {
      _loadAlerts();
    }
  }

  Future<void> _loadAlerts() async {
    if (!mounted) return;
    setState(() => _loading = true);

    try {
      final alerts = await _service.getClientAlerts(widget.clientId);
      if (mounted) {
        setState(() {
          _alerts = alerts;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _isJefe {
    try {
      final auth = context.read<AuthProvider>();
      return auth.currentUser?.isDirector ?? false;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return widget.compact
          ? const SizedBox.shrink()
          : const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: _KpiLoadingShimmer(),
            );
    }

    if (_alerts.isEmpty) return const SizedBox.shrink();

    return widget.compact ? _buildCompactView() : _buildFullView();
  }

  // ============================================================
  // COMPACT VIEW — badges en la lista del rutero/agenda
  // ============================================================
  Widget _buildCompactView() {
    final criticalCount = _alerts.where((a) => a.severity == 'critical').length;
    final warningCount = _alerts.where((a) => a.severity == 'warning').length;
    final infoCount = _alerts.where((a) => a.severity == 'info').length;

    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // "KPI" label
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonPurple.withValues(alpha: 0.25),
                  AppTheme.neonBlue.withValues(alpha: 0.15),
                ],
              ),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(
                color: AppTheme.neonPurple.withValues(alpha: 0.4),
                width: 0.5,
              ),
            ),
            child: const Text(
              'KPI',
              style: TextStyle(
                fontSize: 8,
                fontWeight: FontWeight.w800,
                color: AppTheme.neonPurple,
                letterSpacing: 0.8,
              ),
            ),
          ),
          const SizedBox(width: 4),
          if (criticalCount > 0) _buildCompactBadge(criticalCount, _severityColor('critical'), Icons.error_rounded),
          if (warningCount > 0) _buildCompactBadge(warningCount, _severityColor('warning'), Icons.warning_amber_rounded),
          if (infoCount > 0) _buildCompactBadge(infoCount, _severityColor('info'), Icons.info_rounded),
        ],
      ),
    );
  }

  Widget _buildCompactBadge(int count, Color color, IconData icon) {
    return Container(
      margin: const EdgeInsets.only(right: 3),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 0.5),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.15),
            blurRadius: 4,
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: color),
          const SizedBox(width: 2),
          Text(
            '$count',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  // ============================================================
  // FULL VIEW — panel completo en la ficha del cliente
  // ============================================================
  Widget _buildFullView() {
    final isJefe = _isJefe;

    // Agrupar por tipo
    final grouped = <String, List<KpiAlert>>{};
    for (final alert in _alerts) {
      grouped.putIfAbsent(alert.type, () => []).add(alert);
    }

    // Orden de tipos
    const typeOrder = [
      'DESVIACION_VENTAS',
      'CUOTA_SIN_COMPRA',
      'DESVIACION_REFERENCIACION',
      'ALTA_CLIENTE',
      'PROMOCION',
      'AVISO',
      'MEDIOS_CLIENTE',
    ];
    final sortedTypes = typeOrder.where(grouped.containsKey).toList();
    // Add any types not in the predefined order
    for (final t in grouped.keys) {
      if (!sortedTypes.contains(t)) sortedTypes.add(t);
    }

    final criticalCount = _alerts.where((a) => a.severity == 'critical').length;
    final warningCount = _alerts.where((a) => a.severity == 'warning').length;
    final infoCount = _alerts.where((a) => a.severity == 'info').length;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkSurface,
            AppTheme.neonPurple.withValues(alpha: 0.06),
            AppTheme.darkSurface,
          ],
          stops: const [0.0, 0.5, 1.0],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppTheme.neonPurple.withValues(alpha: 0.3),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonPurple.withValues(alpha: 0.1),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonPurple.withValues(alpha: 0.15),
                    AppTheme.neonBlue.withValues(alpha: 0.08),
                  ],
                ),
                borderRadius: _expanded
                    ? const BorderRadius.vertical(top: Radius.circular(15))
                    : BorderRadius.circular(15),
              ),
              child: Row(
                children: [
                  // KPI icon with glow
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          AppTheme.neonPurple.withValues(alpha: 0.3),
                          AppTheme.neonBlue.withValues(alpha: 0.2),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.neonPurple.withValues(alpha: 0.3),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: const Icon(
                      Icons.insights_rounded,
                      size: 16,
                      color: AppTheme.neonPurple,
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Title
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'KPIs Glacius',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                            letterSpacing: 0.3,
                          ),
                        ),
                        Text(
                          '${_alerts.length} alerta${_alerts.length != 1 ? 's' : ''} activa${_alerts.length != 1 ? 's' : ''}',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppTheme.textSecondary.withValues(alpha: 0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Severity counters
                  if (criticalCount > 0) _buildSeverityChip(criticalCount, _severityColor('critical'), 'CRIT'),
                  if (warningCount > 0) _buildSeverityChip(warningCount, _severityColor('warning'), 'WARN'),
                  if (infoCount > 0) _buildSeverityChip(infoCount, _severityColor('info'), 'INFO'),
                  const SizedBox(width: 8),
                  // Refresh + expand
                  InkWell(
                    onTap: _loadAlerts,
                    child: const Icon(Icons.refresh_rounded, size: 16, color: AppTheme.textTertiary),
                  ),
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: _expanded ? 0.0 : -0.25,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(Icons.expand_more_rounded, size: 18, color: AppTheme.textTertiary),
                  ),
                ],
              ),
            ),
          ),

          // Alert groups
          if (_expanded)
            AnimatedSize(
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeInOut,
              child: Padding(
                padding: const EdgeInsets.only(left: 8, right: 8, bottom: 10, top: 4),
                child: Column(
                  children: sortedTypes.map((type) {
                    return _buildAlertGroup(type, grouped[type]!, isJefe);
                  }).toList(),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSeverityChip(int count, Color color, String label) {
    return Container(
      margin: const EdgeInsets.only(left: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.4), width: 0.5),
      ),
      child: Text(
        '$count',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
    );
  }

  // ============================================================
  // GRUPO de alertas por tipo (Desviación Ventas, Cuota, etc.)
  // ============================================================
  Widget _buildAlertGroup(String type, List<KpiAlert> alerts, bool isJefe) {
    final config = _typeConfig(type);
    final highestSeverity = alerts.fold<String>('info', (prev, a) {
      if (a.severity == 'critical') return 'critical';
      if (a.severity == 'warning' && prev != 'critical') return 'warning';
      return prev;
    });
    final accentColor = _severityColor(highestSeverity);

    return Container(
      margin: const EdgeInsets.only(top: 6),
      decoration: BoxDecoration(
        color: AppTheme.darkBase.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: config.color.withValues(alpha: 0.2),
          width: 0.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Group header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  config.color.withValues(alpha: 0.12),
                  Colors.transparent,
                ],
              ),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(10)),
            ),
            child: Row(
              children: [
                Icon(config.icon, size: 14, color: config.color),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    config.label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: config.color,
                      letterSpacing: 0.2,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: accentColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    '${alerts.length}',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: accentColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Individual alerts
          ...alerts.map((alert) => _buildAlertTile(alert, config, isJefe)),
        ],
      ),
    );
  }

  Widget _buildAlertTile(KpiAlert alert, _AlertTypeConfig config, bool isJefe) {
    final sevColor = _severityColor(alert.severity);
    final lines = alert.message.split('\n');
    final mainMessage = lines.first;
    final details = lines.length > 1 ? lines.sublist(1) : <String>[];

    // Role-based: hide financial details for non-jefes
    final showFinancials = isJefe &&
        (alert.type == 'DESVIACION_VENTAS' || alert.type == 'ALTA_CLIENTE');

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: sevColor, width: 2.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Severity dot
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: sevColor,
                  boxShadow: [
                    BoxShadow(color: sevColor.withValues(alpha: 0.5), blurRadius: 4),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              // Message
              Expanded(
                child: Text(
                  mainMessage,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
              // Severity label
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: sevColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(3),
                ),
                child: Text(
                  _severityLabel(alert.severity),
                  style: TextStyle(
                    fontSize: 8,
                    fontWeight: FontWeight.w700,
                    color: sevColor,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ],
          ),
          // Detail lines (e.g., references sin compra)
          if (details.isNotEmpty) ...[
            const SizedBox(height: 3),
            ...details.map(
              (d) => Padding(
                padding: const EdgeInsets.only(left: 12, top: 1),
                child: Text(
                  d,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
            ),
          ],
          // Financial details for JEFE_VENTAS
          if (showFinancials && alert.rawData != null) ...[
            const SizedBox(height: 4),
            _buildFinancialRow(alert),
          ],
        ],
      ),
    );
  }

  Widget _buildFinancialRow(KpiAlert alert) {
    final raw = alert.rawData!;
    final items = <Widget>[];

    if (raw.containsKey('cuotaAnual') && raw['cuotaAnual'] != null) {
      items.add(_buildFinancialPill('Cuota', '${_formatNum(raw['cuotaAnual'])}€', AppTheme.neonBlue));
    }
    if (raw.containsKey('desviacionEur') && raw['desviacionEur'] != null) {
      final val = (raw['desviacionEur'] as num).toDouble();
      items.add(_buildFinancialPill(
        'Desv.',
        '${val >= 0 ? '+' : ''}${_formatNum(val)}€',
        val < 0 ? AppTheme.error : AppTheme.success,
      ));
    }
    if (raw.containsKey('desviacionPct') && raw['desviacionPct'] != null) {
      final val = (raw['desviacionPct'] as num).toDouble();
      items.add(_buildFinancialPill(
        '%',
        '${val >= 0 ? '+' : ''}${val.toStringAsFixed(0)}%',
        val < 0 ? AppTheme.error : AppTheme.success,
      ));
    }

    if (items.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(left: 12),
      child: Wrap(
        spacing: 4,
        runSpacing: 2,
        children: items,
      ),
    );
  }

  Widget _buildFinancialPill(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withValues(alpha: 0.2), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '$label ',
            style: TextStyle(fontSize: 9, color: AppTheme.textTertiary),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  String _formatNum(dynamic val) {
    if (val == null) return '0';
    final n = (val as num).toDouble();
    if (n.abs() >= 1000) {
      return '${(n / 1000).toStringAsFixed(1)}k';
    }
    return n.toStringAsFixed(n.truncateToDouble() == n ? 0 : 2);
  }

  // ============================================================
  // CONFIGURATION — colores, iconos, labels por tipo de alerta
  // ============================================================
  Color _severityColor(String severity) {
    switch (severity) {
      case 'critical':
        return AppTheme.error;    // Neon red
      case 'warning':
        return AppTheme.warning;  // Neon orange
      case 'info':
        return AppTheme.info;     // Neon cyan
      default:
        return AppTheme.textTertiary;
    }
  }

  String _severityLabel(String severity) {
    switch (severity) {
      case 'critical': return 'CRIT';
      case 'warning': return 'WARN';
      case 'info': return 'INFO';
      default: return severity.toUpperCase();
    }
  }

  _AlertTypeConfig _typeConfig(String type) {
    switch (type) {
      case 'DESVIACION_VENTAS':
        return _AlertTypeConfig(
          label: 'Desviación Ventas',
          icon: Icons.trending_down_rounded,
          color: AppTheme.error,
        );
      case 'CUOTA_SIN_COMPRA':
        return _AlertTypeConfig(
          label: 'Cuota Sin Compra',
          icon: Icons.remove_shopping_cart_rounded,
          color: AppTheme.warning,
        );
      case 'DESVIACION_REFERENCIACION':
        return _AlertTypeConfig(
          label: 'Desviación Referenciación',
          icon: Icons.inventory_2_rounded,
          color: const Color(0xFFFF6B9D), // neonPink
        );
      case 'PROMOCION':
        return _AlertTypeConfig(
          label: 'Promociones',
          icon: Icons.local_offer_rounded,
          color: AppTheme.neonGreen,
        );
      case 'ALTA_CLIENTE':
        return _AlertTypeConfig(
          label: 'Captación / Alta Cliente',
          icon: Icons.person_add_rounded,
          color: AppTheme.neonBlue,
        );
      case 'AVISO':
        return _AlertTypeConfig(
          label: 'Avisos',
          icon: Icons.campaign_rounded,
          color: AppTheme.neonPurple,
        );
      case 'MEDIOS_CLIENTE':
        return _AlertTypeConfig(
          label: 'Medios del Cliente',
          icon: Icons.kitchen_rounded,
          color: AppTheme.neonTeal,
        );
      default:
        return _AlertTypeConfig(
          label: type,
          icon: Icons.notification_important_rounded,
          color: AppTheme.textSecondary,
        );
    }
  }
}

// ============================================================
// Config model for alert type visual properties
// ============================================================
class _AlertTypeConfig {
  final String label;
  final IconData icon;
  final Color color;

  const _AlertTypeConfig({
    required this.label,
    required this.icon,
    required this.color,
  });
}

// ============================================================
// Loading shimmer for the KPI section
// ============================================================
class _KpiLoadingShimmer extends StatelessWidget {
  const _KpiLoadingShimmer();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.darkSurface,
            AppTheme.neonPurple.withValues(alpha: 0.05),
            AppTheme.darkSurface,
          ],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: AppTheme.neonPurple.withValues(alpha: 0.15),
          width: 0.5,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: AppTheme.neonPurple.withValues(alpha: 0.5),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'Cargando KPIs...',
            style: TextStyle(
              fontSize: 12,
              color: AppTheme.textTertiary.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }
}
