/// Complementary Products Widget
/// ==============================
/// Shows products frequently bought together with items in cart

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class ComplementaryProducts extends StatelessWidget {
  final List<Map<String, dynamic>> products;
  final void Function(String code, String name) onAdd;

  const ComplementaryProducts({
    Key? key,
    required this.products,
    required this.onAdd,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    if (products.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Row(
            children: [
              const Icon(Icons.auto_awesome, color: AppTheme.neonPurple, size: 16),
              const SizedBox(width: 6),
              Text(
                'Productos complementarios',
                style: TextStyle(
                  color: AppTheme.neonPurple,
                  fontWeight: FontWeight.w600,
                  fontSize: Responsive.fontSize(context, small: 13, large: 14),
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 72,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            itemCount: products.length,
            itemBuilder: (ctx, i) {
              final p = products[i];
              final code = (p['code'] ?? '').toString();
              final name = (p['name'] ?? '').toString();
              final cooc = (p['cooccurrences'] as num?)?.toInt() ?? 0;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: InkWell(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    onAdd(code, name);
                  },
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    width: 160,
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppTheme.darkCard,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3), width: 0.5),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(name, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w500),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 2),
                        Text(code, style: TextStyle(color: AppTheme.neonPurple.withOpacity(0.7), fontSize: 9)),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Icon(Icons.link, color: Colors.white38, size: 10),
                            const SizedBox(width: 3),
                            Text('$cooc pedidos juntos', style: const TextStyle(color: Colors.white38, fontSize: 9)),
                            const Spacer(),
                            Icon(Icons.add_circle, color: AppTheme.neonPurple, size: 16),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
