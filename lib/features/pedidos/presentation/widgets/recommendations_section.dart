/// Recommendations Section
/// =======================
/// Horizontal scrollable sections for "Productos habituales" and "Otros clientes compran"

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../providers/pedidos_provider.dart';
import '../../data/pedidos_service.dart';

class RecommendationsSection extends StatelessWidget {
  final void Function(String code, String name) onProductTap;

  const RecommendationsSection({
    Key? key,
    required this.onProductTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PedidosProvider>();
    final hasHistory = provider.clientHistory.isNotEmpty;
    final hasSimilar = provider.similarClients.isNotEmpty;

    if (!hasHistory && !hasSimilar) return const SizedBox.shrink();

    return Container(
      color: AppTheme.darkBase,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hasHistory)
            _buildSection(
              context,
              title: 'Productos habituales',
              icon: Icons.history,
              items: provider.clientHistory,
              badgeBuilder: (r) => '${r.frequency}x',
            ),
          if (hasSimilar)
            _buildSection(
              context,
              title: 'Otros clientes compran',
              icon: Icons.people_outline,
              items: provider.similarClients,
              badgeBuilder: (r) => '${r.clientCount} cl.',
            ),
        ],
      ),
    );
  }

  Widget _buildSection(
    BuildContext context, {
    required String title,
    required IconData icon,
    required List<Recommendation> items,
    required String Function(Recommendation) badgeBuilder,
  }) {
    final pad = Responsive.contentPadding(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: EdgeInsets.only(
              left: pad.left, right: pad.right, top: 8, bottom: 4),
          child: Row(
            children: [
              Icon(icon, color: AppTheme.neonBlue, size: 16),
              const SizedBox(width: 6),
              Text(
                title,
                style: TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w600,
                  fontSize:
                      Responsive.fontSize(context, small: 12, large: 14),
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 72,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: pad.left),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (ctx, i) {
              final item = items[i];
              return _buildRecoCard(context, item, badgeBuilder(item));
            },
          ),
        ),
      ],
    );
  }

  Widget _buildRecoCard(
      BuildContext context, Recommendation item, String badge) {
    return InkWell(
      onTap: () => onProductTap(item.code, item.name),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 140,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.borderColor.withOpacity(0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              item.name,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w500,
                fontSize:
                    Responsive.fontSize(context, small: 11, large: 12),
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.12),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                badge,
                style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize:
                      Responsive.fontSize(context, small: 10, large: 11),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
