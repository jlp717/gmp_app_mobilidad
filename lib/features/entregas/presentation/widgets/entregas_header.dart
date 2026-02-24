import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/entregas_provider.dart';
import '../../../../core/utils/responsive.dart';

/// Header con resumen de entregas del día
class EntregasHeader extends StatelessWidget {
  const EntregasHeader({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<EntregasProvider>(
      builder: (context, provider, _) {
        final total = provider.albaranes.length;
        final entregados = provider.totalEntregados;
        final pendientes = provider.totalPendientes;
        final importeCTR = provider.importeTotalCTR;

        return Container(
          padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 16)),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Theme.of(context).primaryColor,
                Theme.of(context).primaryColor.withOpacity(0.8),
              ],
            ),
          ),
          child: Column(
            children: [
              // Título con Selector de Fecha
              Row(
                children: [
                  Icon(Icons.local_shipping, 
                             color: Colors.white, size: Responsive.iconSize(context, phone: 24, desktop: 28)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Entregas del Día',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        InkWell(
                          onTap: () async {
                            final fecha = await showDatePicker(
                              context: context,
                              initialDate: provider.fechaSeleccionada,
                              firstDate: DateTime(2024),
                              lastDate: DateTime(2030),
                              builder: (context, child) {
                                return Theme(
                                  data: Theme.of(context).copyWith(
                                    colorScheme: ColorScheme.light(
                                      primary: Theme.of(context).primaryColor,
                                    ),
                                  ),
                                  child: child!,
                                );
                              },
                            );
                            if (fecha != null) {
                              provider.seleccionarFecha(fecha);
                            }
                          },
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                _formatFecha(provider.fechaSeleccionada),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 14,
                                  decoration: TextDecoration.underline,
                                  decorationColor: Colors.white54,
                                ),
                              ),
                              const SizedBox(width: 4),
                              const Icon(Icons.calendar_today, color: Colors.white, size: 14),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              
              // Muestra estadísticas y progreso solo si NO estamos en vista horizontal compacta
              if (!Responsive.isLandscapeCompact(context)) ...[
                SizedBox(height: 20 * Responsive.landscapeScale(context)),
                
                // Stats cards
                Row(
                  children: [
                    _buildStatCard(
                      context,
                      icon: Icons.pending_actions,
                      label: 'Pendientes',
                      value: '$pendientes',
                      color: Colors.orange,
                    ),
                    const SizedBox(width: 12),
                    _buildStatCard(
                      context,
                      icon: Icons.check_circle,
                      label: 'Entregados',
                      value: '$entregados',
                      color: Colors.green,
                    ),
                    const SizedBox(width: 12),
                    _buildStatCard(
                      context,
                      icon: Icons.euro,
                      label: 'CTR',
                      value: '${importeCTR.toStringAsFixed(0)}€',
                      color: Colors.amber,
                    ),
                  ],
                ),
                
                SizedBox(height: 16 * Responsive.landscapeScale(context)),
                
                // Barra de progreso
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Progreso del día',
                          style: TextStyle(color: Colors.white70, fontSize: 12),
                        ),
                        Text(
                          '$entregados de $total completados',
                          style: const TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      ],
                    ),
                    SizedBox(height: 8 * Responsive.landscapeScale(context)),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: LinearProgressIndicator(
                        value: provider.progresoTotal,
                        backgroundColor: Colors.white24,
                        valueColor: const AlwaysStoppedAnimation(Colors.white),
                        minHeight: 8,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildStatCard(BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Expanded(
      child: Container(
        padding: EdgeInsets.symmetric(
            vertical: 12 * Responsive.landscapeScale(context), 
            horizontal: 8 * Responsive.landscapeScale(context)
        ),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.15),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(height: 4),
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatFecha(DateTime fecha) {
    final dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    final meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return '${dias[fecha.weekday - 1]}, ${fecha.day} ${meses[fecha.month - 1]} ${fecha.year}';
  }
}
