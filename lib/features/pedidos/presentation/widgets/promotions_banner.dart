/// Promotions Banner Widget
/// ========================
/// Horizontal scrollable banner showing products with active date-limited price offers

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
              .map((p) => PromotionItem.fromJson(p as Map<String, dynamic>))
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
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.neonGreen.withOpacity(0.2), AppTheme.neonBlue.withOpacity(0.2)],
                    ),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.neonGreen.withOpacity(0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.local_offer, color: AppTheme.neonGreen, size: 16),
                      const SizedBox(width: 6),
                      Text(
                        'Ofertas activas (${_promotions.length})',
                        style: TextStyle(
                          color: AppTheme.neonGreen,
                          fontWeight: FontWeight.w600,
                          fontSize: Responsive.fontSize(context, small: 12, large: 14),
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                Icon(
                  _isExpanded ? Icons.expand_less : Icons.expand_more,
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
              itemBuilder: (ctx, i) => _buildPromoCard(_promotions[i]),
            ),
          ),
      ],
    );
  }

  Widget _buildPromoCard(PromotionItem promo) {
    return GestureDetector(
      onTap: () => widget.onProductTap?.call(promo.code, promo.name),
      child: Container(
        width: 180,
        margin: const EdgeInsets.only(right: 8, bottom: 4),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              promo.name,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: Responsive.fontSize(context, small: 11, large: 13),
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              promo.code,
              style: TextStyle(
                color: Colors.white38,
                fontSize: Responsive.fontSize(context, small: 10, large: 11),
              ),
            ),
            const Spacer(),
            Row(
              children: [
                // Promo price
                Text(
                  '\u20AC${promo.promoPrice.toStringAsFixed(3)}',
                  style: TextStyle(
                    color: AppTheme.neonGreen,
                    fontWeight: FontWeight.bold,
                    fontSize: Responsive.fontSize(context, small: 13, large: 15),
                  ),
                ),
                const SizedBox(width: 6),
                // Regular price crossed out
                if (promo.hasSaving)
                  Text(
                    '\u20AC${promo.regularPrice.toStringAsFixed(3)}',
                    style: TextStyle(
                      color: Colors.white38,
                      fontSize: Responsive.fontSize(context, small: 10, large: 11),
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                if (promo.savingPct > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.neonGreen.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '-${promo.savingPct.toStringAsFixed(0)}%',
                      style: const TextStyle(color: AppTheme.neonGreen, fontSize: 10, fontWeight: FontWeight.bold),
                    ),
                  ),
                const Spacer(),
                Text(
                  'hasta ${promo.dateTo}',
                  style: TextStyle(
                    color: Colors.white38,
                    fontSize: Responsive.fontSize(context, small: 9, large: 10),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
