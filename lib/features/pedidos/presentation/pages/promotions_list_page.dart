import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/pedidos_service.dart';

class PromotionsListPage extends StatelessWidget {
  final List<PromotionItem> promotions;
  final Function(String code, String name) onProductTap;

  const PromotionsListPage({
    Key? key,
    required this.promotions,
    required this.onProductTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: const Text('Promociones Disponibles'),
        backgroundColor: AppTheme.darkSurface,
        elevation: 0,
      ),
      body: promotions.isEmpty
          ? const Center(
              child: Text(
                'No hay promociones activas.',
                style: TextStyle(color: Colors.white54),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: promotions.length,
              itemBuilder: (context, index) {
                final promo = promotions[index];
                return _buildPromoCard(promo);
              },
            ),
    );
  }

  Widget _buildPromoCard(PromotionItem promo) {
    final isGift = promo.promoType == 'GIFT';
    final accentColor = isGift ? AppTheme.neonPurple : AppTheme.neonGreen;
    final icon = isGift ? Icons.card_giftcard : Icons.local_offer;

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: accentColor.withOpacity(0.5), width: 1.5),
      ),
      child: InkWell(
        onTap: () => onProductTap(promo.code, promo.name),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: accentColor, size: 24),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      promo.promoDesc,
                      style: TextStyle(
                        color: accentColor,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                promo.name,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Ref: ${promo.code}',
                style: const TextStyle(color: Colors.white54, fontSize: 13),
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (!isGift) ...[
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '€${promo.promoPrice.toStringAsFixed(2)}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (promo.hasSaving)
                          Text(
                            'Antes: €${promo.regularPrice.toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Colors.white38,
                              decoration: TextDecoration.lineThrough,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ] else ...[
                    const Text(
                      'Promoción Especial',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                  if (promo.dateTo.isNotEmpty && promo.dateTo != '0/0/0')
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: accentColor.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Válido hasta ${promo.dateTo}',
                        style: TextStyle(
                          color: accentColor,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
