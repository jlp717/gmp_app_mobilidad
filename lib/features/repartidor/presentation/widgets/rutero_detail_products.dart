import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_operation_safety.dart';

String _deliveryQuantityText(num value) {
  final fixed = value.toDouble().toStringAsFixed(3);
  return fixed.replaceFirst(RegExp(r'\.?0+$'), '');
}

/// Step for +/- controls: weight units use 0.1, piece units use 1.
double quantityStepForUnit(String? unit) {
  final u = (unit ?? '').trim().toUpperCase();
  if (u.isEmpty) return 1;
  if (u.contains('KG') ||
      u.contains('KILO') ||
      u == 'G' ||
      u == 'GR' ||
      u.contains('GRAM') ||
      u == 'LT' ||
      u == 'L' ||
      u.contains('LITR')) {
    return 0.1;
  }
  return 1;
}

/// Prefer unit; if unit empty but ordered qty is fractional (carne a peso), use 0.1.
double quantityStepForLine({required num cantidadPedida, String? unit}) {
  if (quantityStepForUnit(unit) < 1) return 0.1;
  final ordered = cantidadPedida.toDouble();
  if ((ordered - ordered.roundToDouble()).abs() > 0.0001) return 0.1;
  return 1;
}

bool isWeightLikeUnit(String? unit) => quantityStepForUnit(unit) < 1;

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
    this.scrollController,
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
  final void Function(EntregaItem linea) onOpenFicha;
  final void Function(String imageUrl, String name) onShowFullscreenImage;
  final ScrollController? scrollController;

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
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            itemBuilder: (context, index) {
              final linea = items[index];
              final lineId = ruteroLineKey(linea);
              return _ProductCard(
                linea: linea,
                isChecked: productChecked[lineId] ?? false,
                quantity: productQuantities[lineId] ?? linea.cantidadPedida,
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
    return const Center(
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
              style:
                  const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
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
          const Text(
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

    return RepartidorExecutivePanel(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      accentColor: checked == total ? AppTheme.success : AppTheme.warning,
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.checklist, color: AppTheme.info, size: 20),
              const SizedBox(width: 12),
              Text(
                '$checked de $total productos verificados',
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const Spacer(),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: checked == total
                      ? AppTheme.success.withValues(alpha: 0.2)
                      : AppTheme.warning.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  checked == total ? '✓ COMPLETO' : 'PENDIENTE',
                  style: TextStyle(
                    color:
                        checked == total ? AppTheme.success : AppTheme.warning,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          if (ordenPreparacion != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(
                  Icons.assignment,
                  color: AppTheme.accentIndigo,
                  size: 18,
                ),
                const SizedBox(width: 8),
                Text(
                  'Orden de Preparación: $ordenPreparacion',
                  style: const TextStyle(
                    color: AppTheme.accentIndigo,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
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
    final allChecked = items.isNotEmpty &&
        items.every((item) => productChecked[ruteroLineKey(item)] ?? false);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(top: BorderSide(color: AppTheme.borderColor)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: onConfirmAll,
              icon: Icon(
                allChecked ? Icons.check_box : Icons.check_box_outline_blank,
              ),
              label: Text(allChecked ? 'DESMARCAR TODO' : 'MARCAR TODO'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.info,
                side: BorderSide(color: AppTheme.info.withValues(alpha: 0.5)),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: onContinueToPayment,
              icon: const Icon(Icons.arrow_forward),
              label: const Text('CONTINUAR'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.info,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
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
  });

  final EntregaItem linea;
  final bool isChecked;
  final double quantity;
  final void Function(bool) onCheckedChanged;
  final void Function(double) onQuantityChanged;
  final VoidCallback onShowEditDialog;
  final VoidCallback onOpenFicha;
  final VoidCallback onShowFullscreenImage;

  bool get isModified => (quantity - linea.cantidadPedida).abs() > 0.0001;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      margin: const EdgeInsets.only(bottom: 12),
      accentColor: isChecked ? AppTheme.success : AppTheme.warning,
      selected: isChecked,
      padding: EdgeInsets.zero,
      onTap: () {
        HapticFeedback.selectionClick();
        onCheckedChanged(!isChecked);
      },
      child: Padding(
        padding: const EdgeInsets.all(14),
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
            fontSize: 13,
            fontWeight: FontWeight.w500,
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
              style: const TextStyle(
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
                  'MODIFICADO',
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
      color: Colors.transparent,
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
    final step = quantityStepForLine(
      unit: linea.unit,
      cantidadPedida: linea.cantidadPedida,
    );
    final unitLabel = (linea.unit ?? '').trim();
    return Container(
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
            onTap: quantity > 0
                ? () {
                    HapticFeedback.selectionClick();
                    onQuantityChanged(
                      (quantity - step).clamp(0.0, linea.cantidadPedida),
                    );
                  }
                : null,
          ),
          GestureDetector(
            onTap: onShowEditDialog,
            child: Container(
              constraints: const BoxConstraints(minWidth: 64),
              padding: const EdgeInsets.symmetric(horizontal: 4),
              alignment: Alignment.center,
              child: Text(
                unitLabel.isEmpty
                    ? _deliveryQuantityText(quantity)
                    : '${_deliveryQuantityText(quantity)} $unitLabel',
                style: TextStyle(
                  color: isModified ? AppTheme.warning : AppTheme.textPrimary,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                  decoration: TextDecoration.underline,
                  decorationStyle: TextDecorationStyle.dotted,
                ),
              ),
            ),
          ),
          _QuantityButton(
            icon: Icons.add,
            onTap: quantity + 0.0001 < linea.cantidadPedida
                ? () {
                    HapticFeedback.selectionClick();
                    final next = quantity + step;
                    onQuantityChanged(
                      next > linea.cantidadPedida ? linea.cantidadPedida : next,
                    );
                  }
                : null,
          ),
        ],
      ),
    );
  }

  Widget _buildEditIcon() {
    return GestureDetector(
      onTap: onShowEditDialog,
      child: const Icon(
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
      color: Colors.transparent,
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
