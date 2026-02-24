/// ENTREGA DETAIL SHEET
/// Bottom sheet con detalle del albarán y acciones

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/models/cobros_models.dart';

class EntregaDetailSheet extends StatelessWidget {
  final Albaran albaran;
  final VoidCallback? onComplete;

  const EntregaDetailSheet({
    super.key,
    required this.albaran,
    this.onComplete,
  });

  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
    
    return Container(
      height: MediaQuery.of(context).size.height * 0.85,
      decoration: const BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          // Handle
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          
          // Header
          Padding(
            padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
            child: Row(
              children: [
                // Número albarán
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                    ),
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.neonBlue.withOpacity(0.3),
                        blurRadius: 12,
                      ),
                    ],
                  ),
                  child: Text(
                    'Albarán #${albaran.numeroAlbaran}',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.fontSize(context, small: 14, large: 16),
                    ),
                  ),
                ),
                
                const SizedBox(width: 12),
                
                // Estado
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: albaran.estado.color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: albaran.estado.color.withOpacity(0.3)),
                  ),
                  child: Row(
                    children: [
                      Icon(albaran.estado.icon, color: albaran.estado.color, size: 16),
                      const SizedBox(width: 6),
                      Text(
                        albaran.estado.label,
                        style: TextStyle(
                          color: albaran.estado.color,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                
                if (albaran.esCTR) ...[
                  const SizedBox(width: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: [Colors.red, Colors.red.shade700]),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.warning, color: Colors.white, size: 14),
                        SizedBox(width: 4),
                        Text(
                          'CONTRA REEMBOLSO',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 10,
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
                    const Text(
                      'Total',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                    ),
                    Text(
                      currencyFormat.format(albaran.importeTotal),
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: Responsive.fontSize(context, small: 18, large: 22),
                      ),
                    ),
                  ],
                ),
                
                const SizedBox(width: 16),
                
                // Cerrar
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
          
          const Divider(color: Colors.white10),
          
          // Cliente info
          Padding(
            padding: EdgeInsets.symmetric(horizontal: Responsive.padding(context, small: 12, large: 20), vertical: 12),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.neonGreen.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(Icons.store, color: AppTheme.neonGreen, size: 24),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        albaran.nombreCliente,
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: Responsive.fontSize(context, small: 14, large: 16),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(Icons.location_on, color: AppTheme.textSecondary.withOpacity(0.5), size: 14),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              albaran.direccion,
                              style: TextStyle(
                                color: AppTheme.textSecondary.withOpacity(0.7),
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Botones de navegación/llamada
                IconButton(
                  onPressed: () {},
                  icon: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.blue.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.map, color: Colors.blue, size: 20),
                  ),
                ),
                IconButton(
                  onPressed: () {},
                  icon: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.green.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.phone, color: Colors.green, size: 20),
                  ),
                ),
              ],
            ),
          ),
          
          const Divider(color: Colors.white10),
          
          // Lista de items
          Expanded(
            child: albaran.items.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.inventory_2, size: 48, color: AppTheme.textSecondary.withOpacity(0.3)),
                        const SizedBox(height: 12),
                        Text(
                          'Sin productos detallados',
                          style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: albaran.items.length,
                    itemBuilder: (context, index) {
                      final item = albaran.items[index];
                      return _buildItemRow(item);
                    },
                  ),
          ),
          
          // Footer con acciones
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppTheme.darkBase,
              border: Border(top: BorderSide(color: Colors.white.withOpacity(0.05))),
            ),
            child: Row(
              children: [
                // Botón añadir foto
                _buildActionButton(
                  icon: Icons.camera_alt,
                  label: 'Foto',
                  color: AppTheme.neonPurple,
                  onTap: () {},
                ),
                
                const SizedBox(width: 12),
                
                // Botón firma
                _buildActionButton(
                  icon: Icons.draw,
                  label: 'Firma',
                  color: AppTheme.neonBlue,
                  onTap: () {},
                ),
                
                const SizedBox(width: 12),
                
                // Botón incidencia
                _buildActionButton(
                  icon: Icons.report_problem,
                  label: 'Incidencia',
                  color: Colors.orange,
                  onTap: () {},
                ),
                
                const Spacer(),
                
                // Botón completar entrega
                if (!albaran.completo && onComplete != null)
                  Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: onComplete,
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Colors.green, Color(0xFF2E7D32)],
                          ),
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.green.withOpacity(0.4),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.check_circle, color: Colors.white),
                            SizedBox(width: 10),
                            Text(
                              'Completar Entrega',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildItemRow(EntregaItem item) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.03),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: item.estado == EstadoEntrega.entregado
              ? Colors.green.withOpacity(0.3)
              : Colors.white.withOpacity(0.05),
        ),
      ),
      child: Row(
        children: [
          // Checkbox / estado
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: item.estado.color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(item.estado.icon, color: item.estado.color, size: 18),
          ),
          
          const SizedBox(width: 14),
          
          // Info del producto
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.descripcion,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.w500,
                    fontSize: 13,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  item.codigoArticulo,
                  style: TextStyle(
                    color: AppTheme.textSecondary.withOpacity(0.6),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          
          // Cantidad
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Text(
                  '${item.cantidadEntregada}',
                  style: TextStyle(
                    color: item.cantidadEntregada > 0 ? Colors.green : AppTheme.textSecondary,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
                Text(
                  '/${item.cantidadPedida}',
                  style: TextStyle(
                    color: AppTheme.textSecondary.withOpacity(0.6),
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withOpacity(0.3)),
          ),
          child: Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.w500,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
