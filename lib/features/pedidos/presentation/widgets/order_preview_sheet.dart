/// Order Preview Sheet (Amazon-style)
/// ====================================
/// Premium DraggableScrollableSheet showing full order details
/// before confirmation. Includes IVA breakdown, margin info,
/// stock warnings, and sale type selector.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

typedef OrderPreviewConfirm = Future<dynamic> Function(
  String observaciones, {
  String? deliveryDate,
  String? vehicleCode,
  String? driverCode,
  String? routeCode,
});

/// Shows the order preview as a centered dialog. Returns the confirmation
/// result (Map) if confirmed, null if cancelled or failed.
Future<dynamic> showOrderPreviewSheet({
  required BuildContext context,
  required PedidosProvider provider,
  required String vendedorCode,
  required OrderPreviewConfirm onConfirm,
}) {
  return showDialog<dynamic>(
    context: context,
    barrierColor: Colors.black87,
    builder: (ctx) => _OrderPreviewSheet(
      provider: provider,
      vendedorCode: vendedorCode,
      onConfirm: onConfirm,
    ),
  );
}

class _OrderPreviewSheet extends StatefulWidget {
  const _OrderPreviewSheet({
    required this.provider,
    required this.vendedorCode,
    required this.onConfirm,
  });
  final PedidosProvider provider;
  final String vendedorCode;
  final OrderPreviewConfirm onConfirm;

  @override
  State<_OrderPreviewSheet> createState() => _OrderPreviewSheetState();
}

