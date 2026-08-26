import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

/// Tarjeta de albarán en la lista de entregas
class EntregaCard extends StatelessWidget {
  const EntregaCard({
    required this.albaran,
    super.key,
    this.onTap,
  });
  final AlbaranEntrega albaran;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: EdgeInsets.all(
            Responsive.padding(context, small: 12, large: 16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header con número y estado
              Row(
                children: [
                  // Badge CTR
                  if (albaran.esCTR)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      margin: const EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(
                        color: AppTheme.accentAmber.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: AppTheme.accentAmber),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.euro,
                            size: 12,
                            color: AppTheme.accentAmber,
                          ),
                          SizedBox(width: 4),
                          Text(
                            'CTR',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.accentAmber,
                            ),
                          ),
                        ],
                      ),
                    ),

                  // Número de albarán
                  Text(
                    'Alb. ${albaran.numeroAlbaran}${albaran.horaPrevista != null ? " (${albaran.horaPrevista})" : ""}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.fontSize(
                        context,
                        small: 13,
                        large: 16,
                      ),
                    ),
                  ),

                  const Spacer(),

                  // Estado
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: albaran.estado.color.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          albaran.estado.icon,
                          size: 14,
                          color: albaran.estado.color,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          albaran.estado.label,
                          style: TextStyle(
                            fontSize: 12,
                            color: albaran.estado.color,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 12),

              // Info cliente
              Row(
                children: [
                  const Icon(
                    Icons.store,
                    size: 18,
                    color: AppTheme.textSecondary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      albaran.nombreCliente,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),

              if (albaran.direccion.isNotEmpty) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(
                      Icons.location_on,
                      size: 16,
                      color: AppTheme.textSecondary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        albaran.direccion,
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],

              const SizedBox(height: 12),

              // Footer con importe y ruta
              Row(
                children: [
                  // Ruta
                  if (albaran.ruta.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.info.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.route,
                            size: 12,
                            color: AppTheme.info,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            albaran.ruta,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppTheme.info,
                            ),
                          ),
                        ],
                      ),
                    ),

                  // Vendedor
                  if (albaran.codigoVendedor.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.accentIndigo.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.person,
                            size: 12,
                            color: AppTheme.accentIndigo,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Com. ${albaran.codigoVendedor}',
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppTheme.accentIndigo,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const Spacer(),

                  // Importe
                  Text(
                    '${albaran.importeTotal.toStringAsFixed(2)}€',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: albaran.esCTR
                          ? AppTheme.accentAmber
                          : AppTheme.textPrimary,
                    ),
                  ),
                ],
              ),

              // Indicador de toque
              const SizedBox(height: 8),
              const Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    'Toca para ver detalle',
                    style: TextStyle(
                      fontSize: 11,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  SizedBox(width: 4),
                  Icon(
                    Icons.chevron_right,
                    size: 16,
                    color: AppTheme.textSecondary,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
