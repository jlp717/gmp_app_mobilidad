import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

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
    required this.onConfirmAll,
    required this.onContinueToPayment,
    required this.onOpenFicha,
    required this.onShowFullscreenImage,
    super.key,
  });

  final List<EntregaItem> items;
  final bool isLoadingItems;
  final String? itemsError;
  final Map<String, bool> productChecked;
  final Map<String, int> productQuantities;
  final String? ordenPreparacion;
  final void Function(String code, bool value) onProductCheckedChanged;
  final void Function(String code, int value) onQuantityChanged;
  final void Function(EntregaItem linea, int current) onShowQuantityEditDialog;
  final VoidCallback onConfirmAll;
  final VoidCallback onContinueToPayment;
  final void Function(EntregaItem linea) onOpenFicha;
  final void Function(String imageUrl, String name) onShowFullscreenImage;

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

    return Column(
      children: [
        _buildSummary(context),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            itemBuilder: (context, index) {
              final linea = items[index];
              return _ProductCard(
                linea: linea,
                isChecked: productChecked[linea.codigoArticulo] ?? true,
                quantity: productQuantities[linea.codigoArticulo] ??
                    linea.cantidadPedida.toInt(),
                onCheckedChanged: (value) =>
                    onProductCheckedChanged(linea.codigoArticulo, value),
                onQuantityChanged: (value) =>
                    onQuantityChanged(linea.codigoArticulo, value),
                onShowEditDialog: () => onShowQuantityEditDialog(
                    linea,
                    productQuantities[linea.codigoArticulo] ??
                        linea.cantidadPedida.toInt()),
                onOpenFicha: () => onOpenFicha(linea),
                onShowFullscreenImage: () => onShowFullscreenImage(
                    linea.codigoArticulo, linea.descripcion),
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
              color: AppTheme.neonBlue,
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
              onPressed: () {},
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

  Widget _buildSummary(BuildContext context) {
    final checked = productChecked.values.where((v) => v).length;
    final total = items.length;

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        gradient: AppTheme.holoGradient,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.2)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.checklist, color: AppTheme.neonBlue, size: 20),
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
                const Icon(Icons.assignment,
                    color: AppTheme.neonCyan, size: 18),
                const SizedBox(width: 8),
                Text(
                  'Orden de Preparación: $ordenPreparacion',
                  style: const TextStyle(
                    color: AppTheme.neonCyan,
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
    final allChecked = productChecked.values.every((v) => v);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(
        color: AppTheme.darkSurface,
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
                foregroundColor: AppTheme.neonBlue,
                side: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.5)),
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
                backgroundColor: AppTheme.neonBlue,
                foregroundColor: AppTheme.darkBase,
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
  final int quantity;
  final void Function(bool) onCheckedChanged;
  final void Function(int) onQuantityChanged;
  final VoidCallback onShowEditDialog;
  final VoidCallback onOpenFicha;
  final VoidCallback onShowFullscreenImage;

  bool get isModified => quantity != linea.cantidadPedida.toInt();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        gradient: AppTheme.cardGradient,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isChecked
              ? AppTheme.success.withValues(alpha: 0.3)
              : AppTheme.warning.withValues(alpha: 0.3),
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onCheckedChanged(!isChecked);
          },
          borderRadius: BorderRadius.circular(14),
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
        color:
            isChecked ? AppTheme.success.withValues(alpha: 0.2) : AppTheme.darkBase,
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
          color: AppTheme.darkBase,
          child: SmartProductImage(
            imageUrl: url,
            productCode: linea.codigoArticulo,
            productName: linea.descripcion,
            width: 48,
            height: 48,
            headers: {
              'Accept': 'image/*',
              if (ApiClient.dio.options.headers['Authorization'] != null)
                'Authorization':
                    ApiClient.dio.options.headers['Authorization'] as String,
            },
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
              color: AppTheme.neonBlue.withValues(alpha: 0.5),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.description_outlined,
                color: AppTheme.neonBlue,
                size: 14,
              ),
              SizedBox(width: 3),
              Text(
                'Ficha',
                style: TextStyle(
                  color: AppTheme.neonBlue,
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
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.darkBase,
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
                    onQuantityChanged(quantity - 1);
                  }
                : null,
          ),
          GestureDetector(
            onTap: onShowEditDialog,
            child: Container(
              width: 40,
              alignment: Alignment.center,
              child: Text(
                '$quantity',
                style: TextStyle(
                  color: isModified ? AppTheme.warning : AppTheme.textPrimary,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                  decoration: TextDecoration.underline,
                  decorationStyle: TextDecorationStyle.dotted,
                ),
              ),
            ),
          ),
          _QuantityButton(
            icon: Icons.add,
            onTap: () {
              HapticFeedback.selectionClick();
              onQuantityChanged(quantity + 1);
            },
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
            color: onTap != null ? AppTheme.neonBlue : AppTheme.textTertiary,
            size: 18,
          ),
        ),
      ),
    );
  }
}
