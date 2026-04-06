/// Product Card (Redesigned)
/// =========================
/// Catalog product card with purchase history badges, unit type indicators,
/// YoY change, IVA toggle, and dual price display

import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import '../utils/pedidos_formatters.dart';
import '../../../../core/widgets/smart_product_image.dart';

class ProductCard extends StatefulWidget {
  final Product product;
  final VoidCallback onTap;
  final bool isFavorite;
  final PromotionItem? promo;
  final VoidCallback? onToggleFavorite;
  final double cartQty;
  final String cartQtySuffix;
  final VoidCallback? onQuickAdd;

  const ProductCard({
    Key? key,
    required this.product,
    required this.onTap,
    this.isFavorite = false,
    this.promo,
    this.onToggleFavorite,
    this.cartQty = 0,
    this.cartQtySuffix = 'c',
    this.onQuickAdd,
  }) : super(key: key);

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  bool _showIva = false;
  bool _showClientePrice = true;

  static const double ivaRate = 0.21;

  double _priceWithIva(double price) => price * (1 + ivaRate);

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

    final hasClientePrice = widget.product.precioCliente > 0;

    return Card(
      color: inCart ? AppTheme.darkCard.withOpacity(0.92) : AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: inCart
              ? AppTheme.neonGreen
              : widget.promo != null
                  ? AppTheme.neonPurple
                  : AppTheme.borderColor.withOpacity(0.3),
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
                            horizontal: 4, vertical: 1),
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
                                    .withOpacity(0.4),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          widget.product.hasPurchased
                              ? 'Comprado'
                              : 'Nuevo',
                          style: TextStyle(
                            color: widget.product.hasPurchased
                                ? AppTheme.success
                                : AppTheme.error,
                            fontSize:
                                Responsive.fontSize(context, small: 9, large: 10),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 6),
                        // Unit type badge
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: AppTheme.neonBlue.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                                color: AppTheme.neonBlue.withOpacity(0.3)),
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
                                  fontSize: Responsive.fontSize(context,
                                      small: 9, large: 10),
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
                                horizontal: 4, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppTheme.neonPurple.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(
                                  color: AppTheme.neonPurple.withOpacity(0.4)),
                            ),
                            child: Text(
                              widget.promo!.promoDesc,
                              style: const TextStyle(
                                  color: AppTheme.neonPurple,
                                  fontSize: 9,
                                  fontWeight: FontWeight.bold),
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
                            fontSize: Responsive.fontSize(context,
                                small: 11, large: 12),
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
                        Icon(Icons.inventory_outlined,
                            color: widget.product.hasStock
                                ? AppTheme.neonGreen
                                : AppTheme.error,
                            size: 13),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            _buildStockText(widget.product),
                            style: TextStyle(
                              color: widget.product.hasStock
                                  ? AppTheme.neonGreen
                                  : AppTheme.error,
                              fontSize: Responsive.fontSize(context,
                                  small: 11, large: 12),
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
                            horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: _showClientePrice
                              ? AppTheme.neonGreen.withOpacity(0.15)
                              : Colors.white.withOpacity(0.06),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(
                            color: _showClientePrice
                                ? AppTheme.neonGreen.withOpacity(0.4)
                                : Colors.white.withOpacity(0.1),
                          ),
                        ),
                        child: Text(
                          _showClientePrice ? 'Cliente' : 'Tarifa',
                          style: TextStyle(
                            color: _showClientePrice
                                ? AppTheme.neonGreen
                                : Colors.white54,
                            fontSize: Responsive.fontSize(context,
                                small: 8, large: 9),
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
                          fontSize: Responsive.fontSize(context,
                              small: 14, large: 16),
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
                                ? AppTheme.neonPurple.withOpacity(0.2)
                                : Colors.white.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: _showIva
                                  ? AppTheme.neonPurple.withOpacity(0.5)
                                  : Colors.white.withOpacity(0.15),
                            ),
                          ),
                          child: Text(
                            _showIva ? 'c/IVA' : 's/IVA',
                            style: TextStyle(
                              color: _showIva
                                  ? AppTheme.neonPurple
                                  : Colors.white54,
                              fontSize: Responsive.fontSize(context,
                                  small: 7, large: 8),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  // Minimum price reference
                  if (widget.product.precioMinimo > 0 &&
                      widget.product.precioMinimo != displayPrice)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Min: ${_formatPrice(widget.product.precioMinimo, decimals: 2)}\u20AC',
                        style: TextStyle(
                          color: Colors.white38,
                          fontSize: Responsive.fontSize(context,
                              small: 9, large: 10),
                        ),
                      ),
                    ),
                  const SizedBox(height: 4),
                  // U/C badge
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(6),
                      border:
                          Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                    ),
                    child: Text(
                      'U/C: ${_formatUc(widget.product.unitsPerBox)}',
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
              if (widget.onQuickAdd != null && widget.product.stockEnvases > 0)
                ...[
                  const SizedBox(width: 4),
                  GestureDetector(
                    onTap: widget.onQuickAdd,
                    child: Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                            color: AppTheme.neonBlue.withOpacity(0.4)),
                      ),
                      child: const Icon(Icons.add,
                          color: AppTheme.neonBlue, size: 18),
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
              Icon(Icons.chevron_right, color: Colors.white24, size: 18),
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
      bgColor = AppTheme.success.withOpacity(0.15);
      textColor = AppTheme.success;
      icon = Icons.trending_up;
    } else if (isNegative) {
      bgColor = AppTheme.error.withOpacity(0.15);
      textColor = AppTheme.error;
      icon = Icons.trending_down;
    } else {
      bgColor = Colors.white.withOpacity(0.08);
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
      fit: BoxFit.cover,
      headers: ApiClient.authHeaders,
      borderRadius: BorderRadius.circular(8),
      showCodeOnFallback: true,
    );
  }

  void _showFullscreenImage(BuildContext context, String code) {
    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(code.trim())}/image';
    Navigator.of(context).push<void>(
      PageRouteBuilder<void>(
        opaque: false,
        barrierColor: Colors.black87,
        barrierDismissible: true,
        pageBuilder: (ctx, anim, secondAnim) {
          return Scaffold(
            backgroundColor: Colors.black,
            appBar: AppBar(
              backgroundColor: Colors.black,
              elevation: 0,
              title: Text(
                widget.product.name,
                style: const TextStyle(color: Colors.white70, fontSize: 14),
                overflow: TextOverflow.ellipsis,
              ),
              leading: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(ctx).pop(),
            ),
            ),
            body: Center(
              child: InteractiveViewer(
                minScale: 0.5,
                maxScale: 5.0,
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: code,
                  productName: widget.product.name,
                  fit: BoxFit.contain,
                  headers: ApiClient.authHeaders,
                  showCodeOnFallback: true,
                ),
              ),
            ),
          );
        },
        transitionsBuilder: (ctx, anim, secondAnim, child) {
          return FadeTransition(opacity: anim, child: child);
        },
      ),
    );
  }

  String _formatUc(double value) {
    if (value == value.roundToDouble()) {
      return value.toInt().toString();
    }
    return value.toStringAsFixed(1);
  }
}
