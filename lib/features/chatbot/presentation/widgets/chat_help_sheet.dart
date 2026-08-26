import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

/// Bottom sheet with common Asistente GMP questions for non-technical users.
class ChatHelpSheet extends StatelessWidget {
  const ChatHelpSheet({
    required this.isSupervisor,
    required this.isRepartidor,
    required this.onQuestionSelected,
    super.key,
  });

  final bool isSupervisor;
  final bool isRepartidor;
  final ValueChanged<String> onQuestionSelected;

  List<(String title, String query)> _questions() {
    final base = <(String, String)>[
      (
        'Mis facturas de hoy',
        'Lista mis facturas emitidas hoy con importe y fecha.',
      ),
      (
        'Ventas por familia',
        'Ventas del cliente (indica codigo) del ultimo trimestre agrupadas por familia.',
      ),
      (
        'Beneficio de un cliente',
        'Cual es el beneficio y margen del cliente (indica codigo) este ano?',
      ),
      (
        'Comparar periodos',
        'Compara las ventas de enero vs enero del ano pasado.',
      ),
      (
        'Evolucion de ventas',
        'Cómo han evolucionado mis ventas en los últimos 12 meses?',
      ),
      (
        'Leer PDF factura',
        'Extrae importe, fecha y lineas del PDF de la factura (indica referencia).',
      ),
      (
        'Ficha de cliente',
        'Dame la ficha del cliente (indica codigo): deuda, margen y top productos.',
      ),
      (
        'Facturas pendientes',
        'Resume mis facturas pendientes de cobro.',
      ),
      (
        'Albaranes de una factura',
        'Que albaranes tiene la factura (indica numero)?',
      ),
      (
        'Deuda de un cliente',
        'Cual es la deuda del cliente (indica codigo)?',
      ),
      (
        'Riesgo de cliente',
        'Cual es el score de riesgo del cliente (indica codigo)?',
      ),
      (
        'Pedidos de hoy',
        'Cuantos pedidos tengo hoy y cual es el importe total?',
      ),
      (
        'Buscar producto',
        'Busca productos que contengan "pollo" en el nombre.',
      ),
      (
        'Bolsa comercial',
        'Cual es mi saldo de bolsa comercial este mes?',
      ),
    ];

    if (isRepartidor) {
      return [
        (
          'Entregas de hoy',
          'Cuantas entregas tengo hoy y cuales estan pendientes?',
        ),
        (
          'PDF de albaran',
          'Dame datos y PDF del albaran (indica referencia).',
        ),
        ...base,
      ];
    }

    if (isSupervisor) {
      return [
        (
          'Resumen del equipo',
          'Dame un resumen comercial del dia: ventas, top clientes y riesgos.',
        ),
        (
          'Top clientes del mes',
          'Quienes son mis mejores clientes este mes?',
        ),
        (
          'Margen global',
          'Cual es mi margen global del mes?',
        ),
        (
          'Comparar YoY',
          'Compara las ventas de este ano vs el anterior.',
        ),
        ...base,
      ];
    }

    return [
      ...base,
      (
        'Objetivo del mes',
        'Como voy de objetivo este mes?',
      ),
      (
        'Comisiones',
        'Cual es mi comision del mes actual?',
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final questions = _questions();

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.raisedSurface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        border: Border(top: BorderSide(color: AppColors.borderColor)),
      ),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 12,
        bottom: MediaQuery.paddingOf(context).bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: AppColors.borderColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const Text(
            'Preguntas frecuentes',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Toca una pregunta para enviarla al asistente.',
            style: TextStyle(color: Colors.grey.shade500, fontSize: 13),
          ),
          const SizedBox(height: 12),
          const _HelpTipRow(
            icon: Icons.wb_sunny_outlined,
            text: 'Resumen del dia: boton flotante o pregunta de briefing.',
          ),
          const _HelpTipRow(
            icon: Icons.table_chart_outlined,
            text:
                'Exportar CSV y compartir por WhatsApp o email en cada respuesta.',
          ),
          const _HelpTipRow(
            icon: Icons.push_pin_outlined,
            text: 'Fija respuestas utiles para consultarlas arriba del chat.',
          ),
          const _HelpTipRow(
            icon: Icons.open_in_new_rounded,
            text:
                'Ver en app salta a Facturas, Clientes, Comisiones o Alertas.',
          ),
          const SizedBox(height: 12),
          ...questions.map(
            (item) {
              final (title, query) = item;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Material(
                  color: AppColors.raisedSurface.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () {
                      Navigator.of(context).pop();
                      onQuestionSelected(query);
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.chat_bubble_outline,
                            color: AppColors.info,
                            size: 18,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              title,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          Icon(
                            Icons.arrow_forward_ios,
                            size: 12,
                            color: Colors.grey.shade600,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _HelpTipRow extends StatelessWidget {
  const _HelpTipRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.info),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
