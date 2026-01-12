/// DELIVERY ITEM LIST WIDGET
/// Lista interactiva de items para marcar entrega individual
/// Verde = Entregado, Rojo = No Entregado (con observaciones obligatorias)

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// Estado de entrega de un item individual
enum ItemDeliveryStatus {
  pending,    // Pendiente (gris)
  delivered,  // Entregado (verde)
  notDelivered, // No entregado (rojo)
}

/// Modelo de item de entrega
class DeliveryItem {
  final String id;
  final String code;
  final String description;
  final double quantityOrdered;
  double quantityDelivered;
  ItemDeliveryStatus status;
  String? observations;

  DeliveryItem({
    required this.id,
    required this.code,
    required this.description,
    required this.quantityOrdered,
    this.quantityDelivered = 0,
    this.status = ItemDeliveryStatus.pending,
    this.observations,
  });

  bool get isCompleteDelivery => quantityDelivered >= quantityOrdered;
  bool get requiresObservations => status == ItemDeliveryStatus.notDelivered;
}

/// Callback para cambios en items
typedef OnItemStatusChanged = void Function(
  DeliveryItem item,
  ItemDeliveryStatus newStatus,
  String? observations,
);

/// Widget de lista de items de entrega
class DeliveryItemList extends StatefulWidget {
  final List<DeliveryItem> items;
  final OnItemStatusChanged onItemChanged;
  final bool readOnly;

  const DeliveryItemList({
    super.key,
    required this.items,
    required this.onItemChanged,
    this.readOnly = false,
  });

  @override
  State<DeliveryItemList> createState() => _DeliveryItemListState();
}

class _DeliveryItemListState extends State<DeliveryItemList> {
  // Controller para observaciones cuando un item no se entrega
  final Map<String, TextEditingController> _obsControllers = {};

  @override
  void dispose() {
    for (final controller in _obsControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  TextEditingController _getObsController(DeliveryItem item) {
    if (!_obsControllers.containsKey(item.id)) {
      _obsControllers[item.id] = TextEditingController(text: item.observations);
    }
    return _obsControllers[item.id]!;
  }

  void _toggleItemStatus(DeliveryItem item) {
    if (widget.readOnly) return;
    
    setState(() {
      // Ciclo: pending -> delivered -> notDelivered -> pending
      switch (item.status) {
        case ItemDeliveryStatus.pending:
          item.status = ItemDeliveryStatus.delivered;
          item.quantityDelivered = item.quantityOrdered;
          widget.onItemChanged(item, ItemDeliveryStatus.delivered, null);
          break;
        case ItemDeliveryStatus.delivered:
          item.status = ItemDeliveryStatus.notDelivered;
          item.quantityDelivered = 0;
          // Mostrar diálogo para observaciones
          _showObservationsDialog(item);
          break;
        case ItemDeliveryStatus.notDelivered:
          item.status = ItemDeliveryStatus.pending;
          item.observations = null;
          widget.onItemChanged(item, ItemDeliveryStatus.pending, null);
          break;
      }
    });
  }

  Future<void> _showObservationsDialog(DeliveryItem item) async {
    final controller = _getObsController(item);
    controller.clear();
    
    final result = await showDialog<String?>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.error.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.warning_amber, color: AppTheme.error, size: 20),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Motivo de No Entrega',
                style: TextStyle(color: AppTheme.textPrimary, fontSize: 16),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${item.code} - ${item.description}',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Ingrese el motivo de la no entrega...',
                hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                filled: true,
                fillColor: AppTheme.darkBase,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.error),
                ),
              ),
              style: const TextStyle(color: AppTheme.textPrimary),
            ),
            const SizedBox(height: 8),
            Text(
              '* Las observaciones son obligatorias',
              style: TextStyle(color: AppTheme.error.withOpacity(0.7), fontSize: 11),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              // Si cancela, revertir a delivered
              item.status = ItemDeliveryStatus.delivered;
              item.quantityDelivered = item.quantityOrdered;
              Navigator.of(ctx).pop(null);
            },
            child: Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () {
              final obs = controller.text.trim();
              if (obs.isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Debe ingresar el motivo de la no entrega'),
                    backgroundColor: AppTheme.error,
                  ),
                );
                return;
              }
              Navigator.of(ctx).pop(obs);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.error,
              foregroundColor: Colors.white,
            ),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );

    if (result != null) {
      setState(() {
        item.observations = result;
        widget.onItemChanged(item, ItemDeliveryStatus.notDelivered, result);
      });
    } else {
      // Revertido a delivered
      setState(() {
        widget.onItemChanged(item, ItemDeliveryStatus.delivered, null);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inventory_2_outlined, size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
            const SizedBox(height: 12),
            Text(
              'Sin items para entregar',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: widget.items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final item = widget.items[index];
        return _buildItemCard(item);
      },
    );
  }

  Widget _buildItemCard(DeliveryItem item) {
    final Color statusColor;
    final IconData statusIcon;
    final String statusLabel;

    switch (item.status) {
      case ItemDeliveryStatus.delivered:
        statusColor = AppTheme.success;
        statusIcon = Icons.check_circle;
        statusLabel = 'Entregado';
        break;
      case ItemDeliveryStatus.notDelivered:
        statusColor = AppTheme.error;
        statusIcon = Icons.cancel;
        statusLabel = 'No Entregado';
        break;
      case ItemDeliveryStatus.pending:
        statusColor = Colors.orange;
        statusIcon = Icons.pending;
        statusLabel = 'Pendiente';
        break;
    }

    return GestureDetector(
      onTap: () => _toggleItemStatus(item),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: statusColor.withOpacity(0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: statusColor.withOpacity(0.3),
            width: 1.5,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                // Status icon
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.2),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(statusIcon, color: statusColor, size: 20),
                ),
                const SizedBox(width: 12),
                
                // Item info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.neonBlue.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              item.code,
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.neonBlue,
                              ),
                            ),
                          ),
                          const Spacer(),
                          Text(
                            statusLabel,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: statusColor,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item.description,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w500,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                
                // Quantity badge
                Container(
                  margin: const EdgeInsets.only(left: 12),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.darkBase,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    children: [
                      Text(
                        '${item.quantityDelivered.toInt()}/${item.quantityOrdered.toInt()}',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: statusColor,
                        ),
                      ),
                      const Text(
                        'uds',
                        style: TextStyle(fontSize: 9, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            
            // Observations (if not delivered)
            if (item.status == ItemDeliveryStatus.notDelivered && item.observations != null) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.error.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.error.withOpacity(0.2)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.note_alt, color: AppTheme.error.withOpacity(0.7), size: 14),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        item.observations!,
                        style: TextStyle(
                          fontSize: 11,
                          color: AppTheme.error.withOpacity(0.9),
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
