/// Client Balance Badge
/// ====================
/// Shows outstanding balance for selected client

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

class ClientBalanceBadge extends StatelessWidget {
  final Map<String, dynamic> balance;

  const ClientBalanceBadge({Key? key, required this.balance}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final saldo = (balance['saldoPendiente'] as num?)?.toDouble() ?? 0;
    final facturado = (balance['facturadoAnual'] as num?)?.toDouble() ?? 0;

    if (facturado == 0 && saldo == 0) return const SizedBox.shrink();

    final isWarning = saldo > 5000;
    final isDanger = saldo > 10000;
    final color = isDanger ? AppTheme.error : isWarning ? Colors.orange : AppTheme.neonGreen;

    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isDanger ? Icons.warning_amber : Icons.account_balance_wallet_outlined,
            color: color,
            size: 12,
          ),
          const SizedBox(width: 4),
          Text(
            'Saldo: \u20AC${saldo.toStringAsFixed(0)}',
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (isDanger) ...[
            const SizedBox(width: 4),
            Text(
              'RIESGO',
              style: TextStyle(
                color: AppTheme.error,
                fontSize: 8,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
