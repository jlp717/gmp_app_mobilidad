/// Bolsa — detalle de movimiento (REQ-14 + REQ-15).
/// =====================================================
/// Bottom sheet con tres bloques:
/// (a) artículos + fotos (catálogo existente, placeholder con código),
/// (b) precio cliente + descuento aplicado (vía pedido; sin margen),
/// (c) bolsa generada + efecto en saldo (antes → ahora + motivo + revisar).
/// Comercial nunca ve `precioMinimoCongelado` ni `precioVenta` sensibles:
/// esos campos solo se renderizan con `canSeeMargin` (jefe).
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

/// Abre el detalle de un movimiento de bolsa.
Future<void> showBolsaMovementDetailSheet(
  BuildContext context, {
  required BolsaMovimiento movimiento,
  required bool canSeeMargin,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.transparent,
    builder: (_) => BolsaMovementDetailSheet(
      movimiento: movimiento,
      canSeeMargin: canSeeMargin,
    ),
  );
}

class BolsaMovementDetailSheet extends StatelessWidget {
  const BolsaMovementDetailSheet({
    required this.movimiento,
    required this.canSeeMargin,
    super.key,
  });

  final BolsaMovimiento movimiento;
  final bool canSeeMargin;

  @override
  Widget build(BuildContext context) {
    final isCredit = movimiento.tipo.isCredit;
    final color = isCredit ? AppTheme.success : AppTheme.error;
    final signed =
        "${isCredit ? '+' : '-'}${_money(movimiento.importe)}";
    final pedidoRef = movimiento.displayPedido;
    final dateStr = movimiento.fecha != null
        ? '${movimiento.fecha!.day.toString().padLeft(2, '0')}/'
            '${movimiento.fecha!.month.toString().padLeft(2, '0')}/'
            '${movimiento.fecha!.year}'
        : '--';

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.82,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (_, controller) => Container(
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.themedWhite38,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Cabecera: tipo + importe firmado + fecha.
            Semantics(
              header: true,
              label:
                  '${movimiento.tipo.label} ${movimiento.importeFirmado >= 0 ? '+' : '-'}${movimiento.importe.toStringAsFixed(2)} euros, $dateStr',
              child: Row(
                children: [
                  Icon(
                    isCredit
                        ? Icons.add_circle_outline
                        : Icons.remove_circle_outline,
                    color: color,
                    size: 28,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          movimiento.tipo.label,
                          style: TextStyle(
                            color: AppColors.themedWhite,
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                        ),
                        Text(
                          dateStr,
                          style: TextStyle(
                            color: AppColors.themedWhite54,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    signed,
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w800,
                      fontSize: 20,
                    ),
                  ),
                ],
              ),
            ),
            if (movimiento.hasSaldoMismatch) ...[
              const SizedBox(height: 8),
              Semantics(
                label: 'Movimiento marcado para revisar: descuadre de saldo',
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.warning.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppTheme.warning.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.warning_amber_rounded,
                        color: AppTheme.warning,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Revisar: el saldo no cuadra con el importe (±0,01).',
                          style: TextStyle(
                            color: AppTheme.warning,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            if (pedidoRef.isNotEmpty || movimiento.displayCliente.isNotEmpty)
              _clientePedidoRow(pedidoRef),
            const SizedBox(height: 12),
            _blockArticulos(),
            const SizedBox(height: 12),
            _blockPrecioCliente(),
            const SizedBox(height: 12),
            _blockBolsaSaldo(color),
          ],
        ),
      ),
    );
  }

  Widget _clientePedidoRow(String pedidoRef) {
    return Semantics(
      label: pedidoRef.isEmpty
          ? 'Cliente ${movimiento.displayCliente}'
          : 'Pedido $pedidoRef, cliente ${movimiento.displayCliente}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (pedidoRef.isNotEmpty)
            Text(
              'Pedido $pedidoRef',
              style: TextStyle(
                color: AppColors.themedWhite,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          if (movimiento.displayCliente.isNotEmpty)
            Text(
              movimiento.displayCliente,
              style: TextStyle(
                color: AppColors.themedWhite70,
                fontSize: 12,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
    );
  }

  /// Bloque (a): artículos + fotos.
  Widget _blockArticulos() {
    final code = movimiento.codigoArticulo;
    final desc =
        movimiento.descripcion.isNotEmpty ? movimiento.descripcion : code;
    final imageUrl = code.isNotEmpty
        ? '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(code.trim())}/image'
        : '';
    return _block(
      title: 'ARTÍCULOS',
      icon: Icons.inventory_2_outlined,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            label: code.isEmpty
                ? 'Sin código de artículo'
                : 'Foto del artículo $code',
            child: SmartProductImage(
              imageUrl: imageUrl,
              productCode: code.isEmpty ? '?' : code,
              productName: desc.isEmpty ? null : desc,
              width: 64,
              height: 64,
              headers: ApiClient.authHeaders,
              borderRadius: BorderRadius.circular(10),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  desc.isEmpty ? 'Artículo sin descripción' : desc,
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (code.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    'Cód. $code',
                    style: TextStyle(
                      color: AppColors.themedWhite54,
                      fontSize: 11,
                    ),
                  ),
                ],
                if (movimiento.cantidad != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    'Cantidad: ${_cantidadConUnidad()}',
                    style: TextStyle(
                      color: AppColors.themedWhite70,
                      fontSize: 12,
                    ),
                  ),
                ],
                if (movimiento.lineId != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    'Línea ${movimiento.lineId}',
                    style: TextStyle(
                      color: AppColors.themedWhite54,
                      fontSize: 11,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Bloque (b): precio cliente + descuento aplicado.
  /// Sin margen: `precioMinimoCongelado`/`precioVenta` sensibles solo con
  /// `canSeeMargin`. El precio cliente visible sale del pedido (el comercial
  /// ve sus propios precios de venta); aquí se muestra lo no sensible y la
  /// referencia completa al pedido.
  Widget _blockPrecioCliente() {
    return _block(
      title: 'PRECIO CLIENTE',
      icon: Icons.price_check_outlined,
      child: canSeeMargin
          ? _precioJefe()
          : _precioComercial(),
    );
  }

  Widget _precioJefe() {
    final rows = <String>[
      if (movimiento.precioVenta != null)
        'Precio venta: ${_money(movimiento.precioVenta!)}',
      if (movimiento.precioMinimoCongelado != null)
        'Referencia tarifa: ${_money(movimiento.precioMinimoCongelado!)}',
    ];
    if (rows.isEmpty) {
      return _precioComercial();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              r,
              style: TextStyle(
                color: AppColors.themedWhite,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        Text(
          'Detalle y descuento aplicado en el pedido ${movimiento.displayPedido}.',
          style: TextStyle(
            color: AppColors.themedWhite54,
            fontSize: 11,
          ),
        ),
      ],
    );
  }

  Widget _precioComercial() {
    return Semantics(
      label:
          'Precio cliente y descuento visibles en el pedido ${movimiento.displayPedido}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Precio cliente y descuento aplicado: ver pedido ${movimiento.displayPedido.isEmpty ? '(sin referencia)' : movimiento.displayPedido}.',
            style: TextStyle(
              color: AppColors.themedWhite,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'La referencia de tarifa no se muestra al perfil comercial.',
            style: TextStyle(
              color: AppColors.themedWhite54,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  /// Bloque (c): bolsa + saldo (REQ-15).
  Widget _blockBolsaSaldo(Color color) {
    return _block(
      title: 'BOLSA Y SALDO',
      icon: Icons.account_balance_wallet_outlined,
      child: Semantics(
        label:
            'Saldo anterior ${movimiento.saldoAnterior.toStringAsFixed(2)} euros, '
            'saldo posterior ${movimiento.saldoPosterior.toStringAsFixed(2)} euros, '
            'variación ${movimiento.variacionSaldo.toStringAsFixed(2)} euros. '
            '${movimiento.motivoVariacion()}',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Saldo anterior',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                Text(
                  _money(movimiento.saldoAnterior),
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Efecto bolsa',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                Text(
                  '${movimiento.importeFirmado >= 0 ? '+' : '-'}${_money(movimiento.importeFirmado.abs())}',
                  style: TextStyle(
                    color: color,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Saldo posterior',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
                Text(
                  _money(movimiento.saldoPosterior),
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              movimiento.motivoVariacion(),
              style: TextStyle(
                color: color.withValues(alpha: 0.9),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (movimiento.idempotencyKey != null &&
                movimiento.idempotencyKey!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                'Ref. ${movimiento.idempotencyKey}',
                style: TextStyle(
                  color: AppColors.themedWhite38,
                  fontSize: 10,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _block({
    required String title,
    required IconData icon,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.softPanel.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppTheme.info, size: 16),
              const SizedBox(width: 6),
              Text(
                title,
                style: TextStyle(
                  color: AppTheme.info,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }

  String _cantidadConUnidad() {
    final q = movimiento.cantidad ?? 0;
    final base =
        q == q.roundToDouble() ? q.toStringAsFixed(0) : q.toStringAsFixed(2);
    final unit = movimiento.unidadMedida?.trim() ?? '';
    return unit.isEmpty ? base : '$base $unit';
  }

  static String _money(double v) => '${v.toStringAsFixed(2)} €';
}

/// Busca la línea del pedido para mostrar precio cliente + dto (bloque b).
/// Uso futuro: el sheet recibe `OrderLine?` cuando la pantalla tenga el
/// detalle cargado; sin él, el bloque b usa la referencia al pedido.
class BolsaDetailLineRef {
  const BolsaDetailLineRef({
    this.precioVenta,
    this.descuentoLinea,
    this.precioTarifaCliente,
  });

  final double? precioVenta;
  final double? descuentoLinea;
  final double? precioTarifaCliente;

  static BolsaDetailLineRef? fromOrderLine(OrderLine line) =>
      BolsaDetailLineRef(
        precioVenta: line.precioVenta,
        descuentoLinea: line.lineDiscountPct,
        precioTarifaCliente: line.precioTarifaCliente,
      );
}
