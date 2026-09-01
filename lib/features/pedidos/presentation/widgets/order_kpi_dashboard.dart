/// Order KPI Dashboard
/// ===================
/// Shows 4 KPI cards, status counters, 7-day trend chart, and top clients.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class OrderKpiDashboard extends ConsumerWidget {
  const OrderKpiDashboard({required this.vendedorCodes, super.key});
  final String vendedorCodes;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // select(): solo KPIs — no rebuild con carrito/búsqueda/productos.
    final stats = ref.watch(pedidosProvider.select((p) => p.orderStats));
    final showMargin =
        ref.watch(pedidosProvider.select((p) => p.isMarginVisible));
    final isLoadingStats =
        ref.watch(pedidosProvider.select((p) => p.isLoadingStats));

    if (isLoadingStats || stats == null) {
      return _buildLoadingState(showMarginCards: showMargin);
    }

    final cards = <Widget>[
      Expanded(
        child: _kpiCard(
          context,
          'Pedidos',
          '${stats.totalOrders}',
          _trendIcon(stats.trendOrdersPct),
          _trendText(stats.trendOrdersPct),
          Icons.receipt_long_outlined,
          AppTheme.info,
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
          AppTheme.success,
        ),
      ),
    ];

    if (showMargin) {
      cards.add(const SizedBox(width: 6));
      cards.add(
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
      );
    }

    cards.add(const SizedBox(width: 6));
    cards.add(
      Expanded(
        child: _kpiCard(
          context,
          'Ticket',
          PedidosFormatters.money(stats.avgTicket),
          null,
          null,
          Icons.calculate_outlined,
          AppTheme.accentIndigo,
        ),
      ),
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(children: cards),
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
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color.withValues(alpha: 0.6), size: 12),
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

  Widget _buildLoadingState({bool showMarginCards = true}) {
    final cardCount = showMarginCards ? 4 : 3;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: List.generate(
          cardCount,
          (i) => Expanded(
            child: Container(
              height: 44,
              margin: EdgeInsets.only(right: i < cardCount - 1 ? 6 : 0),
              decoration: BoxDecoration(
                color: AppTheme.raisedSurface,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Center(
                child: SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppTheme.info,
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
    if (margin >= 15) return AppTheme.success;
    if (margin >= 5) return AppTheme.warning;
    return AppTheme.error;
  }

  Widget? _trendIcon(double? pct) {
    if (pct == null) return null;
    if (pct > 0) {
      return const Icon(Icons.arrow_upward, color: AppTheme.success, size: 12);
    } else if (pct < 0) {
      return const Icon(Icons.arrow_downward, color: AppTheme.error, size: 12);
    }
    return const Icon(Icons.remove, color: Colors.white54, size: 12);
  }

  Widget? _trendText(double? pct) {
    if (pct == null) return null;
    final absPct = pct.abs().toStringAsFixed(1);
    return Text(
      '${pct > 0 ? '+' : ''}$absPct%',
      style: TextStyle(
        color: pct > 0
            ? AppTheme.success
            : (pct < 0 ? AppTheme.error : Colors.white54),
        fontSize: 9,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}
