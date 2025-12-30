import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';

/// Tipos de período para la visualización
enum ChartPeriod {
  week('Semana'),
  month('Mes'),
  quarter('Trimestre'),
  year('Año');

  const ChartPeriod(this.label);
  final String label;
}

/// Tipos de comparación
enum ComparisonType {
  none('Sin comparación'),
  previousPeriod('Período anterior'),
  previousYear('Año anterior'),
  budget('Vs. Objetivo');

  const ComparisonType(this.label);
  final String label;
}

/// Datos para un punto en el gráfico
class ChartDataPoint {
  final String label;
  final double value;
  final DateTime date;
  final double? comparisonValue;

  const ChartDataPoint({
    required this.label,
    required this.value,
    required this.date,
    this.comparisonValue,
  });

  double get deviation {
    if (comparisonValue == null || comparisonValue == 0) return 0;
    return ((value - comparisonValue!) / comparisonValue!) * 100;
  }
}

/// Widget de gráfico avanzado con múltiples períodos y comparaciones
class AdvancedSalesChart extends StatefulWidget {
  final List<ChartDataPoint> data;
  final String title;
  final String subtitle;
  final ChartPeriod initialPeriod;
  final ComparisonType initialComparison;
  final void Function(ChartPeriod period, ComparisonType comparison)? onPeriodChanged;

  const AdvancedSalesChart({
    super.key,
    required this.data,
    required this.title,
    this.subtitle = '',
    this.initialPeriod = ChartPeriod.week,
    this.initialComparison = ComparisonType.previousYear,
    this.onPeriodChanged,
  });

  @override
  State<AdvancedSalesChart> createState() => _AdvancedSalesChartState();
}

class _AdvancedSalesChartState extends State<AdvancedSalesChart> {
  late ChartPeriod _selectedPeriod;
  late ComparisonType _selectedComparison;

  @override
  void initState() {
    super.initState();
    _selectedPeriod = widget.initialPeriod;
    _selectedComparison = widget.initialComparison;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Card(
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.title,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (widget.subtitle.isNotEmpty)
                        Text(
                          widget.subtitle,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                // Botón de configuración
                IconButton(
                  icon: const Icon(Icons.tune),
                  onPressed: () => _showConfigDialog(context),
                  tooltip: 'Configurar visualización',
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Filtros rápidos
            Wrap(
              spacing: 8,
              children: [
                _buildPeriodChip(context, ChartPeriod.week),
                _buildPeriodChip(context, ChartPeriod.month),
                _buildPeriodChip(context, ChartPeriod.quarter),
                _buildPeriodChip(context, ChartPeriod.year),
              ],
            ),

            const SizedBox(height: 16),

            // Estadísticas rápidas
            if (_selectedComparison != ComparisonType.none)
              _buildStatsRow(context),

            const SizedBox(height: 16),

            // Gráfico (con altura aumentada para mejor visualización)
            SizedBox(
              height: 320,
              child: widget.data.isEmpty
                  ? Center(
                      child: Text(
                        'No hay datos para mostrar',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    )
                  : _buildChart(context),
            ),

            const SizedBox(height: 16),

            // Leyenda
            _buildLegend(context),
          ],
        ),
      ),
    );
  }

  Widget _buildPeriodChip(BuildContext context, ChartPeriod period) {
    final isSelected = _selectedPeriod == period;
    final colorScheme = Theme.of(context).colorScheme;

    return FilterChip(
      label: Text(period.label),
      selected: isSelected,
      onSelected: (selected) {
        if (selected) {
          setState(() => _selectedPeriod = period);
          widget.onPeriodChanged?.call(_selectedPeriod, _selectedComparison);
        }
      },
      backgroundColor: colorScheme.surface,
      selectedColor: colorScheme.primaryContainer,
      checkmarkColor: colorScheme.onPrimaryContainer,
      labelStyle: TextStyle(
        color: isSelected
            ? colorScheme.onPrimaryContainer
            : colorScheme.onSurface,
      ),
    );
  }

