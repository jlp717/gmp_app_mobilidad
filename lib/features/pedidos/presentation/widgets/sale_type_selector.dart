/// Sale Type Selector
/// ==================
/// Dropdown for selecting sale type: Venta (CC), Venta Sin Nombre (VC), No Venta (NV)

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class SaleTypeSelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const SaleTypeSelector({
    Key? key,
    required this.value,
    required this.onChanged,
  }) : super(key: key);

  static const _options = [
    {'code': 'CC', 'label': 'Venta'},
    {'code': 'VC', 'label': 'Venta Sin Nombre'},
    {'code': 'NV', 'label': 'No Venta'},
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          dropdownColor: AppTheme.darkCard,
          icon: const Icon(Icons.expand_more, color: Colors.white38, size: 18),
          style: TextStyle(
            color: Colors.white,
            fontSize: Responsive.fontSize(context, small: 12, large: 14),
          ),
          isDense: true,
          items: _options.map((opt) {
            return DropdownMenuItem<String>(
              value: opt['code'],
              child: Text(
                opt['label']!,
                style: TextStyle(
                  color: Colors.white,
                  fontSize:
                      Responsive.fontSize(context, small: 12, large: 14),
                ),
              ),
            );
          }).toList(),
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ),
    );
  }
}
