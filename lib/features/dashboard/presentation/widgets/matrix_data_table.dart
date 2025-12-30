import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';

/// Power BI Style Matrix Data Table
/// Shows years/quarters as columns, rows as vendors/products/clients
class MatrixDataTable extends StatelessWidget {
  final List<Map<String, dynamic>> rows;
  final List<String> periods;
  final String groupBy;

  const MatrixDataTable({
    super.key,
    required this.rows,
    required this.periods,
    required this.groupBy,
  });

  /// Safe extraction of numeric values
  double _safeDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    if (value is Map) {
      // Handle nested structures like {value: 123.45}
      final v = value['value'] ?? value['sales'] ?? value['total'];
      if (v != null) return _safeDouble(v);
    }
    return 0.0;
  }

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(32),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Center(
          child: Text(
            'No hay datos para mostrar',
            style: TextStyle(color: Colors.white54),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Icon(_getGroupIcon(), color: AppTheme.neonBlue, size: 20),
                const SizedBox(width: 8),
                Text(
                  'Matriz por ${_getRowLabel()}',
                  style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                ),
                const Spacer(),
                Text(
                  '${rows.length} registros',
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: Colors.white10),
          // Table
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowColor: WidgetStateProperty.all(AppTheme.darkBase),
              dataRowColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.hovered)) {
                  return AppTheme.neonBlue.withOpacity(0.1);
                }
                return null;
              }),
              columnSpacing: 16,
              horizontalMargin: 12,
              dataRowMinHeight: 36,
              dataRowMaxHeight: 44,
              columns: [
                DataColumn(
                  label: Text(
                    _getRowLabel(),
                    style: const TextStyle(
                      color: AppTheme.neonBlue,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
                ...periods.map((period) => DataColumn(
                  label: Text(
                    _formatPeriod(period),
                    style: const TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: 11,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  numeric: true,
                )),
                const DataColumn(
                  label: Text(
                    'TOTAL',
                    style: TextStyle(
                      color: AppTheme.neonPurple,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                  numeric: true,
                ),
              ],
              rows: rows.take(50).map((row) {
                final total = _safeDouble(row['total']);
                return DataRow(
                  cells: [
                    DataCell(
                      SizedBox(
                        width: 180,
                        child: Text(
                          _getDisplayName(row),
                          style: const TextStyle(color: Colors.white, fontSize: 11),
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                        ),
                      ),
                    ),
                    ...periods.map((period) {
                      final value = _safeDouble(row['data']?[period]);
                      return DataCell(
                        Text(
                          CurrencyFormatter.formatWhole(value),
                          style: TextStyle(
                            color: value > 0 ? Colors.white : Colors.white30,
                            fontSize: 10,
                          ),
                        ),
                      );
                    }),
                    DataCell(
                      Text(
                        CurrencyFormatter.formatWhole(total),
                        style: const TextStyle(
                          color: AppTheme.neonPurple,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  String _getDisplayName(Map<String, dynamic> row) {
    // Try to get a meaningful name
    final name = row['name']?.toString() ?? row['label']?.toString();
    final code = row['code']?.toString() ?? '';
    
    if (name != null && name.isNotEmpty && name != code) {
      return '$name ($code)';
    }
    return name ?? code;
  }

  IconData _getGroupIcon() {
    switch (groupBy) {
      case 'vendor': return Icons.badge;
      case 'product': return Icons.inventory;
      case 'client': return Icons.person;
      default: return Icons.table_chart;
    }
  }

  String _getRowLabel() {
    switch (groupBy) {
      case 'vendor': return 'Vendedor';
      case 'product': return 'Producto';
      case 'client': return 'Cliente';
      default: return 'Item';
    }
  }

  String _formatPeriod(String period) {
    // Format: "2024-T1" -> "24 T1", "2024-01" -> "24/01"
    if (period.contains('-T')) {
      final parts = period.split('-T');
      if (parts.length == 2) {
        return "'${parts[0].substring(2)} T${parts[1]}";
      }
    }
    if (period.contains('-')) {
      final parts = period.split('-');
      if (parts.length == 2) {
        return "'${parts[0].substring(2)}/${parts[1]}";
      }
    }
    return period;
  }
}
