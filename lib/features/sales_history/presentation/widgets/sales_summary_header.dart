import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_colors.dart';

class SalesSummaryHeader extends StatelessWidget {
  final Map<String, dynamic> summary;
  final bool showMargin;
  final bool isJefeVentas;

  const SalesSummaryHeader({
    super.key, 
    required this.summary, 
    this.showMargin = true,
    this.isJefeVentas = true, // Por defecto muestra vista de jefe
  });

  @override
  Widget build(BuildContext context) {
    // Main Totals (Comparison)
    final curr = summary['current'] ?? {};
    final prev = summary['previous'] ?? {};
    final growth = summary['growth'] ?? {};
    
    // Check if client is new from backend response
    final isClientNewFromBackend = summary['isNewClient'] == true;
    
    final currSales = (curr['sales'] as num?)?.toDouble() ?? 0;
    final prevSales = (prev['sales'] as num?)?.toDouble() ?? 0;
    final saleGrowth = (growth['sales'] as num?)?.toDouble() ?? 0;
    
    final currMargin = (curr['margin'] as num?)?.toDouble() ?? 0;
    final prevMargin = (prev['margin'] as num?)?.toDouble() ?? 0;
    final marginGrowth = (growth['margin'] as num?)?.toDouble() ?? 0;
    
    final currUnits = (curr['units'] as num?)?.toDouble() ?? 0;
    final prevUnits = (prev['units'] as num?)?.toDouble() ?? 0;
    final unitGrowth = (growth['units'] as num?)?.toDouble() ?? 0;
    
    // Number of products (SKUs) sold
    final currProducts = (curr['productCount'] as num?)?.toInt() ?? 0;
    final prevProducts = (prev['productCount'] as num?)?.toInt() ?? 0;
    final productGrowth = (growth['productCount'] as num?)?.toDouble() ?? 
        (prevProducts > 0 ? ((currProducts - prevProducts) / prevProducts) * 100 : (currProducts > 0 ? 100 : 0));
    
    // Fallback: calculate isNewClient if not provided by backend
    final isNewClient = isClientNewFromBackend || (prevSales < 0.01 && currSales > 0);
    
    return Column(
      children: [
        _buildPremiumSummary(
          currSales, prevSales, saleGrowth, 
          currUnits, prevUnits, unitGrowth,
          currMargin, prevMargin, marginGrowth,
          currProducts, prevProducts, productGrowth,
          isNewClient,
        ),
        
        // Breakdown Section (Only if > 1 year)
        if ((summary['breakdown'] as List?)?.isNotEmpty ?? false) ...[
          _buildBreakdownSection(summary['breakdown'] as List),
        ],
      ],
    );
  }

