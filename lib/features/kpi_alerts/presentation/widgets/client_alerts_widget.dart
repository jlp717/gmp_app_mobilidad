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
  bool _hasError = false;

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
      if (mounted) {
        setState(() {
          _loading = false;
          _hasError = true;
        });
      }
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

    if (_alerts.isEmpty) {
      // Compact: hide completely when no alerts
      if (widget.compact) return const SizedBox.shrink();
      // Full: show panel with empty/error state
      return _buildEmptyPanel();
    }

    return widget.compact ? _buildCompactView() : _buildFullView();
  }

  // ============================================================
  // EMPTY/ERROR PANEL — visible siempre en modo completo
  // ============================================================
  Widget _buildEmptyPanel() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkSurface,
            AppTheme.neonPurple.withValues(alpha: 0.04),
            AppTheme.darkSurface,
          ],
          stops: const [0.0, 0.5, 1.0],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppTheme.neonPurple.withValues(alpha: 0.2),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonPurple.withValues(alpha: 0.2),
                  AppTheme.neonBlue.withValues(alpha: 0.1),
                ],
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(
              Icons.insights_rounded,
              size: 16,
              color: AppTheme.neonPurple,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Alertas Nestle (Glacius)',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _hasError
                      ? 'Servicio no disponible'
                      : 'Sin alertas Nestle para este cliente',
                  style: TextStyle(
                    fontSize: 11,
                    color: _hasError
                        ? AppTheme.warning.withValues(alpha: 0.7)
                        : AppTheme.textTertiary,
                  ),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: _loadAlerts,
            child: const Icon(
              Icons.refresh_rounded,
              size: 16,
              color: AppTheme.textTertiary,
            ),
          ),
        ],
      ),
    );
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
              'Nestle',
              style: TextStyle(
                fontSize: 7,
                fontWeight: FontWeight.w800,
                color: AppTheme.neonPurple,
                letterSpacing: 0.5,
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

    // Orden de tipos coherente
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
    for (final t in grouped.keys) {
      if (!sortedTypes.contains(t)) sortedTypes.add(t);
    }

    final criticalCount = _alerts.where((a) => a.severity == 'critical').length;
    final warningCount = _alerts.where((a) => a.severity == 'warning').length;
    final infoCount = _alerts.where((a) => a.severity == 'info').length;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      constraints: BoxConstraints(
        // KEY: limitar altura maxima (65% viewport) para que siempre haya scroll
        maxHeight: MediaQuery.of(context).size.height * 0.65,
      ),
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
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header fijo (no hace scroll)
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
                  // KPI icon
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
                          'Alertas Nestle (Glacius)',
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
                  if (criticalCount > 0)
                    _buildSeverityChip(
                        criticalCount, _severityColor('critical'), 'URG'),
                  if (warningCount > 0)
                    _buildSeverityChip(
                        warningCount, _severityColor('warning'), 'ATEN'),
                  if (infoCount > 0)
                    _buildSeverityChip(
                        infoCount, _severityColor('info'), 'INFO'),
                  const SizedBox(width: 8),
                  // Refresh + expand
                  InkWell(
                    onTap: _loadAlerts,
                    child: const Icon(Icons.refresh_rounded,
                        size: 16, color: AppTheme.textTertiary),
                  ),
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: _expanded ? 0.0 : -0.25,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(Icons.expand_more_rounded,
                        size: 18, color: AppTheme.textTertiary),
                  ),
                ],
              ),
            ),
          ),

          // Area de contenido (Scrollable)
          if (_expanded)
            Flexible(
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(
                  parent: AlwaysScrollableScrollPhysics(),
                ),
                child: Padding(
                  padding: const EdgeInsets.only(
                      left: 8, right: 8, bottom: 10, top: 4),
                  child: Column(
                    children: sortedTypes.map((type) {
                      return _buildAlertGroupCollapsible(
                          type, grouped[type]!, isJefe);
                    }).toList(),
                  ),
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
  // GRUPO de alertas por tipo (Collapsible con ExpansionTile)
  // ============================================================
  Widget _buildAlertGroupCollapsible(String type, List<KpiAlert> alerts, bool isJefe) {
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
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: alerts.any((a) => a.severity == 'critical'),
          tilePadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
          childrenPadding: const EdgeInsets.only(bottom: 8),
          iconColor: accentColor,
          collapsedIconColor: accentColor.withValues(alpha: 0.7),
          title: Row(
            children: [
              Icon(config.icon, size: 14, color: config.color),
              const SizedBox(width: 8),
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
          children: alerts.map((a) => _buildAlertTile(a, config, isJefe)).toList(),
        ),
      ),
    );
  }

  // ============================================================
  // TILE individual: Summary siempre visible, Detail colapsable
  // ============================================================
  Widget _buildAlertTile(KpiAlert alert, _AlertTypeConfig config, bool isJefe) {
    final sevColor = _severityColor(alert.severity);

    // Preparar texto: si tenemos compact fields de la API, usarlos
    // Si no, separar el mensaje original de forma provisional
    String summary = '';
    String detailInfo = '';

    if (alert.hasCompactFields) {
      summary = alert.summary;
      detailInfo = alert.detail;
      if (alert.actions.isNotEmpty) {
        // En vez de mostrar los actions como lista, el detail de alert_transformer actual ya los incluye en texto,
        // pero podemos incluirlos si se quiere o dejarlos omitidos. 
        // El detail de alert_transformer ya dice "Que hacer: ..."
      }
    } else {
      // Fallback a parser crudo local
      final lines = alert.message.split('\n');
      summary = lines.first;
      detailInfo = lines.length > 1 ? lines.sublist(1).join('\n') : '';
    }

    // Role-based: hide financial details for non-jefes (usado para tags antiguos)
    final showFinancials = isJefe &&
        (alert.type == 'DESVIACION_VENTAS' || alert.type == 'ALTA_CLIENTE');

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(6),
        border: Border(
          left: BorderSide(color: sevColor, width: 3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Summary texto
              Expanded(
                child: Text(
                  summary,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                    height: 1.3,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // Badge de urgencia pequeno a la derecha
              if (alert.severity == 'critical')
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  decoration: BoxDecoration(
                    color: sevColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(3),
                  ),
                  child: Text(
                    'URGENTE',
                    style: TextStyle(
                      fontSize: 8,
                      fontWeight: FontWeight.w800,
                      color: sevColor,
                    ),
                  ),
                ),
            ],
          ),
          
          // Collapsible Details
          if (detailInfo.isNotEmpty || (showFinancials && alert.rawData != null))
            _CollapsibleDetail(
              detail: detailInfo,
              sevColor: sevColor,
              extraWidget: (showFinancials && alert.rawData != null)
                  ? Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: _buildFinancialRow(alert),
                    )
                  : null,
            ),
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

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: items,
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
            style: TextStyle(fontSize: 10, color: AppTheme.textTertiary),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 11,
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
      case 'critical': return 'URGENTE';
      case 'warning': return 'ATENCION';
      case 'info': return 'INFO';
      default: return severity.toUpperCase();
    }
  }

  _AlertTypeConfig _typeConfig(String type) {
    switch (type) {
      case 'DESVIACION_VENTAS':
        return _AlertTypeConfig(
          label: 'Ventas vs Objetivo',
          icon: Icons.trending_down_rounded,
          color: AppTheme.error,
        );
      case 'CUOTA_SIN_COMPRA':
        return _AlertTypeConfig(
          label: 'Sin Compras',
          icon: Icons.remove_shopping_cart_rounded,
          color: AppTheme.warning,
        );
      case 'DESVIACION_REFERENCIACION':
        return _AlertTypeConfig(
          label: 'Productos Pendientes',
          icon: Icons.inventory_2_rounded,
          color: const Color(0xFFFF6B9D),
        );
      case 'PROMOCION':
        return _AlertTypeConfig(
          label: 'Promociones',
          icon: Icons.local_offer_rounded,
          color: AppTheme.neonGreen,
        );
      case 'ALTA_CLIENTE':
        return _AlertTypeConfig(
          label: 'Cliente Nuevo',
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
          label: 'Equipamiento',
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
            'Cargando alertas Nestle (Glacius)...',
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

// ============================================================
// Internal widget for collapsible detail area
// ============================================================
class _CollapsibleDetail extends StatefulWidget {
  const _CollapsibleDetail({
    required this.detail,
    required this.sevColor,
    this.extraWidget,
  });

  final String detail;
  final Color sevColor;
  final Widget? extraWidget;

  @override
  State<_CollapsibleDetail> createState() => _CollapsibleDetailState();
}

class _CollapsibleDetailState extends State<_CollapsibleDetail> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => setState(() => _open = !_open),
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.only(top: 6, bottom: 2, right: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _open ? Icons.expand_less : Icons.expand_more,
                  size: 14,
                  color: widget.sevColor.withValues(alpha: 0.8),
                ),
                const SizedBox(width: 2),
                Text(
                  _open ? 'Ocultar detalle' : 'Ver detalle',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: widget.sevColor.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
          ),
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          child: _open
              ? Padding(
                  padding: const EdgeInsets.only(left: 14, top: 4, bottom: 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.detail,
                        style: const TextStyle(
                          fontSize: 11,
                          height: 1.4,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                      if (widget.extraWidget != null) widget.extraWidget!,
                    ],
                  ),
                )
              : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

