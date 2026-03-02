import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../domain/models/load_planner_models.dart';

/// Floating info card for the selected box.
/// Positioned near the box, does NOT block the canvas.
class BoxInfoOverlay extends StatelessWidget {
  final LoadBox box;
  final int index;
  final VoidCallback onClose;

  const BoxInfoOverlay({
    super.key,
    required this.box,
    required this.index,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Positioned(
      right: 12,
      bottom: 12,
      child: Material(
        color: Colors.transparent,
        child: Container(
          width: 220,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppTheme.darkCard.withOpacity(0.95),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: AppTheme.neonBlue.withOpacity(0.3),
              width: 1,
            ),
            boxShadow: [
              BoxShadow(
                color: AppTheme.neonBlue.withOpacity(0.1),
                blurRadius: 16,
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header
              Row(
                children: [
                  Icon(
                    Icons.inventory_2,
                    size: 14,
                    color: AppTheme.neonBlue,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      box.label,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  GestureDetector(
                    onTap: onClose,
                    child: Icon(
                      Icons.close,
                      size: 16,
                      color: AppTheme.textTertiary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Divider(
                height: 1,
                color: AppTheme.borderColor,
              ),
              const SizedBox(height: 8),

              // Details
              _InfoRow(
                icon: Icons.tag,
                label: 'Articulo',
                value: box.articleCode,
              ),
              _InfoRow(
                icon: Icons.person,
                label: 'Cliente',
                value: box.clientCode,
              ),
              _InfoRow(
                icon: Icons.receipt,
                label: 'Orden',
                value: '#${box.orderNumber}',
              ),
              const SizedBox(height: 6),
              _InfoRow(
                icon: Icons.fitness_center,
                label: 'Peso',
                value: '${box.weight.toStringAsFixed(1)} kg',
                valueColor: AppTheme.neonGreen,
              ),
              _InfoRow(
                icon: Icons.straighten,
                label: 'Dims',
                value:
                    '${box.w.toStringAsFixed(0)}x${box.d.toStringAsFixed(0)}x${box.h.toStringAsFixed(0)} cm',
              ),
              _InfoRow(
                icon: Icons.place,
                label: 'Pos',
                value:
                    'X:${box.x.toStringAsFixed(0)} Y:${box.y.toStringAsFixed(0)} Z:${box.z.toStringAsFixed(0)}',
                valueColor: AppTheme.neonBlue,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 12, color: AppTheme.textTertiary),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: AppTheme.textTertiary,
              fontSize: 11,
            ),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: valueColor ?? AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
