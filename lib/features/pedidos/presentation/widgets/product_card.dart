/// Product Card
/// ============
/// Catalog product card showing name, code, stock, price, and U/C

import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import '../utils/pedidos_formatters.dart';
import '../../../../core/widgets/smart_product_image.dart';

class ProductCard extends StatelessWidget {
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
  Widget build(BuildContext context) {
    final stockColor = product.hasStock ? AppTheme.neonGreen : AppTheme.error;
    final inCart = cartQty > 0;
    final badgeQty = cartQty == cartQty.truncateToDouble()
        ? cartQty.toStringAsFixed(0)
        : cartQty.toStringAsFixed(2);

    return Card(
      color: inCart ? AppTheme.darkCard.withOpacity(0.92) : AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: inCart
              ? AppTheme.neonGreen
              : promo != null
                  ? AppTheme.neonPurple
                  : AppTheme.borderColor.withOpacity(0.3),
          width: inCart ? 1.5 : (promo != null ? 1.5 : 1.0),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              // Product thumbnail (left) — tap to zoom
              Stack(
                children: [
                  GestureDetector(
                    onTap: () => _showFullscreenImage(context, product.code, product.name),
                    child: _buildThumbnail(product.code),
                  ),
                  if (inCart)
                    Positioned(
                      top: 0,
                      right: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppTheme.neonGreen,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '$badgeQty$cartQtySuffix',
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
              // Product info (center)
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: Responsive.fontSize(context,
                            small: 13, large: 15),
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        if (promo != null)
                          Container(
                            margin: const EdgeInsets.only(right: 6),
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.neonPurple.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(color: AppTheme.neonPurple.withOpacity(0.4)),
                            ),
                            child: Text(promo!.promoDesc, style: const TextStyle(color: AppTheme.neonPurple, fontSize: 9, fontWeight: FontWeight.bold)),
                          ),
                        Text(
                          product.code,
                          style: TextStyle(
                            color: Colors.white38,
                            fontSize: Responsive.fontSize(context,
                                small: 11, large: 12),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    // Stock row — all available units
                    Row(
                      children: [
                        Icon(Icons.inventory_outlined,
                            color: stockColor, size: 13),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            _buildStockText(product),
                            style: TextStyle(
                              color: stockColor,
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
              // Price + U/C (right)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    PedidosFormatters.money(product.bestPrice),
                    style: TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.fontSize(context,
                          small: 15, large: 17),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                          color: AppTheme.neonBlue.withOpacity(0.3)),
                    ),
                    child: Text(
                      'U/C: ${product.unitsPerBox.toStringAsFixed(0)}',
                      style: TextStyle(
                        color: AppTheme.neonBlue,
                        fontSize: Responsive.fontSize(context,
                            small: 10, large: 11),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
              // Quick add button (Mejora 2)
              if (onQuickAdd != null && product.stockEnvases > 0) ...[
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: onQuickAdd,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppTheme.neonBlue.withOpacity(0.4)),
                    ),
                    child: const Icon(Icons.add, color: AppTheme.neonBlue, size: 18),
                  ),
                ),
              ],
              if (onToggleFavorite != null) ...[
                const SizedBox(width: 2),
                GestureDetector(
                  onTap: onToggleFavorite,
                  child: Icon(
                    isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: isFavorite ? Colors.amber : Colors.white24,
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

  String _buildStockText(Product p) {
    final parts = <String>[];
    // Cajas with content description
    final cjStr = '${PedidosFormatters.number(p.stockEnvases)} cj';
    final content = p.boxContentDesc;
    parts.add(content.isNotEmpty ? '$cjStr ($content/cj)' : cjStr);
    // Primary sale unit (if not CAJAS)
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
      productName: product.name,
      width: 48,
      height: 48,
      fit: BoxFit.cover,
      headers: ApiClient.authHeaders,
      borderRadius: BorderRadius.circular(8),
      showCodeOnFallback: true,
    );
  }

  void _showFullscreenImage(BuildContext context, String code, String name) {
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
                name,
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
                  productName: name,
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
}
