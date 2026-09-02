import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

/// Loads the evolution dashboard for one delivery driver.
typedef RepartidorEvolutionLoader = Future<RepartidorEvolutionData> Function(
  String repartidorId, {
  required bool forceRefresh,
});

/// Displays the collection and sales evolution for a delivery driver.
class RepartidorEvolutionPage extends StatefulWidget {
  /// Creates the evolution dashboard for the specified delivery driver.
  const RepartidorEvolutionPage({
    required this.repartidorId,
    this.loadEvolution,
    super.key,
  });

  /// Identifier of the driver whose evolution is displayed.
  final String repartidorId;

  /// Optional loader used to supply evolution data, primarily for tests.
  final RepartidorEvolutionLoader? loadEvolution;

  @override
  State<RepartidorEvolutionPage> createState() =>
      _RepartidorEvolutionPageState();
}

class _RepartidorEvolutionPageState extends State<RepartidorEvolutionPage> {
  bool _isLoading = true;
  RepartidorEvolutionData? _data;
  Object? _error;
  DateTime? _lastUpdated;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant RepartidorEvolutionPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      // Evolution data is scoped to one owner. Do not render the previous
      // driver's financial summary while the new owner's request is pending.
      setState(() {
        _data = null;
        _error = null;
        _lastUpdated = null;
      });
      _loadData(forceRefresh: true);
    }
  }

  Future<void> _loadData({bool forceRefresh = false}) async {
    final generation = ++_generation;
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final loader = widget.loadEvolution ??
          (repartidorId, {required bool forceRefresh}) =>
              RepartidorFinanzasService().getEvolution(
                repartidorId: repartidorId,
                forceRefresh: forceRefresh,
              );
      final data = await loader(
        widget.repartidorId,
        forceRefresh: forceRefresh,
      );
      if (!mounted || generation != _generation) return;
      setState(() {
        _data = data;
        _lastUpdated = DateTime.now();
        _isLoading = false;
      });
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = error;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading && _data == null) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
        body: Center(child: ModernLoading(message: 'Analizando evolución...')),
      );
    }
    if (_error != null && _data == null) {
      return _EvolutionError(
        message: financeErrorMessage(_error!, 'No se pudo cargar la evolución'),
        onRetry: () => _loadData(forceRefresh: true),
      );
    }

    final data = _data!;
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: RefreshIndicator(
        onRefresh: () => _loadData(forceRefresh: true),
        child: ListView(
          padding: EdgeInsets.all(
            Responsive.padding(context, small: 12, large: 20),
          ),
          children: [
            _EvolutionHeader(
              lastUpdated: _lastUpdated,
              isRefreshing: _isLoading,
              onRefresh: () => _loadData(forceRefresh: true),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              _InlineError(
                message: financeErrorMessage(
                  _error!,
                  'No se pudo actualizar la evolución',
                ),
                onRetry: () => _loadData(forceRefresh: true),
              ),
            if (data.isEmpty)
              const _EvolutionEmpty()
            else ...[
              _HeaderSummary(evolution: data.evolution),
              const SizedBox(height: 24),
              _EvolutionChart(evolution: data.evolution),
              const SizedBox(height: 24),
              Text(
                'Productos Top (Ventas)',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimary,
                    ),
              ),
              const SizedBox(height: 12),
              if (data.topProducts.isEmpty)
                RepartidorExecutivePanel(
                  padding: EdgeInsets.all(20),
                  child: Center(
                    child: Text(
                      'No hay datos de productos para este periodo',
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                  ),
                )
              else
                for (final product in data.topProducts)
                  _ProductTile(product: product),
            ],
          ],
        ),
      ),
    );
  }
}

class _EvolutionHeader extends StatelessWidget {
  const _EvolutionHeader({
    required this.lastUpdated,
    required this.isRefreshing,
    required this.onRefresh,
  });

  final DateTime? lastUpdated;
  final bool isRefreshing;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final freshness = lastUpdated == null
        ? 'Sin actualizar'
        : 'Actualizado ${DateFormat('HH:mm').format(lastUpdated!)}';
    return Row(
      children: [
        Expanded(
          child: Text(
            'Evolución de cobros',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        Text(
          freshness,
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
        ),
        IconButton(
          tooltip: 'Actualizar',
          onPressed: isRefreshing ? null : onRefresh,
          icon: const Icon(Icons.refresh),
        ),
      ],
    );
  }
}

class _HeaderSummary extends StatelessWidget {
  const _HeaderSummary({required this.evolution});

