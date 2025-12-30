import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/formatters.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/entities/dashboard_metrics.dart';

/// [SummaryStatsWidget] - Widget de resumen estadístico premium
///
/// CARACTERÍSTICAS:
/// - Diseño profesional con cards modernos
/// - Información estadística clave del negocio
/// - Indicadores visuales de rendimiento
/// - Comparativas y tendencias
/// - Animaciones sutiles
///
/// UBICACIÓN: Entre gráficas y Accesos Rápidos
class SummaryStatsWidget extends StatelessWidget {
  const SummaryStatsWidget({
    super.key,
    required this.metrics,
  });

  final DashboardMetrics metrics;

  @override
  Widget build(BuildContext context) {
    // Calcular estadísticas derivadas
    final totalRevenue = metrics.vencimientos.totalAmount + 
                        metrics.cobros.totalAmount + 
                        metrics.pedidos.totalAmount;
    final totalDocuments = metrics.vencimientos.pendingCount +
                          metrics.cobros.realizedCount +
                          metrics.pedidos.pendingCount;
    
    // Calcular promedio de ventas diarias
    final dailyData = metrics.salesSummary.dailyData;
    final avgDailySales = dailyData.isNotEmpty
        ? dailyData.fold<double>(0.0, (sum, day) => sum + day.sales) / dailyData.length
        : 0.0;
    
    // Determinar tendencia (simplificado)
    final isGrowing = dailyData.length >= 2 
        ? dailyData.last.sales > dailyData.first.sales
        : false;

    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header con título e ícono
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    gradient: AppTheme.primaryGradient,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.analytics_outlined,
                    color: Colors.white,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Resumen Ejecutivo',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        'Visión general del período',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                // Indicador de tendencia
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: isGrowing 
                        ? AppTheme.successColor.withOpacity(0.1)
                        : AppTheme.errorColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isGrowing ? Icons.trending_up : Icons.trending_down,
                        color: isGrowing ? AppTheme.successColor : AppTheme.errorColor,
                        size: 18,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        isGrowing ? 'Creciendo' : 'Decreciendo',
                        style: TextStyle(
                          color: isGrowing ? AppTheme.successColor : AppTheme.errorColor,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 24),

            // Grid de estadísticas principales
            Row(
              children: [
                Expanded(
                  child: _buildStatCard(
                    context,
                    icon: Icons.payments_outlined,
                    label: 'Facturación Total',
                    value: Formatters.currency(totalRevenue),
                    gradient: AppTheme.primaryGradient,
                    subtitle: '$totalDocuments documentos',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildStatCard(
                    context,
                    icon: Icons.trending_up,
                    label: 'Venta Promedio Diaria',
                    value: Formatters.currency(avgDailySales),
                    gradient: AppTheme.successGradient,
                    subtitle: 'Últimos ${dailyData.length} días',
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Estadísticas secundarias
            Row(
              children: [
                Expanded(
                  child: _buildMiniStatCard(
                    context,
                    icon: Icons.local_shipping_outlined,
                    label: 'Unidades Vendidas',
                    value: metrics.salesSummary.totalUnits.toString(),
                    color: AppTheme.infoColor,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMiniStatCard(
                    context,
                    icon: Icons.percent,
                    label: 'Tasa de Realización',
                    value: _calculateCompletionRate(metrics),
                    color: AppTheme.warningColor,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildMiniStatCard(
                    context,
                    icon: Icons.schedule,
                    label: 'Pendientes',
                    value: (metrics.vencimientos.pendingCount + 
                           metrics.pedidos.pendingCount).toString(),
                    color: AppTheme.errorColor,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Construye una tarjeta de estadística principal
  Widget _buildStatCard(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    required LinearGradient gradient,
    String? subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white,
            gradient.colors.first.withOpacity(0.05),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: gradient.colors.first.withOpacity(0.2),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: gradient.colors.first.withOpacity(0.1),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Ícono
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              gradient: gradient,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              icon,
              color: Colors.white,
              size: 20,
            ),
          ),
          const SizedBox(height: 12),
          // Label
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          // Valor
          Text(
            value,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
              color: AppTheme.textPrimary,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: AppTheme.textTertiary,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Construye una mini tarjeta de estadística
  Widget _buildMiniStatCard(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: color.withOpacity(0.2),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: color,
            size: 20,
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: AppTheme.textSecondary,
              fontSize: 10,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  /// Calcula la tasa de realización de tareas
  String _calculateCompletionRate(DashboardMetrics metrics) {
    final completed = metrics.cobros.realizedCount;
    final total = completed + 
                  metrics.vencimientos.pendingCount + 
                  metrics.pedidos.pendingCount;
    
    if (total == 0) return '0%';
    
    final rate = (completed / total * 100).toStringAsFixed(0);
    return '$rate%';
  }
}
