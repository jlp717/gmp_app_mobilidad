import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';
import 'package:intl/intl.dart';

class RuteroDetailHeader extends StatelessWidget {
  const RuteroDetailHeader({
    required this.albaran,
    required this.isCompleted,
    super.key,
  });

  final AlbaranEntrega albaran;
  final bool isCompleted;

  bool get _isFactura => albaran.numeroFactura > 0;
  bool get _isUrgent => albaran.esCTR;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.darkSurface,
            AppTheme.darkBase,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _buildDocumentBadge(),
              const Spacer(),
              _buildAmountBadge(),
              const SizedBox(width: 12),
              _buildCloseButton(context),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            albaran.nombreCliente,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (albaran.nombreFiscal != null &&
              albaran.nombreFiscal!.isNotEmpty &&
              albaran.nombreFiscal!.toUpperCase() !=
                  albaran.nombreCliente.toUpperCase())
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                albaran.nombreFiscal!,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
              ),
            ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(
                Icons.location_on_outlined,
                size: 14,
                color: AppTheme.textSecondary,
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  '${albaran.direccion}, ${albaran.poblacion}',
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          ClientAlertsWidget(
            clientId: albaran.codigoCliente,
            compact: true,
          ),
        ],
      ),
    );
  }

  Widget _buildDocumentBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: _isFactura
              ? [
                  AppTheme.neonPurple.withValues(alpha: 0.3),
                  AppTheme.neonPurple.withValues(alpha: 0.1),
                ]
              : [
                  AppTheme.neonBlue.withValues(alpha: 0.2),
                  AppTheme.neonBlue.withValues(alpha: 0.05),
                ],
        ),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: _isFactura ? AppTheme.neonPurple : AppTheme.neonBlue,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _isFactura ? Icons.receipt_long : Icons.description,
            size: 16,
            color: _isFactura ? AppTheme.neonPurple : AppTheme.neonBlue,
          ),
          const SizedBox(width: 8),
          Text(
            _isFactura
                ? 'FACTURA ${albaran.serieFactura.isNotEmpty ? "${albaran.serieFactura}-" : ""}${albaran.numeroFactura}'
                : 'ALBARÁN ${albaran.serie.isNotEmpty ? albaran.serie : "A"}${albaran.terminal > 0 ? "-${albaran.terminal}" : ""}-${albaran.numeroAlbaran}',
            style: TextStyle(
              color: _isFactura ? AppTheme.neonPurple : AppTheme.neonBlue,
              fontWeight: FontWeight.bold,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAmountBadge() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          NumberFormat.currency(symbol: '€', locale: 'es_ES')
              .format(albaran.importeTotal),
          style: TextStyle(
            color: _isUrgent ? AppTheme.obligatorio : AppTheme.textPrimary,
            fontSize: 22,
            fontWeight: FontWeight.bold,
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: (_isUrgent ? AppTheme.obligatorio : AppTheme.success)
                .withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            isCompleted
                ? '✓ ENTREGADO'
                : _isUrgent
                    ? '⚠ COBRO OBLIGATORIO'
                    : '✓ COBRO OPCIONAL',
            style: TextStyle(
              color: isCompleted
                  ? AppTheme.success
                  : _isUrgent
                      ? AppTheme.obligatorio
                      : AppTheme.success,
              fontSize: 9,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCloseButton(BuildContext context) {
    return IconButton(
      icon: Container(
        padding: const EdgeInsets.all(6),
        decoration: const BoxDecoration(
          color: AppTheme.borderColor,
          shape: BoxShape.circle,
        ),
        child: const Icon(
          Icons.close,
          color: AppTheme.textSecondary,
          size: 18,
        ),
      ),
      onPressed: () => Navigator.pop(context),
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(),
    );
  }
}
