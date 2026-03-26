/// Order Detail Sheet
/// ==================
/// Bottom sheet showing full order details: header info, lines, totals, and actions

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import 'order_pdf_generator.dart';
import '../utils/pedidos_formatters.dart';

class OrderDetailSheet {
  /// Show order detail as a draggable bottom sheet
  static Future<String?> show(
    BuildContext context, {
    required int orderId,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (ctx, scrollCtrl) => _OrderDetailBody(
          orderId: orderId,
          scrollController: scrollCtrl,
        ),
      ),
    );
  }
}

class _OrderDetailBody extends StatefulWidget {
  final int orderId;
  final ScrollController scrollController;

  const _OrderDetailBody({
    required this.orderId,
    required this.scrollController,
  });

  @override
  State<_OrderDetailBody> createState() => _OrderDetailBodyState();
}

class _OrderDetailBodyState extends State<_OrderDetailBody> {
  OrderDetail? _detail;
  bool _isLoading = true;
  String? _error;
  bool _isCancelling = false;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final detail = await PedidosService.getOrderDetail(widget.orderId);
      if (mounted)
        setState(() {
          _detail = detail;
          _isLoading = false;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
    }
  }

  Future<void> _cancelOrder() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.cancel_outlined, color: AppTheme.error, size: 22),
            SizedBox(width: 8),
            Text('Anular pedido', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: const Text(
          'Esta accion no se puede deshacer. ¿Deseas anular este pedido?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('No', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Si, anular',
                style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isCancelling = true);
    try {
      await PedidosService.cancelOrder(widget.orderId);
      if (mounted) Navigator.pop(context, 'cancelled');
    } catch (e) {
      if (mounted) {
        setState(() => _isCancelling = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
          child: CircularProgressIndicator(color: AppTheme.neonBlue));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
            const SizedBox(height: 12),
            Text('Error al cargar pedido',
                style: TextStyle(
                    color: Colors.white,
                    fontSize:
                        Responsive.fontSize(context, small: 14, large: 16))),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _loadDetail,
              icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
              label: const Text('Reintentar',
                  style: TextStyle(color: AppTheme.neonBlue)),
            ),
          ],
        ),
      );
    }

    final detail = _detail!;
    final header = detail.header;
    final statusColor = _statusColor(header.estado);

    return Column(
      children: [
        // Handle bar
        Center(
          child: Container(
            margin: const EdgeInsets.only(top: 8, bottom: 4),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
                color: Colors.white24, borderRadius: BorderRadius.circular(2)),
          ),
        ),
        // Header
        _buildHeader(header, statusColor),
        const Divider(color: AppTheme.borderColor, height: 1),
        // Lines
        Expanded(
          child: detail.lines.isEmpty
              ? const Center(
                  child: Text('Sin lineas',
                      style: TextStyle(color: Colors.white38)))
              : ListView.builder(
                  controller: widget.scrollController,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  itemCount: detail.lines.length + 1, // +1 for totals card
                  itemBuilder: (ctx, i) {
                    if (i < detail.lines.length) {
                      return _buildLineTile(detail.lines[i], i + 1);
                    }
                    return _buildTotalsCard(detail);
                  },
                ),
        ),
        // Actions
        if (header.estado == 'BORRADOR' || header.estado == 'CONFIRMADO')
          _buildActions(header),
      ],
    );
  }

  Widget _buildHeader(OrderSummary header, Color statusColor) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Pedido #${header.numeroPedido}',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: Responsive.fontSize(context, small: 18, large: 22),
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: statusColor.withOpacity(0.5)),
                ),
                child: Text(
                  header.estado,
                  style: TextStyle(
                      color: statusColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _buildInfoRow(Icons.storefront_outlined,
              '${header.clienteName} (${header.clienteCode})'),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                  child: _buildInfoRow(
                      Icons.calendar_today_outlined, header.fecha)),
              _buildInfoRow(
                  Icons.sell_outlined, _saleTypeLabel(header.tipoVenta)),
            ],
          ),
          if (header.vendedorCode.isNotEmpty) ...[
            const SizedBox(height: 4),
            _buildInfoRow(
                Icons.badge_outlined, 'Vendedor: ${header.vendedorCode}'),
          ],
        ],
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, String text) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: Colors.white54, size: 14),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            text,
            style: TextStyle(
                color: Colors.white70,
                fontSize: Responsive.fontSize(context, small: 12, large: 14)),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildLineTile(OrderLine line, int number) {
    final marginColor = line.porcentajeMargen >= 15
        ? AppTheme.neonGreen
        : line.porcentajeMargen >= 5
            ? Colors.orange
            : AppTheme.error;

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppTheme.borderColor, width: 0.5),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Center(
                    child: Text(
                      '$number',
                      style: const TextStyle(
                          color: AppTheme.neonBlue,
                          fontSize: 11,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    line.descripcion,
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize:
                          Responsive.fontSize(context, small: 13, large: 15),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              line.codigoArticulo,
              style: TextStyle(
                  color: Colors.white54,
                  fontSize: Responsive.fontSize(context, small: 11, large: 12)),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _buildChip('${line.cantidadEnvases.toStringAsFixed(0)} c',
                    Icons.all_inbox_outlined),
                const SizedBox(width: 6),
                _buildChip('${line.cantidadUnidades.toStringAsFixed(0)} u',
                    Icons.widgets_outlined),
                const SizedBox(width: 6),
                _buildChip(line.unidadMedida, Icons.straighten),
                const Spacer(),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      PedidosFormatters.money(line.importeVenta),
                      style: TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize:
                            Responsive.fontSize(context, small: 14, large: 16),
                      ),
                    ),
                    Text(
                      '${line.porcentajeMargen.toStringAsFixed(1)}% mg',
                      style: TextStyle(color: marginColor, fontSize: 11),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Text(
                  'PVP: ${PedidosFormatters.money(line.precioVenta, decimals: 3)}',
                  style: const TextStyle(color: Colors.white54, fontSize: 11),
                ),
                const SizedBox(width: 12),
                Text(
                  'Tarifa: ${PedidosFormatters.money(line.precioTarifa, decimals: 3)}',
                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                ),
                if (line.precioMinimo > 0) ...[
                  const SizedBox(width: 12),
                  Text(
                    'Min: ${PedidosFormatters.money(line.precioMinimo, decimals: 3)}',
                    style: TextStyle(
                      color: line.precioVenta < line.precioMinimo
                          ? AppTheme.warning
                          : Colors.white38,
                      fontSize: 11,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChip(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.darkBase.withOpacity(0.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white54, size: 12),
          const SizedBox(width: 3),
          Text(label,
              style: const TextStyle(color: Colors.white54, fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildTotalsCard(OrderDetail detail) {
    final header = detail.header;
    final totalEnvases =
        detail.lines.fold<double>(0, (s, l) => s + l.cantidadEnvases);
    final totalUnidades =
        detail.lines.fold<double>(0, (s, l) => s + l.cantidadUnidades);
    final totalImporte =
        detail.lines.fold<double>(0, (s, l) => s + l.importeVenta);
    final totalCosto =
        detail.lines.fold<double>(0, (s, l) => s + l.importeCosto);
    final totalMargen = totalImporte - totalCosto;
    final pctMargen =
        totalImporte > 0 ? (totalMargen / totalImporte) * 100 : 0.0;

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Text(
            'Resumen del pedido',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: Responsive.fontSize(context, small: 14, large: 16),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildTotalItem(
                  'Lineas', '${detail.lines.length}', AppTheme.neonBlue),
              _buildTotalItem(
                  'Cajas', totalEnvases.toStringAsFixed(0), Colors.white70),
              _buildTotalItem(
                  'Uds', totalUnidades.toStringAsFixed(0), Colors.white70),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(color: AppTheme.borderColor),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildTotalItem(
                  'Total',
                  PedidosFormatters.money(
                      header.total > 0 ? header.total : totalImporte),
                  AppTheme.neonGreen),
              _buildTotalItem('Margen', PedidosFormatters.money(totalMargen),
                  Colors.white70),
              _buildTotalItem(
                  '% Margen',
                  '${pctMargen.toStringAsFixed(1)}%',
                  pctMargen >= 15
                      ? AppTheme.neonGreen
                      : pctMargen >= 5
                          ? Colors.orange
                          : AppTheme.error),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTotalItem(String label, String value, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white54, fontSize: 11)),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
              color: color, fontWeight: FontWeight.bold, fontSize: 16),
        ),
      ],
    );
  }

  Widget _buildActions(OrderSummary header) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        color: AppTheme.darkSurface,
        border:
            Border(top: BorderSide(color: AppTheme.borderColor, width: 0.5)),
      ),
      child: Row(
        children: [
          // PDF export button
          IconButton(
            onPressed: _detail == null
                ? null
                : () async {
                    HapticFeedback.lightImpact();
                    await OrderPdfGenerator.generateAndShare(context, _detail!);
                  },
            icon: const Icon(Icons.picture_as_pdf),
            color: AppTheme.neonGreen,
            tooltip: 'Exportar PDF',
          ),
          // Clone button
          IconButton(
            onPressed: () {
              HapticFeedback.mediumImpact();
              Navigator.pop(context, 'clone:${widget.orderId}');
            },
            icon: const Icon(Icons.copy_all),
            color: AppTheme.neonPurple,
            tooltip: 'Clonar pedido',
          ),
          const Spacer(),
          // Cancel button
          if (header.estado == 'BORRADOR' || header.estado == 'CONFIRMADO')
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _isCancelling ? null : _cancelOrder,
                icon: _isCancelling
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: AppTheme.error))
                    : const Icon(Icons.cancel_outlined),
                label: Text(_isCancelling ? 'Anulando...' : 'Anular'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.error,
                  side: const BorderSide(color: AppTheme.error),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'BORRADOR':
        return Colors.orange;
      case 'CONFIRMADO':
        return AppTheme.neonBlue;
      case 'ENVIADO':
        return AppTheme.neonGreen;
      case 'ANULADO':
        return AppTheme.error;
      default:
        return Colors.white54;
    }
  }

  String _saleTypeLabel(String type) {
    switch (type) {
      case 'CC':
        return 'Venta';
      case 'VC':
        return 'Venta Sin Nombre';
      case 'NV':
        return 'No Venta';
      default:
        return type;
    }
  }
}
