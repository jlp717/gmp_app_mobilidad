---
name: flutter-charts
description: Flutter charts with fl_chart. LineChart with FlSpot and touch, BarChart with labels and grouping, PieChart with animation and callbacks, consistent theming, performance, and responsive sizing.
---

# Flutter Charts with fl_chart

## Overview

`fl_chart` is the standard charting library for Flutter. It provides `LineChart`, `BarChart`, `PieChart`, `ScatterChart`, and `RadarChart` — all fully customizable and interactive. This skill covers the three most common chart types, theming strategy, performance patterns, and responsive sizing.

Add the dependency:

```yaml
dependencies:
  fl_chart: ^0.68.0
```

## When to Use

- You need to visualize time-series, categorical, or proportional data in a Flutter app
- You need interactive charts (tap to inspect, tooltip on hover/press)
- You need animated transitions when data changes
- You need dark-mode-aware charts that respect the app's `ThemeData`

## When NOT to Use

- You need SVG/canvas export — `fl_chart` renders to Flutter widgets only
- You need complex geospatial or financial (candlestick) charts — consider `syncfusion_flutter_charts` instead
- The chart is purely decorative with no data binding — use a custom `CustomPainter` instead

---

## Step-by-Step Process

### 1. LineChart with Real Data and Touch Interaction

Always transform data outside `build()` to avoid re-computing on every frame.

```dart
class SalesLineChart extends StatelessWidget {
  final List<({DateTime date, double value})> sales;

  const SalesLineChart({required this.sales, super.key});

  List<FlSpot> _toSpots() {
    return sales
        .asMap()
        .entries
        .map((e) => FlSpot(e.key.toDouble(), e.value.value))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final spots = _toSpots(); // computed once per build

    return AspectRatio(
      aspectRatio: 16 / 9,
      child: LineChart(
        LineChartData(
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: colorScheme.primary,
              barWidth: 2,
              dotData: FlDotData(
                show: true,
                getDotPainter: (spot, percent, bar, index) =>
                    FlDotCirclePainter(
                  radius: 4,
                  color: colorScheme.primary,
                  strokeWidth: 2,
                  strokeColor: colorScheme.surface,
                ),
              ),
              belowBarData: BarAreaData(
                show: true,
                gradient: LinearGradient(
                  colors: [
                    colorScheme.primary.withOpacity(0.3),
                    colorScheme.primary.withOpacity(0.0),
                  ],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
            ),
          ],
          lineTouchData: LineTouchData(
            enabled: true,
            touchTooltipData: LineTouchTooltipData(
              getTooltipItems: (spots) => spots
                  .map((s) => LineTooltipItem(
                        '\$${s.y.toStringAsFixed(2)}',
                        TextStyle(
                          color: colorScheme.onPrimary,
                          fontWeight: FontWeight.bold,
                        ),
                      ))
                  .toList(),
            ),
          ),
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            getDrawingHorizontalLine: (_) => FlLine(
              color: colorScheme.outline.withOpacity(0.2),
              strokeWidth: 1,
            ),
          ),
          borderData: FlBorderData(show: false),
        ),
      ),
    );
  }
}
```

### 2. BarChart with Labels and Grouped Bars

```dart
class RevenueBarChart extends StatelessWidget {
  final List<({String label, double q1, double q2})> data;

  const RevenueBarChart({required this.data, super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    final groups = data.asMap().entries.map((e) {
      return BarChartGroupData(
        x: e.key,
        barRods: [
          BarChartRodData(
            toY: e.value.q1,
            color: colorScheme.primary,
            width: 12,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
          ),
          BarChartRodData(
            toY: e.value.q2,
            color: colorScheme.secondary,
            width: 12,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
          ),
        ],
      );
    }).toList();

    return AspectRatio(
      aspectRatio: 16 / 9,
      child: BarChart(
        BarChartData(
          barGroups: groups,
          barTouchData: BarTouchData(
            touchTooltipData: BarTouchTooltipData(
              getTooltipItem: (group, groupIndex, rod, rodIndex) =>
                  BarTooltipItem(
                rod.toY.toStringAsFixed(0),
                TextStyle(color: colorScheme.onPrimary),
              ),
            ),
          ),
          titlesData: FlTitlesData(
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                getTitlesWidget: (value, meta) => Text(
                  data[value.toInt()].label,
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(showTitles: true, reservedSize: 40),
            ),
            topTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false)),
            rightTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false)),
          ),
          gridData: FlGridData(show: true, drawVerticalLine: false),
          borderData: FlBorderData(show: false),
        ),
      ),
    );
  }
}
```

### 3. Animated PieChart with Touch Callbacks

```dart
class CategoryPieChart extends StatefulWidget {
  final List<({String label, double value, Color color})> sections;

  const CategoryPieChart({required this.sections, super.key});

  @override
  State<CategoryPieChart> createState() => _CategoryPieChartState();
}

class _CategoryPieChartState extends State<CategoryPieChart> {
  int _touchedIndex = -1;

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1,
      child: PieChart(
        PieChartData(
          sectionsSpace: 3,
          centerSpaceRadius: 48,
          pieTouchData: PieTouchData(
            touchCallback: (event, response) {
              if (!event.isInterestedForInteractions ||
                  response?.touchedSection == null) {
                setState(() => _touchedIndex = -1);
                return;
              }
              setState(() => _touchedIndex =
                  response!.touchedSection!.touchedSectionIndex);
            },
          ),
          sections: widget.sections.asMap().entries.map((e) {
            final isTouched = e.key == _touchedIndex;
            return PieChartSectionData(
              value: e.value.value,
              color: e.value.color,
              radius: isTouched ? 72 : 60,
              title: isTouched ? e.value.label : '',
              titleStyle: TextStyle(
                color: Theme.of(context).colorScheme.onPrimary,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            );
          }).toList(),
        ),
        swapAnimationDuration: const Duration(milliseconds: 250),
        swapAnimationCurve: Curves.easeInOut,
      ),
    );
  }
}
```

### 4. Theming and Dark Mode

Always source colors from `Theme.of(context)` — never hardcode hex values in charts:

```dart
final colorScheme = Theme.of(context).colorScheme;

// Use semantic tokens
colorScheme.primary       // main data series
colorScheme.secondary     // secondary series
colorScheme.outline       // grid lines (with opacity)
colorScheme.onSurface     // axis labels
colorScheme.surface       // tooltip background
```

### 5. Responsive Sizing

```dart
// Option A: Fixed aspect ratio (preferred)
AspectRatio(aspectRatio: 16 / 9, child: LineChart(...))

// Option B: Fill available width with fixed height
SizedBox(
  width: double.infinity,
  height: MediaQuery.of(context).size.height * 0.3,
  child: BarChart(...),
)
```

---

## Verification Checklist

- [ ] Data transformation happens outside `build()` (no computation inside `LineChartData`)
- [ ] Colors come from `Theme.of(context).colorScheme`, not hardcoded hex
- [ ] Chart is wrapped in `AspectRatio` or `SizedBox` — never unconstrained
- [ ] Touch interactions provide visual feedback (radius change, tooltip)
- [ ] Dark mode tested: no hardcoded white/black colors
- [ ] Animations use `swapAnimationDuration` for smooth data transitions
- [ ] `const` constructors used where data is static
- [ ] Axis titles hidden on sides where not needed (`showTitles: false`)