  Widget _buildStatsRow(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    // Calcular estadísticas
    final currentTotal = widget.data.fold<double>(
      0,
      (sum, point) => sum + point.value,
    );
    final comparisonTotal = widget.data.fold<double>(
      0,
      (sum, point) => sum + (point.comparisonValue ?? 0),
    );
    final deviation = comparisonTotal == 0
        ? 0.0
        : ((currentTotal - comparisonTotal) / comparisonTotal) * 100;

    final isPositive = deviation >= 0;
    final deviationColor = isPositive ? Colors.green : Colors.red;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colorScheme.surfaceVariant.withOpacity(0.3),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Actual',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                Text(
                  NumberFormat.currency(symbol: '€', decimalDigits: 0)
                      .format(currentTotal),
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _selectedComparison.label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                Text(
                  NumberFormat.currency(symbol: '€', decimalDigits: 0)
                      .format(comparisonTotal),
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: deviationColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isPositive ? Icons.trending_up : Icons.trending_down,
                  size: 16,
                  color: deviationColor,
                ),
                const SizedBox(width: 4),
                Text(
                  '${deviation.abs().toStringAsFixed(1)}%',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: deviationColor,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChart(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final hasComparison = _selectedComparison != ComparisonType.none;

    // Calcular ancho apropiado para scroll horizontal
    // Dar más espacio a cada punto para evitar compresión
    final minWidthPerPoint = 60.0; // píxeles por punto de datos
    final chartWidth = (widget.data.length * minWidthPerPoint).clamp(300.0, double.infinity);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SizedBox(
        width: chartWidth,
        child: LineChart(
          LineChartData(
            gridData: FlGridData(
              show: true,
              drawVerticalLine: true,
              horizontalInterval: _calculateInterval(),
              verticalInterval: 1,
              getDrawingHorizontalLine: (value) {
                return FlLine(
                  color: colorScheme.outlineVariant.withOpacity(0.3),
                  strokeWidth: 1,
                );
              },
              getDrawingVerticalLine: (value) {
                return FlLine(
                  color: colorScheme.outlineVariant.withOpacity(0.15),
                  strokeWidth: 1,
                );
              },
            ),
            titlesData: FlTitlesData(
              show: true,
              rightTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false),
              ),
              topTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 40,
                  interval: 1, // Mostrar todos los labels ahora que tenemos espacio
                  getTitlesWidget: (value, meta) {
                    final index = value.toInt();
                    if (index < 0 || index >= widget.data.length) return const SizedBox.shrink();
                    
                    final point = widget.data[index];
                    return Padding(
                      padding: const EdgeInsets.only(top: 8.0),
                      child: RotatedBox(
                        quarterTurns: -1, // Rotar labels para mejor legibilidad
                        child: Text(
                          point.label,
                          style: TextStyle(
                            color: colorScheme.onSurfaceVariant,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    );
                  },
                ),
              ),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  interval: _calculateInterval(),
                  reservedSize: 50,
                  getTitlesWidget: (value, meta) {
                    return Padding(
                      padding: const EdgeInsets.only(right: 8.0),
                      child: Text(
                        NumberFormat.compact(locale: 'es').format(value),
                        style: TextStyle(
                          color: colorScheme.onSurfaceVariant,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
            borderData: FlBorderData(
              show: true,
              border: Border(
                left: BorderSide(
                  color: colorScheme.outline.withOpacity(0.5),
                  width: 2,
                ),
                bottom: BorderSide(
                  color: colorScheme.outline.withOpacity(0.5),
                  width: 2,
                ),
              ),
            ),
            minX: 0,
            maxX: (widget.data.length - 1).toDouble(),
            minY: 0,
            maxY: _calculateMaxY(),
            lineBarsData: [
              // Línea principal (valores actuales)
              LineChartBarData(
                spots: widget.data.asMap().entries.map((entry) {
                  return FlSpot(entry.key.toDouble(), entry.value.value);
                }).toList(),
                isCurved: true,
                color: colorScheme.primary,
                barWidth: 3,
                isStrokeCapRound: true,
                dotData: FlDotData(
                  show: true,
                  getDotPainter: (spot, percent, barData, index) {
                    return FlDotCirclePainter(
                      radius: 5,
                      color: colorScheme.primary,
                      strokeWidth: 2,
                      strokeColor: colorScheme.surface,
                    );
                  },
                ),
                belowBarData: BarAreaData(
                  show: true,
                  color: colorScheme.primary.withOpacity(0.1),
                ),
              ),
              // Línea de comparación (si está activa)
              if (hasComparison)
                LineChartBarData(
                  spots: widget.data.asMap().entries.map((entry) {
                    return FlSpot(
                      entry.key.toDouble(),
                      entry.value.comparisonValue ?? 0,
                    );
                  }).toList(),
                  isCurved: true,
                  color: colorScheme.tertiary,
                  barWidth: 2,
                  isStrokeCapRound: true,
                  dashArray: [5, 5],
                  dotData: FlDotData(
                    show: true,
                    getDotPainter: (spot, percent, barData, index) {
                      return FlDotCirclePainter(
                        radius: 4,
                        color: colorScheme.tertiary,
                        strokeWidth: 1,
                        strokeColor: colorScheme.surface,
                      );
                    },
                  ),
                ),
            ],
            lineTouchData: LineTouchData(
              enabled: true,
              touchTooltipData: LineTouchTooltipData(
                tooltipBgColor: colorScheme.inverseSurface,
                tooltipRoundedRadius: 8,
                getTooltipItems: (touchedSpots) {
                  return touchedSpots.map((spot) {
                    final point = widget.data[spot.x.toInt()];
                    final isMainLine = spot.barIndex == 0;
                    final value = isMainLine ? point.value : point.comparisonValue ?? 0;
                    
                    return LineTooltipItem(
                      '${point.label}\n${NumberFormat.currency(symbol: '€', decimalDigits: 0).format(value)}',
                      TextStyle(
                        color: colorScheme.onInverseSurface,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    );
                  }).toList();
                },
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLegend(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final hasComparison = _selectedComparison != ComparisonType.none;

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _buildLegendItem(
          context,
          color: colorScheme.primary,
          label: 'Actual',
        ),
        if (hasComparison) ...[
          const SizedBox(width: 24),
          _buildLegendItem(
            context,
            color: colorScheme.tertiary,
            label: _selectedComparison.label,
            isDashed: true,
          ),
        ],
      ],
    );
  }

  Widget _buildLegendItem(
    BuildContext context, {
    required Color color,
    required String label,
    bool isDashed = false,
  }) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 24,
          height: 3,
          decoration: BoxDecoration(
            color: isDashed ? null : color,
            border: isDashed ? Border.all(color: color, width: 2) : null,
          ),
          child: isDashed
              ? CustomPaint(
                  painter: DashedLinePainter(color: color),
                )
              : null,
        ),
        const SizedBox(width: 8),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  double _calculateMaxY() {
    if (widget.data.isEmpty) return 100;
    
    double maxValue = widget.data.map((p) => p.value).reduce((a, b) => a > b ? a : b);
    
    if (_selectedComparison != ComparisonType.none) {
      final maxComparison = widget.data
          .where((p) => p.comparisonValue != null)
          .map((p) => p.comparisonValue!)
          .fold<double>(0, (a, b) => a > b ? a : b);
      maxValue = maxValue > maxComparison ? maxValue : maxComparison;
    }
    
    return (maxValue * 1.2).ceilToDouble();
  }

  double _calculateInterval() {
    final maxY = _calculateMaxY();
    return (maxY / 5).ceilToDouble();
  }

  void _showConfigDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Configurar visualización'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Período:'),
            const SizedBox(height: 8),
            ...ChartPeriod.values.map((period) {
              return RadioListTile<ChartPeriod>(
                title: Text(period.label),
                value: period,
                groupValue: _selectedPeriod,
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _selectedPeriod = value);
                    widget.onPeriodChanged?.call(_selectedPeriod, _selectedComparison);
                    Navigator.pop(context);
                  }
                },
              );
            }),
            const Divider(),
            const Text('Comparación:'),
            const SizedBox(height: 8),
            ...ComparisonType.values.map((comparison) {
              return RadioListTile<ComparisonType>(
                title: Text(comparison.label),
                value: comparison,
                groupValue: _selectedComparison,
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _selectedComparison = value);
                    widget.onPeriodChanged?.call(_selectedPeriod, _selectedComparison);
                    Navigator.pop(context);
                  }
                },
              );
            }),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  }
}

/// Painter para líneas discontinuas en la leyenda
class DashedLinePainter extends CustomPainter {
  final Color color;

  DashedLinePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    const dashWidth = 4;
    const dashSpace = 3;
    double startX = 0;

    while (startX < size.width) {
      canvas.drawLine(
        Offset(startX, size.height / 2),
        Offset(startX + dashWidth, size.height / 2),
        paint,
      );
      startX += dashWidth + dashSpace;
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
