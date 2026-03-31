/// Order KPI Dashboard
/// ===================
/// Shows 4 KPI cards, status counters, 7-day trend chart, and top clients.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../providers/pedidos_provider.dart';
import '../utils/pedidos_formatters.dart';
import 'order_status_badge.dart';
import 'order_trend_chart.dart';

class OrderKpiDashboard extends StatelessWidget {
  final String vendedorCodes;
  const OrderKpiDashboard({Key? key, required this.vendedorCodes})
      : super(key: key);

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<PedidosProvider>();
    final stats = prov.orderStats;

    if (prov.isLoadingStats || stats == null) {
      return _buildLoadingState();
    }

    return Container(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 4 KPI Cards
          Row(
            children: [
              Expanded(
                child: _kpiCard(
                  context,
                  'Pedidos',
                  '${stats.totalOrders}',
                  _trendIcon(stats.trendOrdersPct),
                  _trendText(stats.trendOrdersPct),
                  Icons.receipt_long_outlined,
                  AppTheme.neonBlue,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _kpiCard(
                  context,
                  'Importe',
                  PedidosFormatters.money(stats.totalAmount),
                  _trendIcon(stats.trendAmountPct),
                  _trendText(stats.trendAmountPct),
                  Icons.euro,
                  AppTheme.neonGreen,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _kpiCard(
                  context,
                  'Margen',
                  '${stats.avgMargin.toStringAsFixed(1)}%',
                  null,
                  null,
                  Icons.trending_up,
                  _marginColor(stats.avgMargin),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _kpiCard(
                  context,
                  'Ticket medio',
                  PedidosFormatters.money(stats.avgTicket),
                  null,
                  null,
                  Icons.calculate_outlined,
                  AppTheme.neonPurple,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Status counters
          _buildStatusCounters(context, stats.byStatus),
          const SizedBox(height: 12),
          // Trend chart
          if (stats.dailyTrend.isNotEmpty) ...[
            Text(
              'Tendencia 7 días',
              style: TextStyle(
                color: Colors.white70,
                fontSize: Responsive.fontSize(context, small: 11, large: 13),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            OrderTrendChart(
              data: stats.dailyTrend
                  .map((d) => TrendDataPoint(
                        date: d['date'] as String,
                        orders: d['orders'] as int,
                        amount: d['amount'] as double,
                      ))
                  .toList(),
            ),
          ],
          // Top clients
          if (stats.topClients.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              'Top clientes del periodo',
              style: TextStyle(
                color: Colors.white70,
                fontSize: Responsive.fontSize(context, small: 11, large: 13),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            ...stats.topClients.asMap().entries.map((e) {
              final idx = e.key;
              final client = e.value;
              final pct = stats.totalAmount > 0
                  ? (client['amount'] as double) / stats.totalAmount * 100
                  : 0.0;
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Container(
                      width: 20,
                      height: 20,
                      decoration: BoxDecoration(
                        color: idx < 3
                            ? AppTheme.neonBlue.withOpacity(0.2)
                            : Colors.white.withOpacity(0.05),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Center(
                        child: Text(
                          '${idx + 1}',
                          style: TextStyle(
                            color: idx < 3 ? AppTheme.neonBlue : Colors.white54,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        client['name'] as String,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${client['orders']} ped.',
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 10,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      PedidosFormatters.money(client['amount'] as double),
                      style: const TextStyle(
                        color: AppTheme.neonGreen,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }

  Widget _kpiCard(
    BuildContext context,
    String label,
    String value,
    Widget? trendIcon,
    Widget? trendText,
    IconData icon,
    Color color,
  ) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color.withOpacity(0.7), size: 16),
              const Spacer(),
              if (trendIcon != null) trendIcon,
              if (trendText != null) ...[
                const SizedBox(width: 2),
                trendText,
              ],
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              color: Colors.white,
              fontSize: Responsive.fontSize(context, small: 16, large: 18),
              fontWeight: FontWeight.bold,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              color: Colors.white54,
              fontSize: Responsive.fontSize(context, small: 10, large: 11),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusCounters(BuildContext context, Map<String, int> byStatus) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        _statusChip(
            context, 'Todos', null, byStatus.values.fold(0, (a, b) => a + b)),
        ...OrderStatusConfig.themes.entries.map((e) {
          final count = byStatus[e.key] ?? 0;
          return _statusChip(context, e.value.label, e.value.primary, count);
        }),
      ],
    );
  }

  Widget _statusChip(
      BuildContext context, String label, Color? color, int count) {
    final prov = context.read<PedidosProvider>();
    final isSelected =
        prov.orderStatusFilter == (color != null ? label.toUpperCase() : null);
    return GestureDetector(
      onTap: () {
        final newStatus = color != null ? label.toUpperCase() : null;
        prov.setOrderStatusFilter(newStatus);
        prov.loadOrders(
          vendedorCodes: vendedorCodes,
          status: newStatus,
          forceRefresh: true,
        );
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: isSelected
              ? (color ?? AppTheme.neonBlue).withOpacity(0.2)
              : AppTheme.darkCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected
                ? (color ?? AppTheme.neonBlue).withOpacity(0.5)
                : AppTheme.borderColor,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (color != null)
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                ),
              ),
            if (color != null) const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? (color ?? Colors.white) : Colors.white70,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 4),
            Text(
              '$count',
              style: TextStyle(
                color: color ?? Colors.white54,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadingState() {
    return Container(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Row(
            children: List.generate(
              4,
              (i) => Expanded(
                child: Container(
                  height: 70,
                  margin: EdgeInsets.only(right: i < 3 ? 8 : 0),
                  decoration: BoxDecoration(
                    color: AppTheme.darkSurface,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Center(
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.neonBlue,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Container(
            height: 32,
            decoration: BoxDecoration(
              color: AppTheme.darkSurface,
              borderRadius: BorderRadius.circular(20),
            ),
          ),
        ],
      ),
    );
  }

  Color _marginColor(double margin) {
    if (margin >= 15) return AppTheme.neonGreen;
    if (margin >= 5) return Colors.orange;
    return AppTheme.error;
  }

  Widget? _trendIcon(double? pct) {
    if (pct == null) return null;
    if (pct > 0) {
      return Icon(Icons.arrow_upward, color: AppTheme.neonGreen, size: 12);
    } else if (pct < 0) {
      return Icon(Icons.arrow_downward, color: AppTheme.error, size: 12);
    }
    return Icon(Icons.remove, color: Colors.white54, size: 12);
  }

  Widget? _trendText(double? pct) {
    if (pct == null) return null;
    final absPct = pct.abs().toStringAsFixed(1);
    return Text(
      '${pct > 0 ? '+' : ''}$absPct%',
      style: TextStyle(
        color: pct > 0
            ? AppTheme.neonGreen
            : (pct < 0 ? AppTheme.error : Colors.white54),
        fontSize: 9,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}
