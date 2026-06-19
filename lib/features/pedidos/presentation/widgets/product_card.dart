/// Product Card (Redesigned)
/// =========================
/// Catalog product card with purchase history badges, unit type indicators,
/// YoY change, IVA toggle, and dual price display
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/fullscreen_image_viewer.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class ProductCard extends StatefulWidget {
  const ProductCard({
    required this.product,
    required this.onTap,
    super.key,
    this.isFavorite = false,
    this.promo,
    this.extraPromoCount = 0,
    this.onToggleFavorite,
    this.cartQty = 0,
    this.cartQtySuffix = 'c',
    this.onQuickAdd,
  });
  final Product product;
  final VoidCallback onTap;
  final bool isFavorite;
  final PromotionItem? promo;
  final int extraPromoCount;
  final VoidCallback? onToggleFavorite;
  final double cartQty;
  final String cartQtySuffix;
  final VoidCallback? onQuickAdd;

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  bool _showIva = false;
  bool _showClientePrice = true;

  double _ivaRateForProduct() => ivaRateFromCode(widget.product.codigoIva);

  double _priceWithIva(double price) => price * (1 + _ivaRateForProduct());

  String _formatPrice(double price, {int decimals = 3}) {
    final displayPrice = _showIva ? _priceWithIva(price) : price;
    return displayPrice.toStringAsFixed(decimals);
  }

  String _unitTypeLabel() {
    final ut = widget.product.unitType;
    if (ut == null) return '';
    switch (ut) {
      case 'caja':
        return 'Caja';
      case 'unidad':
        return 'Unidad';
      case 'ambos':
        return 'Caja+Unidad';
      default:
        return '';
    }
  }

  IconData _unitTypeIcon() {
    final ut = widget.product.unitType;
    if (ut == 'unidad') return Icons.emoji_food_beverage;
    if (ut == 'ambos') return Icons.inventory_2;
    return Icons.inventory_2; // caja default
  }

  @override
  Widget build(BuildContext context) {
    final inCart = widget.cartQty > 0;
    final badgeQty = widget.cartQty == widget.cartQty.truncateToDouble()
        ? widget.cartQty.toStringAsFixed(0)
        : widget.cartQty.toStringAsFixed(2);

    final displayPrice = _showClientePrice
        ? (widget.product.precioCliente > 0
            ? widget.product.precioCliente
            : widget.product.precioTarifa1)
        : widget.product.precioTarifa1;
    final minBoxPrice = widget.product.minimumPriceForUnit('CAJAS');
    final primaryUnit = widget.product.displayUnit;
    final minPrimaryPrice = widget.product.minimumPriceForUnit(primaryUnit);
    final unitLabel = Product.unitLabel(primaryUnit);

    final hasClientePrice = widget.product.precioCliente > 0;
    final promoColor =
        widget.promo?.isGift == true ? AppTheme.neonGreen : AppTheme.neonPurple;

    return Card(
      color: inCart
          ? AppTheme.darkCard.withValues(alpha: 0.92)
          : AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: inCart
              ? AppTheme.neonGreen
              : widget.promo != null
                  ? promoColor
                  : AppTheme.borderColor.withValues(alpha: 0.3),
          width: inCart ? 1.5 : (widget.promo != null ? 1.5 : 1.0),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: widget.onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Product thumbnail (left)
              Stack(
                children: [
                  GestureDetector(
                    onTap: () =>
                        _showFullscreenImage(context, widget.product.code),
                    child: _buildThumbnail(widget.product.code),
                  ),
                  // Cart quantity badge
                  if (inCart)
                    Positioned(
                      top: 0,
                      right: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.neonGreen,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '$badgeQty${widget.cartQtySuffix}',
                          style: const TextStyle(
                            color: AppTheme.darkBase,
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 10),
              // Product info (center-left)
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Top badges row
                    Row(
                      children: [
                        // Purchase history dot
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: widget.product.hasPurchased
                                ? AppTheme.success
                                : AppTheme.error,
                            boxShadow: [
                              BoxShadow(
                                color: (widget.product.hasPurchased
                                        ? AppTheme.success
                                        : AppTheme.error)
                                    .withValues(alpha: 0.4),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          widget.product.hasPurchased ? 'Comprado' : 'Nuevo',
                          style: TextStyle(
                            color: widget.product.hasPurchased
                                ? AppTheme.success
                                : AppTheme.error,
                            fontSize: Responsive.fontSize(
                              context,
                              small: 9,
                              large: 10,
                            ),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 6),
                        // Unit type badge
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.neonBlue.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: AppTheme.neonBlue.withValues(alpha: 0.3),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _unitTypeIcon(),
                                color: AppTheme.neonBlue,
                                size: 10,
                              ),
                              const SizedBox(width: 2),
                              Text(
                                _unitTypeLabel(),
                                style: TextStyle(
                                  color: AppTheme.neonBlue,
                                  fontSize: Responsive.fontSize(
                                    context,
                                    small: 9,
                                    large: 10,
                                  ),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        // Promo badge
                        if (widget.promo != null) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 4,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: promoColor.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(
                                color: promoColor.withValues(alpha: 0.4),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (widget.promo!.isGift) ...[
                                  Icon(
                                    Icons.card_giftcard,
                                    color: promoColor,
                                    size: 10,
                                  ),
                                  const SizedBox(width: 2),
                                ],
                                Text(
                                  (widget.promo!.isGift
                                          ? widget.promo!.giftLabel
                                          : widget.promo!.promoDesc) +
                                      (widget.extraPromoCount > 0
                                          ? ' +${widget.extraPromoCount}'
                                          : ''),
                                  style: TextStyle(
                                    color: promoColor,
                                    fontSize: 9,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    // Product name
                    Text(
                      widget.product.name,
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize:
                            Responsive.fontSize(context, small: 13, large: 15),
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    // Code + YoY change
                    Row(
                      children: [
                        Text(
                          widget.product.code,
                          style: TextStyle(
                            color: Colors.white38,
                            fontSize: Responsive.fontSize(
                              context,
                              small: 11,
                              large: 12,
                            ),
                          ),
                        ),
                        if (widget.product.hasPurchased &&
                            widget.product.yoyChange != 0) ...[
                          const SizedBox(width: 6),
                          _buildYoyBadge(),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    // Stock row
                    Row(
                      children: [
                        Icon(
                          Icons.inventory_outlined,
                          color: widget.product.hasStock
                              ? AppTheme.neonGreen
                              : AppTheme.error,
                          size: 13,
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            _buildStockText(widget.product),
                            style: TextStyle(
                              color: widget.product.hasStock
                                  ? AppTheme.neonGreen
                                  : AppTheme.error,
                              fontSize: Responsive.fontSize(
                                context,
                                small: 11,
                                large: 12,
                              ),
                              fontWeight: FontWeight.w500,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              // Price + controls (right)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  // Price toggle (Cliente / Tarifa)
                  if (hasClientePrice)
                    GestureDetector(
                      onTap: () {
                        setState(() {
                          _showClientePrice = !_showClientePrice;
                        });
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: _showClientePrice
                              ? AppTheme.neonGreen.withValues(alpha: 0.15)
                              : Colors.white.withValues(alpha: 0.06),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(
                            color: _showClientePrice
                                ? AppTheme.neonGreen.withValues(alpha: 0.4)
                                : Colors.white.withValues(alpha: 0.1),
                          ),
                        ),
                        child: Text(
                          _showClientePrice ? 'Cliente' : 'Tarifa',
                          style: TextStyle(
                            color: _showClientePrice
                                ? AppTheme.neonGreen
                                : Colors.white54,
                            fontSize: Responsive.fontSize(
                              context,
                              small: 8,
                              large: 9,
                            ),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  const SizedBox(height: 2),
                  // Main price display
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${_formatPrice(displayPrice)}\u20AC',
                        style: TextStyle(
                          color: _showIva
                              ? AppTheme.neonPurple
                              : AppTheme.neonGreen,
                          fontWeight: FontWeight.bold,
                          fontSize: Responsive.fontSize(
                            context,
                            small: 14,
                            large: 16,
                          ),
                        ),
                      ),
                      // IVA toggle button
                      const SizedBox(width: 3),
                      GestureDetector(
                        onTap: () {
                          setState(() {
                            _showIva = !_showIva;
                          });
                        },
                        child: Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(
                            color: _showIva
                                ? AppTheme.neonPurple.withValues(alpha: 0.2)
                                : Colors.white.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: _showIva
                                  ? AppTheme.neonPurple.withValues(alpha: 0.5)
                                  : Colors.white.withValues(alpha: 0.15),
                            ),
                          ),
                          child: Text(
                            _showIva ? 'c/IVA' : 's/IVA',
                            style: TextStyle(
                              color: _showIva
                                  ? AppTheme.neonPurple
                                  : Colors.white54,
                              fontSize: Responsive.fontSize(
                                context,
                                small: 7,
                                large: 8,
                              ),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  // Minimum price reference (per primary sale unit)
                  if (widget.product.precioMinimo > 0 &&
                      minPrimaryPrice != displayPrice)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Min $unitLabel: ${_formatPrice(minPrimaryPrice, decimals: 2)}\u20AC',
                        style: TextStyle(
                          color: Colors.white38,
                          fontSize:
                              Responsive.fontSize(context, small: 9, large: 10),
                        ),
                      ),
                    ),
                  const SizedBox(height: 4),
                  // Box content badge (U/C, kg/cj, L/cj)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                          color: AppTheme.neonBlue.withValues(alpha: 0.3)),
                    ),
                    child: Text(
                      _buildBoxContentBadge(),
                      style: TextStyle(
                        color: AppTheme.neonBlue,
                        fontSize:
                            Responsive.fontSize(context, small: 10, large: 11),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  // Neto U/R when retractil units available
                  if (widget.product.unitsRetractil > 0 &&
                      widget.product.bestPrice > 0) ...[
                    const SizedBox(height: 2),
                    Text(
                      'U/R: ${(widget.product.bestPrice / widget.product.unitsRetractil).toStringAsFixed(3)}\u20AC',
                      style: TextStyle(
                        color: Colors.white54,
                        fontSize:
                            Responsive.fontSize(context, small: 9, large: 10),
                      ),
                    ),
                  ],
                ],
              ),
              // Quick add button
              if (widget.onQuickAdd != null && widget.product.hasStock) ...[
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: widget.onQuickAdd,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: AppTheme.neonBlue.withValues(alpha: 0.4)),
                    ),
                    child: const Icon(
                      Icons.add,
                      color: AppTheme.neonBlue,
                      size: 18,
                    ),
                  ),
                ),
              ],
              if (widget.onToggleFavorite != null) ...[
                const SizedBox(width: 2),
                GestureDetector(
                  onTap: widget.onToggleFavorite,
                  child: Icon(
                    widget.isFavorite
                        ? Icons.star_rounded
                        : Icons.star_outline_rounded,
                    color: widget.isFavorite ? Colors.amber : Colors.white24,
                    size: 22,
                  ),
                ),
              ],
              const SizedBox(width: 2),
              const Icon(Icons.chevron_right, color: Colors.white24, size: 18),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildYoyBadge() {
    final yoy = widget.product.yoyChange;
    final isPositive = yoy > 0;
    final isNegative = yoy < 0;

    Color bgColor;
    Color textColor;
    IconData icon;

    if (isPositive) {
      bgColor = AppTheme.success.withValues(alpha: 0.15);
      textColor = AppTheme.success;
      icon = Icons.trending_up;
    } else if (isNegative) {
      bgColor = AppTheme.error.withValues(alpha: 0.15);
      textColor = AppTheme.error;
      icon = Icons.trending_down;
    } else {
      bgColor = Colors.white.withValues(alpha: 0.08);
      textColor = Colors.white54;
      icon = Icons.trending_flat;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: textColor, size: 9),
          const SizedBox(width: 1),
          Text(
            '${yoy.abs().toStringAsFixed(1)}%',
            style: TextStyle(
              color: textColor,
              fontSize: 9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  String _buildStockText(Product p) {
    final parts = <String>[];
    final cjStr = '${PedidosFormatters.number(p.stockEnvases)} cj';
    final content = p.boxContentDesc;
    parts.add(content.isNotEmpty ? '$cjStr ($content/cj)' : cjStr);
    for (final unit in p.availableUnits) {
      if (unit == 'CAJAS') continue;
      final stock = p.stockForUnit(unit);
      final label = Product.unitLabel(unit);
      final dec = (unit == 'KILOGRAMOS') ? 1 : 0;
      parts.add('${PedidosFormatters.number(stock, decimals: dec)} $label');
    }
    return parts.join(' / ');
  }

  Widget _buildThumbnail(String code) {
    final url = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(code.trim())}/image';
    return SmartProductImage(
      imageUrl: url,
      productCode: code,
      productName: widget.product.name,
      width: 48,
      height: 48,
      headers: ApiClient.authHeaders,
      borderRadius: BorderRadius.circular(8),
    );
  }

  void _showFullscreenImage(BuildContext context, String code) {
    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(code.trim())}/image';
    FullscreenImageViewer.show(
      context,
      imageUrl: imageUrl,
      productName: widget.product.name,
      productCode: code,
      headers: ApiClient.authHeaders,
    );
  }

  String _buildBoxContentBadge() {
    final p = widget.product;
    final content = p.boxContentDesc;
    if (content.isNotEmpty) return content;
    if (p.unitsPerBox > 1) return '${_formatUc(p.unitsPerBox)} uds/cj';
    return '';
  }

  String _formatUc(double value) {
    if (value == value.roundToDouble()) {
      return value.toInt().toString();
    }
    return value.toStringAsFixed(1);
  }
}
