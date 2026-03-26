/// Promotions Banner Widget
/// ========================
/// Horizontal scrollable banner showing products with active promotions.
/// Handles PRICE promos (price reduction) and GIFT promos (buy X get Y free).

import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/api/api_client.dart';
import '../../data/pedidos_service.dart';

class PromotionsBanner extends StatefulWidget {
  final Function(String code, String name)? onProductTap;

  const PromotionsBanner({Key? key, this.onProductTap}) : super(key: key);

  @override
  State<PromotionsBanner> createState() => _PromotionsBannerState();
}

class _PromotionsBannerState extends State<PromotionsBanner> {
  List<PromotionItem> _promotions = [];
  bool _isLoading = true;
  bool _isExpanded = false;

  @override
  void initState() {
    super.initState();
    _loadPromotions();
  }

  Future<void> _loadPromotions() async {
    try {
      final response = await ApiClient.get(
        '/pedidos/promotions',
        cacheKey: 'pedidos:promotions',
        cacheTTL: const Duration(minutes: 10),
      );
      final list = response['promotions'] as List? ?? [];
      if (mounted) {
        setState(() {
          _promotions = list
              .map((p) =>
                  PromotionItem.fromJson(p as Map<String, dynamic>))
              .toList();
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const SizedBox.shrink();
    if (_promotions.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        InkWell(
          onTap: () => setState(() => _isExpanded = !_isExpanded),
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.neonGreen.withValues(alpha: 0.2),
                        AppTheme.neonBlue.withValues(alpha: 0.2),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color:
                            AppTheme.neonGreen.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.local_offer,
                          color: AppTheme.neonGreen, size: 16),
                      const SizedBox(width: 6),
                      Text(
                        'Ofertas activas (${_promotions.length})',
                        style: TextStyle(
                          color: AppTheme.neonGreen,
                          fontWeight: FontWeight.w600,
                          fontSize: Responsive.fontSize(context,
                              small: 12, large: 14),
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                Icon(
                  _isExpanded
                      ? Icons.expand_less
                      : Icons.expand_more,
                  color: Colors.white38,
                  size: 20,
                ),
              ],
            ),
          ),
        ),
        // Promo cards
        if (_isExpanded)
          SizedBox(
            height: 110,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _promotions.length,
              itemBuilder: (ctx, i) =>
                  _buildPromoCard(_promotions[i]),
            ),
          ),
      ],
    );
  }

  Widget _buildPromoCard(PromotionItem promo) {
    final isGift = promo.promoType == 'GIFT';

    return GestureDetector(
      onTap: () =>
          widget.onProductTap?.call(promo.code, promo.name),
      child: Container(
        width: 180,
        margin: const EdgeInsets.only(right: 8, bottom: 4),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isGift
                ? AppTheme.neonPurple.withValues(alpha: 0.4)
                : AppTheme.neonGreen.withValues(alpha: 0.3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              promo.name,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: Responsive.fontSize(context,
                    small: 11, large: 13),
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              promo.code,
              style: TextStyle(
                color: Colors.white38,
                fontSize: Responsive.fontSize(context,
                    small: 10, large: 11),
              ),
            ),
            const Spacer(),
            if (isGift)
              // GIFT promo: show description (e.g., "14+4 GRATIS")
              _buildGiftRow(promo)
            else
              // PRICE promo: show promo price vs regular
              _buildPriceRow(promo),
            const SizedBox(height: 2),
            Row(
              children: [
                // Badge: type indicator
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: isGift
                        ? AppTheme.neonPurple.withValues(alpha: 0.15)
                        : AppTheme.neonGreen.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    isGift ? 'REGALO' : _buildDiscountLabel(promo),
                    style: TextStyle(
                      color: isGift
                          ? AppTheme.neonPurple
                          : AppTheme.neonGreen,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const Spacer(),
                if (promo.dateTo.isNotEmpty)
                  Text(
                    'hasta ${promo.dateTo}',
                    style: TextStyle(
                      color: Colors.white38,
                      fontSize: Responsive.fontSize(context,
                          small: 9, large: 10),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPriceRow(PromotionItem promo) {
    return Row(
      children: [
        Text(
          '${promo.promoPrice.toStringAsFixed(3)}\u20AC',
          style: TextStyle(
            color: AppTheme.neonGreen,
            fontWeight: FontWeight.bold,
            fontSize: Responsive.fontSize(context,
                small: 13, large: 15),
          ),
        ),
        const SizedBox(width: 6),
        if (promo.hasSaving)
          Text(
            '${promo.regularPrice.toStringAsFixed(3)}\u20AC',
            style: TextStyle(
              color: Colors.white38,
              fontSize: Responsive.fontSize(context,
                  small: 10, large: 11),
              decoration: TextDecoration.lineThrough,
            ),
          ),
      ],
    );
  }

  Widget _buildGiftRow(PromotionItem promo) {
    return Row(
      children: [
        const Icon(Icons.card_giftcard,
            color: AppTheme.neonPurple, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            promo.promoDesc.isNotEmpty
                ? promo.promoDesc
                : 'Promocion regalo',
            style: TextStyle(
              color: AppTheme.neonPurple,
              fontWeight: FontWeight.bold,
              fontSize: Responsive.fontSize(context,
                  small: 11, large: 13),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  String _buildDiscountLabel(PromotionItem promo) {
    if (promo.savingPct > 0) {
      return '-${promo.savingPct.toStringAsFixed(0)}%';
    }
    return 'OFERTA';
  }
}