class _OrderPreviewSheetState extends State<_OrderPreviewSheet>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  bool _isConfirming = false;
  bool _isLoadingDeliveryOptions = false;
  bool _confirmSucceeded = false;
  OrderDeliveryOptions? _deliveryOptions;
  DateTime? _selectedDeliveryDate;
  String? _deliveryError;
  String? _confirmStatusMessage;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _loadDeliveryOptions();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = widget.provider;
    final lines = provider.lines;
    final hasDiscount = provider.globalDiscountPct > 0;
    final margin = provider.porcentajeMargen;
    final total = provider.totalConIva;

    // ponytail: widgets preconstruidos eager; .builder difiere inflate/layout. upgrade: itemBuilder por indice si lines crece mucho.
    final rows = <Widget>[
      _buildClientCard(provider),
      const SizedBox(height: 16),
      _buildDeliveryCard(),
      const SizedBox(height: 16),
      _buildSectionLabel('PRODUCTOS (${lines.length})'),
      const SizedBox(height: 8),
      ...lines.asMap().entries.map(
            (entry) => _buildLineItem(
              entry.key,
              entry.value,
              hasDiscount,
              provider,
            ),
          ),
      const SizedBox(height: 16),
      _buildTotalsCard(provider, hasDiscount, total, margin),
      const SizedBox(height: 16),
      if (provider.ivaBreakdown.isNotEmpty) _buildIvaBreakdown(provider),
      const SizedBox(height: 24),
    ];

    return Dialog(
      backgroundColor: AppTheme.inkSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.88,
          maxWidth: 520,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // ── Header ──
            _buildHeader(provider),

            // ── Scrollable Content ──
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                itemCount: rows.length,
                itemBuilder: (_, index) => rows[index],
              ),
            ),

            // ── Confirm Footer ──
            _buildConfirmFooter(total, margin),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(PedidosProvider provider) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 12, 18),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.info.withValues(alpha: 0.18),
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: AppTheme.info,
              borderRadius: BorderRadius.circular(14),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.16),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(
              Icons.task_alt_rounded,
              color: Colors.white,
              size: 24,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  provider.clientName ?? 'Pedido listo',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    _buildHeaderChip(
                      Icons.storefront_rounded,
                      provider.clientCode ?? '-',
                    ),
                    _buildHeaderChip(
                      Icons.sell_rounded,
                      provider.saleTypeLabel,
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _isConfirming ? null : () => Navigator.pop(context),
            icon: const Icon(Icons.close, color: Colors.white54),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }

  Widget _buildHeaderChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: AppTheme.info, size: 13),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildClientCard(PedidosProvider provider) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphismPremium(
        glowColor: AppTheme.info,
        opacity: 0.5,
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.storefront, color: AppTheme.info, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  provider.clientName ?? 'Sin cliente',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  'Código: ${provider.clientCode ?? '-'}',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          if (provider.clientSaldoPendiente > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppTheme.warning.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border:
                    Border.all(color: AppTheme.warning.withValues(alpha: 0.3)),
              ),
              child: Column(
                children: [
                  const Text(
                    'Saldo Pdte',
                    style: TextStyle(color: AppTheme.warning, fontSize: 9),
                  ),
                  Text(
                    PedidosFormatters.money(provider.clientSaldoPendiente),
                    style: const TextStyle(
                      color: AppTheme.warning,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDeliveryCard() {
    final options = _deliveryOptions;
    final dateLabel = _selectedDeliveryDate != null
        ? _formatDateDisplay(_selectedDeliveryDate!)
        : options?.deliveryLabel ?? 'Calculando...';
    final weekdayLabel = _selectedDeliveryDate == null
        ? ''
        : _weekdayLabel(_selectedDeliveryDate!);
    final truckLabel = options?.truckLabel ?? 'Calculando camion...';
    final truckSub = options == null
        ? ''
        : [
            if (options.vehicleDescription.isNotEmpty)
              options.vehicleDescription,
            if (options.routeCode.isNotEmpty) 'Ruta ${options.routeCode}',
          ].join(' - ');
    final isValidated = options?.validated ?? false;
    final ruleLabel = options == null
        ? 'Cargando reparto'
        : isValidated
            ? 'Dias de reparto cliente'
            : 'Sin regla cerrada en DB';

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppTheme.softPanel,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.success.withValues(alpha: 0.22)),
        boxShadow: [
          BoxShadow(
            color: AppTheme.success.withValues(alpha: 0.10),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.route_rounded,
                  color: AppTheme.success,
                  size: 21,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Reparto',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      ruleLabel,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              _buildStatusPill(
                isValidated ? 'Validado' : 'Flexible',
                isValidated ? AppTheme.success : AppTheme.warning,
              ),
              const SizedBox(width: 8),
              if (_isLoadingDeliveryOptions)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppTheme.success,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Fecha reparto',
                        style: TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Flexible(
                            child: Text(
                              dateLabel,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w900,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (weekdayLabel.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Padding(
                              padding: const EdgeInsets.only(bottom: 3),
                              child: Text(
                                weekdayLabel,
                                style: const TextStyle(
                                  color: AppTheme.success,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Cambiar fecha',
                  onPressed: _isLoadingDeliveryOptions || _isConfirming
                      ? null
                      : _pickDeliveryDate,
                  icon: const Icon(Icons.edit_calendar_rounded),
                  color: AppTheme.success,
                  style: IconButton.styleFrom(
                    backgroundColor: AppTheme.success.withValues(alpha: 0.12),
                    disabledBackgroundColor:
                        Colors.white.withValues(alpha: 0.04),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _buildDayChips(options),
          const SizedBox(height: 12),
          InkWell(
            onTap: _isLoadingDeliveryOptions || _isConfirming
                ? null
                : _showVehicleSelector,
            borderRadius: BorderRadius.circular(14),
            child: Container(
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.055),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _buildDeliveryInfo(
                      icon: Icons.local_shipping_rounded,
                      label: 'Camion asignado',
                      value: truckLabel,
                      subtitle: truckSub,
                    ),
                  ),
                  Icon(
                    Icons.arrow_forward_ios_rounded,
                    color: AppTheme.textSecondary,
                    size: 14,
                  ),
                ],
              ),
            ),
          ),
          if (_deliveryError != null) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.error.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: AppTheme.error.withValues(alpha: 0.24)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.error_outline_rounded,
                    color: AppTheme.error,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _deliveryError!,
                      style: const TextStyle(
                        color: AppTheme.error,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildStatusPill(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.26)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _buildDayChips(OrderDeliveryOptions? options) {
    final days = options?.allowedDeliveryDays ?? const <String>[];
    if (days.isEmpty) {
      return _buildStatusPill('Sin regla de reparto en DB', AppTheme.warning);
    }
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: days
          .map(
            (day) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: AppTheme.success.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: AppTheme.success.withValues(alpha: 0.22),
                ),
              ),
              child: Text(
                _capitalize(day),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _buildDeliveryInfo({
    required IconData icon,
    required String label,
    required String value,
    String subtitle = '',
  }) {
    return Row(
      children: [
        Icon(icon, color: AppTheme.textSecondary, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                ),
              ),
              Text(
                value,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (subtitle.isNotEmpty)
                Text(
                  subtitle,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 11,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSectionLabel(String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Container(
            width: 3,
            height: 14,
            decoration: BoxDecoration(
              color: AppTheme.info,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLineItem(
    int index,
    OrderLine line,
    bool hasDiscount,
    PedidosProvider provider,
  ) {
    final effectivePrice = hasDiscount
        ? line.precioVenta * (1 - provider.globalDiscountPct / 100)
        : line.precioVenta;
    final qty = _formatPreviewQuantity(line);
    final lineTotal = hasDiscount
        ? line.importeVenta * (1 - provider.globalDiscountPct / 100)
        : line.importeVenta;
    final bolsaDelta = provider.isMarginVisible && line.precioMinimo > 0
        ? double.parse(
            ((effectivePrice - line.precioMinimo) * line.billingQuantity)
                .toStringAsFixed(2),
          )
        : 0.0;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          // Index
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${index + 1}',
              style: const TextStyle(
                color: AppTheme.info,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 12),
          // Product info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.descripcion,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '$qty × ${PedidosFormatters.money(effectivePrice, decimals: 3)}',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 11,
                  ),
                ),
                if (bolsaDelta != 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Bolsa ${bolsaDelta > 0 ? '+' : '-'}${PedidosFormatters.money(bolsaDelta.abs())}',
                    style: TextStyle(
                      color:
                          bolsaDelta > 0 ? AppTheme.success : AppTheme.warning,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
          // Line total
          Text(
            PedidosFormatters.money(lineTotal),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  String _formatPreviewQuantity(OrderLine line) {
    final unit = line.unidadMedida.trim().toUpperCase();
    final label = Product.unitLabel(unit);
    if (unit == 'KILOGRAMOS') {
      return '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} kg';
    }
    if (unit == 'LITROS') {
      return '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} L';
    }
    if (unit == 'CAJAS' || unit.isEmpty) {
      if (line.cantidadEnvases > 0) {
        return '${PedidosFormatters.number(line.cantidadEnvases)} cajas';
      }
      return '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} uds';
    }
    return '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} $label';
  }

  Widget _buildTotalsCard(
    PedidosProvider provider,
    bool hasDiscount,
    double total,
    double margin,
  ) {
    final marginColor = margin >= 15
        ? AppTheme.success
        : margin >= 5
            ? AppTheme.warning
            : AppTheme.error;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphismPremium(
        glowColor: AppTheme.success,
        opacity: 0.4,
      ),
      child: Column(
        children: [
          // Subtotal
          _buildTotalRow(
            'Subtotal (${provider.lineCount} líneas)',
            PedidosFormatters.money(provider.totalImporte),
          ),

          // Discount
          if (hasDiscount) ...[
            const SizedBox(height: 8),
            _buildTotalRow(
              'Descuento ${provider.globalDiscountPct.toStringAsFixed(1)}%',
              '-${PedidosFormatters.money(provider.totalDescuento)}',
              valueColor: AppTheme.error,
            ),
          ],

          const SizedBox(height: 8),
          Divider(color: AppTheme.borderColor, height: 1),
          const SizedBox(height: 8),

          // Base
          _buildTotalRow(
            'Base Imponible',
            PedidosFormatters.money(provider.totalBase),
          ),

          // IVA
          const SizedBox(height: 4),
          _buildTotalRow('IVA', PedidosFormatters.money(provider.totalIva)),

          if (provider.isMarginVisible &&
              provider.estimatedBolsaImpact.hasImpact) ...[
            const SizedBox(height: 8),
            Divider(color: AppTheme.borderColor, height: 1),
            const SizedBox(height: 8),
            _buildBolsaPreviewRows(provider),
          ],

          const SizedBox(height: 8),
          Divider(color: AppTheme.borderColor, height: 1),
          const SizedBox(height: 12),

          // TOTAL
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'TOTAL',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                PedidosFormatters.money(total),
                style: const TextStyle(
                  color: AppTheme.success,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),

          const SizedBox(height: 10),

          // Margin bar
          if (provider.isMarginVisible)
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: (margin / 50).clamp(0.0, 1.0),
                      minHeight: 6,
                      backgroundColor: AppTheme.softPanel,
                      valueColor: AlwaysStoppedAnimation<Color>(marginColor),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: marginColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border:
                        Border.all(color: marginColor.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    'Margen ${margin.toStringAsFixed(1)}%',
                    style: TextStyle(
                      color: marginColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildBolsaPreviewRows(PedidosProvider provider) {
    final impact = provider.estimatedBolsaImpact;
    return Column(
      children: [
        if (impact.acumulacion > 0)
          _buildTotalRow(
            'Bolsa generada',
            '+${PedidosFormatters.money(impact.acumulacion)}',
            valueColor: AppTheme.success,
          ),
        if (impact.consumo > 0) ...[
          if (impact.acumulacion > 0) const SizedBox(height: 4),
          _buildTotalRow(
            'Bolsa usada',
            '-${PedidosFormatters.money(impact.consumo)}',
            valueColor: AppTheme.warning,
          ),
        ],
        const SizedBox(height: 4),
        _buildTotalRow(
          'Impacto neto bolsa',
          '${impact.neto >= 0 ? '+' : ''}${PedidosFormatters.money(impact.neto)}',
          valueColor: impact.neto >= 0 ? AppTheme.success : AppTheme.warning,
        ),
      ],
    );
  }

  Widget _buildTotalRow(String label, String value, {Color? valueColor}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
        ),
        Text(
          value,
          style: TextStyle(
            color: valueColor ?? Colors.white,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  Widget _buildIvaBreakdown(PedidosProvider provider) {
    final breakdown = provider.ivaBreakdown;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionLabel('DESGLOSE IVA'),
          const SizedBox(height: 6),
          ...breakdown.entries.map((e) {
            final pct = e.key.toString();
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'IVA $pct%',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                  Text(
                    PedidosFormatters.money(e.value),
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildConfirmFooter(double total, double margin) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          top: BorderSide(color: AppTheme.info.withValues(alpha: 0.2)),
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.info.withValues(alpha: 0.1),
            blurRadius: 20,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_confirmStatusMessage != null) ...[
              _buildConfirmStatusBanner(),
              const SizedBox(height: 12),
            ],
            Row(
              children: [
                // Total summary
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Total a confirmar',
                        style: TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                      Text(
                        PedidosFormatters.money(total),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                // Confirm button with pulse animation
                AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, child) {
                    final glow = _isConfirming || _confirmSucceeded
                        ? 0.0
                        : _pulseController.value * 0.3;
                    return Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color:
                                AppTheme.success.withValues(alpha: 0.2 + glow),
                            blurRadius: 16 + (glow * 20),
                            spreadRadius: glow * 4,
                          ),
                        ],
                      ),
                      child: child,
                    );
                  },
                  child: SizedBox(
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: _isConfirming ||
                              _isLoadingDeliveryOptions ||
                              _confirmSucceeded
                          ? null
                          : _handleConfirm,
                      icon: _isConfirming
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Icon(
                              _confirmSucceeded
                                  ? Icons.check_circle
                                  : Icons.check_circle_outline,
                              size: 20,
                            ),
                      label: Text(
                        _confirmSucceeded
                            ? 'Confirmado'
                            : (_isConfirming
                                ? 'Confirmando...'
                                : 'CONFIRMAR PEDIDO'),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.success,
                        foregroundColor: Colors.white,
                        disabledBackgroundColor:
                            AppTheme.success.withValues(alpha: 0.4),
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        elevation: 0,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConfirmStatusBanner() {
    final isError = !_isConfirming && !_confirmSucceeded;
    final color = _confirmSucceeded
        ? AppTheme.success
        : (isError ? AppTheme.error : AppTheme.info);
    final icon = _confirmSucceeded
        ? Icons.check_circle_rounded
        : (isError ? Icons.error_outline_rounded : Icons.sync_rounded);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          if (_isConfirming)
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: color,
              ),
            )
          else
            Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _confirmStatusMessage!,
              style: TextStyle(
                color: color,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _loadDeliveryOptions({String? deliveryDate}) async {
    final clientCode = widget.provider.clientCode;
    if (clientCode == null || clientCode.trim().isEmpty) return;

    setState(() {
      _isLoadingDeliveryOptions = true;
      _deliveryError = null;
    });

    try {
      final options = await PedidosService.getDeliveryOptions(
        clientCode: clientCode.trim(),
        vendedorCode: widget.vendedorCode,
        deliveryDate: deliveryDate,
      );
      final selected = _parseIsoDate(
        options.selectedDeliveryDate.isNotEmpty
            ? options.selectedDeliveryDate
            : options.suggestedDeliveryDate,
      );
      if (!mounted) return;
      setState(() {
        _deliveryOptions = options;
        _selectedDeliveryDate = selected ?? _selectedDeliveryDate;
        _isLoadingDeliveryOptions = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _deliveryError = _cleanError(e);
        _isLoadingDeliveryOptions = false;
      });
    }
  }

  Future<void> _pickDeliveryDate() async {
    final now = DateTime.now();
    final initial = _selectedDeliveryDate ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(now) ? now : initial,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 60)),
      helpText: 'Fecha reparto',
      confirmText: 'Aceptar',
      cancelText: 'Cancelar',
    );

    if (picked == null) return;
    await _loadDeliveryOptions(deliveryDate: _formatIsoDate(picked));
  }

  Future<void> _showVehicleSelector() async {
    if (_deliveryOptions == null) return;

    try {
      final vehicles = await PedidosService.getAvailableVehicles();
      if (!mounted) return;

      if (vehicles.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No hay camiones disponibles'),
            backgroundColor: AppTheme.warning,
          ),
        );
        return;
      }

      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppTheme.raisedSurface,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.local_shipping_rounded, color: AppTheme.success),
              SizedBox(width: 8),
              Text('Seleccionar camion', style: TextStyle(color: Colors.white)),
            ],
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: vehicles.length,
              itemBuilder: (_, i) {
                final v = vehicles[i];
                final code = (v['code'] ?? '').toString();
                final desc =
                    (v['matricula'] ?? v['description'] ?? '').toString();
                final isCurrent = code == _deliveryOptions?.vehicleCode;
                return ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: isCurrent
                          ? AppTheme.success.withValues(alpha: 0.15)
                          : AppTheme.info.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      Icons.local_shipping_rounded,
                      color: isCurrent ? AppTheme.success : AppTheme.info,
                    ),
                  ),
                  title: Text(
                    desc.isNotEmpty ? '$code - $desc' : 'Camion $code',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                  trailing: isCurrent
                      ? const Icon(Icons.check_circle, color: AppTheme.success)
                      : null,
                  onTap: () {
                    Navigator.pop(ctx);
                    setState(() {
                      _deliveryOptions = OrderDeliveryOptions(
                        clientCode: _deliveryOptions!.clientCode,
                        vendedorCode: _deliveryOptions!.vendedorCode,
                        allowedDeliveryDays:
                            _deliveryOptions!.allowedDeliveryDays,
                        allowedDeliveryDaysShort:
                            _deliveryOptions!.allowedDeliveryDaysShort,
                        suggestedDeliveryDate:
                            _deliveryOptions!.suggestedDeliveryDate,
                        suggestedDeliveryDateFormatted:
                            _deliveryOptions!.suggestedDeliveryDateFormatted,
                        selectedDeliveryDate:
                            _deliveryOptions!.selectedDeliveryDate,
                        selectedDeliveryDateFormatted:
                            _deliveryOptions!.selectedDeliveryDateFormatted,
                        vehicleCode: code,
                        driverCode: _deliveryOptions!.driverCode,
                        vehicleMatricula: desc,
                        vehicleDescription: desc,
                        truckConfidence: 'manual',
                        truckSource: 'manual',
                        routeCode: _deliveryOptions!.routeCode,
                        validated: _deliveryOptions!.validated,
                      );
                    });
                  },
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text(
                'Cancelar',
                style: TextStyle(color: Colors.white54),
              ),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error cargando camiones: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  DateTime? _parseIsoDate(String value) {
    final parts = value.split('-');
    if (parts.length != 3) return null;
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    final day = int.tryParse(parts[2]);
    if (year == null || month == null || day == null) return null;
    return DateTime(year, month, day);
  }

  String _formatIsoDate(DateTime date) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }

  String _formatDateDisplay(DateTime date) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '$day/$month/${date.year}';
  }

  String _weekdayLabel(DateTime date) {
    const labels = [
      'Lunes',
      'Martes',
      'Miercoles',
      'Jueves',
      'Viernes',
      'Sabado',
      'Domingo',
    ];
    return labels[date.weekday - 1];
  }

  String _capitalize(String value) {
    final clean = value.trim();
    if (clean.isEmpty) return clean;
    return clean[0].toUpperCase() + clean.substring(1);
  }

  String _cleanError(Object error) {
    final raw = error.toString();
    return raw
        .replaceFirst('ApiException: ', '')
        .replaceFirst('Exception: ', '');
  }

  Future<void> _handleConfirm() async {
    HapticFeedback.heavyImpact();
    setState(() {
      _isConfirming = true;
      _confirmSucceeded = false;
      _confirmStatusMessage = 'Confirmando pedido...';
    });

    try {
      final result = await widget.onConfirm(
        '',
        deliveryDate: _selectedDeliveryDate == null
            ? null
            : _formatIsoDate(_selectedDeliveryDate!),
        vehicleCode: _deliveryOptions?.vehicleCode,
        driverCode: _deliveryOptions?.driverCode,
        routeCode: _deliveryOptions?.routeCode,
      );
      if (!mounted) return;
      final resultMap = result is Map<String, dynamic> ? result : null;
      final isRealSuccess =
          resultMap != null && isConfirmedOrderResultForProvider(resultMap);
      final isPendingSync = resultMap != null &&
          (resultMap['pendingConfirmation'] == true ||
              resultMap['queued'] == true);
      if (isRealSuccess) {
        HapticFeedback.mediumImpact();
        final number = resultMap['numeroPedido']?.toString();
        setState(() {
          _isConfirming = false;
          _confirmSucceeded = true;
          _confirmStatusMessage = number == null || number.isEmpty
              ? 'Pedido confirmado correctamente'
              : 'Pedido #$number confirmado correctamente';
        });
        await Future<void>.delayed(const Duration(seconds: 2));
        if (!mounted) return;
        Navigator.of(context).pop(result);
      } else if (isPendingSync) {
        HapticFeedback.mediumImpact();
        final message = resultMap['message']?.toString().trim();
        setState(() {
          _isConfirming = false;
          _confirmSucceeded = true;
          _confirmStatusMessage = message != null && message.isNotEmpty
              ? message
              : 'Pedido guardado localmente. Se enviara al recuperar conexion.';
        });
        await Future<void>.delayed(const Duration(seconds: 2));
        if (!mounted) return;
        Navigator.of(context).pop(result);
      } else if (resultMap != null) {
        // Resultado bloqueado por stock o no confirmado: NO mostrar éxito
        // ni cerrar el diálogo (el flujo de alternativas se abre encima).
        final status = orderConfirmationStatusForProvider(resultMap);
        final message = resultMap['message']?.toString().trim();
        setState(() {
          _isConfirming = false;
          _confirmSucceeded = false;
          _confirmStatusMessage = (message != null && message.isNotEmpty)
              ? _cleanError(message)
              : 'Pedido no confirmado. Estado: '
                  '${status.isEmpty ? 'DESCONOCIDO' : status}';
        });
      } else {
        final providerError = widget.provider.error;
        setState(() {
          _isConfirming = false;
          _confirmSucceeded = false;
          _confirmStatusMessage = providerError == null || providerError.isEmpty
              ? 'No se pudo confirmar el pedido. Intentalo de nuevo.'
              : _cleanError(providerError);
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isConfirming = false;
        _confirmSucceeded = false;
        _confirmStatusMessage = _cleanError(e);
      });
    }
  }
}
