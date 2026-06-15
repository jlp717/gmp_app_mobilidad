/// Client Balance Badge
/// ====================
/// Shows outstanding balance and risk level for selected client
/// with info icon that opens an explanation modal.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class ClientBalanceBadge extends StatelessWidget {
  const ClientBalanceBadge({required this.balance, super.key});
  final Map<String, dynamic> balance;

  @override
  Widget build(BuildContext context) {
    final debt = clientDebtFromMap(balance);
    if (debt['state'] == 'none') return const SizedBox.shrink();
    if (debt['state'] != 'data') {
      return ClientDebtStatusChip(balance: balance, compact: false);
    }

    final saldo = debt['pending']! as double;
    final cobrado = debt['collected']! as double;
    final facturado = debt['billed']! as double;
    final year = (debt['year'] as int?) ?? DateTime.now().year;
    final color = clientDebtColor(debt);
    final statusLabel = clientDebtLabel(debt);

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
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.3), width: 0.5),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              clientDebtIcon(debt),
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
                          horizontal: 5,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.16),
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
              color: color.withValues(alpha: 0.6),
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
          side: BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.3)),
        ),
        title: const Row(
          children: [
            Icon(
              Icons.account_balance_wallet,
              color: AppTheme.neonBlue,
              size: 22,
            ),
            SizedBox(width: 8),
            Expanded(
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
                  border: Border.all(color: color.withValues(alpha: 0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.15),
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
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _riskLevel(
                      AppTheme.neonGreen,
                      'Sin riesgo',
                      'Sin deuda pendiente',
                    ),
                    _riskLevel(
                      AppTheme.neonGreen,
                      'Riesgo bajo',
                      'Pendiente < 5.000\u20AC',
                    ),
                    _riskLevel(
                      Colors.orange,
                      'Riesgo medio',
                      'Pendiente entre 5.000\u20AC y 10.000\u20AC',
                    ),
                    _riskLevel(
                      AppTheme.error,
                      'Riesgo alto',
                      'Pendiente > 10.000\u20AC',
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Entendido',
              style: TextStyle(color: AppTheme.neonBlue),
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String title, String value, String desc, Color color) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Text(
                  title,
                  style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  color: color,
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            desc,
            style: const TextStyle(color: Colors.white38, fontSize: 10),
          ),
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
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            '$label: ',
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
          Flexible(
            child: Text(
              desc,
              style: const TextStyle(color: Colors.white38, fontSize: 10),
            ),
          ),
        ],
      ),
    );
  }
}

Map<String, Object?> clientDebtFromMap(Map<String, dynamic>? data) {
  if (data == null || data.isEmpty) return const {'state': 'none'};
  final status = _debtText(data, const [
    'balanceStatus',
    'debtStatus',
    'deudaEstado',
    'loadStatus'
  ]).toUpperCase();
  final loadError = data['loadError'] == true || data['balanceError'] == true;
  if (loadError || status == 'ERROR' || status == 'FAILED') {
    return {
      'state': 'error',
      'message': _debtText(data, const ['message', 'error'])
    };
  }
  if (status == 'LOADING' || status == 'PENDING')
    return const {'state': 'loading'};
  final pending = _debtNum(data, const [
    'saldoPendiente',
    'pendiente',
    'totalPendiente',
    'deuda',
    'deudaPendiente',
    'pending',
    'pendingAmount',
    'outstandingBalance',
    'balance'
  ]);
  final overdue = _debtNum(data, const [
    'vencido',
    'totalVencido',
    'importeVencido',
    'overdue',
    'overdueAmount'
  ]);
  final billed = _debtNum(
      data, const ['facturadoAnual', 'facturado', 'billed', 'yearBilled']);
  final collected = _debtNum(
      data, const ['cobradoAnual', 'cobrado', 'collected', 'yearCollected']);
  if (pending != null ||
      overdue != null ||
      billed != null ||
      collected != null) {
    return {
      'state': 'data',
      'pending': pending ?? 0.0,
      'overdue': overdue ?? 0.0,
      'billed': billed ?? 0.0,
      'collected': collected ?? 0.0,
      'year': _debtInt(data, const ['year', 'ejercicio'])
    };
  }
  final hasStatus = status.isNotEmpty ||
      data.containsKey('loadError') ||
      data.containsKey('balanceError');
  if (hasStatus || status == 'UNKNOWN' || status == 'SIN_DATOS')
    return {
      'state': 'unknown',
      'message': _debtText(data, const ['message'])
    };
  return const {'state': 'none'};
}