  Widget _buildBreakdownSection(List breakdown) {
    final fmt = NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 0);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 3,
                height: 12,
                decoration: BoxDecoration(
                  color: AppTheme.neonGreen,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 8),
              const Text(
                'HISTÓRICO ANUAL', 
                style: TextStyle(color: Colors.white60, fontSize: 10, fontWeight: FontWeight.w600, letterSpacing: 1.5)
              ),
            ],
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: breakdown.map((item) {
                final i = item as Map<String, dynamic>;
                final year = i['year']?.toString() ?? '-';
                final s = (i['sales'] as num?)?.toDouble() ?? 0;
                final m = (i['margin'] as num?)?.toDouble() ?? 0;
                final u = (i['units'] as num?)?.toDouble() ?? 0;
                
                return Container(
                  margin: const EdgeInsets.only(right: 10),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.surfaceColor, AppTheme.darkCard.withOpacity(0.8)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(year, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.neonGreen)),
                      const SizedBox(height: 4),
                      Text(fmt.format(s), style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 2),
                      Text('${_formatCompact(u)} Uds${showMargin ? ' • ${m.toStringAsFixed(1)}%' : ''}', 
                           style: const TextStyle(color: Colors.white38, fontSize: 10)),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPremiumSummary(
    double sales, double prevSales, double salesGrowth, 
    double units, double prevUnits, double unitsGrowth,
    double margin, double prevMargin, double marginGrowth,
    int productCount, int prevProductCount, double productGrowth,
    bool isNewClient,
  ) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.surfaceColor,
            AppTheme.darkCard,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.4), blurRadius: 12, offset: const Offset(0, 6)),
        ],
      ),
      child: Column(
        children: [
          // Header con VENTAS principal
          _buildMainSalesSection(sales, prevSales, salesGrowth, isNewClient),
          
          // Separator
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.transparent, Colors.white24, Colors.transparent],
              ),
            ),
          ),
          
          // Secondary metrics row - MÁS COMPACTO
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                // UDS / CAJAS / KG
                Expanded(
                  child: _buildCompactMetricCard(
                    icon: Icons.inventory_2_outlined,
                    iconColor: AppTheme.neonBlue,
                    label: 'UDS',
                    value: _formatCompact(units),
                    prevValue: prevUnits,
                    growth: unitsGrowth,
                    isNew: prevUnits < 0.01 && units > 0,
                    isClientNew: isNewClient,
                  ),
                ),
                const SizedBox(width: 8),
                
                // PRODUCTOS
                Expanded(
                  child: _buildCompactMetricCard(
                    icon: Icons.category_outlined,
                    iconColor: AppTheme.warning,
                    label: 'PRODS',
                    value: productCount.toString(),
                    prevValue: prevProductCount.toDouble(),
                    growth: productGrowth,
                    isNew: prevProductCount == 0 && productCount > 0,
                    isInteger: true,
                    isClientNew: isNewClient,
                  ),
                ),
                
                // MARGEN (solo jefe de ventas)
                if (showMargin) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildCompactMarginCard(margin, prevMargin, marginGrowth, isClientNew: isNewClient),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMainSalesSection(double sales, double prevSales, double salesGrowth, bool isNewClient) {
    final isPositive = salesGrowth >= 0;
    
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Icon + Label
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.neonGreen.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(Icons.euro, color: AppTheme.neonGreen, size: 16),
          ),
          const SizedBox(width: 8),
          // Main value
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _formatCurrency(sales),
                  style: const TextStyle(
                    color: Colors.white, 
                    fontSize: 22, 
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'VENTAS', 
                  style: TextStyle(color: AppTheme.neonGreen.withOpacity(0.7), fontWeight: FontWeight.w500, fontSize: 9, letterSpacing: 1),
                ),
              ],
            ),
          ),
          // Badge de estado o comparación
          if (isNewClient)
            _buildStatusBadge('NUEVO', AppColors.neonBlue)
          else
            _buildPreviousYearComparison(prevSales, salesGrowth, isPositive),
        ],
      ),
    );
  }

  Widget _buildPreviousYearComparison(double prevSales, double growth, bool isPositive) {
    if (isJefeVentas) {
      // Jefe de ventas: muestra "-96% vs 1.655,82 €"
      final growthText = '${isPositive ? '+' : ''}${growth.toStringAsFixed(1)}%';
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              growthText,
              style: TextStyle(
                color: isPositive ? AppColors.success : AppColors.error,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            Text(
              ' vs ',
              style: TextStyle(color: Colors.white38, fontSize: 12),
            ),
            Text(
              _formatCurrencyDecimals(prevSales),
              style: TextStyle(color: Colors.white60, fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      );
    } else {
      // Comercial: muestra año anterior y este año
      return Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            'Año anterior',
            style: TextStyle(color: Colors.white38, fontSize: 10),
          ),
          const SizedBox(height: 2),
          Text(
            _formatCurrencyDecimals(prevSales),
            style: TextStyle(color: Colors.white60, fontSize: 16, fontWeight: FontWeight.w600),
          ),
        ],
      );
    }
  }

  Widget _buildMetricCard({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String value,
    required double prevValue,
    required double growth,
    required bool isNew,
    bool isInteger = false,
  }) {
    final isPositive = growth >= 0;
    final prevText = isInteger ? prevValue.toInt().toString() : _formatCompact(prevValue);
    
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              Icon(icon, color: iconColor, size: 14),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label, 
                  style: TextStyle(
                    color: iconColor.withOpacity(0.9), 
                    fontWeight: FontWeight.w600, 
                    fontSize: 9, 
                    letterSpacing: 0.5
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          
          // Value
          Text(
            value,
            style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          
          // Comparison
          if (isNew)
            _buildMiniStatusBadge('NUEVO', AppColors.neonBlue)
          else if (prevValue > 0)
            _buildMetricComparison(prevText, growth, isPositive),
        ],
      ),
    );
  }

  // === VERSIONES COMPACTAS ===
  Widget _buildCompactMetricCard({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String value,
    required double prevValue,
    required double growth,
    required bool isNew,
    bool isInteger = false,
    bool isClientNew = false,
  }) {
    final isPositive = growth >= 0;
    final prevText = isInteger ? prevValue.toInt().toString() : _formatCompact(prevValue);
    
    // Si el cliente es nuevo, mostrar NUEVO en azul para todas las métricas
    final showNuevo = isClientNew || isNew;
    
    return Container(
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(minHeight: 70), // Altura mínima uniforme
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Value principal
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          // Label
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: iconColor, size: 10),
              const SizedBox(width: 3),
              Text(label, style: TextStyle(color: iconColor.withOpacity(0.8), fontWeight: FontWeight.w500, fontSize: 8)),
            ],
          ),
          const SizedBox(height: 4),
          // Comparison - siempre mostrar algo para altura uniforme
          if (showNuevo)
            _buildMiniStatusBadge('NUEVO', AppColors.neonBlue)
          else if (prevValue > 0)
            _buildCompactComparison(prevText, growth, isPositive)
          else
            const SizedBox(height: 16), // Placeholder para mantener altura
        ],
      ),
    );
  }

  Widget _buildCompactMarginCard(double margin, double prevMargin, double marginGrowth, {bool isClientNew = false}) {
    final isPositive = marginGrowth >= 0;
    final marginColor = margin >= 15 ? AppTheme.success : (margin >= 10 ? AppTheme.warning : AppTheme.error);
    
    return Container(
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(minHeight: 70), // Altura mínima uniforme
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Value
          Text('${margin.toStringAsFixed(1)}%', style: TextStyle(color: marginColor, fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          // Label
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.show_chart, color: AppTheme.neonPurple, size: 10),
              const SizedBox(width: 3),
              Text('MARGEN', style: TextStyle(color: AppTheme.neonPurple.withOpacity(0.8), fontWeight: FontWeight.w500, fontSize: 8)),
            ],
          ),
          const SizedBox(height: 4),
          // Comparison
          if (isClientNew)
            _buildMiniStatusBadge('NUEVO', AppColors.neonBlue)
          else if (prevMargin > 0)
            _buildCompactComparison('${prevMargin.toStringAsFixed(1)}%', marginGrowth, isPositive)
          else if (margin > 0)
            _buildMiniStatusBadge('NUEVO', AppColors.neonBlue)
          else
            const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _buildCompactComparison(String prevText, double growth, bool isPositive) {
    if (isJefeVentas) {
      final growthText = '${isPositive ? '+' : ''}${growth.toStringAsFixed(0)}%';
      return Text(
        '$growthText vs $prevText',
        style: TextStyle(color: isPositive ? AppColors.success : AppColors.error, fontSize: 9, fontWeight: FontWeight.w500),
        overflow: TextOverflow.ellipsis,
      );
    } else {
      return Text('Ant: $prevText', style: TextStyle(color: Colors.white38, fontSize: 9));
    }
  }

  Widget _buildMarginCard(double margin, double prevMargin, double marginGrowth) {
    final isPositive = marginGrowth >= 0;
    final marginColor = margin >= 15 ? AppTheme.success : (margin >= 10 ? AppTheme.warning : AppTheme.error);
    
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              Icon(Icons.show_chart, color: AppTheme.neonPurple, size: 14),
              const SizedBox(width: 6),
              Text(
                'MARGEN', 
                style: TextStyle(
                  color: AppTheme.neonPurple.withOpacity(0.9), 
                  fontWeight: FontWeight.w600, 
                  fontSize: 9, 
                  letterSpacing: 0.5
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          
          // Value
          Text(
            '${margin.toStringAsFixed(1)}%',
            style: TextStyle(color: marginColor, fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          
          // Comparison
          if (prevMargin > 0)
            _buildMetricComparison('${prevMargin.toStringAsFixed(1)}%', marginGrowth, isPositive, isMargin: true)
          else if (margin > 0)
            _buildMiniStatusBadge('NUEVO', AppColors.neonBlue),
        ],
      ),
    );
  }

  Widget _buildMetricComparison(String prevText, double growth, bool isPositive, {bool isMargin = false}) {
    if (isJefeVentas) {
      // Jefe: muestra % crecimiento vs valor anterior
      final growthText = '${isPositive ? '+' : ''}${growth.toStringAsFixed(1)}%';
      return Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: (isPositive ? AppColors.success : AppColors.error).withOpacity(0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              growthText,
              style: TextStyle(
                color: isPositive ? AppColors.success : AppColors.error, 
                fontWeight: FontWeight.bold, 
                fontSize: 10
              ),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              'vs $prevText',
              style: TextStyle(color: Colors.white38, fontSize: 9),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    } else {
      // Comercial: solo muestra valor anterior
      return Text(
        'Ant: $prevText',
        style: TextStyle(color: Colors.white38, fontSize: 10),
      );
    }
  }

  Widget _buildStatusBadge(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        text, 
        style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 10, letterSpacing: 0.5),
      ),
    );
  }

  Widget _buildMiniStatusBadge(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 9)),
    );
  }

  Widget _buildGrowthBadge(double growth, bool isPositive) {
    final color = isPositive ? AppColors.success : AppColors.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isPositive ? Icons.trending_up : Icons.trending_down, 
            color: color, 
            size: 14
          ),
          const SizedBox(width: 4),
          Text(
            '${isPositive ? '+' : ''}${growth.toStringAsFixed(1)}%',
            style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 11),
          ),
        ],
      ),
    );
  }

  String _formatCurrency(double value) {
    return NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 0).format(value);
  }

  String _formatCurrencyDecimals(double value) {
    return NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 2).format(value);
  }

  String _formatCompact(double value) {
    if (value >= 1000000) {
      return '${(value / 1000000).toStringAsFixed(1)}M';
    } else if (value >= 1000) {
      return '${(value / 1000).toStringAsFixed(1)}K';
    }
    return NumberFormat.decimalPattern('es_ES').format(value);
  }
}