  final List<RepartidorEvolutionPoint> evolution;

  @override
  Widget build(BuildContext context) {
    final total = evolution.fold<double>(
      0,
      (sum, item) => sum + item.totalSales,
    );
    final growth = evolution.length > 1 ? _growth(evolution) : null;
    return Row(
      children: [
        Expanded(
          child: _SummaryCard(
            title: 'Cobros del periodo',
            value: CurrencyFormatter.formatWhole(total),
            icon: Icons.analytics,
            color: AppTheme.info,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _SummaryCard(
            title: 'Tendencia',
            value: growth == null ? '--' : '${growth.toStringAsFixed(1)}%',
            subtitle: 'vs mes anterior',
            icon: Icons.trending_up,
            color: AppTheme.success,
          ),
        ),
      ],
    );
  }

  static double _growth(List<RepartidorEvolutionPoint> points) {
    final current = points.last.totalSales;
    final previous = points[points.length - 2].totalSales;
    return previous == 0 ? 0 : ((current - previous) / previous) * 100;
  }
}

class _EvolutionChart extends StatelessWidget {
  const _EvolutionChart({required this.evolution});

  final List<RepartidorEvolutionPoint> evolution;

  @override
  Widget build(BuildContext context) {
    if (evolution.isEmpty) return const SizedBox.shrink();
    final spots = evolution.indexed
        .map((entry) => FlSpot(entry.$1.toDouble(), entry.$2.totalSales))
        .toList();
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.all(16),
      child: SizedBox(
        height: 250,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Evolución mensual',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 20),
            Expanded(
              child: LineChart(
                LineChartData(
                  gridData: const FlGridData(show: false),
                  titlesData: FlTitlesData(
                    leftTitles: const AxisTitles(),
                    rightTitles: const AxisTitles(),
                    topTitles: const AxisTitles(),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, _) {
                          final index = value.toInt();
                          if (index < 0 || index >= evolution.length) {
                            return const SizedBox.shrink();
                          }
                          return Text(
                            evolution[index].monthLabel,
                            style: TextStyle(
                              fontSize: 10,
                              color: AppTheme.textSecondary,
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  borderData: FlBorderData(show: false),
                  lineBarsData: [
                    LineChartBarData(
                      spots: spots,
                      isCurved: true,
                      color: AppTheme.info,
                      barWidth: 4,
                      isStrokeCapRound: true,
                      dotData: const FlDotData(show: false),
                      belowBarData: BarAreaData(
                        show: true,
                        color: AppTheme.info.withValues(alpha: 0.12),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EvolutionError extends StatelessWidget {
  const _EvolutionError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: Center(
        child: _ErrorContent(message: message, onRetry: onRetry),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: _ErrorContent(message: message, onRetry: onRetry),
    );
  }
}

class _ErrorContent extends StatelessWidget {
  const _ErrorContent({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
        const SizedBox(height: 12),
        Text(message, style: TextStyle(color: AppTheme.textSecondary)),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: onRetry, child: const Text('Reintentar')),
      ],
    );
  }
}

class _EvolutionEmpty extends StatelessWidget {
  const _EvolutionEmpty();

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      padding: EdgeInsets.all(24),
      child: Center(
        child: Text(
          'Todavía no hay cobros ni productos para mostrar',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
    this.subtitle,
  });

  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.all(16),
      accentColor: color,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
              ),
              Icon(icon, color: color, size: 20),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 18,
            ),
          ),
          if (subtitle != null)
            Text(
              subtitle!,
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 10,
              ),
            ),
        ],
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product});

  final RepartidorTopProduct product;

  @override
  Widget build(BuildContext context) {
    final units = product.totalUnits == product.totalUnits.roundToDouble()
        ? product.totalUnits.toInt().toString()
        : product.totalUnits.toStringAsFixed(2);
    return RepartidorExecutivePanel(
      margin: const EdgeInsets.only(bottom: 12),
      accentColor: AppTheme.accentIndigo,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppTheme.accentIndigo.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(
            Icons.inventory_2,
            color: AppTheme.accentIndigo,
            size: 20,
          ),
        ),
        title: Text(
          product.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
        subtitle: Text(
          'Cód: ${product.code} • $units uds',
          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
        ),
        trailing: Text(
          CurrencyFormatter.formatWhole(product.totalSales),
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            color: AppTheme.success,
          ),
        ),
      ),
    );
  }
}
