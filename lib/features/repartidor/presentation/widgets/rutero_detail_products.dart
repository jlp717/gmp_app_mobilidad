import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_quantity_uom.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_operation_safety.dart';

export 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_quantity_uom.dart';

String _deliveryQuantityText(num value) => formatRuteroQuantity(value);

/// Live line amount from delivered quantity × unit price.
double ruteroLineDeliveredAmount({
  required EntregaItem item,
  required double deliveredQty,
}) {
  final unit = item.precioUnitario > 0.004 ? item.precioUnitario : 0.0;
  return double.parse((deliveredQty * unit).toStringAsFixed(2));
}

/// Returns the only valid UI identity for a delivery line.
String ruteroLineKey(EntregaItem item) => item.itemId.trim();

/// Fails closed when the backend omits or duplicates a canonical line ID.
String? validateRuteroLineIdentities(List<EntregaItem> items) {
  final seen = <String>{};
  for (final item in items) {
    final lineId = ruteroLineKey(item);
    if (lineId.isEmpty) {
      return 'Una línea de entrega no tiene identificador. Recarga el reparto.';
    }
    if (!seen.add(lineId)) {
      return 'Hay líneas de entrega duplicadas. Recarga el reparto.';
    }
  }
  return null;
}

/// Validates that a loaded delivery has usable canonical lines before submit.
String? validateRuteroLoadedDeliveryLines({
  required List<EntregaItem> items,
  required bool isLoading,
  String? loadError,
  bool allowEmpty = false,
}) {
  if (isLoading) {
    return 'Espera a que terminen de cargar las líneas de entrega.';
  }
  if (loadError != null) return loadError;
  if (items.isEmpty) {
    if (allowEmpty) return null;
    return 'La entrega no contiene líneas confirmables. Recarga el reparto.';
  }
  return validateRuteroLineIdentities(items);
}

class RuteroDetailProducts extends StatelessWidget {
  const RuteroDetailProducts({
    required this.items,
    required this.isLoadingItems,
    required this.itemsError,
    required this.productChecked,
    required this.productQuantities,
    required this.ordenPreparacion,
    required this.onProductCheckedChanged,
    required this.onQuantityChanged,
    required this.onShowQuantityEditDialog,
    required this.onRetryItems,
    required this.onConfirmAll,
    required this.onContinueToPayment,
    required this.onOpenFicha,
    required this.onShowFullscreenImage,
    this.onNoDelivery,
    this.scrollController,
    this.readOnly = false,
    this.canonicalDocumentTotal,
    this.quantitiesChanged = false,
    super.key,
  });

  final List<EntregaItem> items;
  final bool isLoadingItems;
  final String? itemsError;
  final Map<String, bool> productChecked;
  final Map<String, double> productQuantities;
  final String? ordenPreparacion;
  final void Function(String code, bool value) onProductCheckedChanged;
  final void Function(String code, double value) onQuantityChanged;
  final void Function(EntregaItem linea, double current)
      onShowQuantityEditDialog;
  final VoidCallback onRetryItems;
  final VoidCallback onConfirmAll;
  final VoidCallback onContinueToPayment;
  final VoidCallback? onNoDelivery;
  final void Function(EntregaItem linea) onOpenFicha;
  final void Function(String imageUrl, String name) onShowFullscreenImage;
  final ScrollController? scrollController;
  final bool readOnly;
  final double? canonicalDocumentTotal;
  final bool quantitiesChanged;

  @override
  Widget build(BuildContext context) {
    if (isLoadingItems) {
      return _buildLoading();
    }

    if (itemsError != null) {
      return _buildError(context);
    }

    if (items.isEmpty) {
      return _buildEmpty(context);
    }

    final identityError = validateRuteroLineIdentities(items);
    if (identityError != null) {
      return _buildLineIdentityError(identityError);
    }

    return Column(
      children: [
        _buildSummary(context),
        Expanded(
          child: ListView.builder(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            itemCount: items.length,
            itemBuilder: (context, index) {
              final linea = items[index];
              final lineId = ruteroLineKey(linea);
              return _ProductCard(
                linea: linea,
                isChecked: productChecked[lineId] ?? false,
                quantity: productQuantities[lineId] ?? linea.cantidadPedida,
                readOnly: readOnly,
                onCheckedChanged: (value) =>
                    onProductCheckedChanged(lineId, value),
                onQuantityChanged: (value) => onQuantityChanged(lineId, value),
                onShowEditDialog: () => onShowQuantityEditDialog(
                  linea,
                  productQuantities[lineId] ?? linea.cantidadPedida,
                ),
                onOpenFicha: () => onOpenFicha(linea),
                onShowFullscreenImage: () => onShowFullscreenImage(
                  linea.codigoArticulo,
                  linea.descripcion,
                ),
              );
            },
          ),
        ),
        _buildConfirmButton(context),
      ],
    );
  }

