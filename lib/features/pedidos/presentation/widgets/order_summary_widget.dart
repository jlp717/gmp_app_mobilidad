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
import 'order_preview_sheet.dart';
import 'stock_alternatives_sheet.dart';
import '../dialogs/delete_line_dialog.dart';
import '../utils/pedidos_formatters.dart';

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
  final TextEditingController _discountCtrl = TextEditingController();
  final FocusNode _discountFocusNode = FocusNode();

  @override
  void dispose() {
    _obsCtrl.dispose();
    _discountCtrl.dispose();
    _discountFocusNode.dispose();
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
                      fontSize:
                          Responsive.fontSize(context, small: 13, large: 15),
                    ),
                  ),
          ),
          // Line count badge
          if (provider.hasLines)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '${provider.lineCount} lineas',
                style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize: Responsive.fontSize(context, small: 11, large: 12),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          // Clear cart button (Mejora 8)
          if (provider.hasLines)
            IconButton(
              icon: const Icon(Icons.delete_sweep_outlined,
                  color: AppTheme.error, size: 20),
              tooltip: 'Vaciar carrito',
              onPressed: () {
                showDialog<void>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    backgroundColor: AppTheme.darkSurface,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16)),
                    title: const Row(
                      children: [
                        Icon(Icons.warning_amber_rounded,
                            color: AppTheme.error, size: 22),
                        SizedBox(width: 8),
                        Text('Vaciar carrito',
                            style:
                                TextStyle(color: Colors.white, fontSize: 16)),
                      ],
                    ),
                    content: const Text(
                      '¿Seguro que quieres eliminar todas las líneas del pedido?',
                      style: TextStyle(color: Colors.white70),
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('Cancelar',
                            style: TextStyle(color: Colors.white54)),
                      ),
                      TextButton(
                        onPressed: () async {
                          provider.clearOrder();
                          await provider.loadPromotions();
                          Navigator.pop(ctx);
                        },
                        child: const Text('Vaciar',
                            style: TextStyle(
                                color: AppTheme.error,
                                fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildLinesList(BuildContext context, PedidosProvider provider) {
    return ReorderableListView.builder(
      scrollController: widget.scrollController,
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: provider.lines.length,
      buildDefaultDragHandles: true,
      onReorder: (oldIndex, newIndex) =>
          provider.reorderLines(oldIndex, newIndex),
      itemBuilder: (ctx, i) {
        final line = provider.lines[i];
        return OrderLineTile(
          key: ObjectKey(line),
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
            final qty =
                isBoxes ? line.cantidadEnvases + 1 : line.cantidadUnidades + 1;
            final error = provider.updateLine(i,
                cantidadEnvases: isBoxes ? qty : null,
                cantidadUnidades: isBoxes ? null : qty);
            if (error != null) {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                  content: Text(error,
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.bold)),
                  backgroundColor: AppTheme.error));
            }
          },
          onDecrement: () {
            final isBoxes = line.cantidadEnvases > 0;
            final currentQty =
                isBoxes ? line.cantidadEnvases : line.cantidadUnidades;
            if (currentQty <= 1) return;
            final qty = currentQty - 1;
            provider.updateLine(i,
                cantidadEnvases: isBoxes ? qty : null,
                cantidadUnidades: isBoxes ? null : qty);
          },
          onClaseLineaToggle: (clase) =>
              provider.updateLineClaseLinea(i, clase),
        );
      },
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.shopping_cart_outlined, color: Colors.white24, size: 56),
          const SizedBox(height: 12),
          Text(
            'Pedido vacio',
            style: TextStyle(
              color: Colors.white38,
              fontSize: Responsive.fontSize(context, small: 15, large: 17),
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Toca un producto para anadirlo',
            style: TextStyle(
              color: Colors.white24,
              fontSize: Responsive.fontSize(context, small: 12, large: 14),
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
    final totalShown = provider.globalDiscountPct > 0
        ? provider.totalConDescuento
        : provider.totalImporte;

    if (!_discountFocusNode.hasFocus) {
      final discountText = provider.globalDiscountPct > 0
          ? (provider.globalDiscountPct % 1 == 0
              ? provider.globalDiscountPct.toStringAsFixed(0)
              : provider.globalDiscountPct.toStringAsFixed(1))
          : '';
      if (_discountCtrl.text != discountText) {
        _discountCtrl.value = TextEditingValue(
          text: discountText,
          selection: TextSelection.collapsed(offset: discountText.length),
        );
      }
    }

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
              prefixIcon: const Icon(Icons.comment_outlined,
                  color: Colors.white54, size: 18),
              filled: true,
              fillColor: AppTheme.darkCard,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 12),
          // C5 — Global discount
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              children: [
                const Icon(Icons.discount_outlined,
                    color: Colors.white54, size: 16),
                const SizedBox(width: 6),
                Text(
                  'Descuento:',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize:
                        Responsive.fontSize(context, small: 12, large: 13),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 64,
                  child: TextField(
                    controller: _discountCtrl,
                    focusNode: _discountFocusNode,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    onChanged: (v) {
                      final normalized = v.replaceAll(',', '.').trim();
                      provider
                          .setGlobalDiscount(double.tryParse(normalized) ?? 0);
                    },
                    decoration: InputDecoration(
                      suffixText: '%',
                      suffixStyle:
                          const TextStyle(color: Colors.white54, fontSize: 12),
                      filled: true,
                      fillColor: AppTheme.darkCard,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 6),
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide:
                            const BorderSide(color: AppTheme.borderColor),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide:
                            const BorderSide(color: AppTheme.borderColor),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: AppTheme.neonBlue),
                      ),
                    ),
                  ),
                ),
                const Spacer(),
                if (provider.globalDiscountPct > 0) ...[
                  Text(
                    PedidosFormatters.money(provider.totalConDescuento),
                    style: TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize:
                          Responsive.fontSize(context, small: 14, large: 15),
                    ),
                  ),
                  Text(
                    ' (-${PedidosFormatters.money(provider.totalDescuento)})',
                    style: const TextStyle(color: AppTheme.error, fontSize: 11),
                  ),
                ],
              ],
            ),
          ),
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
                PedidosFormatters.money(totalShown),
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
          // C3 — IVA breakdown
          if (provider.ivaBreakdown.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Wrap(
                alignment: WrapAlignment.center,
                spacing: 8,
                runSpacing: 4,
                children: [
                  Text(
                    'Base: ${PedidosFormatters.money(provider.totalBase)}',
                    style: const TextStyle(color: Colors.white38, fontSize: 10),
                  ),
                  Text(
                    'IVA: ${PedidosFormatters.money(provider.totalIva)}',
                    style: const TextStyle(color: Colors.white38, fontSize: 10),
                  ),
                  ...provider.ivaBreakdown.entries.map((e) => Text(
                        'IVA ${(e.key * 100).toStringAsFixed(0)}%: ${PedidosFormatters.money(e.value)}',
                        style: const TextStyle(
                            color: Colors.white38, fontSize: 10),
                      )),
                ],
              ),
            ),
          const SizedBox(height: 6),
          // Auto-save indicator
          if (provider.lastAutoSaved != null || provider.isDirty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    provider.isDirty
                        ? Icons.edit_outlined
                        : Icons.check_circle_outline,
                    color:
                        provider.isDirty ? Colors.white38 : AppTheme.neonGreen,
                    size: 12,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    provider.isDirty
                        ? 'Sin guardar...'
                        : 'Guardado ${_formatTime(provider.lastAutoSaved!)}',
                    style: TextStyle(
                      color: provider.isDirty
                          ? Colors.white38
                          : AppTheme.neonGreen.withOpacity(0.7),
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
          // E1 — Preview before confirm
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton.icon(
              onPressed: provider.isSaving
                  ? null
                  : () => _showOrderPreview(context, provider),
              icon: provider.isSaving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.darkBase,
                      ),
                    )
                  : const Icon(Icons.preview_outlined),
              label: Text(
                provider.isSaving ? 'Guardando...' : 'Confirmar pedido',
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

  String _formatTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  void _showEditLineDialog(BuildContext context, PedidosProvider provider,
      OrderLine line, int index) {
    final isDual = line.unidadesCaja > 1 &&
        line.unidadesFraccion > 0 &&
        line.unidadesFraccion < line.unidadesCaja;
    String formatQty(double v) => v
        .toStringAsFixed(2)
        .replaceAll(RegExp(r'\.00$'), '')
        .replaceAll(RegExp(r'0$'), '')
        .replaceAll(RegExp(r'\.$'), '');

    final qtyController = TextEditingController(
      text: formatQty(line.cantidadEnvases > 0
          ? line.cantidadEnvases
          : line.cantidadUnidades),
    );
    final cajasController = TextEditingController(
      text: line.cantidadEnvases > 0 ? formatQty(line.cantidadEnvases) : '',
    );
    final unidadesController = TextEditingController(
      text: line.cantidadUnidades > 0 ? formatQty(line.cantidadUnidades) : '',
    );
    final priceController =
        TextEditingController(text: line.precioVenta.toStringAsFixed(3));

    final unitLabel = Product.unitLabel(line.unidadMedida);
    final equivText = line.unidadesCaja > 1
        ? '1 cj = ${formatQty(line.unidadesCaja)} uds'
        : null;

    showDialog<void>(
      context: context,
      barrierColor: Colors.black54,
      builder: (ctx) {
        return Dialog(
          backgroundColor: AppTheme.darkSurface,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          insetPadding:
              const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
          child: SingleChildScrollView(
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
                // Header with close
                Row(
                  children: [
                    const Icon(Icons.edit_outlined,
                        color: AppTheme.neonBlue, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Editar linea',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: Responsive.fontSize(context,
                              small: 15, large: 17),
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(ctx),
                      icon: const Icon(Icons.close,
                          color: Colors.white54, size: 20),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                // Product name + code
                Text(
                  line.descripcion,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize:
                        Responsive.fontSize(context, small: 14, large: 16),
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  line.codigoArticulo,
                  style: TextStyle(
                    color: AppTheme.neonBlue,
                    fontSize:
                        Responsive.fontSize(context, small: 11, large: 13),
                  ),
                ),
                // Equivalence info
                if (equivText != null) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '$equivText  ·  $unitLabel',
                      style: const TextStyle(
                        color: AppTheme.neonBlue,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                if (isDual) ...[
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: cajasController,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold),
                          textAlign: TextAlign.center,
                          decoration: InputDecoration(
                            labelText: 'Cajas',
                            labelStyle: const TextStyle(color: Colors.white70),
                            filled: true,
                            fillColor: AppTheme.darkCard,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.neonGreen)),
                          ),
                          onChanged: (val) {
                            final cur =
                                double.tryParse(val.replaceAll(',', '.')) ?? 0;
                            unidadesController.text =
                                formatQty(cur * line.unidadesCaja);
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: unidadesController,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold),
                          textAlign: TextAlign.center,
                          decoration: InputDecoration(
                            labelText:
                                'Uds (${formatQty(line.unidadesCaja)} U/C)',
                            labelStyle: const TextStyle(color: Colors.white70),
                            filled: true,
                            fillColor: AppTheme.darkCard,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide:
                                    const BorderSide(color: AppTheme.neonBlue)),
                          ),
                          onChanged: (val) {
                            final cur =
                                double.tryParse(val.replaceAll(',', '.')) ?? 0;
                            cajasController.text =
                                formatQty(cur / line.unidadesCaja);
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: priceController,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Precio',
                      suffixText: ' \u20AC',
                      labelStyle: const TextStyle(color: Colors.white70),
                      filled: true,
                      fillColor: AppTheme.darkCard,
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor)),
                      enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor)),
                      focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.neonBlue)),
                    ),
                  ),
                ] else ...[
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: qtyController,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold),
                          textAlign: TextAlign.center,
                          decoration: InputDecoration(
                            labelText: 'Cantidad ($unitLabel)',
                            labelStyle: const TextStyle(color: Colors.white70),
                            filled: true,
                            fillColor: AppTheme.darkCard,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide:
                                    const BorderSide(color: AppTheme.neonBlue)),
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
                            suffixText: ' \u20AC',
                            labelStyle: const TextStyle(color: Colors.white70),
                            filled: true,
                            fillColor: AppTheme.darkCard,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: AppTheme.borderColor)),
                            focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide:
                                    const BorderSide(color: AppTheme.neonBlue)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                if (line.precioMinimo > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Precio minimo: ${PedidosFormatters.money(line.precioMinimo, decimals: 3)}',
                      style: TextStyle(
                        color: Colors.white54,
                        fontSize:
                            Responsive.fontSize(context, small: 10, large: 12),
                      ),
                    ),
                  ),
                const SizedBox(height: 18),
                // Action buttons
                Row(
                  children: [
                    // Delete line
                    Expanded(
                      child: SizedBox(
                        height: 46,
                        child: OutlinedButton.icon(
                          onPressed: () {
                            provider.removeLine(index);
                            Navigator.pop(ctx);
                          },
                          icon: const Icon(Icons.delete_outline, size: 16),
                          label: const Text('ELIMINAR',
                              style: TextStyle(fontSize: 13)),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppTheme.error,
                            side: const BorderSide(color: AppTheme.error),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    // Save
                    Expanded(
                      flex: 2,
                      child: SizedBox(
                        height: 46,
                        child: ElevatedButton.icon(
                          onPressed: () {
                            final price = double.tryParse(priceController.text
                                    .replaceAll(',', '.')) ??
                                0;

                            if (isDual) {
                              final c = double.tryParse(cajasController.text
                                      .replaceAll(',', '.')) ??
                                  0;
                              final u = double.tryParse(unidadesController.text
                                      .replaceAll(',', '.')) ??
                                  0;
                              if (c <= 0 && u <= 0) return;
                              provider.updateLine(
                                index,
                                cantidadEnvases: c,
                                cantidadUnidades: u,
                                precioVenta: price,
                              );
                            } else {
                              final qty = double.tryParse(qtyController.text
                                      .replaceAll(',', '.')) ??
                                  0;
                              if (qty <= 0) return;
                              final isBoxes = line.cantidadEnvases > 0;
                              provider.updateLine(
                                index,
                                cantidadEnvases: isBoxes ? qty : null,
                                cantidadUnidades: isBoxes ? null : qty,
                                precioVenta: price,
                              );
                            }
                            Navigator.pop(ctx);
                          },
                          icon: const Icon(Icons.check, size: 18),
                          label: const Text('GUARDAR',
                              style: TextStyle(
                                  fontSize: 14, fontWeight: FontWeight.bold)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neonBlue,
                            foregroundColor: AppTheme.darkBase,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
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

    final result = await provider.confirmOrder(widget.vendedorCode,
        observaciones: _obsCtrl.text.trim());
    
    if (result != null && context.mounted) {
      // Check if order was blocked due to stock issues
      if (result['blocked'] == true) {
        // Show stock alternatives sheet
        _showStockAlternatives(context, result);
        return;
      }
      
      // Success - clear forms and show success message
      _obsCtrl.clear();
      _discountCtrl.clear();
      await provider.loadPromotions();
      // Refresh orders list + KPIs
      provider.loadOrders(
        vendedorCodes: widget.vendedorCode,
        forceRefresh: true,
      );
      provider.loadOrderStats(
        vendedorCodes: widget.vendedorCode,
        forceRefresh: true,
      );
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Pedido #${result['numeroPedido'] ?? ''} confirmado correctamente'),
          backgroundColor: AppTheme.neonGreen,
        ),
      );
    }
  }

  // Show stock alternatives when order is blocked
  void _showStockAlternatives(BuildContext context, Map<String, dynamic> result) {
    final stockWarnings = result['stockWarnings'] as List? ?? [];
    final alternatives = result['alternatives'] as List? ?? [];

    showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _AlternativesDialog(
        stockWarnings: stockWarnings,
        alternatives: alternatives,
        onAddToCart: (productCode, productName, quantity, unit) async {
          Navigator.pop(context, {'code': productCode, 'qty': quantity, 'unit': unit});
        },
      ),
    ).then((selected) async {
      if (selected != null && selected['code'] != null) {
        final provider = context.read<PedidosProvider>();
        final productCode = selected['code'] as String;
        final quantity = selected['qty'] as double;
        final unit = selected['unit'] as String;

        try {
          final productDetail = await PedidosService.getProductDetail(productCode);
          final product = productDetail.product;

          final isBoxes = unit == 'CAJAS';
          final error = provider.addLine(
            product,
            isBoxes ? quantity : 0,
            isBoxes ? 0 : quantity,
            unit,
            product.bestPrice,
          );

          if (error != null && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(error, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                backgroundColor: AppTheme.error,
              ),
            );
          } else if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('✅ ${product.name} añadido al carrito'),
                backgroundColor: AppTheme.neonGreen,
                duration: const Duration(seconds: 2),
              ),
            );
          }
        } catch (e) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Error al añadir producto: $e'),
                backgroundColor: AppTheme.error,
              ),
            );
          }
        }
      }
    });
  }

  // E1 — Preview sheet before confirm (Amazon-style DraggableScrollableSheet)
  void _showOrderPreview(BuildContext context, PedidosProvider provider) {
    if (!provider.hasClient) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Selecciona un cliente primero'),
            backgroundColor: AppTheme.error),
      );
      return;
    }

    showOrderPreviewSheet(
      context: context,
      provider: provider,
      vendedorCode: widget.vendedorCode,
      onConfirm: (observaciones) async {
        final result = await provider.confirmOrder(
          widget.vendedorCode,
          observaciones:
              observaciones.isNotEmpty ? observaciones : _obsCtrl.text.trim(),
        );
        if (result != null && context.mounted) {
          _obsCtrl.clear();
          _discountCtrl.clear();
          await provider.loadPromotions();
          provider.loadOrders(
            vendedorCodes: widget.vendedorCode,
            forceRefresh: true,
          );
          provider.loadOrderStats(
            vendedorCodes: widget.vendedorCode,
            forceRefresh: true,
          );
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                  'Pedido #${result['numeroPedido'] ?? ''} confirmado correctamente'),
              backgroundColor: AppTheme.neonGreen,
            ),
          );
        }
        return result;
      },
    );
  }
}

