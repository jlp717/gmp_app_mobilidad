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
    // Determine status color based on growth
    Color statusColor = Colors.grey;
    if (growth > 0) statusColor = AppColors.success;
    else if (growth < 0 && prevVal > 0) statusColor = AppColors.error;
    else if (prevVal == 0 && currVal > 0) statusColor = AppColors.neonBlue;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Header: Title and Trend Icon
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title.toUpperCase(),
                style: TextStyle(
                  color: Colors.white.withOpacity(0.6),
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.0,
                ),
              ),
              if (prevVal > 0 || currVal > 0)
                _buildTrendIcon(growth, prevVal),
            ],
          ),
          
          // Main Value
          const SizedBox(height: 12),
          Text(
            fmt.format(currVal),
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
              letterSpacing: -0.5,
            ),
          ),
          
          // Comparison Footer
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (prevVal > 0) ...[
                  Text(
                    growth > 0 ? '+' : '',
                    style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    '${growth.abs().toStringAsFixed(1)}%',
                    style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    ' vs ${_formatCompact(prevVal)}',
                    style: TextStyle(color: statusColor.withOpacity(0.8), fontSize: 11),
                  ),
                ] else if (currVal > 0) ...[
                   Text('NUEVO', style: TextStyle(color: AppColors.neonBlue, fontSize: 10, fontWeight: FontWeight.bold)),
                ] else ...[
                   const Text('Sin actividad', style: TextStyle(color: Colors.grey, fontSize: 10)),
                ]
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTrendIcon(double growth, double prevVal) {
    IconData icon;
    Color color;
    
    if (prevVal == 0) {
      icon = Icons.fiber_new;
      color = AppColors.neonBlue;
    } else if (growth > 0) {
      icon = Icons.trending_up;
      color = AppColors.success;
    } else if (growth < 0) {
      icon = Icons.trending_down;
      color = AppColors.error;
    } else {
      icon = Icons.remove;
      color = Colors.grey;
    }

    return Icon(icon, color: color, size: 16);
  }

  // Helper for compact formatting in footer
  String _formatCompact(double v) {
    if (v >= 1000000) return '${(v/1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v/1000).toStringAsFixed(0)}k';
    return v.toStringAsFixed(0);
  }


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
