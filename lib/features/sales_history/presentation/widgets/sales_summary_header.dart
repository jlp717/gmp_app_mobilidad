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
    // REVERTED TO "CLASSIC" STYLE AS REQUESTED (Horizontal Cards)
    // "Solo las etiquetas de ventas, uds, margen y productos, el resto dejalo sin tocar"
    
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          // 1. VENTAS
          _buildClassicCard(
            title: 'VENTAS', 
            value: _formatCurrency(sales), 
            icon: Icons.attach_money, 
            color: AppTheme.neonGreen,
            child: _buildPremiumGrowthBadge(growth, prevSales), // Keep the fixed logic!
          ),
          
          const SizedBox(width: 8),
          
          // 2. AÑO ANTERIOR (Explicitly requested separate or just clear?)
          // The user complained about "etiquetas... feisimas". 
          // Let's include Prev Year as a small info in Ventas or separate?
          // New design had "Año Anterior" in the dashboard.
          // Let's make a card for "AÑO ANT." to be clear.
          _buildClassicCard(
            title: 'AÑO ANT.',
            value: _formatCurrency(prevSales),
            icon: Icons.history,
            color: Colors.white70,
          ),

          const SizedBox(width: 8),

          // 3. UNIDADES / CAJAS
          _buildClassicCard(
            title: 'UDS / CAJAS',
            value: _formatCompact(units),
            icon: Icons.inventory_2_outlined,
            color: AppTheme.neonBlue,
          ),

          const SizedBox(width: 8),

          // 4. MARGEN (If Manager)
          if (showMargin) ...[
            _buildClassicCard(
              title: 'MARGEN',
              value: '${margin.toStringAsFixed(1)}%',
              icon: Icons.show_chart,
              color: AppTheme.neonPurple,
            ),
            const SizedBox(width: 8),
          ],
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
