import 'package:flutter/material.dart';

/// [ClientConditionsWidget] - Widget que muestra información de condiciones del cliente
///
/// CARACTERÍSTICAS:
/// - Sección "Diversos" con medios de pago y congeladores
/// - Sección "Condiciones" con tarifa y concepto de facturación
/// - Diseño mejorado según imagen de referencia
/// - Mejor visibilidad y contraste
class ClientConditionsWidget extends StatelessWidget {
  const ClientConditionsWidget({
    super.key,
    this.mediosCount = 0,
    this.congeladoresCount = 2,
    this.tarifa = '1 - TARIFA.1',
    this.conceptoFacturacion = '002 - CT CT CT CT CT CT CT CT',
  });

  final int mediosCount;
  final int congeladoresCount;
  final String tarifa;
  final String conceptoFacturacion;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Column(
      children: [
        // Sección Diversos
        _buildDiversosSection(context, isDark),

        const SizedBox(height: 16),

        // Sección Condiciones
        _buildCondicionesSection(context, isDark),
      ],
    );
  }

  Widget _buildDiversosSection(BuildContext context, bool isDark) {
    return Container(
      decoration: BoxDecoration(
        color: isDark 
            ? const Color(0xFF1E293B)
            : const Color(0xFF5B8FB9),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header "Diversos"
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: isDark 
                  ? const Color(0xFF1E293B)
                  : const Color(0xFF5B8FB9),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(12),
                topRight: Radius.circular(12),
              ),
            ),
            child: Text(
              'Diversos',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          
          // Content: Medios y Congeladores
          Container(
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF0F172A) : Colors.white,
              borderRadius: const BorderRadius.only(
                bottomLeft: Radius.circular(12),
                bottomRight: Radius.circular(12),
              ),
            ),
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                // Medios
                _buildDiversosItem(
                  context: context,
                  icon: Icons.payment_rounded,
                  iconColor: const Color(0xFF10B981),
                  title: 'Medios',
                  subtitle: '$mediosCount medios',
                  isDark: isDark,
                  onTap: () {
                    // TODO: Navegar a detalle de medios
                  },
                ),
                
                const SizedBox(height: 8),
                
                // Congeladores
                _buildDiversosItem(
                  context: context,
                  icon: Icons.ac_unit_rounded,
                  iconColor: const Color(0xFF3B82F6),
                  title: 'Congeladores',
                  subtitle: '$congeladoresCount máquinas',
                  isDark: isDark,
                  onTap: () {
                    // TODO: Navegar a detalle de congeladores
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDiversosItem({
    required BuildContext context,
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required bool isDark,
    VoidCallback? onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: isDark 
                ? const Color(0xFF1E293B).withOpacity(0.5)
                : Colors.grey.shade50,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isDark 
                  ? Colors.white.withOpacity(0.1)
                  : Colors.grey.shade200,
            ),
          ),
          child: Row(
            children: [
              // Icono
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: iconColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  icon,
                  color: iconColor,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),
              // Texto
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white : const Color(0xFF1E293B),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: isDark 
                            ? Colors.blue.shade300
                            : const Color(0xFF3B82F6),
                      ),
                    ),
                  ],
                ),
              ),
              // Chevron
              Icon(
                Icons.chevron_right_rounded,
                color: isDark 
                    ? Colors.white.withOpacity(0.4)
                    : Colors.grey.shade400,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCondicionesSection(BuildContext context, bool isDark) {
    return Container(
      decoration: BoxDecoration(
        color: isDark 
            ? const Color(0xFF1E293B)
            : const Color(0xFF5B8FB9),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header "Condiciones"
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: isDark 
                  ? const Color(0xFF1E293B)
                  : const Color(0xFF5B8FB9),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(12),
                topRight: Radius.circular(12),
              ),
            ),
            child: const Text(
              'Condiciones',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          
          // Content
          Container(
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF0F172A) : Colors.white,
              borderRadius: const BorderRadius.only(
                bottomLeft: Radius.circular(12),
                bottomRight: Radius.circular(12),
              ),
            ),
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Tarifa
                _buildConditionItem(
                  context: context,
                  label: 'Tarifa',
                  value: tarifa,
                  isDark: isDark,
                ),
                
                const SizedBox(height: 12),
                
                // Concepto Facturación
                _buildConditionItem(
                  context: context,
                  label: 'Concepto Facturación',
                  value: conceptoFacturacion,
                  isDark: isDark,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConditionItem({
    required BuildContext context,
    required String label,
    required String value,
    required bool isDark,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark 
            ? const Color(0xFF1E293B).withOpacity(0.5)
            : Colors.grey.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isDark 
              ? Colors.white.withOpacity(0.1)
              : Colors.grey.shade200,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: isDark 
                        ? Colors.white.withOpacity(0.6)
                        : Colors.grey.shade600,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: isDark 
                        ? Colors.blue.shade300
                        : const Color(0xFF1E40AF),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
