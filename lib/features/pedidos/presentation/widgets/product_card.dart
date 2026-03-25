/// Product Card
/// ============
/// Catalog product card showing name, code, stock, price, and U/C

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;
  final bool isFavorite;
  final VoidCallback? onToggleFavorite;

  const ProductCard({
    Key? key,
    required this.product,
    required this.onTap,
    this.isFavorite = false,
    this.onToggleFavorite,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final stockColor = product.hasStock ? AppTheme.neonGreen : AppTheme.error;

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: AppTheme.borderColor.withOpacity(0.3),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              // Product info (left)
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
                    Text(
                      product.code,
                      style: TextStyle(
                        color: Colors.white38,
                        fontSize: Responsive.fontSize(context,
                            small: 11, large: 12),
                      ),
                    ),
                    const SizedBox(height: 4),
                    // Stock row
                    Row(
                      children: [
                        Icon(Icons.inventory_outlined,
                            color: stockColor, size: 13),
                        const SizedBox(width: 4),
                        Text(
                          '${product.stockEnvases.toStringAsFixed(0)} cajas / ${product.stockUnidades.toStringAsFixed(0)} uds',
                          style: TextStyle(
                            color: stockColor,
                            fontSize: Responsive.fontSize(context,
                                small: 11, large: 12),
                            fontWeight: FontWeight.w500,
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
                    '\u20AC${product.bestPrice.toStringAsFixed(2)}',
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
}
