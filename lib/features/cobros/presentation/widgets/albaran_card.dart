/// ALBARAN CARD WIDGET
/// Tarjeta premium para mostrar un albarán/entrega
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:intl/intl.dart';

class AlbaranCard extends StatelessWidget {
  const AlbaranCard({
    required this.albaran,
    super.key,
    this.onTap,
    this.onQuickComplete,
  });
  final Albaran albaran;
  final VoidCallback? onTap;
  final VoidCallback? onQuickComplete;

  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding:
            EdgeInsets.all(Responsive.padding(context, small: 10, large: 16)),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.raisedSurface,
              AppTheme.softPanel.withValues(alpha: 0.92),
              (albaran.esCTR ? AppTheme.error : albaran.estado.color)
                  .withValues(alpha: 0.045),
            ],
          ),
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(
            color: albaran.esCTR
                ? AppTheme.error.withValues(alpha: 0.4)
                : albaran.estado.color.withValues(alpha: 0.3),
            width: albaran.esCTR ? 2 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.systemBlack.withValues(alpha: 0.2),
              blurRadius: 14,
              offset: const Offset(0, 6),
            ),
            BoxShadow(
              color: (albaran.esCTR ? AppTheme.error : albaran.estado.color)
                  .withValues(alpha: 0.07),
              blurRadius: 18,
            ),
            if (albaran.esCTR)
              BoxShadow(
                color: AppTheme.error.withValues(alpha: 0.08),
                blurRadius: 14,
              ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header: Número, Estado, CTR badge
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                // Número de albarán
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.info.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: AppTheme.info.withValues(alpha: 0.26),
                    ),
                  ),
                  child: Text(
                    '#${albaran.numeroAlbaran}',
                    style: const TextStyle(
                      color: AppTheme.info,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ),

                const SizedBox(width: 10),

                // Estado badge
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: albaran.estado.color.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: albaran.estado.color.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Wrap(
                    spacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Icon(
                        albaran.estado.icon,
                        color: albaran.estado.color,
                        size: 18,
                      ),
                      Text(
                        albaran.estado.label,
                        style: TextStyle(
                          color: albaran.estado.color,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),

                // CTR Badge
                if (albaran.esCTR) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.error,
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.systemBlack.withValues(alpha: 0.14),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: Semantics(
                      label: 'Hay que cobrar esta entrega',
                      child: Wrap(
                        spacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Icon(Icons.warning,
                              color: AppColors.themedWhite, size: 18),
                          Text(
                            'Cobrar',
                            style: TextStyle(
                              color: AppColors.themedWhite,
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],

                // Importe
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      currencyFormat.format(albaran.importeTotal),
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize:
                            Responsive.fontSize(context, small: 16, large: 18),
                      ),
                    ),
                    if (albaran.formaPago != null)
                      Text(
                        albaran.formaPago!,
                        style: TextStyle(
                          color: AppTheme.textSecondary.withValues(alpha: 0.7),
                          fontSize: 16,
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
                    color: AppTheme.success.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: AppTheme.success.withValues(alpha: 0.22),
                    ),
                  ),
                  child: const Icon(
                    Icons.store,
                    color: AppTheme.success,
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
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(
                            Icons.location_on,
                            color:
                                AppTheme.textSecondary.withValues(alpha: 0.5),
                            size: 12,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              albaran.direccion,
                              style: TextStyle(
                                color: AppTheme.textSecondary
                                    .withValues(alpha: 0.7),
                                fontSize: 16,
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
                                color: AppTheme.textSecondary
                                    .withValues(alpha: 0.8),
                                fontSize: 11,
                              ),
                            ),
                            Text(
                              '${(albaran.porcentajeCompletado * 100).toInt()}%',
                              style: TextStyle(
                                color: albaran.completo
                                    ? AppTheme.success
                                    : AppTheme.info,
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
                            backgroundColor:
                                AppColors.themedWhite.withValues(alpha: 0.1),
                            valueColor: AlwaysStoppedAnimation(
                              albaran.completo
                                  ? AppTheme.success
                                  : AppTheme.info,
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
                      color: AppColors.transparent,
                      child: Semantics(
                        button: true,
                        label: 'Completar entrega',
                        child: InkWell(
                          onTap: onQuickComplete,
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            constraints: const BoxConstraints(minHeight: 48),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.success,
                              borderRadius: BorderRadius.circular(12),
                              boxShadow: [
                                BoxShadow(
                                  color: AppColors.systemBlack
                                      .withValues(alpha: 0.14),
                                  blurRadius: 8,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.check,
                                    color: AppColors.themedWhite, size: 18),
                                SizedBox(width: 6),
                                Text(
                                  'Completar',
                                  style: TextStyle(
                                    color: AppColors.themedWhite,
                                    fontWeight: FontWeight.w700,
                                    fontSize: 16,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ] else ...[
              // Sin items, mostrar botón de ver detalles
              SizedBox(
                width: double.infinity,
                child: Semantics(
                  button: true,
                  label: 'Ver detalles de la entrega',
                  child: TextButton.icon(
                    onPressed: onTap,
                    icon: const Icon(Icons.visibility, size: 20),
                    label: const Text(
                      'Ver detalles',
                      style: TextStyle(fontSize: 16),
                    ),
                    style: TextButton.styleFrom(
                      foregroundColor: AppTheme.info,
                      minimumSize: const Size(48, 48),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
