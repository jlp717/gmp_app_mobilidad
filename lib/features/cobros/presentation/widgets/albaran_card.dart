/// ALBARAN CARD WIDGET
/// Tarjeta premium para mostrar un albarán/entrega

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/models/cobros_models.dart';

class AlbaranCard extends StatelessWidget {
  final Albaran albaran;
  final VoidCallback? onTap;
  final VoidCallback? onQuickComplete;

  const AlbaranCard({
    super.key,
    required this.albaran,
    this.onTap,
    this.onQuickComplete,
  });

  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
    
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: EdgeInsets.all(Responsive.padding(context, small: 10, large: 16)),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.surfaceColor,
              AppTheme.surfaceColor.withOpacity(0.8),
            ],
          ),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: albaran.esCTR
                ? Colors.red.withOpacity(0.4)
                : albaran.estado.color.withOpacity(0.3),
            width: albaran.esCTR ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.2),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
            if (albaran.esCTR)
              BoxShadow(
                color: Colors.red.withOpacity(0.1),
                blurRadius: 20,
              ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header: Número, Estado, CTR badge
            Row(
              children: [
                // Número de albarán
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '#${albaran.numeroAlbaran}',
                    style: const TextStyle(
                      color: AppTheme.neonBlue,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ),
                
                const SizedBox(width: 10),
                
                // Estado badge
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: albaran.estado.color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: albaran.estado.color.withOpacity(0.3),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        albaran.estado.icon,
                        color: albaran.estado.color,
                        size: 14,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        albaran.estado.label,
                        style: TextStyle(
                          color: albaran.estado.color,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                
                // CTR Badge
                if (albaran.esCTR) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Colors.red, Colors.red.shade700],
                      ),
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.red.withOpacity(0.4),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.warning, color: Colors.white, size: 12),
                        SizedBox(width: 4),
                        Text(
                          'CTR',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                
                const Spacer(),
                
                // Importe
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      currencyFormat.format(albaran.importeTotal),
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: Responsive.fontSize(context, small: 14, large: 18),
                      ),
                    ),
                    if (albaran.formaPago != null)
                      Text(
                        albaran.formaPago!,
                        style: TextStyle(
                          color: AppTheme.textSecondary.withOpacity(0.7),
                          fontSize: 10,
                        ),
                      ),
                  ],
                ),
              ],
            ),
            
            const SizedBox(height: 16),
            
            // Cliente
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.neonGreen.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.store,
                    color: AppTheme.neonGreen,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        albaran.nombreCliente,
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(
                            Icons.location_on,
                            color: AppTheme.textSecondary.withOpacity(0.5),
                            size: 12,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              albaran.direccion,
                              style: TextStyle(
                                color: AppTheme.textSecondary.withOpacity(0.7),
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 16),
            
            // Progress bar (si tiene items)
            if (albaran.items.isNotEmpty) ...[
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '${albaran.itemsEntregados}/${albaran.totalItems} productos',
                              style: TextStyle(
                                color: AppTheme.textSecondary.withOpacity(0.8),
                                fontSize: 11,
                              ),
                            ),
                            Text(
                              '${(albaran.porcentajeCompletado * 100).toInt()}%',
                              style: TextStyle(
                                color: albaran.completo ? Colors.green : AppTheme.neonBlue,
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: albaran.porcentajeCompletado,
                            backgroundColor: Colors.white.withOpacity(0.1),
                            valueColor: AlwaysStoppedAnimation(
                              albaran.completo ? Colors.green : AppTheme.neonBlue,
                            ),
                            minHeight: 6,
                          ),
                        ),
                      ],
                    ),
                  ),
                  
                  if (!albaran.completo && onQuickComplete != null) ...[
                    const SizedBox(width: 16),
                    // Botón de completar rápido
                    Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: onQuickComplete,
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Colors.green, Color(0xFF2E7D32)],
                            ),
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.green.withOpacity(0.3),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.check, color: Colors.white, size: 18),
                              SizedBox(width: 6),
                              Text(
                                'Completar',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ] else ...[
              // Sin items, mostrar botón de ver detalles
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: onTap,
                    icon: const Icon(Icons.visibility, size: 16),
                    label: const Text('Ver detalles'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppTheme.neonBlue,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
