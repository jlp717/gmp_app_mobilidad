/// COBROS SUMMARY CARD
/// Tarjeta de resumen diario de entregas

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class CobrosSummaryCard extends StatelessWidget {
  final int totalPendientes;
  final int totalCompletadas;
  final int totalCTR;
  final double importeTotal;

  const CobrosSummaryCard({
    super.key,
    required this.totalPendientes,
    required this.totalCompletadas,
    required this.totalCTR,
    required this.importeTotal,
  });

  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
    final total = totalPendientes + totalCompletadas;
    final progreso = total > 0 ? totalCompletadas / total : 0.0;

    return Container(
      padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.surfaceColor,
            AppTheme.surfaceColor.withOpacity(0.7),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: Colors.white.withOpacity(0.05),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 10,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Título
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.summarize,
                  color: AppTheme.neonBlue,
                  size: 18,
                ),
              ),
              const SizedBox(width: 12),
              const Text(
                'Resumen del día',
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 15,
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 20),
          
          // Progreso circular
          Row(
            children: [
              // Indicador circular
              SizedBox(
                width: Responsive.value(context, phone: 60, desktop: 80),
                height: Responsive.value(context, phone: 60, desktop: 80),
                child: Stack(
                  children: [
                    SizedBox.expand(
                      child: CircularProgressIndicator(
                        value: progreso,
                        strokeWidth: 8,
                        backgroundColor: Colors.white.withOpacity(0.1),
                        valueColor: AlwaysStoppedAnimation(
                          progreso >= 1 ? Colors.green : AppTheme.neonBlue,
                        ),
                      ),
                    ),
                    Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            '${(progreso * 100).toInt()}%',
                            style: TextStyle(
                              color: progreso >= 1 ? Colors.green : AppTheme.neonBlue,
                              fontWeight: FontWeight.bold,
                              fontSize: Responsive.fontSize(context, small: 16, large: 22),
                            ),
                          ),
                          Text(
                            '$totalCompletadas/$total',
                            style: TextStyle(
                              color: AppTheme.textSecondary.withOpacity(0.7),
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              
              const SizedBox(width: 20),
              
              // Stats
              Expanded(
                child: Column(
                  children: [
                    _buildStatRow(
                      context,
                      icon: Icons.pending_actions,
                      label: 'Pendientes',
                      value: totalPendientes.toString(),
                      color: Colors.orange,
                    ),
                    const SizedBox(height: 8),
                    _buildStatRow(
                      context,
                      icon: Icons.check_circle,
                      label: 'Completadas',
                      value: totalCompletadas.toString(),
                      color: Colors.green,
                    ),
                  ],
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 16),
          const Divider(color: Colors.white10),
          const SizedBox(height: 16),
          
          // CTR Alerta
          if (totalCTR > 0)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.red.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber, color: Colors.red, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Contra Reembolso Pendiente',
                          style: TextStyle(
                            color: Colors.red,
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                          ),
                        ),
                        Text(
                          '$totalCTR entregas requieren cobro',
                          style: TextStyle(
                            color: Colors.red.withOpacity(0.7),
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          
          // Importe total
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withOpacity(0.1),
                  AppTheme.neonPurple.withOpacity(0.1),
                ],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Total Pendiente',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: Responsive.fontSize(context, small: 11, large: 13),
                  ),
                ),
                Text(
                  currencyFormat.format(importeTotal),
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.bold,
                    fontSize: Responsive.fontSize(context, small: 16, large: 20),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatRow(BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: color.withOpacity(0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: color, size: 14),
        ),
        const SizedBox(width: 10),
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary.withOpacity(0.8),
            fontSize: 12,
          ),
        ),
        const Spacer(),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.bold,
            fontSize: Responsive.fontSize(context, small: 14, large: 18),
          ),
        ),
      ],
    );
  }
}
