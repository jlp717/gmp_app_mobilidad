// client_alerts_widget.dart: Widget Flutter para mostrar alertas KPI
// Muestra alertas con prioridad por severidad y colores diferenciados

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/data/kpi_alerts_service.dart';

/// Widget que muestra las alertas KPI de un cliente con colores por severidad.
/// Usa el singleton KpiAlertsService — no requiere inyección manual.
class ClientAlertsWidget extends StatefulWidget {
  /// Creates a client alerts widget.
  const ClientAlertsWidget({
    super.key,
    required this.clientId,
    this.compact = false,
  });

  /// Client code to fetch alerts for
  final String clientId;

  /// Modo compacto: badges de colores para la agenda/rutero
  final bool compact;

  @override
  State<ClientAlertsWidget> createState() => _ClientAlertsWidgetState();
}

class _ClientAlertsWidgetState extends State<ClientAlertsWidget> {
  final _service = KpiAlertsService.instance;
  List<KpiAlert> _alerts = [];
  bool _loading = true;

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

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return widget.compact
          ? const SizedBox.shrink()
          : const Padding(
              padding: EdgeInsets.all(16),
              child: Center(
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            );
    }

    if (_alerts.isEmpty) {
      return const SizedBox.shrink();
    }

    return widget.compact ? _buildCompactView() : _buildFullView();
  }

  /// Vista compacta: badges de colores con conteo
  Widget _buildCompactView() {
    final criticalCount =
        _alerts.where((a) => a.severity == 'critical').length;
    final warningCount =
        _alerts.where((a) => a.severity == 'warning').length;
    final infoCount =
        _alerts.where((a) => a.severity == 'info').length;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (criticalCount > 0)
          _buildBadge(
            criticalCount,
            _severityColor('critical'),
            Icons.error,
          ),
        if (warningCount > 0)
          _buildBadge(
            warningCount,
            _severityColor('warning'),
            Icons.warning_amber,
          ),
        if (infoCount > 0)
          _buildBadge(
            infoCount,
            _severityColor('info'),
            Icons.info_outline,
          ),
      ],
    );
  }

  Widget _buildBadge(int count, Color color, IconData icon) {
    return Container(
      margin: const EdgeInsets.only(right: 4),
      padding: const EdgeInsets.symmetric(
        horizontal: 6,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 2),
          Text(
            '$count',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  /// Vista completa: lista de alertas con detalles
  Widget _buildFullView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 8,
          ),
          child: Row(
            children: [
              Icon(
                Icons.notifications_active,
                size: 18,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 8),
              Text(
                'Alertas KPI (${_alerts.length})',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              InkWell(
                onTap: _loadAlerts,
                child: Icon(
                  Icons.refresh,
                  size: 18,
                  color: Colors.grey[600],
                ),
              ),
            ],
          ),
        ),
        ..._alerts.map(_buildAlertTile),
      ],
    );
  }

  Widget _buildAlertTile(KpiAlert alert) {
    final color = _severityColor(alert.severity);
    final icon = _severityIcon(alert.severity);

    final lines = alert.message.split('\n');
    final mainMessage = lines.first;
    final details =
        lines.length > 1 ? lines.sublist(1) : <String>[];

    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(color: color, width: 3),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 8,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 16, color: color),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    alert.typeLabel,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                  ),
                ),
                const Spacer(),
                Text(
                  _formatDate(alert.createdAt),
                  style: TextStyle(
                    fontSize: 10,
                    color: Colors.grey[500],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              mainMessage,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
            if (details.isNotEmpty) ...[
              const SizedBox(height: 4),
              ...details.map(
                (d) => Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(
                    d,
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.grey[700],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Color _severityColor(String severity) {
    switch (severity) {
      case 'critical':
        return const Color(0xFFD32F2F);
      case 'warning':
        return const Color(0xFFF57C00);
      case 'info':
        return const Color(0xFF1976D2);
      default:
        return Colors.grey;
    }
  }

  IconData _severityIcon(String severity) {
    switch (severity) {
      case 'critical':
        return Icons.error;
      case 'warning':
        return Icons.warning_amber_rounded;
      case 'info':
        return Icons.info_outline;
      default:
        return Icons.circle;
    }
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inHours < 24) return 'Hoy';
    if (diff.inDays == 1) return 'Ayer';
    if (diff.inDays < 7) return 'Hace ${diff.inDays}d';
    return '${date.day}/${date.month}';
  }
}
