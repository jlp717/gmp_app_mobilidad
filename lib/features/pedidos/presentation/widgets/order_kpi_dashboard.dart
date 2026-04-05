/// Order KPI Dashboard
/// ===================
/// Shows 4 KPI cards, status counters, 7-day trend chart, and top clients.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../providers/pedidos_provider.dart';
import '../utils/pedidos_formatters.dart';

class OrderKpiDashboard extends ConsumerWidget {
  final String vendedorCodes;
  const OrderKpiDashboard({Key? key, required this.vendedorCodes})
      : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prov = ref.watch(pedidosProvider);
    final stats = prov.orderStats;

    if (prov.isLoadingStats || stats == null) {
      return _buildLoadingState();
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
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
          const SizedBox(width: 6),
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
          const SizedBox(width: 6),
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
          const SizedBox(width: 6),
          Expanded(
            child: _kpiCard(
              context,
              'Ticket',
              PedidosFormatters.money(stats.avgTicket),
              null,
              null,
              Icons.calculate_outlined,
              AppTheme.neonPurple,
            ),
          ),
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color.withOpacity(0.6), size: 12),
              const Spacer(),
              if (trendIcon != null) trendIcon,
              if (trendText != null) ...[
                const SizedBox(width: 2),
                trendText,
              ],
            ],
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: Colors.white,
              fontSize: Responsive.fontSize(context, small: 12, large: 14),
              fontWeight: FontWeight.bold,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Text(
            label,
            style: TextStyle(
              color: Colors.white54,
              fontSize: Responsive.fontSize(context, small: 8, large: 9),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingState() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: List.generate(
          4,
          (i) => Expanded(
            child: Container(
              height: 44,
              margin: EdgeInsets.only(right: i < 3 ? 6 : 0),
              decoration: BoxDecoration(
                color: AppTheme.darkSurface,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Center(
                child: SizedBox(
                  width: 12,
                  height: 12,
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