// ============================================================================
// ALTERNATIVES DIALOG - Stock alternatives selector
// ============================================================================

class _AlternativesDialog extends StatefulWidget {
  final List<dynamic> stockWarnings;
  final List<dynamic> alternatives;
  final Function(String productCode, String productName, double quantity, String unit) onAddToCart;

  const _AlternativesDialog({
    Key? key,
    required this.stockWarnings,
    required this.alternatives,
    required this.onAddToCart,
  }) : super(key: key);

  @override
  State<_AlternativesDialog> createState() => _AlternativesDialogState();
}

class _AlternativesDialogState extends State<_AlternativesDialog> {
  String? _selectedProductCode;
  double _quantity = 1;
  String _unit = 'CAJAS';
  Map<String, dynamic>? _selectedProduct;
  final _qtyController = TextEditingController();

  @override
  void dispose() {
    _qtyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_selectedProduct != null && _qtyController.text.isEmpty) {
      _qtyController.text = (_selectedProduct!['stockEnvases'] ?? 1).toString();
    }

    return Dialog(
      backgroundColor: AppTheme.darkSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 500, maxHeight: 600),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                color: AppTheme.error,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(16),
                  topRight: Radius.circular(16),
                ),
              ),
              child: const Row(
                children: [
                  Icon(Icons.warning_amber_rounded, color: Colors.white, size: 28),
                  SizedBox(width: 12),
                  Text(
                    'Stock Insuficiente',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            // Content
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Products without stock
                    if (widget.stockWarnings.isNotEmpty) ...[
                      const Text(
                        'Productos sin stock:',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ...widget.stockWarnings.map((w) => Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppTheme.error.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.error.withOpacity(0.3)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, color: AppTheme.error, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    w['description'] ?? w['product'] ?? 'Producto',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w500,
                                      fontSize: 13,
                                    ),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'Solicitado: ${w['requested']} ${w['unit'] ?? ''} | Disponible: ${w['available']} ${w['unit'] ?? ''}',
                                    style: const TextStyle(
                                      color: Colors.white54,
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      )),
                      const SizedBox(height: 16),
                    ],
                    // Alternatives
                    if (widget.alternatives.isNotEmpty) ...[
                      const Text(
                        'Alternativas con stock:',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ...widget.alternatives.expand((alt) {
                        final alternativesList = alt['alternatives'] as List? ?? [];
                        return alternativesList.map((prod) {
                          final isSelected = _selectedProductCode == prod['code'];
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                _selectedProductCode = prod['code'];
                                _selectedProduct = prod;
                                _quantity = (prod['stockEnvases'] ?? 1).toDouble();
                                _unit = 'CAJAS';
                                _qtyController.text = _quantity.toStringAsFixed(0);
                              });
                            },
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? AppTheme.neonGreen.withOpacity(0.15)
                                    : AppTheme.darkCard,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: isSelected
                                      ? AppTheme.neonGreen
                                      : AppTheme.borderColor,
                                  width: isSelected ? 2 : 1,
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Icon(
                                        isSelected
                                            ? Icons.check_circle
                                            : Icons.circle_outlined,
                                        color: isSelected
                                            ? AppTheme.neonGreen
                                            : Colors.white54,
                                        size: 20,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          prod['name'] ?? prod['code'] ?? 'Producto',
                                          style: TextStyle(
                                            color: Colors.white,
                                            fontWeight: isSelected
                                                ? FontWeight.bold
                                                : FontWeight.w500,
                                            fontSize: 13,
                                          ),
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 4,
                                        ),
                                        decoration: BoxDecoration(
                                          color: AppTheme.neonBlue.withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          '${(prod['stockEnvases'] ?? 0).toStringAsFixed(0)} cajas',
                                          style: const TextStyle(
                                            color: AppTheme.neonBlue,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (prod['precio'] != null && (prod['precio'] as num).toDouble() > 0)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 6, left: 28),
                                      child: Text(
                                        '${(prod['precio'] as num).toDouble().toStringAsFixed(2)} €/caja',
                                        style: const TextStyle(
                                          color: Colors.white54,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          );
                        });
                      }),
                      // Add to cart section
                      if (_selectedProduct != null) ...[
                        const SizedBox(height: 16),
                        const Divider(color: AppTheme.borderColor),
                        const SizedBox(height: 12),
                        const Text(
                          'Cantidad a añadir:',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _qtyController,
                                keyboardType: TextInputType.number,
                                style: const TextStyle(color: Colors.white, fontSize: 16),
                                textAlign: TextAlign.center,
                                decoration: InputDecoration(
                                  labelText: 'Cajas',
                                  labelStyle: const TextStyle(color: Colors.white70),
                                  filled: true,
                                  fillColor: AppTheme.darkCard,
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: AppTheme.borderColor),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: AppTheme.borderColor),
                                  ),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(color: AppTheme.neonGreen),
                                  ),
                                ),
                                onChanged: (val) {
                                  final qty = double.tryParse(val) ?? 1;
                                  final maxStock = (_selectedProduct!['stockEnvases'] ?? 1).toDouble();
                                  setState(() {
                                    _quantity = qty.clamp(1, maxStock).toDouble();
                                    _unit = 'CAJAS';
                                  });
                                },
                              ),
                            ),
                          ],
                        ),
                      ],
                    ] else ...[
                      const Center(
                        child: Padding(
                          padding: EdgeInsets.all(32),
                          child: Column(
                            children: [
                              Icon(Icons.inventory_2_outlined, color: Colors.white54, size: 48),
                              SizedBox(height: 16),
                              Text(
                                'No hay alternativas disponibles',
                                style: TextStyle(color: Colors.white54, fontSize: 14),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            // Actions
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                color: AppTheme.darkCard,
                borderRadius: BorderRadius.only(
                  bottomLeft: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white70,
                        side: const BorderSide(color: AppTheme.borderColor),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      child: const Text(
                        'Cerrar',
                        style: TextStyle(fontSize: 14),
                      ),
                    ),
                  ),
                  if (_selectedProduct != null) ...[
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: ElevatedButton.icon(
                        onPressed: _quantity > 0
                            ? () => widget.onAddToCart(
                                  _selectedProductCode!,
                                  _selectedProduct!['name'] ?? _selectedProductCode!,
                                  _quantity,
                                  _unit,
                                )
                            : null,
                        icon: const Icon(Icons.add_shopping_cart, size: 18),
                        label: const Text(
                          'AÑADIR AL CARRITO',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.neonGreen,
                          foregroundColor: AppTheme.darkBase,
                          disabledBackgroundColor: AppTheme.neonGreen.withOpacity(0.3),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
