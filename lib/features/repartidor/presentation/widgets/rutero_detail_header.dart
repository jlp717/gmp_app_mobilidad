import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
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
  bool get _isTerminal =>
      isCompleted ||
      switch (albaran.estado) {
        EstadoEntrega.entregado ||
        EstadoEntrega.parcial ||
        EstadoEntrega.noEntregado ||
        EstadoEntrega.rechazado =>
          true,
        _ => false,
      };

  Color get _terminalColor => switch (albaran.estado) {
        EstadoEntrega.entregado => AppTheme.success,
        EstadoEntrega.parcial || EstadoEntrega.noEntregado => AppTheme.warning,
        EstadoEntrega.rechazado => AppTheme.error,
        _ => AppTheme.info,
      };

  String get _terminalLabel => switch (albaran.estado) {
        EstadoEntrega.entregado => 'ENTREGADO',
        EstadoEntrega.parcial => 'ENTREGA PARCIAL',
        EstadoEntrega.noEntregado => 'NO ENTREGADO',
        EstadoEntrega.rechazado => 'RECHAZADO',
        _ => 'CONFIRMADO',
      };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.borderColor.withValues(alpha: 0.8),
          ),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 430;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (compact) ...[
                Row(
                  children: [
                    Expanded(child: _buildDocumentBadge()),
                    const SizedBox(width: 8),
                    _buildCloseButton(context),
                  ],
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: _buildAmountBadge(),
                ),
              ] else
                Row(
                  children: [
                    Flexible(child: _buildDocumentBadge()),
                    const SizedBox(width: 12),
                    const Spacer(),
                    Flexible(child: _buildAmountBadge()),
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
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
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
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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
                      maxLines: compact ? 2 : 1,
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
          );
        },
      ),
    );
  }

  Widget _buildDocumentBadge() {
    final badgeColor = _isFactura ? AppTheme.accentIndigo : AppTheme.info;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: badgeColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.radiusSm),
        border: Border.all(color: badgeColor.withValues(alpha: 0.34)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _isFactura ? Icons.receipt_long : Icons.description,
            size: 16,
            color: badgeColor,
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              _isFactura
                  ? 'FACTURA ${albaran.serieFactura.isNotEmpty ? "${albaran.serieFactura}-" : ""}${albaran.numeroFactura}'
                  : 'ALBARÁN ${albaran.serie.isNotEmpty ? albaran.serie : "A"}${albaran.terminal > 0 ? "-${albaran.terminal}" : ""}-${albaran.numeroAlbaran}',
              style: TextStyle(
                color: badgeColor,
                fontWeight: FontWeight.bold,
                fontSize: 13,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAmountBadge() {
    return FittedBox(
      fit: BoxFit.scaleDown,
      alignment: Alignment.centerRight,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            NumberFormat.currency(symbol: '€', locale: 'es_ES')
                .format(albaran.importeTotal),
            style: TextStyle(
              color: _isUrgent ? AppTheme.error : AppTheme.textPrimary,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: (_isTerminal
                      ? _terminalColor
                      : _isUrgent
                          ? AppTheme.error
                          : AppTheme.success)
                  .withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              _isTerminal
                  ? _terminalLabel
                  : _isUrgent
                      ? '⚠ COBRO OBLIGATORIO'
                      : '✓ COBRO OPCIONAL',
              style: TextStyle(
                color: _isTerminal
                    ? _terminalColor
                    : _isUrgent
                        ? AppTheme.error
                        : AppTheme.success,
                fontSize: 9,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCloseButton(BuildContext context) {
    return IconButton(
      icon: Container(
        padding: const EdgeInsets.all(6),
        decoration: const BoxDecoration(
          color: AppTheme.softPanel,
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
