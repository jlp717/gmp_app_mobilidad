import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';

class SalesSummaryHeader extends StatelessWidget {
  final Map<String, dynamic> summary;
  final bool showMargin;

  const SalesSummaryHeader({super.key, required this.summary, this.showMargin = true});

  @override
  Widget build(BuildContext context) {
    // Breakdown Logic
    final breakdown = (summary['breakdown'] as List?)?.map((e) => e as Map<String, dynamic>).toList() ?? [];
    
    // Formatting
    final fmt = NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 0);
    final fmtNum = NumberFormat.decimalPattern('es_ES');

    // Main Totals (Comparison)
    final curr = summary['current'] ?? {};
    final prev = summary['previous'] ?? {};
    final growth = summary['growth'] ?? {};
    
    final currSales = (curr['sales'] as num?)?.toDouble() ?? 0;
    final prevSales = (prev['sales'] as num?)?.toDouble() ?? 0;
    final saleGrowth = (growth['sales'] as num?)?.toDouble() ?? 0;
    
    final currMargin = (curr['margin'] as num?)?.toDouble() ?? 0;
    final prevMargin = (prev['margin'] as num?)?.toDouble() ?? 0;
    final marginGrowth = (growth['margin'] as num?)?.toDouble() ?? 0;
    
    final currUnits = (curr['units'] as num?)?.toDouble() ?? 0;
    final prevUnits = (prev['units'] as num?)?.toDouble() ?? 0;
    final unitGrowth = (growth['units'] as num?)?.toDouble() ?? 0;

    final productCount = (curr['products'] as num?)?.toInt(); // Nullable

    List<Widget> cards = [];

    // SALES
    cards.add(_buildCard('VENTAS', curr['label'], currSales, prev['label'], prevSales, saleGrowth, fmt, AppColors.neonBlue));

    // MARGIN (Conditional)
    if (showMargin) {
      cards.add(_buildCard('MARGEN', curr['label'], currMargin, prev['label'], prevMargin, marginGrowth, fmt, AppColors.success));
    }

    // UNITS
    cards.add(_buildCard('UDS / CAJAS', curr['label'], currUnits, prev['label'], prevUnits, unitGrowth, fmtNum, AppColors.neonPurple));

    // PRODUCTS (Conditional, if provided)
    if (productCount != null) {
      // Simplified card for count (no growth tracked for products yet in backend or redundant)
      // Actually backend doesn't send prevProducts count or growth. Just show count.
      cards.add(_buildSimpleCard('PRODUCTOS', '$productCount', Icons.local_offer, Colors.orange));
    }

