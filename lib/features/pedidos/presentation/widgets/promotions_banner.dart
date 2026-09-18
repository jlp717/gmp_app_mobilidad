/// Promotions Banner Widget
/// ========================
/// Horizontal scrollable banner showing products with active promotions.
/// Handles PRICE promos (price reduction) and GIFT promos (buy X get Y free).
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/promotions_cache_policy.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class PromotionsBanner extends ConsumerStatefulWidget {
  const PromotionsBanner({
    super.key,
    this.onProductTap,
    this.promotions,
  });
  final void Function(String code, String name)? onProductTap;
  final List<PromotionItem>? promotions;

  @override
  ConsumerState<PromotionsBanner> createState() => _PromotionsBannerState();
}

class _PromotionsBannerState extends ConsumerState<PromotionsBanner> {
  List<PromotionItem> _promotions = [];
  bool _isLoading = true;
  bool _hasError = false;
  bool _isExpanded = true;

  @override
  void initState() {
    super.initState();
    if (widget.promotions != null) {
      _promotions = List<PromotionItem>.from(widget.promotions!);
      _isLoading = false;
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _loadPromotions();
      });
    }
  }

  @override
  void didUpdateWidget(covariant PromotionsBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.promotions != null) {
      _promotions = List<PromotionItem>.from(widget.promotions!);
      _isLoading = false;
    }
  }

  Future<void> _loadPromotions() async {
    try {
      setState(() {
        _hasError = false;
      });
      final provider = ref.read(pedidosProvider);
      final clientCode = normalizePedidoClientCode(provider.clientCode);
      if (clientCode.isEmpty) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }
      final cacheKey = promotionsCacheKey(clientCode, provider.vendedorCodes);
      final cached = CacheService.get<Object?>(cacheKey);
      final reuseCache = shouldReusePromotionsCache(cached);
      final Map<String, dynamic> response;
      if (reuseCache && cached is Map) {
        response = Map<String, dynamic>.from(cached);
      } else {
        response = await ApiClient.get(
          '/pedidos/promotions',
          queryParameters: {
            'clientCode': clientCode,
            if (provider.vendedorCodes.isNotEmpty)
              'vendedorCodes': provider.vendedorCodes,
          },
          cacheKey: cacheKey,
          cacheTTL: const Duration(minutes: 30),
          cacheResponse: false,
          forceRefresh: false,
        );
        if (shouldReusePromotionsCache(response)) {
          await CacheService.set(
            cacheKey,
            response,
            ttl: const Duration(minutes: 30),
          );
        } else {
          await CacheService.invalidate(cacheKey);
        }
      }
      final list = response['promotions'] as List? ?? [];
      if (mounted) {
        setState(() {
          _promotions = list
              .whereType<Map>()
              .map((p) => PromotionItem.fromJson(Map<String, dynamic>.from(p)))
              .toList();
          _isLoading = false;
          _hasError = false;
        });
      }
    } catch (e) {
      debugPrint('[PromotionsBanner] Load error: $e');
      if (mounted) {
        setState(() {
          _hasError = true;
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _retry() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _hasError = false;
      });
    }
    await _loadPromotions();
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const SizedBox.shrink();
    if (_hasError) {
      return Container(
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.warning.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.warning_amber_rounded,
              color: AppTheme.warning,
              size: 18,
            ),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'No se pudieron cargar las ofertas',
                style: TextStyle(fontSize: 13),
              ),
            ),
            TextButton(
              onPressed: _retry,
              child: const Text('Reintentar', style: TextStyle(fontSize: 12)),
            ),
          ],
        ),
      );
    }
    if (_promotions.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        InkWell(
          onTap: () => setState(() => _isExpanded = !_isExpanded),
          child: Semantics(
            button: true,
            label: _isExpanded
                ? 'Ocultar ofertas activas'
                : 'Mostrar ofertas activas',
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Row(
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.success.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppTheme.success.withValues(alpha: 0.4),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.local_offer,
                          color: AppTheme.success,
                          size: 16,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'Ofertas activas (${_promotions.length})',
                          style: TextStyle(
                            color: AppTheme.success,
                            fontWeight: FontWeight.w600,
                            fontSize: Responsive.fontSize(
                              context,
                              small: 12,
                              large: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    _isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: AppColors.themedWhite38,
                    size: 20,
                  ),
                ],
              ),
            ),
          ),
        ),
        // Promo cards
        if (_isExpanded)
          SizedBox(
            height: 168,
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
    final isGift = promo.promoType == 'GIFT';

    return Semantics(
      button: true,
      label: 'Oferta ${promo.name}',
      child: GestureDetector(
        onTap: () => widget.onProductTap?.call(promo.code, promo.name),
        child: Container(
          width: 180,
          margin: const EdgeInsets.only(right: 8, bottom: 4),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppTheme.softPanel,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isGift
                  ? AppTheme.accentIndigo.withValues(alpha: 0.4)
                  : AppTheme.success.withValues(alpha: 0.3),
            ),
          ),
          clipBehavior: Clip.hardEdge,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                promo.name,
                style: TextStyle(
                  color: AppColors.themedWhite,
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
                  color: AppColors.themedWhite38,
                  fontSize: Responsive.fontSize(context, small: 10, large: 11),
                ),
              ),
              const SizedBox(height: 4),
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
                    padding:
                        const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: isGift
                          ? AppTheme.accentIndigo.withValues(alpha: 0.15)
                          : AppTheme.success.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      isGift ? 'REGALO' : _buildDiscountLabel(promo),
                      style: TextStyle(
                        color:
                            isGift ? AppTheme.accentIndigo : AppTheme.success,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  if (promo.cumulative) ...[
                    const SizedBox(width: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: AppTheme.info.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text(
                        'ACUM.',
                        style: TextStyle(
                          color: AppTheme.info,
                          fontSize: 8,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                  const Spacer(),
                  if (promo.dateTo.isNotEmpty)
                    Text(
                      'hasta ${promo.dateTo}',
                      style: TextStyle(
                        color: AppColors.themedWhite38,
                        fontSize:
                            Responsive.fontSize(context, small: 9, large: 10),
                      ),
                    )
                  else if (promo.hasStock)
                    Text(
                      '${promo.stockEnvases.toInt()} cj',
                      style: TextStyle(
                        color: AppTheme.success.withValues(alpha: 0.7),
                        fontSize:
                            Responsive.fontSize(context, small: 9, large: 10),
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

  Widget _buildPriceRow(PromotionItem promo) {
    return Row(
      children: [
        Flexible(
          child: Text(
            PedidosFormatters.money(promo.promoPrice, decimals: 3),
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AppTheme.success,
              fontWeight: FontWeight.bold,
              fontSize: Responsive.fontSize(context, small: 13, large: 15),
            ),
          ),
        ),
        const SizedBox(width: 6),
        if (promo.hasSaving)
          Flexible(
            child: Text(
              PedidosFormatters.money(promo.regularPrice, decimals: 3),
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: AppColors.themedWhite38,
                fontSize: Responsive.fontSize(context, small: 10, large: 11),
                decoration: TextDecoration.lineThrough,
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildGiftRow(PromotionItem promo) {
    return Row(
      children: [
        const Icon(Icons.card_giftcard, color: AppTheme.accentIndigo, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                promo.giftLabel,
                style: TextStyle(
                  color: AppTheme.accentIndigo,
                  fontWeight: FontWeight.bold,
                  fontSize: Responsive.fontSize(context, small: 11, large: 13),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (promo.minQty > 0)
                Text(
                  'Compra ${promo.minQty.toInt()}, lleva ${(promo.minQty + promo.giftQty).toInt()}',
                  style: TextStyle(
                    color: AppTheme.accentIndigo.withValues(alpha: 0.7),
                    fontSize: Responsive.fontSize(context, small: 9, large: 10),
                  ),
                ),
            ],
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
