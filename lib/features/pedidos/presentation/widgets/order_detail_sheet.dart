/// Order Detail Sheet
/// ==================
/// Bottom sheet showing full order details: header info, lines, totals, and actions
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/fullscreen_image_viewer.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_pdf_generator.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class OrderDetailSheet {
  /// Show order detail as a draggable bottom sheet
  static Future<String?> show(
    BuildContext context, {
    required int orderId,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.raisedSurface,
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

class _OrderDetailBody extends ConsumerStatefulWidget {
  const _OrderDetailBody({
    required this.orderId,
    required this.scrollController,
  });
  final int orderId;
  final ScrollController scrollController;

  @override
  ConsumerState<_OrderDetailBody> createState() => _OrderDetailBodyState();
}

class _OrderDetailBodyState extends ConsumerState<_OrderDetailBody> {
  OrderDetail? _detail;
  bool _isLoading = true;
  String? _error;
  bool _isDeleting = false;
  bool _isConfirming = false;

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
      final detail = await PedidosService.getOrderDetail(
        widget.orderId,
        forceRefresh: true,
      );
      if (mounted) {
        setState(() {
          _detail = detail;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  bool _lineUsesBoxes(OrderLine line) {
    final unit = line.unidadMedida.trim().toUpperCase();
    return unit.isEmpty || unit == 'CAJAS';
  }

  List<Widget> _buildQuantityChips(OrderLine line) {
    final unit = line.unidadMedida.trim().toUpperCase();
    final unitLabel = Product.unitLabel(unit);
    if (unit == 'KILOGRAMOS' || unit == 'LITROS') {
      return [
        _buildChip(
          '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} $unitLabel',
          Icons.scale_outlined,
        ),
      ];
    }
    if (_lineUsesBoxes(line)) {
      final chips = <Widget>[
        _buildChip(
          '${PedidosFormatters.number(line.cantidadEnvases)} ${Product.unitLabel('CAJAS')}',
          Icons.all_inbox_outlined,
        ),
      ];
      final expectedUnits = line.cantidadEnvases * line.unidadesCaja;
      final hasLooseUnits = line.cantidadUnidades > 0 &&
          (line.cantidadUnidades - expectedUnits).abs() > 0.0001;
      if (hasLooseUnits) {
        chips.add(
          _buildChip(
            '${PedidosFormatters.number(line.cantidadUnidades)} ${Product.unitLabel('UNIDADES')}',
            Icons.widgets_outlined,
          ),
        );
      }
      return chips;
    }
    return [
      _buildChip(
        '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} $unitLabel',
        Icons.widgets_outlined,
      ),
    ];
  }

  String _imageUrl(String code) {
    final trimmed = code.trim();
    if (trimmed.isEmpty) return '';
    return '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(trimmed)}/image';
  }

  Future<void> _deleteDraftOrder() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.delete_outline, color: AppTheme.error, size: 22),
            SizedBox(width: 8),
            Text('Eliminar borrador', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: const Text(
          'Esta accion no se puede deshacer. Deseas eliminar este borrador?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('No', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text(
              'Si, eliminar',
              style: TextStyle(color: AppTheme.error),
            ),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isDeleting = true);
    try {
      await ref.read(pedidosProvider.notifier).deleteDraftOrder(widget.orderId);
      if (mounted) Navigator.pop(context, 'deleted');
    } catch (e) {
      if (mounted) {
        setState(() => _isDeleting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  Future<void> _confirmOrder() async {
    final header = _detail?.header;
    if (header == null) return;

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.check_circle_outline, color: AppTheme.success, size: 22),
            SizedBox(width: 8),
            Text('Confirmar pedido', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          '¿Deseas confirmar el pedido #${header.numeroPedido} para el cliente ${header.clienteName}?',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.success.withValues(alpha: 0.2),
              foregroundColor: AppTheme.success,
            ),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isConfirming = true);
    try {
      await ref
          .read(pedidosProvider.notifier)
          .confirmExistingOrder(widget.orderId, header.tipoVenta);
      if (mounted) Navigator.pop(context, 'confirmed');
    } catch (e) {
      if (mounted) {
        setState(() => _isConfirming = false);
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
        child: CircularProgressIndicator(color: AppTheme.info),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
            const SizedBox(height: 12),
            Text(
              'Error al cargar pedido',
              style: TextStyle(
                color: Colors.white,
                fontSize: Responsive.fontSize(context, small: 14, large: 16),
              ),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _loadDetail,
              icon: const Icon(Icons.refresh, color: AppTheme.info),
              label: const Text(
                'Reintentar',
                style: TextStyle(color: AppTheme.info),
              ),
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
              color: Colors.white24,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        // Header
        _buildHeader(header, statusColor),
        Divider(color: AppTheme.borderColor, height: 1),
        // Lines
        Expanded(
          child: detail.lines.isEmpty
              ? const Center(
                  child: Text(
                    'Sin lineas',
                    style: TextStyle(color: Colors.white38),
                  ),
                )
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
                  color: statusColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: statusColor.withValues(alpha: 0.5)),
                ),
                child: Text(
                  header.estado,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _buildInfoRow(
            Icons.storefront_outlined,
            '${header.clienteName} (${header.clienteCode})',
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: _buildInfoRow(
                  Icons.calendar_today_outlined,
                  header.fecha,
                ),
              ),
              _buildInfoRow(
                Icons.sell_outlined,
                _saleTypeLabel(header.tipoVenta),
              ),
            ],
          ),
          if (header.vendedorCode.isNotEmpty) ...[
            const SizedBox(height: 4),
            _buildInfoRow(
              Icons.badge_outlined,
              'Vendedor: ${header.vendedorCode}',
            ),
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
              fontSize: Responsive.fontSize(context, small: 12, large: 14),
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildLineTile(OrderLine line, int number) {
    final showMargin = ref.watch(
      pedidosProvider.select((p) => p.isMarginVisible),
    );
    final marginColor = line.porcentajeMargen >= 15
        ? AppTheme.success
        : line.porcentajeMargen >= 5
            ? AppTheme.warning
            : AppTheme.error;

    final imageUrl = _imageUrl(line.codigoArticulo);
    return Card(
      color: AppTheme.softPanel,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: AppTheme.borderColor, width: 0.5),
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
                    color: AppTheme.info.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Center(
                    child: Text(
                      '$number',
                      style: const TextStyle(
                        color: AppTheme.info,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: () => FullscreenImageViewer.show(
                    context,
                    imageUrl: imageUrl,
                    productName: line.descripcion,
                    productCode: line.codigoArticulo,
                    headers: ApiClient.authHeaders,
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      width: 38,
                      height: 38,
                      color: AppTheme.raisedSurface,
                      child: SmartProductImage(
                        imageUrl: imageUrl,
                        productCode: line.codigoArticulo,
                        productName: line.descripcion,
                        headers: ApiClient.authHeaders,
                        fit: BoxFit.contain,
                        borderRadius: BorderRadius.circular(6),
                      ),
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
                fontSize: Responsive.fontSize(context, small: 11, large: 12),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      ..._buildQuantityChips(line),
                      _buildChip(
                        Product.unitLabel(line.unidadMedida),
                        Icons.straighten,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      PedidosFormatters.money(line.importeVenta),
                      style: TextStyle(
                        color: AppTheme.success,
                        fontWeight: FontWeight.bold,
                        fontSize:
                            Responsive.fontSize(context, small: 14, large: 16),
                      ),
                    ),
                    // Req #2: margen solo visible para JEFE_VENTAS/ADMIN.
                    if (showMargin)
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
                if (showMargin && line.precioMinimo > 0) ...[
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
            if (showMargin && line.bolsaImpact.hasImpact) ...[
              const SizedBox(height: 8),
              _buildLineBolsaImpact(line),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildLineBolsaImpact(OrderLine line) {
    final impact = line.bolsaImpact;
    final isPureConsumption = impact.consumo > 0 && impact.acumulacion == 0;
    final isPureGeneration = impact.acumulacion > 0 && impact.consumo == 0;
    final color = isPureConsumption
        ? AppTheme.error
        : isPureGeneration
            ? AppTheme.success
            : impact.neto < 0
                ? AppTheme.error
                : AppTheme.warning;
    final label = impact.consumo > 0 && impact.acumulacion == 0
        ? 'Bolsa usada'
        : impact.acumulacion > 0 && impact.consumo == 0
            ? 'Bolsa generada'
            : 'Bolsa';
    final value = impact.consumo > 0 && impact.acumulacion == 0
        ? '-${PedidosFormatters.money(impact.consumo)}'
        : impact.acumulacion > 0 && impact.consumo == 0
            ? '+${PedidosFormatters.money(impact.acumulacion)}'
            : '${impact.neto >= 0 ? '+' : ''}${PedidosFormatters.money(impact.neto)}';
    final icon = isPureConsumption
        ? Icons.trending_down
        : isPureGeneration
            ? Icons.trending_up
            : Icons.compare_arrows;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 15),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChip(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white54, size: 12),
          const SizedBox(width: 3),
          Text(
            label,
            style: const TextStyle(color: Colors.white54, fontSize: 11),
          ),
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
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.info.withValues(alpha: 0.3)),
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
                'Lineas',
                '${detail.lines.length}',
                AppTheme.info,
              ),
              _buildTotalItem(
                'Cajas',
                totalEnvases.toStringAsFixed(0),
                Colors.white70,
              ),
              _buildTotalItem(
                'Uds',
                totalUnidades.toStringAsFixed(0),
                Colors.white70,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Divider(color: AppTheme.borderColor),
          const SizedBox(height: 10),
          // Req #2: Margen/% margen solo visibles para JEFE_VENTAS/ADMIN.
          Consumer(
            builder: (ctx, ref, _) {
              final showMargin = ref.watch(
      pedidosProvider.select((p) => p.isMarginVisible),
    );
              return Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildTotalItem(
                    'Total',
                    PedidosFormatters.money(
                      header.total > 0 ? header.total : totalImporte,
                    ),
                    AppTheme.success,
                  ),
                  if (showMargin) ...[
                    _buildTotalItem(
                      'Margen',
                      PedidosFormatters.money(totalMargen),
                      Colors.white70,
                    ),
                    _buildTotalItem(
                      '% Margen',
                      '${pctMargen.toStringAsFixed(1)}%',
                      pctMargen >= 15
                          ? AppTheme.success
                          : pctMargen >= 5
                              ? AppTheme.warning
                              : AppTheme.error,
                    ),
                  ],
                ],
              );
            },
          ),
          if (detail.bolsaSummary.hasImpact) ...[
            const SizedBox(height: 10),
            Divider(color: AppTheme.borderColor),
            const SizedBox(height: 10),
            _buildOrderBolsaSummary(detail.bolsaSummary),
          ],
        ],
      ),
    );
  }

  Widget _buildOrderBolsaSummary(OrderBolsaImpact impact) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: [
        if (impact.acumulacion > 0)
          _buildTotalItem(
            'Bolsa +',
            PedidosFormatters.money(impact.acumulacion),
            AppTheme.success,
          ),
        if (impact.consumo > 0)
          _buildTotalItem(
            'Bolsa -',
            PedidosFormatters.money(impact.consumo),
            AppTheme.error,
          ),
        _buildTotalItem(
          'Bolsa neta',
          '${impact.neto >= 0 ? '+' : ''}${PedidosFormatters.money(impact.neto)}',
          impact.neto >= 0 ? AppTheme.success : AppTheme.error,
        ),
      ],
    );
  }

  Widget _buildTotalItem(String label, String value, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: const TextStyle(color: Colors.white54, fontSize: 11),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.bold,
            fontSize: 16,
          ),
        ),
      ],
    );
  }

  Widget _buildActions(OrderSummary header) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
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
                    final canSeeMargin = ref.watch(
                      pedidosProvider.select((p) => p.isMarginVisible),
                    );
                    await OrderPdfGenerator.generateAndShare(
                      context,
                      _detail!,
                      isMarginVisible: canSeeMargin,
                    );
                  },
            icon: const Icon(Icons.picture_as_pdf),
            color: AppTheme.success,
            tooltip: 'Exportar PDF',
          ),
          // Clone button
          IconButton(
            onPressed: () {
              HapticFeedback.mediumImpact();
              Navigator.pop(context, 'clone:${widget.orderId}');
            },
            icon: const Icon(Icons.copy_all),
            color: AppTheme.accentIndigo,
            tooltip: 'Clonar pedido',
          ),
          const Spacer(),
          // Confirm button
          if (header.estado == 'BORRADOR') ...[
            Expanded(
              child: ElevatedButton.icon(
                onPressed: _isConfirming ? null : _confirmOrder,
                icon: _isConfirming
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check_circle_outline),
                label: Text(_isConfirming ? 'Confirmando...' : 'Confirmar'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.success,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  elevation: 0,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          if (header.estado == 'BORRADOR')
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _isDeleting ? null : _deleteDraftOrder,
                icon: _isDeleting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.error,
                        ),
                      )
                    : const Icon(Icons.delete_outline),
                label: Text(_isDeleting ? 'Eliminando...' : 'Eliminar'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.error,
                  side: const BorderSide(color: AppTheme.error),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
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
      case 'CONFIRMADO':
        return AppTheme.success;
      case 'BORRADOR':
      default:
        return AppTheme.warning;
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