    return Container(
      width: double.infinity,
      color: AppColors.cardColor,
      margin: const EdgeInsets.only(bottom: 1),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
            // 1. Comparison Cards (Dynamic Row)
            Row(
              children: cards.map((c) => Expanded(child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4.0),
                child: c,
              ))).toList(),
            ),
            
            // 2. Breakdown Section (Only if > 1 year)
            if (breakdown.length > 1) ...[
                const SizedBox(height: 12),
                const Text('Desglose por Año', style: TextStyle(color: Colors.white54, fontSize: 11)),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                     children: breakdown.map((item) {
                        final year = item['year']?.toString() ?? '-';
                        final sales = (item['sales'] as num?)?.toDouble() ?? 0;
                        final margin = (item['margin'] as num?)?.toDouble() ?? 0;
                        final units = (item['units'] as num?)?.toDouble() ?? 0;
                        
                        return Container(
                           width: 140,
                           margin: const EdgeInsets.only(right: 8),
                           padding: const EdgeInsets.all(12),
                           decoration: BoxDecoration(color: AppColors.backgroundColor.withOpacity(0.5), borderRadius: BorderRadius.circular(8)),
                           child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                 Text(year, style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary)),
                                 const SizedBox(height: 4),
                                 Text(fmt.format(sales), style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
                                 const SizedBox(height: 2),
                                 Row(
                                   mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                   children: [
                                      Text('${fmtNum.format(units)} Uds', style: const TextStyle(color: Colors.white54, fontSize: 10)),
                                      Text(fmt.format(margin), style: const TextStyle(color: AppColors.success, fontSize: 10)),
                                   ] 
                                 )
                              ],
                           ),
                        );
                     }).toList(),
                  ),
                ),
            ],
        ],
      ),
    );
  }

  Widget _buildCard(String title, String? currLabel, double currVal, String? prevLabel, double prevVal, double growth, NumberFormat fmt, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        // Enhanced gradient background for prominence
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            color.withOpacity(0.15),
            AppColors.backgroundColor.withOpacity(0.5),
          ],
        ),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3), width: 1),
      ),
      child: Column(
         crossAxisAlignment: CrossAxisAlignment.start,
         children: [
            // Title with year label
            Text(title, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            
            // Current year value - LARGE and prominent
            Row(
              children: [
                Text('$currLabel: ', style: const TextStyle(color: Colors.white54, fontSize: 10)),
                Expanded(
                  child: Text(
                    fmt.format(currVal), 
                    style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            
            // Previous year comparison - explicit label
            Row(
              children: [
                Text('$prevLabel: ', style: const TextStyle(color: Colors.white38, fontSize: 9)),
                Expanded(
                  child: Text(
                    fmt.format(prevVal), 
                    style: const TextStyle(color: Colors.white38, fontSize: 10),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            
            // Growth indicator - explicit "vs anterior" label
            _buildGrowthWithLabel(growth, prevVal),
         ],
      ),
    );
  }

  /// Enhanced growth display with explicit "vs anterior" label
  Widget _buildGrowthWithLabel(double value, double prevValue) {
      if (prevValue == 0) {
         return Container(
           padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
           decoration: BoxDecoration(
             color: AppColors.neonBlue.withOpacity(0.2), 
             borderRadius: BorderRadius.circular(6),
             border: Border.all(color: AppColors.neonBlue.withOpacity(0.4)),
           ),
           child: const Row(
             mainAxisSize: MainAxisSize.min,
             children: [
               Icon(Icons.fiber_new, color: AppColors.neonBlue, size: 12),
               SizedBox(width: 4),
               Text('NUEVO', style: TextStyle(color: AppColors.neonBlue, fontSize: 9, fontWeight: FontWeight.bold)),
             ],
           ),
         );
      }
      if (value.abs() < 0.1) {
         return Container(
           padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
           decoration: BoxDecoration(
             color: Colors.grey.withOpacity(0.2), 
             borderRadius: BorderRadius.circular(6),
           ),
           child: const Text('0% vs anterior', style: TextStyle(color: Colors.grey, fontSize: 10, fontWeight: FontWeight.bold)),
         );
      }
      final isPositive = value > 0;
      final displayColor = isPositive ? AppColors.success : AppColors.error;
      final icon = isPositive ? Icons.trending_up : Icons.trending_down;
      final sign = isPositive ? '+' : '';
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        decoration: BoxDecoration(
          color: displayColor.withOpacity(0.15), 
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: displayColor.withOpacity(0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
             Icon(icon, color: displayColor, size: 12),
             const SizedBox(width: 4),
             Text(
               '$sign${value.toStringAsFixed(1)}% vs anterior', 
               style: TextStyle(color: displayColor, fontSize: 10, fontWeight: FontWeight.bold),
             ),
          ],
        ),
      );
  }

  /// Original growth display (kept for backward compatibility)
  Widget _buildGrowth(double value, double prevValue) {
      if (prevValue == 0) {
         return Container(
           padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
           decoration: BoxDecoration(color: AppColors.neonBlue.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
           child: const Text('NUEVO', style: TextStyle(color: AppColors.neonBlue, fontSize: 9, fontWeight: FontWeight.bold)),
         );
      }
      if (value.abs() < 0.1) {
         return const Text('0%', style: TextStyle(color: Colors.grey, fontSize: 11, fontWeight: FontWeight.bold));
      }
      final isPositive = value > 0;
      final color = isPositive ? AppColors.success : AppColors.error;
      final icon = isPositive ? Icons.trending_up : Icons.trending_down;
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
           Icon(icon, color: color, size: 12),
           const SizedBox(width: 2),
           Text('${isPositive ? '+' : ''}${value.toStringAsFixed(1)}%', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
        ],
      );
  }

  Widget _buildSimpleCard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.backgroundColor.withOpacity(0.5), borderRadius: BorderRadius.circular(8)),
      child: Column(
         crossAxisAlignment: CrossAxisAlignment.start,
         mainAxisAlignment: MainAxisAlignment.center,
         children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                 Text(title, style: const TextStyle(color: Colors.white54, fontSize: 10)),
                 Icon(icon, color: color, size: 12),
              ],
            ),
            const SizedBox(height: 4),
            Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16)),
         ],
      ),
    );
  }
}
