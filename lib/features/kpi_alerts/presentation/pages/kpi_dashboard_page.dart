// kpi_dashboard_page.dart: Panel resumen Glacius/Nestle
// JEFE_VENTAS ve todos los clientes, COMERCIAL solo los suyos

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/core/widgets/error_state_widget.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class KpiDashboardPage extends ConsumerStatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;

  const KpiDashboardPage({
    super.key,
    required this.employeeCode,
    required this.isJefeVentas,
  });

  @override
  ConsumerState<KpiDashboardPage> createState() => _KpiDashboardPageState();
}

class _KpiDashboardPageState extends ConsumerState<KpiDashboardPage> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  /// Resolves the vendorCode to use for the API call:
  /// - JEFE with FilterProvider selection → that vendor
  /// - JEFE with no filter → null (all clients)
  /// - COMERCIAL → their own vendorCode always
  String? _resolveVendorCode() {
    if (widget.isJefeVentas) {
      // Jefe: use the global filter selector
      final filterCode = ref.read(filterProvider).selectedVendor;
      return filterCode; // null = all, or specific vendor
    }
    // Comercial: always their own code
    final authState = ProviderScope.containerOf(context)
        .read(authProvider)
        .value;
    return authState?.user?.vendedorCode;
  }

  Future<void> _loadDashboard() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final vendorCode = _resolveVendorCode();

      String url = ApiConfig.kpiDashboard;
      if (vendorCode != null && vendorCode.isNotEmpty) {
        url += '?vendorCode=$vendorCode';
      }

      final data = await ApiClient.get(url);
      if (!mounted) return;
      if (data != null && data['success'] == true) {
        setState(() {
          _data = data;
          _loading = false;
        });
      } else {
        setState(() {
          _error = 'No se pudieron cargar los datos de Nestle';
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error =
            'Error de conexion. Comprueba tu red e intentalo de nuevo.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: const Text('Nestle / Glacius'),
        backgroundColor: AppTheme.darkSurface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadDashboard,
          ),
        ],
      ),
      body: Column(
        children: [
          // Vendor selector for JEFE_VENTAS
          if (widget.isJefeVentas)
            GlobalVendorSelector(
              isJefeVentas: true,
              onChanged: _loadDashboard,
            ),
          // Content
          Expanded(
            child: _loading
                ? const SkeletonList(itemCount: 4, itemHeight: 120)
                : _error != null
                    ? ErrorStateWidget(
                        message: _error!,
                        onRetry: _loadDashboard,
                      )
                    : _buildContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: Colors.grey[600]),
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Colors.grey[400], fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _loadDashboard,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent() {
    final totals = _data!['totals'] as Map<String, dynamic>? ?? {};
    final byType = (_data!['byType'] as List<dynamic>?) ?? [];
    final clients = (_data!['clients'] as List<dynamic>?) ?? [];
    final lastLoad = _data!['lastLoad'] as Map<String, dynamic>?;

    final totalAlerts = (totals['alerts'] as num?)?.toInt() ?? 0;

    return RefreshIndicator(
      onRefresh: _loadDashboard,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Last update banner
          _buildUpdateBanner(lastLoad, totalAlerts),
          const SizedBox(height: 16),

          // Summary cards
          _buildSummaryCards(totals),
          const SizedBox(height: 20),

          // Type breakdown
          if (byType.isNotEmpty) ...[
            _buildSectionTitle('Resumen por tipo de alerta'),
            const SizedBox(height: 8),
            ...byType.map((t) => _buildTypeRow(t as Map<String, dynamic>)),
            const SizedBox(height: 20),
          ],

          // Clients with alerts
          if (clients.isNotEmpty) ...[
            _buildSectionTitle(
                'Clientes con alertas (${clients.length})'),
            const SizedBox(height: 8),
            ...clients.map(
                (c) => _buildClientTile(c as Map<String, dynamic>)),
          ],

          // Empty state
          if (totalAlerts == 0)
            _buildEmptyState(
              lastLoad?['totalAlerts'] as num?,
            ),

          const SizedBox(height: 40),
        ],
      ),
    );
  }

  // ─── UPDATE BANNER ──────────────────────────────────────────

  Widget _buildUpdateBanner(Map<String, dynamic>? lastLoad, int totalAlerts) {
    String label;
    Color dotColor;

    if (lastLoad == null) {
      label = 'Sin datos de Nestle cargados aun';
      dotColor = Colors.orange;
    } else {
      final completedAt = lastLoad['completedAt']?.toString() ?? '';
      final relativeTime = _formatRelativeTime(completedAt);
      label = 'Datos actualizados $relativeTime';
      dotColor = Colors.greenAccent;

      if (totalAlerts > 0) {
        label += '  ·  $totalAlerts alerta${totalAlerts == 1 ? '' : 's'} activa${totalAlerts == 1 ? '' : 's'}';
      }
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: dotColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: dotColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: Colors.grey[300], fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  String _formatRelativeTime(String dateStr) {
    if (dateStr.isEmpty) return '';
    try {
      final date = DateTime.parse(dateStr);
      final now = DateTime.now();
      final diff = now.difference(date);

      if (diff.inMinutes < 1) return 'ahora mismo';
      if (diff.inMinutes < 60) return 'hace ${diff.inMinutes} min';
      if (diff.inHours < 24) {
        final h = diff.inHours;
        return 'hoy hace ${h}h';
      }
      if (diff.inDays == 1) return 'ayer';
      if (diff.inDays < 7) return 'hace ${diff.inDays} dias';
      // Fallback: show date
      return 'el ${date.day}/${date.month}/${date.year}';
    } catch (_) {
      return '';
    }
  }

  // ─── SUMMARY CARDS ──────────────────────────────────────────

  Widget _buildSummaryCards(Map<String, dynamic> totals) {
    return Row(
      children: [
        _buildCard(
          'Urgentes',
          totals['critical']?.toString() ?? '0',
          Colors.redAccent,
          Icons.error_rounded,
        ),
        const SizedBox(width: 8),
        _buildCard(
          'Atencion',
          totals['warning']?.toString() ?? '0',
          Colors.orangeAccent,
          Icons.warning_amber_rounded,
        ),
        const SizedBox(width: 8),
        _buildCard(
          'Info',
          totals['info']?.toString() ?? '0',
          Colors.cyanAccent,
          Icons.info_outline_rounded,
        ),
        const SizedBox(width: 8),
        _buildCard(
          'Clientes',
          totals['clients']?.toString() ?? '0',
          Colors.blueAccent,
          Icons.storefront_rounded,
        ),
      ],
    );
  }

  Widget _buildCard(String label, String value, Color color, IconData icon) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
        decoration: BoxDecoration(
          color: AppTheme.darkSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 4),
            Text(
              value,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 10, color: Colors.grey[500]),
            ),
          ],
        ),
      ),
    );
  }

  // ─── TYPE BREAKDOWN ─────────────────────────────────────────

  Widget _buildTypeRow(Map<String, dynamic> t) {
    final label = t['label']?.toString() ?? '';
    final crit = (t['critical'] as num?)?.toInt() ?? 0;
    final warn = (t['warning'] as num?)?.toInt() ?? 0;
    final info = (t['info'] as num?)?.toInt() ?? 0;
    final total = (t['total'] as num?)?.toInt() ?? 0;

    if (total == 0) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          if (crit > 0) _buildBadge(crit, Colors.redAccent),
          if (warn > 0) _buildBadge(warn, Colors.orangeAccent),
          if (info > 0) _buildBadge(info, Colors.cyanAccent),
          const SizedBox(width: 8),
          SizedBox(
            width: 32,
            child: Text(
              '$total',
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ─── CLIENT TILES (expandable) ──────────────────────────────

  Widget _buildClientTile(Map<String, dynamic> client) {
    final code = client['code']?.toString() ?? '';
    final name = client['name']?.toString() ?? '';
    final address = client['address']?.toString() ?? '';
    final city = client['city']?.toString() ?? '';
    final total = (client['total'] as num?)?.toInt() ?? 0;
    final crit = (client['critical'] as num?)?.toInt() ?? 0;
    final warn = (client['warning'] as num?)?.toInt() ?? 0;
    final alerts = (client['alerts'] as List<dynamic>?) ?? [];

    // Short code: remove 4300 prefix for display
    final shortCode = code.startsWith('4300')
        ? code.substring(4).replaceFirst(RegExp(r'^0+'), '')
        : code;

    final headerColor = crit > 0
        ? Colors.redAccent.withValues(alpha: 0.2)
        : warn > 0
            ? Colors.orangeAccent.withValues(alpha: 0.12)
            : Colors.blueGrey.withValues(alpha: 0.1);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(10),
        border: crit > 0
            ? Border.all(color: Colors.redAccent.withValues(alpha: 0.3))
            : null,
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          childrenPadding:
              const EdgeInsets.only(left: 14, right: 14, bottom: 12),
          backgroundColor: headerColor,
          collapsedBackgroundColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          collapsedShape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          title: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name.isNotEmpty ? name : 'Cliente $shortCode',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        shortCode,
                        if (city.isNotEmpty) city,
                      ].join('  ·  '),
                      style: TextStyle(
                        color: Colors.grey[500],
                        fontSize: 11,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              if (crit > 0) _buildBadge(crit, Colors.redAccent),
              if (warn > 0) _buildBadge(warn, Colors.orangeAccent),
              const SizedBox(width: 4),
              Text(
                '$total',
                style: TextStyle(
                  color: Colors.grey[500],
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          children: [
            // Address
            if (address.isNotEmpty) ...[
              Row(
                children: [
                  Icon(Icons.location_on_outlined,
                      size: 14, color: Colors.grey[600]),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      [address, if (city.isNotEmpty) city]
                          .join(', '),
                      style: TextStyle(
                        color: Colors.grey[500],
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
            ],

            // Alerts list
            ...alerts.map(
                (a) => _buildAlertItem(a as Map<String, dynamic>)),
          ],
        ),
      ),
    );
  }

  Widget _buildAlertItem(Map<String, dynamic> alert) {
    final severity = alert['severity']?.toString() ?? 'info';
    final title = alert['title']?.toString() ?? '';
    final summary = alert['summary']?.toString() ?? '';
    final detail = alert['detail']?.toString() ?? '';
    final actions = (alert['actions'] as List<dynamic>?) ?? [];
    final uiHint = (alert['ui_hint'] as Map<String, dynamic>?) ?? {};

    final colorHex = uiHint['color']?.toString() ?? '#888888';
    final color = _parseColor(colorHex);

    final sevColor = severity == 'critical'
        ? Colors.redAccent
        : severity == 'warning'
            ? Colors.orangeAccent
            : Colors.cyanAccent;

    final sevLabel =
        severity == 'critical' ? 'URG' : severity == 'warning' ? 'ATEN' : 'INFO';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.darkBase.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(color: color, width: 3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title + severity badge
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: color,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: sevColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  sevLabel,
                  style: TextStyle(
                    color: sevColor,
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),

          // Summary
          Text(
            summary,
            style: TextStyle(color: Colors.grey[300], fontSize: 12),
          ),

          // Detail (if exists)
          if (detail.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              detail,
              style: TextStyle(color: Colors.grey[500], fontSize: 11),
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
            ),
          ],

          // Action chips
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: actions
                  .take(2)
                  .map((a) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                              color: color.withValues(alpha: 0.3)),
                        ),
                        child: Text(
                          a.toString(),
                          style: TextStyle(
                            color: color,
                            fontSize: 10,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }

  // ─── EMPTY STATE ────────────────────────────────────────────

  Widget _buildEmptyState(num? globalAlerts) {
    final hasGlobalData =
        globalAlerts != null && globalAlerts.toInt() > 0;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Column(
        children: [
          Icon(
            hasGlobalData
                ? Icons.filter_list_off_rounded
                : Icons.check_circle_outline_rounded,
            size: 56,
            color: hasGlobalData
                ? Colors.orangeAccent
                : Colors.greenAccent[400],
          ),
          const SizedBox(height: 12),
          Text(
            hasGlobalData
                ? 'Sin alertas para tus clientes'
                : 'Sin alertas de Nestle',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            hasGlobalData
                ? 'Hay ${globalAlerts.toInt()} alertas globales '
                    'pero ninguna afecta a tus clientes'
                : 'Todos tus clientes estan al dia '
                    'con sus objetivos',
            style: TextStyle(color: Colors.grey[500], fontSize: 13),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  // ─── HELPERS ────────────────────────────────────────────────

  Widget _buildSectionTitle(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: Colors.white,
        fontSize: 15,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  Widget _buildBadge(int count, Color color) {
    return Container(
      margin: const EdgeInsets.only(left: 4),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '$count',
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Color _parseColor(String hex) {
    try {
      final cleaned = hex.replaceFirst('#', '');
      return Color(int.parse('FF$cleaned', radix: 16));
    } catch (_) {
      return Colors.grey;
    }
  }
}
