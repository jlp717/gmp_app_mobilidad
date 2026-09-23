/// Catalog sort selector for commercial pedidos product list.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/catalog_product_sort.dart';

class CatalogSortSelector extends StatelessWidget {
  const CatalogSortSelector({
    required this.value,
    required this.onChanged,
    this.includeMargin = false,
    super.key,
  });

  final CatalogProductSort value;
  final ValueChanged<CatalogProductSort> onChanged;
  final bool includeMargin;

  @override
  Widget build(BuildContext context) {
    final pad = Responsive.contentPadding(context);
    final options = CatalogProductSortX.visibleOptions(
      includeMargin: includeMargin,
    );
    final effective =
        options.contains(value) ? value : CatalogProductSort.purchasesDesc;
    final compact = Responsive.isLandscapeCompact(context);
    final fontSize = Responsive.fontSize(
      context,
      small: compact ? 11 : 12,
      large: compact ? 12 : 13,
    );

    return Padding(
      padding: EdgeInsets.fromLTRB(pad.left, 0, pad.right, compact ? 2 : 4),
      child: Row(
        children: [
          Icon(
            Icons.sort_rounded,
            size: compact ? 14 : 16,
            color: AppTheme.textSecondary,
          ),
          SizedBox(width: compact ? 4 : 8),
          Text(
            'Orden:',
            style: TextStyle(
              fontSize: fontSize,
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          SizedBox(width: compact ? 4 : 8),
          Expanded(
            child: Semantics(
              button: true,
              label: 'Ordenar catálogo: ${effective.label}',
              child: Container(
                height: compact ? 28 : 32,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  color: AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<CatalogProductSort>(
                    value: effective,
                    isExpanded: true,
                    isDense: true,
                    icon: Icon(
                      Icons.arrow_drop_down,
                      size: compact ? 16 : 18,
                      color: AppTheme.textSecondary,
                    ),
                    dropdownColor: AppTheme.softPanel,
                    style: TextStyle(
                      fontSize: fontSize,
                      color: AppTheme.textPrimary,
                    ),
                    items: options
                        .map(
                          (mode) => DropdownMenuItem(
                            value: mode,
                            child: Text(
                              mode.label,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: fontSize),
                            ),
                          ),
                        )
                        .toList(growable: false),
                    onChanged: (next) {
                      if (next != null) onChanged(next);
                    },
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
