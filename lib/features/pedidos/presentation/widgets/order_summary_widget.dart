/// Order Summary Widget
/// ====================
/// Cart/current order panel showing client header, line items, totals, and confirm button

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import '../../providers/pedidos_provider.dart';
import 'order_line_tile.dart';
import '../dialogs/delete_line_dialog.dart';

class OrderSummaryWidget extends StatefulWidget {
  final String vendedorCode;
  final ScrollController? scrollController;

  const OrderSummaryWidget({
    Key? key,
    required this.vendedorCode,
    this.scrollController,
  }) : super(key: key);

  @override
  State<OrderSummaryWidget> createState() => _OrderSummaryWidgetState();
}

class _OrderSummaryWidgetState extends State<OrderSummaryWidget> {
  final TextEditingController _obsCtrl = TextEditingController();

  @override
  void dispose() {
    _obsCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PedidosProvider>();

    return Container(
      color: AppTheme.darkBase,
      child: Column(
        children: [
          // Client header
          _buildClientHeader(context, provider),
          // Lines list
          Expanded(
            child: provider.hasLines
                ? _buildLinesList(context, provider)
                : _buildEmptyState(context),
          ),
          // Bottom summary bar
          if (provider.hasLines) _buildSummaryBar(context, provider),
        ],
      ),
    );
  }

