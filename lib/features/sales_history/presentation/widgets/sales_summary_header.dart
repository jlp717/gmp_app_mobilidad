import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_colors.dart';

class SalesSummaryHeader extends StatelessWidget {
  final Map<String, dynamic> summary;
  final bool showMargin;

  const SalesSummaryHeader({super.key, required this.summary, this.showMargin = true});

  @override
  Widget build(BuildContext context) {
    // Formatting
    final fmt = NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 0);

    // Main Totals (Comparison)
    final curr = summary['current'] ?? {};
    final prev = summary['previous'] ?? {};
    final growth = summary['growth'] ?? {};
    
    final currSales = (curr['sales'] as num?)?.toDouble() ?? 0;
    final prevSales = (prev['sales'] as num?)?.toDouble() ?? 0;
    final saleGrowth = (growth['sales'] as num?)?.toDouble() ?? 0;
    
    final currMargin = (curr['margin'] as num?)?.toDouble() ?? 0;
    //final prevMargin = (prev['margin'] as num?)?.toDouble() ?? 0;
    //final marginGrowth = (growth['margin'] as num?)?.toDouble() ?? 0;
    
    final currUnits = (curr['units'] as num?)?.toDouble() ?? 0;
    //final prevUnits = (prev['units'] as num?)?.toDouble() ?? 0;
    //final unitGrowth = (growth['units'] as num?)?.toDouble() ?? 0;
    
    double totalMargin = currMargin; // Roughly total margin amount if margin is %? 
    // Wait, the input summary usually has 'margin' as a %.
    // Let's check `ProductHistoryPage` or typical usage.
    // If we assume `curr['margin']` is %, we need the absolute if we want to show it.
    // But in the new design we show `MARGEN %`.
    
    // For calculating "Total Margin" amount if not provided:
    // Usually sales * margin% / 100.
    // But let's stick to what we have.
    
    return Column(
      children: [
        _buildUnifiedSummary(currSales, prevSales, saleGrowth, currUnits, currMargin, 0, 0),
        
        // Breakdown Section (Only if > 1 year)
        if ((summary['breakdown'] as List?)?.isNotEmpty ?? false) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                   const Text('DESGLOSE ANUAL', style: TextStyle(color: Colors.white54, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                   const SizedBox(height: 8),
                   SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                         children: (summary['breakdown'] as List).map((item) {
                            final i = item as Map<String, dynamic>;
                            final year = i['year']?.toString() ?? '-';
                            final s = (i['sales'] as num?)?.toDouble() ?? 0;
                            final m = (i['margin'] as num?)?.toDouble() ?? 0;
                            final u = (i['units'] as num?)?.toDouble() ?? 0;
                            
                            return Container(
                               margin: const EdgeInsets.only(right: 8),
                               padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                               decoration: BoxDecoration(
                                 color: AppTheme.surfaceColor, 
                                 borderRadius: BorderRadius.circular(8),
                                 border: Border.all(color: Colors.white10)
                               ),
                               child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                     Text(year, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Colors.white70)),
                                     const SizedBox(height: 2),
                                     Text(fmt.format(s), style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
                                     const SizedBox(height: 2),
                                     Text('${u.toInt()} Uds • ${m.toStringAsFixed(1)}%', style: const TextStyle(color: Colors.white38, fontSize: 10)),
                                  ],
                               ),
                            );
                         }).toList(),
                      ),
                   ),
                ],
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildUnifiedSummary(double sales, double prevSales, double growth, double units, double margin, double totalMargin, int uniqueClients) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.darkBase, // Solid dark background
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
        boxShadow: [
          BoxShadow(color: Colors.black38, blurRadius: 12, offset: const Offset(0, 6)),
        ],
      ),
      child: Column(
        children: [
           // Top Row: Sales & Growth (The Hero Metric)
           Row(
             mainAxisAlignment: MainAxisAlignment.spaceBetween,
             crossAxisAlignment: CrossAxisAlignment.start,
             children: [
               Column(
                 crossAxisAlignment: CrossAxisAlignment.start,
                 children: [
                   Text('VENTAS ACUMULADAS', style: TextStyle(color: Colors.white54, fontSize: 10, letterSpacing: 1.5, fontWeight: FontWeight.bold)),
                   const SizedBox(height: 6),
                   Text(_formatCurrency(sales), style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                 ],
               ),
               // Growth Pill
               _buildPremiumGrowthBadge(growth, prevSales),
             ],
           ),
           
           const SizedBox(height: 20),
           Divider(color: Colors.white10, height: 1),
           const SizedBox(height: 20),
           
           // Bottom Grid: Comparison | Units | Margin
           Row(
             crossAxisAlignment: CrossAxisAlignment.start,
             children: [
               // 1. Previous Year Comparison
               Expanded(
                 child: Column(
                   crossAxisAlignment: CrossAxisAlignment.start,
                   children: [
                      Text('AÑO ANTERIOR', style: TextStyle(color: Colors.white38, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.5)),
                      const SizedBox(height: 4),
                      Text(_formatCurrency(prevSales), style: const TextStyle(color: Colors.white70, fontSize: 15, fontWeight: FontWeight.w600)),
                   ],
                 ),
               ),
               
               // 2. Units
               Expanded(
                 child: Column(
                   crossAxisAlignment: CrossAxisAlignment.start,
                   children: [
                      Text('UNIDADES', style: TextStyle(color: Colors.white38, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.5)),
                      const SizedBox(height: 4),
                      Text('${_formatCompact(units)}', style: const TextStyle(color: Colors.white70, fontSize: 15, fontWeight: FontWeight.w600)),
                   ],
                 ),
               ),
               
               // 3. Margin (if manager)
               if (showMargin)
               Expanded(
                 child: Column(
                   crossAxisAlignment: CrossAxisAlignment.end,
                   children: [
                      Text('MARGEN', style: TextStyle(color: Colors.white38, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.5)),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: margin >= 0 ? AppColors.success.withOpacity(0.15) : AppColors.error.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(4)
                        ),
                        child: Text('${margin.toStringAsFixed(1)}%', 
                            style: TextStyle(color: margin >= 0 ? AppColors.success : AppColors.error, fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                   ],
                 ),
               ),
             ],
           ),
        ],
      ),
    );
  }
  
  Widget _buildPremiumGrowthBadge(double growth, double prevSales) {
      if (prevSales == 0) {
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.neonBlue.withOpacity(0.15),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.neonBlue.withOpacity(0.3)),
            ),
            child: const Text('NUEVO', style: TextStyle(color: AppColors.neonBlue, fontWeight: FontWeight.bold, fontSize: 10)),
          );
      }
      
      final isPositive = growth >= 0;
      final color = isPositive ? AppColors.success : AppColors.error;
      
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withOpacity(0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(isPositive ? Icons.trending_up : Icons.trending_down, color: color, size: 14),
            const SizedBox(width: 4),
            Text('${growth.abs().toStringAsFixed(1)}%', style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
          ],
        ),
      );
  }

  String _formatCurrency(double value) {
    return NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 0).format(value);
  }

  String _formatCompact(double value) {
    return NumberFormat.decimalPattern('es_ES').format(value);
  }
}
