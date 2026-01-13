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
    // PREMIUM ROW-STYLE SUMMARY - Full width cards with year comparison
    final isNewClient = prevSales < 0.01 && sales > 0;
    final isPositive = growth >= 0;
    
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.surfaceColor,
            AppTheme.darkCard,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.3), blurRadius: 8, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        children: [
          // Main row with VENTAS comparison
          Row(
            children: [
              // VENTAS Column (Este año)
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.attach_money, color: AppTheme.neonGreen, size: 20),
                        const SizedBox(width: 6),
                        const Text('VENTAS', style: TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 11, letterSpacing: 1)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _formatCurrency(sales),
                      style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    // Año anterior o NUEVO badge
                    if (isNewClient)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.neonBlue.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.neonBlue.withOpacity(0.4)),
                        ),
                        child: const Text('NUEVO', style: TextStyle(color: AppColors.neonBlue, fontWeight: FontWeight.bold, fontSize: 11)),
                      )
                    else
                      Row(
                        children: [
                          Text('Año ant: ${_formatCurrency(prevSales)}', style: TextStyle(color: Colors.grey.shade400, fontSize: 12)),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: (isPositive ? AppColors.success : AppColors.error).withOpacity(0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(isPositive ? Icons.arrow_upward : Icons.arrow_downward, 
                                     color: isPositive ? AppColors.success : AppColors.error, size: 12),
                                const SizedBox(width: 2),
                                Text(
                                  '${isPositive ? '+' : ''}${growth.toStringAsFixed(1)}%',
                                  style: TextStyle(color: isPositive ? AppColors.success : AppColors.error, fontWeight: FontWeight.bold, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
              
              // Divider
              Container(width: 1, height: 60, color: Colors.white12, margin: const EdgeInsets.symmetric(horizontal: 12)),
              
              // UNIDADES Column
              Expanded(
                flex: 2,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.inventory_2_outlined, color: AppTheme.neonBlue, size: 16),
                        const SizedBox(width: 4),
                        const Text('UNIDADES', style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold, fontSize: 10, letterSpacing: 0.5)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _formatCompact(units),
                      style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
              
              // MARGEN Column (only if showMargin)
              if (showMargin) ...[
                Container(width: 1, height: 60, color: Colors.white12, margin: const EdgeInsets.symmetric(horizontal: 12)),
                Expanded(
                  flex: 2,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.show_chart, color: AppTheme.neonPurple, size: 16),
                          const SizedBox(width: 4),
                          const Text('MARGEN', style: TextStyle(color: AppTheme.neonPurple, fontWeight: FontWeight.bold, fontSize: 10, letterSpacing: 0.5)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${margin.toStringAsFixed(1)}%',
                        style: TextStyle(
                          color: margin >= 15 ? AppTheme.success : (margin >= 10 ? AppTheme.warning : AppTheme.error),
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildClassicCard({required String title, required String value, required IconData icon, required Color color, Widget? child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      constraints: const BoxConstraints(minWidth: 140),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
        boxShadow: [
          BoxShadow(color: Colors.black26, blurRadius: 4, offset: const Offset(0, 2))
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 8),
              Text(title, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 12),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
          if (child != null) ...[
            const SizedBox(height: 8),
            child,
          ]
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
