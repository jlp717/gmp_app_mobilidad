/// Client Balance Badge
/// ====================
/// Shows outstanding balance and risk level for selected client
/// with info icon that opens an explanation modal.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../utils/pedidos_formatters.dart';

class ClientBalanceBadge extends StatelessWidget {
  final Map<String, dynamic> balance;

  const ClientBalanceBadge({Key? key, required this.balance}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final saldo = (balance['saldoPendiente'] as num?)?.toDouble() ?? 0;
    final cobrado = (balance['cobradoAnual'] as num?)?.toDouble() ?? 0;
    final facturado =
        (balance['facturadoAnual'] as num?)?.toDouble() ?? 0;
    final year =
        (balance['year'] as num?)?.toInt() ?? DateTime.now().year;

    if (facturado == 0 && saldo == 0) return const SizedBox.shrink();

    final isWarning = saldo > 5000;
    final isDanger = saldo > 10000;
    final color = isDanger
        ? AppTheme.error
        : isWarning
            ? Colors.orange
            : AppTheme.neonGreen;
    final statusLabel = isDanger
        ? 'Riesgo alto'
        : isWarning
            ? 'Riesgo medio'
            : saldo > 0
                ? 'Riesgo bajo'
                : 'Sin riesgo';

    return GestureDetector(
      onTap: () => _showInfoModal(
        context,
        saldo: saldo,
        cobrado: cobrado,
        facturado: facturado,
        year: year,
        statusLabel: statusLabel,
        color: color,
      ),
      child: Container(
        margin: const EdgeInsets.only(top: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withOpacity(0.3), width: 0.5),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isDanger
                  ? Icons.warning_amber_rounded
                  : Icons.account_balance_wallet_outlined,
              color: color,
              size: 13,
            ),
            const SizedBox(width: 5),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Pendiente: ${PedidosFormatters.money(saldo)}',
                        style: TextStyle(
                          color: color,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.16),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: color,
                            fontSize: 8,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$year: fact. ${PedidosFormatters.money(facturado)}'
                    ' - cobr. ${PedidosFormatters.money(cobrado)}',
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 9,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Icon(
              Icons.info_outline_rounded,
              color: color.withOpacity(0.6),
              size: 14,
            ),
          ],
        ),
      ),
    );
  }

  void _showInfoModal(
    BuildContext context, {
    required double saldo,
    required double cobrado,
    required double facturado,
    required int year,
    required String statusLabel,
    required Color color,
  }) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
              color: AppTheme.borderColor.withOpacity(0.3)),
        ),
        title: Row(
          children: [
            const Icon(Icons.account_balance_wallet,
                color: AppTheme.neonBlue, size: 22),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'Datos financieros del cliente',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _infoRow(
                'Saldo pendiente de cobro',
                PedidosFormatters.money(saldo),
                'Importe total de facturas emitidas que '
                    'aun no han sido cobradas.',
                color,
              ),
              const SizedBox(height: 10),
              _infoRow(
                'Facturado en $year',
                PedidosFormatters.money(facturado),
                'Total facturado al cliente durante '
                    'el ejercicio $year.',
                AppTheme.neonBlue,
              ),
              const SizedBox(height: 10),
              _infoRow(
                'Cobrado en $year',
                PedidosFormatters.money(cobrado),
                'Total cobrado del cliente durante '
                    'el ejercicio $year.',
                AppTheme.neonGreen,
              ),
              const SizedBox(height: 14),
              // Status explanation
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                      color: color.withOpacity(0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: color.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            statusLabel,
                            style: TextStyle(
                              color: color,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Niveles de riesgo:',
                      style: TextStyle(
                          color: Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    _riskLevel(AppTheme.neonGreen, 'Sin riesgo',
                        'Sin deuda pendiente'),
                    _riskLevel(AppTheme.neonGreen, 'Riesgo bajo',
                        'Pendiente < 5.000\u20AC'),
                    _riskLevel(Colors.orange, 'Riesgo medio',
                        'Pendiente entre 5.000\u20AC y 10.000\u20AC'),
                    _riskLevel(AppTheme.error, 'Riesgo alto',
                        'Pendiente > 10.000\u20AC'),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Entendido',
                style: TextStyle(color: AppTheme.neonBlue)),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(
      String title, String value, String desc, Color color) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Text(title,
                    style: TextStyle(
                        color: color,
                        fontSize: 11,
                        fontWeight: FontWeight.w600)),
              ),
              Text(value,
                  style: TextStyle(
                      color: color,
                      fontSize: 13,
                      fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 4),
          Text(desc,
              style: const TextStyle(
                  color: Colors.white38, fontSize: 10)),
        ],
      ),
    );
  }

  Widget _riskLevel(Color color, String label, String desc) {
    return Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
                color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            '$label: ',
            style: TextStyle(
                color: color,
                fontSize: 10,
                fontWeight: FontWeight.w600),
          ),
          Flexible(
            child: Text(
              desc,
              style: const TextStyle(
                  color: Colors.white38, fontSize: 10),
            ),
          ),
        ],
      ),
    );
  }
}
