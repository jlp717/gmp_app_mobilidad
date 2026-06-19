/// Recommendations Section
/// =======================
/// Collapsible horizontal scrollable sections for "Productos habituales" and "Otros clientes compran"
/// Ahora muestra datos enriquecidos: stock, referencia, unidad, estado comprado, margen (jefes ventas).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class RecommendationsSection extends ConsumerStatefulWidget {
  const RecommendationsSection({
    required this.onProductTap,
    super.key,
  });

  /// Callback al tocar una recomendacion. Recibe el Recommendation completo
  /// con todos los datos enriquecidos (stock, precios, unidades, etc.).
  final void Function(Recommendation item) onProductTap;

  @override
  ConsumerState<RecommendationsSection> createState() =>
      _RecommendationsSectionState();
}

class _RecommendationsSectionState
    extends ConsumerState<RecommendationsSection> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final provider = ref.watch(pedidosProvider);
    final hasHistory = provider.clientHistory.isNotEmpty;
    final hasSimilar = provider.similarClients.isNotEmpty;
    final canSeeMargin =
        ref.watch(pedidosProvider.select((p) => p.isMarginVisible));

    if (!hasHistory && !hasSimilar) return const SizedBox.shrink();

    final totalCount =
        provider.clientHistory.length + provider.similarClients.length;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Collapsible header
        InkWell(
          onTap: () => setState(() => _isExpanded = !_isExpanded),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.neonBlue.withValues(alpha: 0.15),
                        Colors.deepPurple.withValues(alpha: 0.15),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color: AppTheme.neonBlue.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.recommend,
                        color: AppTheme.neonBlue,
                        size: 16,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Recomendaciones ($totalCount)',
                        style: TextStyle(
                          color: AppTheme.neonBlue,
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
                  color: Colors.white38,
                  size: 20,
                ),
              ],
            ),
          ),
        ),
        // Expandable content
        if (_isExpanded) ...[
          if (hasHistory)
            _buildSection(
              context,
              title: 'Productos habituales',
              icon: Icons.history,
              items: provider.clientHistory,
              canSeeMargin: canSeeMargin,
            ),
          if (hasSimilar)
            _buildSection(
              context,
              title: 'Otros clientes compran',
              icon: Icons.people_outline,
              items: provider.similarClients,
              canSeeMargin: canSeeMargin,
            ),
        ],
      ],
    );
  }

  Widget _buildSection(
    BuildContext context, {
    required String title,
    required IconData icon,
    required List<Recommendation> items,
    required bool canSeeMargin,
  }) {
    final pad = Responsive.contentPadding(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: EdgeInsets.only(
            left: pad.left,
            right: pad.right,
            top: 4,
            bottom: 4,
          ),
          child: Row(
            children: [
              Icon(icon, color: Colors.white54, size: 14),
              const SizedBox(width: 4),
              Text(
                title,
                style: TextStyle(
                  color: Colors.white54,
                  fontWeight: FontWeight.w500,
                  fontSize: Responsive.fontSize(context, small: 11, large: 12),
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 124,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: pad.left),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (ctx, i) {
              final item = items[i];
              return _buildRecoCard(context, item, canSeeMargin);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildRecoCard(
    BuildContext context,
    Recommendation item,
    bool canSeeMargin,
  ) {
    final hasStock = item.hasStock;
    final isDual = item.unitsPerBox > 1;
    final unitLabel = item.unitMeasure.isNotEmpty
        ? item.unitMeasure
        : (isDual ? 'CAJAS' : 'UDS');

    // Badge principal: cantidad sugerida o frecuencia
    String mainBadge;
    if (item.source == 'history') {
      if (item.suggestedUnits > 0) {
        mainBadge = '${item.suggestedUnits.toStringAsFixed(0)} cj';
      } else if (item.totalEnvases > 0) {
        mainBadge = '${item.totalEnvases.toStringAsFixed(0)} cj tot';
      } else {
        mainBadge = '${item.frequency}x';
      }
    } else {
      mainBadge = '${item.clientCount} cl.';
    }

    return InkWell(
      onTap: () => widget.onProductTap(item),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 168,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: hasStock
                ? AppTheme.neonGreen.withValues(alpha: 0.3)
                : AppTheme.borderColor.withValues(alpha: 0.3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Code + name
            Text(
              item.code,
              style: TextStyle(
                color: AppTheme.neonBlue,
                fontWeight: FontWeight.w600,
                fontSize: Responsive.fontSize(context, small: 9, large: 10),
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              item.name,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w500,
                fontSize: Responsive.fontSize(context, small: 10, large: 11),
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const Spacer(),
            // Stock indicator
            Row(
              children: [
                Icon(
                  hasStock ? Icons.inventory_2 : Icons.inventory_2_outlined,
                  color: hasStock ? AppTheme.neonGreen : AppTheme.error,
                  size: 12,
                ),
                const SizedBox(width: 3),
                Expanded(
                  child: Text(
                    item.stockDisplay,
                    style: TextStyle(
                      color: hasStock ? AppTheme.neonGreen : AppTheme.error,
                      fontSize: 9,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            // Badges row
            Wrap(
              spacing: 4,
              runSpacing: 2,
              children: [
                // Main badge (suggested qty / frequency / client count)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    mainBadge,
                    style: TextStyle(
                      color: AppTheme.neonBlue,
                      fontSize:
                          Responsive.fontSize(context, small: 8, large: 9),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                // Unit badge
                if (isDual)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.neonPurple.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '${item.unitsPerBox.toStringAsFixed(0)}u/cj',
                      style: TextStyle(
                        color: AppTheme.neonPurple,
                        fontSize:
                            Responsive.fontSize(context, small: 8, large: 9),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                // Margin badge (jefes de ventas)
                if (canSeeMargin &&
                    item.precioTarifa1 > 0 &&
                    item.precioCliente > 0)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.warning.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '${((1 - item.precioCliente / item.precioTarifa1) * 100).toStringAsFixed(0)}%',
                      style: TextStyle(
                        color: AppTheme.warning,
                        fontSize:
                            Responsive.fontSize(context, small: 8, large: 9),
                        fontWeight: FontWeight.w600,
                      ),
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