  Widget _buildClientHeader(BuildContext context, PedidosProvider provider) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: const BoxDecoration(
        color: AppTheme.darkSurface,
        border: Border(
          bottom: BorderSide(color: AppTheme.borderColor, width: 0.5),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.storefront_outlined,
            color: provider.hasClient ? AppTheme.neonBlue : Colors.white38,
            size: 20,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: provider.hasClient
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        provider.clientName ?? '',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                          fontSize: Responsive.fontSize(context,
                              small: 13, large: 15),
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        provider.clientCode ?? '',
                        style: TextStyle(
                          color: AppTheme.neonBlue,
                          fontSize: Responsive.fontSize(context,
                              small: 11, large: 12),
                        ),
                      ),
                    ],
                  )
                : Text(
                    'Seleccionar cliente',
                    style: TextStyle(
                      color: Colors.white38,
                      fontSize: Responsive.fontSize(context,
                          small: 13, large: 15),
                    ),
                  ),
          ),
          // Line count badge
          if (provider.hasLines)
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '${provider.lineCount} lineas',
                style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize:
                      Responsive.fontSize(context, small: 11, large: 12),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildLinesList(BuildContext context, PedidosProvider provider) {
    return ListView.builder(
      controller: widget.scrollController,
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: provider.lines.length,
      itemBuilder: (ctx, i) {
        final line = provider.lines[i];
        return OrderLineTile(
          line: line,
          index: i,
          onDismissed: () async {
            final confirm = await DeleteLineDialog.show(
              context,
              productName: line.descripcion,
            );
            if (confirm == true) {
              provider.removeLine(i);
            }
          },
          onTap: () {
            _showEditLineDialog(context, provider, line, i);
          },
          onIncrement: () {
            final isBoxes = line.cantidadEnvases > 0;
            final qty = isBoxes ? line.cantidadEnvases + 1 : line.cantidadUnidades + 1;
            final error = provider.updateLine(
               i, 
               cantidadEnvases: isBoxes ? qty : null, 
               cantidadUnidades: isBoxes ? null : qty
            );
            if (error != null) {
               ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)), backgroundColor: AppTheme.error));
            }
          },
          onDecrement: () {
            final isBoxes = line.cantidadEnvases > 0;
            final currentQty = isBoxes ? line.cantidadEnvases : line.cantidadUnidades;
            if (currentQty <= 1) return; // Prevent 0, use swipe to delete
            final qty = currentQty - 1;
            provider.updateLine(
               i,
               cantidadEnvases: isBoxes ? qty : null, 
               cantidadUnidades: isBoxes ? null : qty
            );
          },
        );
      },
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.shopping_cart_outlined,
              color: Colors.white24, size: 56),
          const SizedBox(height: 12),
          Text(
            'Pedido vacio',
            style: TextStyle(
              color: Colors.white38,
              fontSize:
                  Responsive.fontSize(context, small: 15, large: 17),
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Toca un producto para anadirlo',
            style: TextStyle(
              color: Colors.white24,
              fontSize:
                  Responsive.fontSize(context, small: 12, large: 14),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryBar(BuildContext context, PedidosProvider provider) {
    final margin = provider.porcentajeMargen;
    final marginColor = margin >= 15
        ? AppTheme.neonGreen
        : margin >= 5
            ? Colors.orange
            : AppTheme.error;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        border: const Border(
          top: BorderSide(color: AppTheme.borderColor, width: 0.5),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Observaciones field
          TextField(
            controller: _obsCtrl,
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Añadir observaciones al pedido...',
              hintStyle: const TextStyle(color: Colors.white38),
              prefixIcon: const Icon(Icons.comment_outlined, color: Colors.white54, size: 18),
              filled: true,
              fillColor: AppTheme.darkCard,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 12),
          // Stats row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildStatItem(
                context,
                '${provider.totalEnvases.toStringAsFixed(0)} cajas',
                Icons.all_inbox_outlined,
                Colors.white70,
              ),
              _buildStatItem(
                context,
                '${provider.totalUnidades.toStringAsFixed(0)} uds',
                Icons.widgets_outlined,
                Colors.white70,
              ),
              _buildStatItem(
                context,
                '\u20AC${provider.totalImporte.toStringAsFixed(2)}',
                Icons.euro,
                AppTheme.neonGreen,
              ),
              _buildStatItem(
                context,
                '${margin.toStringAsFixed(1)}%',
                Icons.trending_up,
                marginColor,
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Confirm button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton.icon(
              onPressed: provider.isSaving
                  ? null
                  : () => _onConfirm(context, provider),
              icon: provider.isSaving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.darkBase,
                      ),
                    )
                  : const Icon(Icons.check_circle),
              label: Text(
                provider.isSaving ? 'Guardando...' : 'Definitivo',
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonGreen,
                foregroundColor: AppTheme.darkBase,
                disabledBackgroundColor: AppTheme.neonGreen.withOpacity(0.5),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
          // Error
          if (provider.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                provider.error!,
                style: const TextStyle(color: AppTheme.error, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildStatItem(
      BuildContext context, String value, IconData icon, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.w600,
            fontSize: Responsive.fontSize(context, small: 12, large: 14),
          ),
        ),
      ],
    );
  }

  void _showEditLineDialog(BuildContext context, PedidosProvider provider,
      OrderLine line, int index) {
    final qtyController = TextEditingController(
      text: (line.cantidadEnvases > 0
              ? line.cantidadEnvases
              : line.cantidadUnidades)
          .toStringAsFixed(0),
    );
    final priceController =
        TextEditingController(text: line.precioVenta.toStringAsFixed(3));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                line.descripcion,
                style: TextStyle(
                  color: Colors.white,
                  fontSize:
                      Responsive.fontSize(context, small: 16, large: 18),
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                line.codigoArticulo,
                style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize:
                      Responsive.fontSize(context, small: 12, large: 14),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: qtyController,
                      keyboardType: const TextInputType.numberWithOptions(
                          decimal: true),
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Cantidad',
                        labelStyle: const TextStyle(color: Colors.white70),
                        filled: true,
                        fillColor: AppTheme.darkCard,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.neonBlue),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: priceController,
                      keyboardType: const TextInputType.numberWithOptions(
                          decimal: true),
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'Precio',
                        prefixText: '\u20AC ',
                        prefixStyle:
                            const TextStyle(color: AppTheme.neonGreen),
                        labelStyle: const TextStyle(color: Colors.white70),
                        filled: true,
                        fillColor: AppTheme.darkCard,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.neonBlue),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              if (line.precioMinimo > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'Precio minimo: \u20AC${line.precioMinimo.toStringAsFixed(3)}',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize:
                          Responsive.fontSize(context, small: 10, large: 12),
                    ),
                  ),
                ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton.icon(
                  onPressed: () {
                    final qty =
                        double.tryParse(qtyController.text) ?? 0;
                    final price =
                        double.tryParse(priceController.text) ?? 0;
                    if (qty <= 0) return;

                    final isBoxes = line.cantidadEnvases > 0;

                    provider.updateLine(
                      index,
                      cantidadEnvases: isBoxes ? qty : null,
                      cantidadUnidades: isBoxes ? null : qty,
                      precioVenta: price,
                    );
                    Navigator.pop(ctx);
                  },
                  icon: const Icon(Icons.save),
                  label: const Text('Guardar cambios'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: AppTheme.darkBase,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    textStyle:
                        const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _onConfirm(
      BuildContext context, PedidosProvider provider) async {
    if (!provider.hasClient) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selecciona un cliente primero'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    final result = await provider.confirmOrder(widget.vendedorCode, observaciones: _obsCtrl.text.trim());
    if (result != null && context.mounted) {
      _obsCtrl.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Pedido #${result['numeroPedido'] ?? ''} creado correctamente'),
          backgroundColor: AppTheme.neonGreen,
        ),
      );
    }
  }
}
