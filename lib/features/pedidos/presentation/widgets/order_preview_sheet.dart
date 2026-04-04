/// Order Preview Sheet (Amazon-style)
/// ====================================
/// Premium DraggableScrollableSheet showing full order details
/// before confirmation. Includes IVA breakdown, margin info,
/// stock warnings, and sale type selector.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/pedidos_service.dart';
import '../../providers/pedidos_provider.dart';
import '../utils/pedidos_formatters.dart';

/// Shows the order preview as a centered dialog. Returns true if confirmed.
Future<bool?> showOrderPreviewSheet({
  required BuildContext context,
  required PedidosProvider provider,
  required String vendedorCode,
  required Future<Map<String, dynamic>?> Function(String observaciones) onConfirm,
}) {
  return showDialog<bool>(
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
  final PedidosProvider provider;
  final String vendedorCode;
  final Future<Map<String, dynamic>?> Function(String observaciones) onConfirm;

  const _OrderPreviewSheet({
    required this.provider,
    required this.vendedorCode,
    required this.onConfirm,
  });

  @override
  State<_OrderPreviewSheet> createState() => _OrderPreviewSheetState();
}

class _OrderPreviewSheetState extends State<_OrderPreviewSheet>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  bool _isConfirming = false;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
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
    final total = hasDiscount ? provider.totalConDescuento : provider.totalImporte;

    return Dialog(
      backgroundColor: AppTheme.darkBase,
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
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  _buildClientCard(provider),
                  const SizedBox(height: 16),
                  _buildSectionLabel('PRODUCTOS (${lines.length})'),
                  const SizedBox(height: 8),
                  ...lines.asMap().entries.map((entry) =>
                      _buildLineItem(entry.key, entry.value, hasDiscount, provider)),
                  const SizedBox(height: 16),
                  _buildTotalsCard(provider, hasDiscount, total, margin),
                  const SizedBox(height: 16),
                  if (provider.ivaBreakdown.isNotEmpty)
                    _buildIvaBreakdown(provider),
                  const SizedBox(height: 24),
                ],
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
      padding: const EdgeInsets.fromLTRB(20, 16, 12, 16),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.15),
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withOpacity(0.2),
                  AppTheme.neonPurple.withOpacity(0.1),
                ],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              Icons.receipt_long,
              color: AppTheme.neonBlue,
              size: 24,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Resumen del Pedido',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    const Text(
                      'Revisa antes de confirmar',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: AppTheme.neonBlue.withOpacity(0.3),
                        ),
                      ),
                      child: Text(
                        provider.saleTypeLabel,
                        style: const TextStyle(
                          color: AppTheme.neonBlue,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close, color: Colors.white54),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }

  Widget _buildClientCard(PedidosProvider provider) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphismPremium(
        glowColor: AppTheme.neonBlue,
        opacity: 0.5,
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.neonBlue.withOpacity(0.3), AppTheme.neonPurple.withOpacity(0.2)],
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.storefront, color: AppTheme.neonBlue, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  provider.clientName ?? 'Sin cliente',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  'Código: ${provider.clientCode ?? '-'}',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          if (provider.clientSaldoPendiente > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppTheme.warning.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.warning.withOpacity(0.3)),
              ),
              child: Column(
                children: [
                  const Text('Saldo Pdte', style: TextStyle(color: AppTheme.warning, fontSize: 9)),
                  Text(
                    PedidosFormatters.money(provider.clientSaldoPendiente),
                    style: const TextStyle(
                        color: AppTheme.warning, fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
        ],
      ),
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
              color: AppTheme.neonBlue,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLineItem(int index, OrderLine line, bool hasDiscount, PedidosProvider provider) {
    final effectivePrice = hasDiscount
        ? line.precioVenta * (1 - provider.globalDiscountPct / 100)
        : line.precioVenta;
    final qty = line.cantidadEnvases > 0
        ? '${PedidosFormatters.number(line.cantidadEnvases)} ${line.unidadMedida.toLowerCase()}'
        : '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} ${line.unidadMedida.toLowerCase()}';
    final lineTotal = hasDiscount
        ? line.importeVenta * (1 - provider.globalDiscountPct / 100)
        : line.importeVenta;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withOpacity(0.6),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          // Index
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${index + 1}',
              style: const TextStyle(
                  color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.w600),
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
                  style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '$qty × ${PedidosFormatters.money(effectivePrice, decimals: 3)}',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          // Line total
          Text(
            PedidosFormatters.money(lineTotal),
            style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildTotalsCard(
      PedidosProvider provider, bool hasDiscount, double total, double margin) {
    final marginColor = margin >= 15
        ? AppTheme.neonGreen
        : margin >= 5
            ? AppTheme.warning
            : AppTheme.error;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphismPremium(
        glowColor: AppTheme.neonGreen,
        opacity: 0.4,
      ),
      child: Column(
        children: [
          // Subtotal
          _buildTotalRow('Subtotal (${provider.lineCount} líneas)',
              PedidosFormatters.money(provider.totalImporte)),

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
          const Divider(color: AppTheme.borderColor, height: 1),
          const SizedBox(height: 8),

          // Base
          _buildTotalRow('Base Imponible', PedidosFormatters.money(provider.totalBase)),

          // IVA
          const SizedBox(height: 4),
          _buildTotalRow('IVA', PedidosFormatters.money(provider.totalIva)),

          const SizedBox(height: 8),
          const Divider(color: AppTheme.borderColor, height: 1),
          const SizedBox(height: 12),

          // TOTAL
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('TOTAL',
                  style: TextStyle(
                      color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
              Text(
                PedidosFormatters.money(total),
                style: const TextStyle(
                    color: AppTheme.neonGreen,
                    fontSize: 22,
                    fontWeight: FontWeight.w800),
              ),
            ],
          ),

          const SizedBox(height: 10),

          // Margin bar
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: (margin / 50).clamp(0.0, 1.0),
                    minHeight: 6,
                    backgroundColor: AppTheme.darkCard,
                    valueColor: AlwaysStoppedAnimation<Color>(marginColor),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: marginColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: marginColor.withOpacity(0.3)),
                ),
                child: Text(
                  'Margen ${margin.toStringAsFixed(1)}%',
                  style: TextStyle(
                      color: marginColor, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTotalRow(String label, String value, {Color? valueColor}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
        Text(value,
            style: TextStyle(
                color: valueColor ?? Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w500)),
      ],
    );
  }

  Widget _buildIvaBreakdown(PedidosProvider provider) {
    final breakdown = provider.ivaBreakdown;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withOpacity(0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionLabel('DESGLOSE IVA'),
          const SizedBox(height: 6),
          ...breakdown.entries.map((e) {
            final pct = (e.key * 100).toStringAsFixed(0);
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('IVA $pct%',
                      style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                  Text(PedidosFormatters.money(e.value),
                      style: const TextStyle(color: Colors.white70, fontSize: 12)),
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
        color: AppTheme.darkSurface,
        border: Border(top: BorderSide(color: AppTheme.neonBlue.withOpacity(0.2))),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonBlue.withOpacity(0.1),
            blurRadius: 20,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        child: Row(
          children: [
            // Total summary
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Total a confirmar',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                  Text(
                    PedidosFormatters.money(total),
                    style: const TextStyle(
                        color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            // Confirm button with pulse animation
            AnimatedBuilder(
              animation: _pulseController,
              builder: (context, child) {
                final glow = _isConfirming ? 0.0 : _pulseController.value * 0.3;
                return Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.neonGreen.withOpacity(0.2 + glow),
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
                  onPressed: _isConfirming ? null : _handleConfirm,
                  icon: _isConfirming
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppTheme.darkBase))
                      : const Icon(Icons.check_circle_outline, size: 20),
                  label: Text(
                    _isConfirming ? 'Confirmando...' : 'CONFIRMAR PEDIDO',
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 0.5),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonGreen,
                    foregroundColor: AppTheme.darkBase,
                    disabledBackgroundColor: AppTheme.neonGreen.withOpacity(0.4),
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16)),
                    elevation: 0,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleConfirm() async {
    HapticFeedback.heavyImpact();
    setState(() => _isConfirming = true);

    try {
      final result = await widget.onConfirm('');
      if (result != null && mounted) {
        HapticFeedback.mediumImpact();
        Navigator.of(context).pop(true);
      } else {
        setState(() => _isConfirming = false);
      }
    } catch (e) {
      setState(() => _isConfirming = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }
}
