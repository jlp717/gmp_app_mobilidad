import 'package:flutter/material.dart';

import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';

/// Scrollable formatted table for exportable chat data.

class ChatExportTable extends StatefulWidget {
  const ChatExportTable({required this.data, super.key});

  final ChatExportableData data;

  static const int _collapsedRows = 10;

  @override
  State<ChatExportTable> createState() => _ChatExportTableState();
}

class _ChatExportTableState extends State<ChatExportTable> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final headers = _safeHeaders(widget.data);
    final rows = widget.data.rows
        .map((row) => _safeRow(row, headers.length))
        .where((row) => row.isNotEmpty)
        .toList();

    if (headers.isEmpty && rows.isEmpty) {
      return const SizedBox.shrink();
    }

    final totalRows = rows.length;

    final showToggle = totalRows > ChatExportTable._collapsedRows;

    final visibleRows = (!_expanded && showToggle)
        ? rows.take(ChatExportTable._collapsedRows).toList()
        : rows;

    return Container(
      margin: const EdgeInsets.only(top: 10),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.info.withValues(alpha: 0.2)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowHeight: 36,
                dataRowMinHeight: 32,
                dataRowMaxHeight: 40,
                horizontalMargin: 12,
                columnSpacing: 20,
                headingTextStyle: const TextStyle(
                  color: AppColors.info,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                ),
                dataTextStyle: TextStyle(
                  color: Colors.grey.shade300,
                  fontSize: 12,
                ),
                columns:
                    headers.map((h) => DataColumn(label: Text(h))).toList(),
                rows: visibleRows
                    .asMap()
                    .entries
                    .map(
                      (entry) => DataRow(
                        color: WidgetStateProperty.resolveWith((states) {
                          if (states.contains(WidgetState.pressed)) {
                            return AppColors.info.withValues(alpha: 0.12);
                          }

                          if (states.contains(WidgetState.hovered)) {
                            return AppColors.info.withValues(alpha: 0.06);
                          }

                          return entry.key.isEven
                              ? Colors.white.withValues(alpha: 0.02)
                              : null;
                        }),
                        cells: entry.value
                            .map((cell) => DataCell(Text(cell)))
                            .toList(),
                      ),
                    )
                    .toList(),
              ),
            ),
            if (showToggle)
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () => setState(() => _expanded = !_expanded),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    alignment: Alignment.center,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _expanded ? Icons.expand_less : Icons.expand_more,
                          size: 18,
                          color: AppColors.info,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _expanded
                              ? 'Ver menos'
                              : 'Ver más (${totalRows - ChatExportTable._collapsedRows} filas)',
                          style: const TextStyle(
                            color: AppColors.info,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  List<String> _safeHeaders(ChatExportableData data) {
    if (data.headers.isNotEmpty) return data.headers;
    final columnCount = data.rows.fold<int>(
      0,
      (maxColumns, row) => row.length > maxColumns ? row.length : maxColumns,
    );
    return List.generate(columnCount, (index) => 'Columna ${index + 1}');
  }

  List<String> _safeRow(List<String> row, int columnCount) {
    if (columnCount == 0) return const [];
    if (row.length == columnCount) return row;
    if (row.length > columnCount) return row.take(columnCount).toList();
    return [...row, ...List.filled(columnCount - row.length, '')];
  }
}