bool clientDebtIsVisible(Map<String, dynamic>? data) =>
    clientDebtFromMap(data)['state'] != 'none';

String clientDebtLabel(Map<String, Object?> debt) {
  final state = debt['state'];
  if (state == 'loading') return 'Consultando deuda';
  if (state == 'error') return 'Deuda no disponible';
  if (state == 'unknown') return 'Deuda sin confirmar';
  final pending = (debt['pending'] as double?) ?? 0;
  final overdue = (debt['overdue'] as double?) ?? 0;
  if (overdue > 0) return 'Vencido';
  if (pending > 10000) return 'Riesgo alto';
  if (pending > 5000) return 'Riesgo medio';
  if (pending > 0) return 'Riesgo bajo';
  return 'Al día';
}

String clientDebtAmountLabel(Map<String, Object?> debt) {
  final state = debt['state'];
  if (state == 'loading') return 'Consultando...';
  if (state == 'error') return 'No disponible';
  if (state == 'unknown') return 'Sin datos';
  return PedidosFormatters.money((debt['pending'] as double?) ?? 0);
}

Color clientDebtColor(Map<String, Object?> debt) {
  final state = debt['state'];
  if (state == 'loading') return AppTheme.neonBlue;
  if (state == 'error') return AppTheme.warning;
  if (state == 'unknown') return Colors.white54;
  final pending = (debt['pending'] as double?) ?? 0;
  final overdue = (debt['overdue'] as double?) ?? 0;
  if (overdue > 0 || pending > 10000) return AppTheme.error;
  if (pending > 5000) return Colors.orange;
  return AppTheme.neonGreen;
}

IconData clientDebtIcon(Map<String, Object?> debt) {
  final state = debt['state'];
  if (state == 'loading') return Icons.hourglass_top_rounded;
  if (state == 'error') return Icons.sync_problem_rounded;
  if (state == 'unknown') return Icons.help_outline_rounded;
  final pending = (debt['pending'] as double?) ?? 0;
  final overdue = (debt['overdue'] as double?) ?? 0;
  if (overdue > 0 || pending > 10000) return Icons.warning_amber_rounded;
  return Icons.account_balance_wallet_outlined;
}

class ClientDebtStatusChip extends StatelessWidget {
  const ClientDebtStatusChip({required this.balance, this.compact = true});
  final Map<String, dynamic>? balance;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final debt = clientDebtFromMap(balance);
    if (debt['state'] == 'none') return const SizedBox.shrink();
    final color = clientDebtColor(debt);
    return Container(
      margin: EdgeInsets.only(top: compact ? 4 : 6),
      padding: EdgeInsets.symmetric(
          horizontal: compact ? 7 : 9, vertical: compact ? 3 : 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.34), width: 0.7),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(clientDebtIcon(debt), color: color, size: compact ? 12 : 14),
        const SizedBox(width: 4),
        Flexible(
            child: Text(
                'Deuda: ${clientDebtAmountLabel(debt)} · ${clientDebtLabel(debt)}',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    color: color,
                    fontSize: compact ? 10 : 11,
                    fontWeight: FontWeight.w700))),
      ]),
    );
  }
}

String _debtText(Map<String, dynamic> data, List<String> names) {
  for (final name in names) {
    final value = data[name];
    if (value != null && value.toString().trim().isNotEmpty)
      return value.toString().trim();
  }
  return '';
}

double? _debtNum(Map<String, dynamic> data, List<String> names) {
  for (final name in names) {
    if (!data.containsKey(name)) continue;
    final value = data[name];
    if (value == null) continue;
    if (value is num) return value.toDouble();
    final parsed = double.tryParse(value.toString().replaceAll(',', '.'));
    if (parsed != null) return parsed;
  }
  return null;
}

int? _debtInt(Map<String, dynamic> data, List<String> names) {
  for (final name in names) {
    if (!data.containsKey(name)) continue;
    final value = data[name];
    if (value == null) continue;
    if (value is num) return value.toInt();
    final parsed = int.tryParse(value.toString());
    if (parsed != null) return parsed;
  }
  return null;
}