  Widget _buildLoading() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 60,
            height: 60,
            child: CircularProgressIndicator(
              color: AppTheme.info,
              strokeWidth: 3,
            ),
          ),
          SizedBox(height: 16),
          Text(
            'Cargando productos...',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildError(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.error.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.error_outline,
                color: AppTheme.error,
                size: 48,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Error al cargar productos',
              style: TextStyle(color: AppTheme.error, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              '$itemsError',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetryItems,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.inventory_2_outlined,
            color: AppTheme.textSecondary.withValues(alpha: 0.5),
            size: 64,
          ),
          const SizedBox(height: 16),
          Text(
            'No hay líneas de producto',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
          ),
        ],
      ),
    );
  }

  Widget _buildLineIdentityError(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          style: const TextStyle(color: AppTheme.error, fontSize: 16),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }

  Widget _buildSummary(BuildContext context) {
    final checked = items
        .where((item) => productChecked[ruteroLineKey(item)] ?? false)
        .length;
    final total = items.length;
    final allChecked = total > 0 && checked == total;
    final liveLineSum = items.fold<double>(0, (sum, item) {
      final qty = productQuantities[ruteroLineKey(item)] ?? item.cantidadPedida;
      return sum +
          ruteroLineDeliveredAmount(item: item, deliveredQty: qty.toDouble());
    });
    final liveTotal = canonicalDocumentTotal ?? liveLineSum;
    final amountLabel = quantitiesChanged || canonicalDocumentTotal == null
        ? 'Importe según unidades'
        : 'Importe';
    final landscape = Responsive.isLandscapeCompact(context);
    final metaParts = <String>[
      if (ordenPreparacion != null) 'Orden prep. $ordenPreparacion',
      if (liveTotal > 0.004)
        '$amountLabel: ${liveTotal.toStringAsFixed(2).replaceAll('.', ',')} €',
    ];

    return RepartidorExecutivePanel(
      margin: EdgeInsets.fromLTRB(12, landscape ? 4 : 8, 12, 4),
      padding: EdgeInsets.symmetric(
        horizontal: 10,
        vertical: landscape ? 6 : 8,
      ),
      accentColor: allChecked ? AppTheme.success : AppTheme.warning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.checklist, color: AppTheme.info, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '$checked de $total verificados',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: allChecked
                      ? AppTheme.success.withValues(alpha: 0.2)
                      : AppTheme.warning.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  allChecked ? 'Completo' : 'Pendiente',
                  style: TextStyle(
                    color: allChecked ? AppTheme.success : AppTheme.warning,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          if (metaParts.isNotEmpty || !readOnly) ...[
            const SizedBox(height: 2),
            Row(
              children: [
                Expanded(
                  child: Text(
                    metaParts.isEmpty ? '' : metaParts.join(' · '),
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (!readOnly)
                  Semantics(
                    button: true,
                    label: allChecked ? 'Desmarcar todo' : 'Marcar todo',
                    child: TextButton(
                      onPressed: onConfirmAll,
                      style: TextButton.styleFrom(
                        foregroundColor: AppTheme.info,
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(allChecked ? 'Desmarcar' : 'Marcar todo'),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildConfirmButton(BuildContext context) {
    if (readOnly) return const SizedBox.shrink();
    final landscape = Responsive.isLandscapeCompact(context);
    final gap = landscape ? 4.0 : 6.0;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          12,
          landscape ? 4 : 6,
          12,
          landscape ? 6 : 8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              button: true,
              label: 'Continuar al cobro',
              child: ElevatedButton.icon(
                onPressed: onContinueToPayment,
                icon: const Icon(Icons.arrow_forward, size: 18),
                label: const Text('Continuar al cobro'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.info,
                  foregroundColor: AppColors.themedWhite,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  minimumSize: const Size.fromHeight(44),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
            ),
            if (onNoDelivery != null) ...[
              SizedBox(height: gap),
              Semantics(
                button: true,
                label: 'No entrega, cerrado o no disponible',
                child: OutlinedButton.icon(
                  onPressed: onNoDelivery,
                  icon: const Icon(Icons.storefront_outlined, size: 18),
                  label: const Text('No entrega (cerrado o no disponible)'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.warning,
                    side: const BorderSide(color: AppTheme.warning),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    minimumSize: const Size.fromHeight(40),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({
    required this.linea,
    required this.isChecked,
    required this.quantity,
    required this.onCheckedChanged,
    required this.onQuantityChanged,
    required this.onShowEditDialog,
    required this.onOpenFicha,
    required this.onShowFullscreenImage,
    this.readOnly = false,
  });

  final EntregaItem linea;
  final bool isChecked;
  final double quantity;
  final void Function(bool) onCheckedChanged;
  final void Function(double) onQuantityChanged;
  final VoidCallback onShowEditDialog;
  final VoidCallback onOpenFicha;
  final VoidCallback onShowFullscreenImage;
  final bool readOnly;

  bool get isModified => (quantity - linea.cantidadPedida).abs() > 0.0001;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      margin: const EdgeInsets.only(bottom: 8),
      accentColor: isChecked ? AppTheme.success : AppTheme.warning,
      selected: isChecked,
      padding: EdgeInsets.zero,
      onTap: readOnly
          ? null
          : () {
              HapticFeedback.selectionClick();
              onCheckedChanged(!isChecked);
            },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Row(
          children: [
            _buildCheckbox(),
            const SizedBox(width: 10),
            _buildThumbnail(),
            const SizedBox(width: 10),
            Expanded(child: _buildProductInfo(context)),
            _buildQuantityControls(context),
            const SizedBox(width: 6),
            _buildEditIcon(),
          ],
        ),
      ),
    );
  }

  Widget _buildCheckbox() {
    return AnimatedContainer(
      duration: AppTheme.animFast,
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: isChecked
            ? AppTheme.success.withValues(alpha: 0.2)
            : AppTheme.softPanel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isChecked ? AppTheme.success : AppTheme.borderColor,
          width: 2,
        ),
      ),
      child: isChecked
          ? const Icon(Icons.check, color: AppTheme.success, size: 18)
          : null,
    );
  }

  Widget _buildThumbnail() {
    final url =
        '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(linea.codigoArticulo.trim())}/image';
    return GestureDetector(
      onTap: onShowFullscreenImage,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 48,
          height: 48,
          color: AppTheme.softPanel,
          child: SmartProductImage(
            imageUrl: url,
            productCode: linea.codigoArticulo,
            productName: linea.descripcion,
            width: 48,
            height: 48,
            headers: repartidorProtectedImageHeaders(url),
            showCodeOnFallback: false,
          ),
        ),
      ),
    );
  }

  Widget _buildProductInfo(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          linea.descripcion,
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
            decoration: isChecked ? null : TextDecoration.lineThrough,
          ),
          maxLines: 4,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Text(
              'Ref: ${linea.codigoArticulo}',
              style: TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 11,
              ),
            ),
            if (isModified) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 6,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: AppTheme.warning.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'Modificado',
                  style: TextStyle(
                    color: AppTheme.warning,
                    fontSize: 8,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
            const Spacer(),
            _buildFichaButton(),
          ],
        ),
      ],
    );
  }

  Widget _buildFichaButton() {
    return Material(
      color: AppColors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onOpenFicha,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 6,
            vertical: 3,
          ),
          decoration: BoxDecoration(
            border: Border.all(
              color: AppTheme.info.withValues(alpha: 0.5),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.description_outlined,
                color: AppTheme.info,
                size: 14,
              ),
              SizedBox(width: 3),
              Text(
                'Ficha',
                style: TextStyle(
                  color: AppTheme.info,
                  fontSize: 10,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQuantityControls(BuildContext context) {
    final maxQty = ruteroMaxDeliverableQuantity(linea.cantidadPedida);
    final step = quantityStepForDeliveryLine(linea);
    final facingQty = ruteroFacingFromCanonical(linea, quantity);
    final unitLabel = ruteroLineQuantityUnitLabel(linea);
    final lineAmount = ruteroLineDeliveredAmount(
      item: linea,
      deliveredQty: quantity,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Container(
          decoration: BoxDecoration(
            color: AppTheme.softPanel,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppTheme.borderColor),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _QuantityButton(
                icon: Icons.remove,
                onTap: readOnly || quantity <= 0
                    ? null
                    : () {
                        HapticFeedback.selectionClick();
                        onQuantityChanged(
                          (quantity - step).clamp(0.0, maxQty),
                        );
                      },
              ),
              GestureDetector(
                onTap: readOnly ? null : onShowEditDialog,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 64),
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  alignment: Alignment.center,
                  child: Semantics(
                    label: unitLabel.isEmpty
                        ? 'Cantidad ${_deliveryQuantityText(facingQty)}'
                        : 'Cantidad ${_deliveryQuantityText(facingQty)} $unitLabel',
                    child: Text(
                      unitLabel.isEmpty
                          ? _deliveryQuantityText(facingQty)
                          : '${_deliveryQuantityText(facingQty)} $unitLabel',
                      style: TextStyle(
                        color: isModified
                            ? AppTheme.warning
                            : AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        decoration: readOnly ? null : TextDecoration.underline,
                        decorationStyle: TextDecorationStyle.dotted,
                      ),
                    ),
                  ),
                ),
              ),
              _QuantityButton(
                icon: Icons.add,
                onTap: readOnly || quantity + 0.0001 >= maxQty
                    ? null
                    : () {
                        HapticFeedback.selectionClick();
                        final next = quantity + step;
                        onQuantityChanged(next > maxQty ? maxQty : next);
                      },
              ),
            ],
          ),
        ),
        if (lineAmount > 0.004) ...[
          const SizedBox(height: 4),
          Text(
            '${lineAmount.toStringAsFixed(2).replaceAll('.', ',')} €',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildEditIcon() {
    if (readOnly) return const SizedBox.shrink();
    return GestureDetector(
      onTap: onShowEditDialog,
      child: Icon(
        Icons.edit_outlined,
        color: AppTheme.textTertiary,
        size: 18,
      ),
    );
  }
}

class _QuantityButton extends StatelessWidget {
  const _QuantityButton({
    required this.icon,
    required this.onTap,
  });

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(
            icon,
            color: onTap != null ? AppTheme.info : AppTheme.textTertiary,
            size: 18,
          ),
        ),
      ),
    );
  }
}
