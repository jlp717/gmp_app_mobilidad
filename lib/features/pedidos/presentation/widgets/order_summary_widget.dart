/// Order Summary Widget
/// ====================
/// Cart/current order panel showing client header, line items, totals, and confirm button
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/dialogs/delete_line_dialog.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_line_tile.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_preview_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class OrderSummaryWidget extends ConsumerStatefulWidget {
  const OrderSummaryWidget({
    required this.vendedorCode,
    super.key,
    this.scrollController,
    this.onOrderConfirmed,
  });
  final String vendedorCode;
  final ScrollController? scrollController;
  final ValueChanged<Map<String, dynamic>>? onOrderConfirmed;

  @override
  ConsumerState<OrderSummaryWidget> createState() => _OrderSummaryWidgetState();
}

class _OrderSummaryWidgetState extends ConsumerState<OrderSummaryWidget> {
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

  bool _lineUsesBoxes(OrderLine line) {
    final unit = line.unidadMedida.trim().toUpperCase();
    return unit.isEmpty || unit == 'CAJAS';
  }

  double _primaryLineQuantity(OrderLine line) =>
      _lineUsesBoxes(line) ? line.cantidadEnvases : line.cantidadUnidades;

  @override
  Widget build(BuildContext context) {
    ref.watch(pedidosProvider.select((p) => (
          p.hasClient,
          p.hasLines,
          p.clientCode,
          p.clientName,
          p.lines.length,
          p.totalImporte,
          p.totalConDescuento,
          p.globalDiscountPct,
          p.isMarginVisible,
        )));
    final provider = ref.read(pedidosProvider);

    return ColoredBox(
      color: AppTheme.inkSurface,
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
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(color: AppTheme.borderColor, width: 0.5),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.storefront_outlined,
            color: provider.hasClient ? AppTheme.info : AppTheme.textTertiary,
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
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: Responsive.fontSize(
                            context,
                            small: 13,
                            large: 15,
                          ),
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        provider.clientCode ?? '',
                        style: TextStyle(
                          color: AppTheme.info,
                          fontSize: Responsive.fontSize(
                            context,
                            small: 11,
                            large: 12,
                          ),
                        ),
                      ),
                    ],
                  )
                : Text(
                    'Seleccionar cliente',
                    style: TextStyle(
                      color: AppTheme.textTertiary,
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
                color: AppTheme.info.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '${provider.lineCount} lineas',
                style: TextStyle(
                  color: AppTheme.info,
                  fontSize: Responsive.fontSize(context, small: 11, large: 12),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          // Clear cart button (Mejora 8)
          if (provider.hasLines)
            IconButton(
              icon: const Icon(
                Icons.delete_sweep_outlined,
                color: AppTheme.error,
                size: 20,
              ),
              tooltip: 'Vaciar carrito',
              onPressed: () {
                showDialog<void>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    backgroundColor: AppTheme.raisedSurface,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    title: Row(
                      children: [
                        Icon(
                          Icons.warning_amber_rounded,
                          color: AppTheme.error,
                          size: 22,
                        ),
                        SizedBox(width: 8),
                        Text(
                          'Vaciar carrito',
                          style: TextStyle(
                              color: AppTheme.textPrimary, fontSize: 16),
                        ),
                      ],
                    ),
                    content: Text(
                      '¿Seguro que quieres eliminar todas las líneas del pedido?',
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: Text(
                          'Cancelar',
                          style: TextStyle(color: AppTheme.textTertiary),
                        ),
                      ),
                      TextButton(
                        onPressed: () async {
                          provider.clearOrder();
                          await provider.loadPromotions();
                          // Guard: si el diálogo se cerró durante el await
                          // (barrier), un pop extra cerraría la pantalla.
                          if (ctx.mounted) Navigator.pop(ctx);
                        },
                        child: const Text(
                          'Vaciar',
                          style: TextStyle(
                            color: AppTheme.error,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
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
      onReorder: (oldIndex, newIndex) =>
          provider.reorderLines(oldIndex, newIndex),
      itemBuilder: (ctx, i) {
        final line = provider.lines[i];
        return OrderLineTile(
          // Stable key per article: the cart deduplicates by codigoArticulo,
          // so identity follows the code. ObjectKey(line) changed every
          // key on each updateLine and repainted the whole list per tap.
          key: ValueKey(line.codigoArticulo),
          line: line,
          index: i,
          onDismissed: () async {
            final confirm = await DeleteLineDialog.show(
              context,
              productName: line.descripcion,
            );
            if (confirm ?? false) {
              provider.removeLine(i);
            }
          },
          onTap: () {
            _showEditLineDialog(context, provider, line, i);
          },
          onIncrement: () {
            final isBoxes = _lineUsesBoxes(line);
            final qty =
                isBoxes ? line.cantidadEnvases + 1 : line.cantidadUnidades + 1;
            final error = provider.updateLine(
              i,
              cantidadEnvases: isBoxes ? qty : null,
              cantidadUnidades: isBoxes ? null : qty,
            );
            if (error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    error,
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  backgroundColor: AppTheme.error,
                ),
              );
            }
          },
          onDecrement: () {
            final isBoxes = _lineUsesBoxes(line);
            final currentQty =
                isBoxes ? line.cantidadEnvases : line.cantidadUnidades;
            if (currentQty <= 1) return;
            final qty = currentQty - 1;
            provider.updateLine(
              i,
              cantidadEnvases: isBoxes ? qty : null,
              cantidadUnidades: isBoxes ? null : qty,
            );
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
          Icon(
            Icons.shopping_cart_outlined,
            color: AppTheme.borderColor,
            size: 56,
          ),
          const SizedBox(height: 12),
          Text(
            'Pedido vacio',
            style: TextStyle(
              color: AppTheme.textTertiary,
              fontSize: Responsive.fontSize(context, small: 15, large: 17),
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Toca un producto para anadirlo',
            style: TextStyle(
              color: AppTheme.borderColor,
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
        ? AppTheme.success
        : margin >= 5
            ? AppTheme.warning
            : AppTheme.error;
    final totalShown = provider.totalConIva;

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
        color: AppTheme.raisedSurface,
        border: Border(
          top: BorderSide(color: AppTheme.borderColor, width: 0.5),
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.textPrimary.withValues(alpha: 0.3),
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
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Añadir observaciones al pedido...',
              hintStyle: TextStyle(color: AppTheme.textTertiary),
              prefixIcon: Icon(
                Icons.comment_outlined,
                color: AppTheme.textTertiary,
                size: 18,
              ),
              filled: true,
              fillColor: AppTheme.softPanel,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          // C5 – Global discount
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              children: [
                Icon(
                  Icons.discount_outlined,
                  color: AppTheme.textTertiary,
                  size: 16,
                ),
                const SizedBox(width: 6),
                Text(
                  'Descuento:',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
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
                    style: TextStyle(color: AppTheme.textPrimary, fontSize: 13),
                    onChanged: (v) {
                      final normalized = v.replaceAll(',', '.').trim();
                      provider
                          .setGlobalDiscount(double.tryParse(normalized) ?? 0);
                    },
                    decoration: InputDecoration(
                      suffixText: '%',
                      suffixStyle:
                          TextStyle(color: AppTheme.textTertiary, fontSize: 12),
                      filled: true,
                      fillColor: AppTheme.softPanel,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(color: AppTheme.borderColor),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(color: AppTheme.borderColor),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: AppTheme.info),
                      ),
                    ),
                  ),
                ),
                const Spacer(),
                if (provider.globalDiscountPct > 0) ...[
                  Text(
                    PedidosFormatters.money(provider.totalConDescuento),
                    style: TextStyle(
                      color: AppTheme.success,
                      fontWeight: FontWeight.bold,
                      fontSize:
                          Responsive.fontSize(context, small: 14, large: 15),
                    ),
                  ),
                  Text(
                    ' (-${PedidosFormatters.money(provider.totalDescuento)})',
                    style: TextStyle(color: AppTheme.error, fontSize: 11),
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
                AppTheme.textSecondary,
              ),
              _buildStatItem(
                context,
                _formatTotalUnits(provider),
                Icons.widgets_outlined,
                AppTheme.textSecondary,
              ),
              _buildStatItem(
                context,
                PedidosFormatters.money(totalShown),
                Icons.euro,
                AppTheme.success,
              ),
              if (provider.isMarginVisible)
                _buildStatItem(
                  context,
                  '${margin.toStringAsFixed(1)}%',
                  Icons.trending_up,
                  marginColor,
                ),
            ],
          ),
          // C3 – IVA breakdown
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
                    style:
                        TextStyle(color: AppTheme.textTertiary, fontSize: 10),
                  ),
                  Text(
                    'IVA: ${PedidosFormatters.money(provider.totalIva)}',
                    style:
                        TextStyle(color: AppTheme.textTertiary, fontSize: 10),
                  ),
                  ...provider.ivaBreakdown.entries.map(
                    (e) => Text(
                      'IVA ${e.key}%: ${PedidosFormatters.money(e.value)}',
                      style: TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 10,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (provider.estimatedBolsaImpact.hasImpact)
            _buildBolsaImpactPreview(context, provider),
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
                    color: provider.isDirty
                        ? AppTheme.textTertiary
                        : AppTheme.success,
                    size: 12,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    provider.isDirty
                        ? 'Sin guardar...'
                        : 'Guardado ${_formatTime(provider.lastAutoSaved!)}',
                    style: TextStyle(
                      color: provider.isDirty
                          ? AppTheme.textTertiary
                          : AppTheme.success.withValues(alpha: 0.7),
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
          // E1 – Preview before confirm
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton.icon(
              onPressed: provider.isSaving
                  ? null
                  : () => _showOrderPreview(context, provider),
              icon: provider.isSaving
                  ? SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.textPrimary,
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
                backgroundColor: AppTheme.success,
                foregroundColor: AppColors.onAccent,
                disabledBackgroundColor:
                    AppTheme.success.withValues(alpha: 0.5),
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
                style: TextStyle(color: AppTheme.error, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildStatItem(
    BuildContext context,
    String value,
    IconData icon,
    Color color,
  ) {
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

  Widget _buildBolsaImpactPreview(
    BuildContext context,
    PedidosProvider provider,
  ) {
    final impact = provider.estimatedBolsaImpact;
    final isPureConsumption = impact.consumo > 0 && impact.acumulacion == 0;
    final isPureGeneration = impact.acumulacion > 0 && impact.consumo == 0;
    final netColor = isPureConsumption
        ? AppTheme.error
        : isPureGeneration
            ? AppTheme.success
            : impact.neto < 0
                ? AppTheme.error
                : AppTheme.warning;
    final title = isPureConsumption
        ? 'Consume bolsa'
        : isPureGeneration
            ? 'Genera bolsa'
            : 'Bolsa compensada';
    final icon = isPureConsumption
        ? Icons.trending_down
        : isPureGeneration
            ? Icons.trending_up
            : Icons.compare_arrows;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: netColor.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: netColor.withValues(alpha: 0.42)),
      ),
      child: Row(
        children: [
          Icon(icon, color: netColor, size: 17),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title,
              style: TextStyle(
                color: netColor,
                fontSize: Responsive.fontSize(context, small: 11, large: 12),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          if (impact.acumulacion > 0)
            _buildBolsaMiniStat(
              '+${PedidosFormatters.money(impact.acumulacion)}',
              AppTheme.success,
            ),
          if (impact.consumo > 0) ...[
            const SizedBox(width: 8),
            _buildBolsaMiniStat(
              '-${PedidosFormatters.money(impact.consumo)}',
              AppTheme.error,
            ),
          ],
          const SizedBox(width: 8),
          _buildBolsaMiniStat(
            '${impact.neto >= 0 ? '+' : ''}${PedidosFormatters.money(impact.neto)}',
            netColor,
          ),
        ],
      ),
    );
  }

  Widget _buildBolsaMiniStat(String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        value,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  String _formatTotalUnits(PedidosProvider provider) {
    final total = provider.totalUnidades;
    final hasWeightLines = provider.lines.any((l) {
      final u = l.unidadMedida.toUpperCase().trim();
      return u == 'KILOGRAMOS' || u == 'LITROS';
    });
    if (hasWeightLines) {
      final formatted = total
          .toStringAsFixed(2)
          .replaceAll(RegExp(r'0+$'), '')
          .replaceAll(RegExp(r'\.$'), '');
      return '$formatted mixto';
    }
    return '${total.toStringAsFixed(0)} uds';
  }

  void _showEditLineDialog(
    BuildContext context,
    PedidosProvider provider,
    OrderLine line,
    int index,
  ) {
    final isDual = line.unidadesCaja > 1 &&
        line.unidadesFraccion > 0 &&
        line.unidadesFraccion < line.unidadesCaja;
    String formatQty(double v, String unit) {
      final isWeight =
          unit.toUpperCase() == 'KILOGRAMOS' || unit.toUpperCase() == 'LITROS';
      if (isWeight) {
        return v
            .toStringAsFixed(2)
            .replaceAll(RegExp(r'0+$'), '')
            .replaceAll(RegExp(r'\.$'), '');
      }
      return v.toStringAsFixed(0);
    }

    final qtyController = TextEditingController(
      text: formatQty(
        _primaryLineQuantity(line),
        line.unidadMedida,
      ),
    );
    final cajasController = TextEditingController(
      text: _lineUsesBoxes(line) && line.cantidadEnvases > 0
          ? formatQty(line.cantidadEnvases, 'CAJAS')
          : '',
    );
    final unidadesController = TextEditingController(
      text: line.cantidadUnidades > 0
          ? formatQty(line.cantidadUnidades, line.unidadMedida)
          : '',
    );
    final priceController =
        TextEditingController(text: line.precioVenta.toStringAsFixed(3));

    final unitLabel = Product.unitLabel(line.unidadMedida);
    final equivText = line.unidadesCaja > 1
        ? '1 cj = ${formatQty(line.unidadesCaja, line.unidadMedida)} uds'
        : null;

    showDialog<void>(
      context: context,
      barrierColor: AppColors.systemBlack54,
      builder: (ctx) {
        return Dialog(
          backgroundColor: AppTheme.raisedSurface,
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
                    const Icon(
                      Icons.edit_outlined,
                      color: AppTheme.info,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Editar linea',
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.bold,
                          fontSize: Responsive.fontSize(
                            context,
                            small: 15,
                            large: 17,
                          ),
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(ctx),
                      icon: Icon(
                        Icons.close,
                        color: AppTheme.textTertiary,
                        size: 20,
                      ),
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
                    color: AppTheme.textPrimary,
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
                    color: AppTheme.info,
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
                      color: AppTheme.info.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '$equivText  ·  $unitLabel',
                      style: const TextStyle(
                        color: AppTheme.info,
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
                            decimal: true,
                          ),
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                          decoration: InputDecoration(
                            labelText: 'Cajas',
                            labelStyle:
                                TextStyle(color: AppTheme.textSecondary),
                            filled: true,
                            fillColor: AppTheme.softPanel,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: AppTheme.success,
                              ),
                            ),
                          ),
                          onChanged: (val) {
                            final cur =
                                double.tryParse(val.replaceAll(',', '.')) ?? 0;
                            unidadesController.text =
                                formatQty(cur * line.unidadesCaja, 'UNIDADES');
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: unidadesController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                          decoration: InputDecoration(
                            labelText:
                                'Uds (${formatQty(line.unidadesCaja, 'UNIDADES')} U/C)',
                            labelStyle:
                                TextStyle(color: AppTheme.textSecondary),
                            filled: true,
                            fillColor: AppTheme.softPanel,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide:
                                  const BorderSide(color: AppTheme.info),
                            ),
                          ),
                          onChanged: (val) {
                            final cur =
                                double.tryParse(val.replaceAll(',', '.')) ?? 0;
                            cajasController.text =
                                formatQty(cur / line.unidadesCaja, 'CAJAS');
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
                    style: TextStyle(color: AppTheme.textPrimary),
                    decoration: InputDecoration(
                      labelText: 'Precio',
                      suffixText: ' \u20AC',
                      labelStyle: TextStyle(color: AppTheme.textSecondary),
                      filled: true,
                      fillColor: AppTheme.softPanel,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: AppTheme.borderColor),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: AppTheme.borderColor),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: AppTheme.info),
                      ),
                    ),
                  ),
                ] else ...[
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: qtyController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                          decoration: InputDecoration(
                            labelText: 'Cantidad ($unitLabel)',
                            labelStyle:
                                TextStyle(color: AppTheme.textSecondary),
                            filled: true,
                            fillColor: AppTheme.softPanel,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide:
                                  const BorderSide(color: AppTheme.info),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: priceController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          style: TextStyle(color: AppTheme.textPrimary),
                          decoration: InputDecoration(
                            labelText: 'Precio',
                            suffixText: ' \u20AC',
                            labelStyle:
                                TextStyle(color: AppTheme.textSecondary),
                            filled: true,
                            fillColor: AppTheme.softPanel,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: AppTheme.borderColor,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide:
                                  const BorderSide(color: AppTheme.info),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                if (provider.isMarginVisible && line.precioMinimo > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Precio minimo: ${PedidosFormatters.money(line.precioMinimo, decimals: 3)}',
                      style: TextStyle(
                        color: AppTheme.textTertiary,
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
                          label: const Text(
                            'ELIMINAR',
                            style: TextStyle(fontSize: 13),
                          ),
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
                            void showValidation(String msg) {
                              ScaffoldMessenger.of(ctx).showSnackBar(
                                SnackBar(
                                  content: Text(msg),
                                  backgroundColor: AppTheme.warning,
                                  duration: const Duration(seconds: 2),
                                ),
                              );
                            }

                            final price = double.tryParse(
                                  priceController.text.replaceAll(',', '.'),
                                ) ??
                                0;
                            // Precio negativo nunca es válido; 0 solo para
                            // líneas Sin Cargo (SC).
                            final isSinCargo =
                                line.claseLinea.trim().toUpperCase() == 'SC';
                            if (price < 0 || (price == 0 && !isSinCargo)) {
                              showValidation('Precio no válido');
                              return;
                            }

                            if (isDual) {
                              final c = double.tryParse(
                                    cajasController.text.replaceAll(',', '.'),
                                  ) ??
                                  0;
                              final u = double.tryParse(
                                    unidadesController.text
                                        .replaceAll(',', '.'),
                                  ) ??
                                  0;
                              if (c <= 0 && u <= 0) {
                                showValidation(
                                  'Indica una cantidad mayor que 0',
                                );
                                return;
                              }
                              final err = provider.updateLine(
                                index,
                                cantidadEnvases: c,
                                cantidadUnidades: u,
                                precioVenta: price,
                              );
                              if (err != null) {
                                showValidation(err);
                                return;
                              }
                            } else {
                              final qty = double.tryParse(
                                    qtyController.text.replaceAll(',', '.'),
                                  ) ??
                                  0;
                              if (qty <= 0) {
                                showValidation(
                                  'Indica una cantidad mayor que 0',
                                );
                                return;
                              }
                              final isBoxes = _lineUsesBoxes(line);
                              final err = provider.updateLine(
                                index,
                                cantidadEnvases: isBoxes ? qty : null,
                                cantidadUnidades: isBoxes ? null : qty,
                                precioVenta: price,
                              );
                              if (err != null) {
                                showValidation(err);
                                return;
                              }
                            }
                            Navigator.pop(ctx);
                          },
                          icon: const Icon(Icons.check, size: 18),
                          label: const Text(
                            'GUARDAR',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.info,
                            foregroundColor: AppColors.onAccent,
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
    BuildContext context,
    PedidosProvider provider,
  ) async {
    if (!provider.hasClient) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selecciona un cliente primero'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    final result = await provider.confirmOrder(
      widget.vendedorCode,
      observaciones: _obsCtrl.text.trim(),
    );

    if (result != null && context.mounted) {
      if (_handleBlockedOrUnconfirmedResult(context, result)) return;

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
            'Pedido #${result['numeroPedido'] ?? ''} confirmado correctamente',
          ),
          backgroundColor: AppTheme.success,
        ),
      );
    }
  }

  bool _handleBlockedOrUnconfirmedResult(
    BuildContext context,
    Map<String, dynamic> result,
  ) {
    if (result['blocked'] == true) {
      _showStockAlternatives(context, result);
      return true;
    }

    if (result['pendingConfirmation'] == true || result['queued'] == true) {
      final message = result['message']?.toString().trim();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            message != null && message.isNotEmpty
                ? message
                : 'Pedido guardado localmente. Se enviara al recuperar conexion.',
          ),
          backgroundColor: AppTheme.warning,
        ),
      );
      return true;
    }

    if (!isConfirmedOrderResultForProvider(result)) {
      final status = orderConfirmationStatusForProvider(result);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Pedido no confirmado. Estado actual: ${status.isEmpty ? 'DESCONOCIDO' : status}',
          ),
          backgroundColor: AppTheme.error,
        ),
      );
      return true;
    }

    return false;
  }

  // Show stock alternatives when order is blocked
  void _showStockAlternatives(
    BuildContext context,
    Map<String, dynamic> result,
  ) {
    final stockWarnings = result['stockWarnings'] as List? ?? [];
    final alternatives = result['alternatives'] as List? ?? [];

    showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _AlternativesDialog(
        stockWarnings: stockWarnings,
        alternatives: alternatives,
        onAddToCart: (productCode, productName, quantity, unit) async {
          Navigator.pop(
            context,
            {'code': productCode, 'qty': quantity, 'unit': unit},
          );
        },
      ),
    ).then((selected) async {
      if (selected != null && selected['code'] != null) {
        final provider = ref.read(pedidosProvider.notifier);
        final productCode = selected['code'] as String;
        final quantity = selected['qty'] as double;
        final unit = selected['unit'] as String;

        try {
          final productDetail =
              await PedidosService.getProductDetail(productCode);
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
                content: Text(
                  error,
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                backgroundColor: AppTheme.error,
              ),
            );
          } else if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('✅ ${product.name} añadido al carrito'),
                backgroundColor: AppTheme.success,
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

  // E1 – Preview sheet before confirm (Amazon-style DraggableScrollableSheet)
  void _showOrderPreview(BuildContext context, PedidosProvider provider) {
    if (!provider.hasClient) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selecciona un cliente primero'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    showOrderPreviewSheet(
      context: context,
      provider: provider,
      vendedorCode: widget.vendedorCode,
      onConfirm: (
        observaciones, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
      }) async {
        final result = await provider.confirmOrder(
          widget.vendedorCode,
          observaciones:
              observaciones.isNotEmpty ? observaciones : _obsCtrl.text.trim(),
          deliveryDate: deliveryDate,
          vehicleCode: vehicleCode,
          driverCode: driverCode,
          routeCode: routeCode,
        );
        if (result != null && context.mounted) {
          if (_handleBlockedOrUnconfirmedResult(context, result)) return result;

          _obsCtrl.clear();
          _discountCtrl.clear();
          // Fire-and-forget: do NOT await these — the modal should close
          // immediately after a successful confirmation. Awaiting loadPromotions()
          // was the root cause of the "modal stuck after confirm" bug.
          provider.loadPromotions();
          provider.loadOrders(
            vendedorCodes: widget.vendedorCode,
            forceRefresh: true,
          );
          provider.loadOrderStats(
            vendedorCodes: widget.vendedorCode,
            forceRefresh: true,
          );
        }
        return result;
      },
    ).then((result) {
      // This runs AFTER the preview dialog is closed
      if (result == null || result is! Map<String, dynamic>) return;
      if (!context.mounted) return;
      if (_handleBlockedOrUnconfirmedResult(context, result)) return;

      widget.onOrderConfirmed?.call(result);
      if (widget.onOrderConfirmed == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Pedido #${result['numeroPedido'] ?? ''} confirmado correctamente',
            ),
            backgroundColor: AppTheme.success,
          ),
        );
      }
    });
  }
}

// ============================================================================
// ALTERNATIVES DIALOG - Stock alternatives selector
// ============================================================================

class _AlternativesDialog extends StatefulWidget {
  const _AlternativesDialog({
    required this.stockWarnings,
    required this.alternatives,
    required this.onAddToCart,
  });
  final List<dynamic> stockWarnings;
  final List<dynamic> alternatives;
  final Function(
    String productCode,
    String productName,
    double quantity,
    String unit,
  ) onAddToCart;

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
      backgroundColor: AppTheme.raisedSurface,
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
              child: Row(
                children: [
                  Icon(
                    Icons.warning_amber_rounded,
                    color: AppTheme.textPrimary,
                    size: 28,
                  ),
                  SizedBox(width: 12),
                  Text(
                    'Stock Insuficiente',
                    style: TextStyle(
                      color: AppTheme.textPrimary,
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
                      Text(
                        'Productos sin stock:',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ...widget.stockWarnings.map(
                        (w) => Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.error.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: AppTheme.error.withValues(alpha: 0.3),
                            ),
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.error_outline,
                                color: AppTheme.error,
                                size: 20,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      w['description'] ??
                                          w['product'] ??
                                          'Producto',
                                      style: TextStyle(
                                        color: AppTheme.textPrimary,
                                        fontWeight: FontWeight.w500,
                                        fontSize: 13,
                                      ),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Solicitado: ${w['requested']} ${w['unit'] ?? ''} | Disponible: ${w['available']} ${w['unit'] ?? ''}',
                                      style: TextStyle(
                                        color: AppTheme.textTertiary,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    // Alternatives
                    if (widget.alternatives.isNotEmpty) ...[
                      Text(
                        'Alternativas con stock:',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ...widget.alternatives.expand((alt) {
                        final alternativesList =
                            alt['alternatives'] as List? ?? [];
                        return alternativesList.map((prod) {
                          final isSelected =
                              _selectedProductCode == prod['code'];
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                _selectedProductCode = prod['code'];
                                _selectedProduct = prod;
                                _quantity =
                                    (prod['stockEnvases'] ?? 1).toDouble();
                                _unit = 'CAJAS';
                                _qtyController.text =
                                    _quantity.toStringAsFixed(0);
                              });
                            },
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? AppTheme.success.withValues(alpha: 0.15)
                                    : AppTheme.softPanel,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: isSelected
                                      ? AppTheme.success
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
                                            ? AppTheme.success
                                            : AppTheme.textTertiary,
                                        size: 20,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          prod['name'] ??
                                              prod['code'] ??
                                              'Producto',
                                          style: TextStyle(
                                            color: AppTheme.textPrimary,
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
                                          color: AppTheme.info
                                              .withValues(alpha: 0.15),
                                          borderRadius:
                                              BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          '${(prod['stockEnvases'] ?? 0).toStringAsFixed(0)} cajas',
                                          style: const TextStyle(
                                            color: AppTheme.info,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (prod['precio'] != null &&
                                      (prod['precio'] as num).toDouble() > 0)
                                    Padding(
                                      padding: const EdgeInsets.only(
                                        top: 6,
                                        left: 28,
                                      ),
                                      child: Text(
                                        '${(prod['precio'] as num).toDouble().toStringAsFixed(2)} €/caja',
                                        style: TextStyle(
                                          color: AppTheme.textTertiary,
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
                        Divider(color: AppTheme.borderColor),
                        const SizedBox(height: 12),
                        Text(
                          'Cantidad a añadir:',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _qtyController,
                                keyboardType: TextInputType.number,
                                style: TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontSize: 16,
                                ),
                                textAlign: TextAlign.center,
                                decoration: InputDecoration(
                                  labelText: 'Cajas',
                                  labelStyle:
                                      TextStyle(color: AppTheme.textSecondary),
                                  filled: true,
                                  fillColor: AppTheme.softPanel,
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: BorderSide(
                                      color: AppTheme.borderColor,
                                    ),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: BorderSide(
                                      color: AppTheme.borderColor,
                                    ),
                                  ),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    borderSide: const BorderSide(
                                      color: AppTheme.success,
                                    ),
                                  ),
                                ),
                                onChanged: (val) {
                                  final qty = double.tryParse(val) ?? 1;
                                  final maxStock =
                                      (_selectedProduct!['stockEnvases'] ?? 1)
                                          .toDouble();
                                  setState(() {
                                    _quantity =
                                        qty.clamp(1, maxStock).toDouble();
                                    _unit = 'CAJAS';
                                  });
                                },
                              ),
                            ),
                          ],
                        ),
                      ],
                    ] else ...[
                      Center(
                        child: Padding(
                          padding: EdgeInsets.all(32),
                          child: Column(
                            children: [
                              Icon(
                                Icons.inventory_2_outlined,
                                color: AppTheme.textTertiary,
                                size: 48,
                              ),
                              SizedBox(height: 16),
                              Text(
                                'No hay alternativas disponibles',
                                style: TextStyle(
                                  color: AppTheme.textTertiary,
                                  fontSize: 14,
                                ),
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
              decoration: BoxDecoration(
                color: AppTheme.softPanel,
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
                        foregroundColor: AppColors.onAccent,
                        side: BorderSide(color: AppTheme.borderColor),
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
                                  _selectedProduct!['name'] ??
                                      _selectedProductCode!,
                                  _quantity,
                                  _unit,
                                )
                            : null,
                        icon: const Icon(Icons.add_shopping_cart, size: 18),
                        label: const Text(
                          'AÑADIR AL CARRITO',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.success,
                          foregroundColor: AppColors.onAccent,
                          disabledBackgroundColor:
                              AppTheme.success.withValues(alpha: 0.3),
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
