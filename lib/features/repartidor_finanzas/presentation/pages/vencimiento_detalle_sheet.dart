import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';

class VencimientoDetalleSheet extends StatefulWidget {
  const VencimientoDetalleSheet({
    super.key,
    required this.item,
    this.loadDetalle,
    this.onCobrar,
  });

  final VencimientoItem item;
  final Future<JsonMap?> Function()? loadDetalle;
  final VoidCallback? onCobrar;

  @override
  State<VencimientoDetalleSheet> createState() =>
      _VencimientoDetalleSheetState();
}

class _VencimientoDetalleSheetState extends State<VencimientoDetalleSheet> {
  JsonMap? _detalle;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final loader = widget.loadDetalle;
    if (loader == null) return;
    _loading = true;
    loader().then((value) {
      if (!mounted) return;
      setState(() {
        _detalle = value;
        _loading = false;
      });
    }).catchError((Object error) {
      if (!mounted) return;
      setState(() {
        _error = financeErrorMessage(error, 'No se pudo cargar el detalle');
        _loading = false;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final collectionLabel = collectionStatusLabel(item);
    final height = MediaQuery.sizeOf(context).height * 0.88;
    return RepartidorExecutiveSheet(
      height: height,
      accentColor: vencimientoStatusColor(item.estado),
      child: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                children: [
                  Text(
                    item.nombreCliente.isNotEmpty
                        ? item.nombreCliente
                        : item.cliente,
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w900,
                      fontSize: 20,
                      height: 1.25,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      VencimientoTypePill(tipoDocumento: item.tipoDocumento),
                      VencimientoStatusPill(
                        label: collectionLabel,
                        color: collectionLabel == 'COBRADO'
                            ? AppTheme.success
                            : collectionLabel == 'VENCIDO'
                                ? AppTheme.error
                                : AppTheme.warning,
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _row('Documento', item.documento),
                  _row('Cliente', item.codigoCliente),
                  _row('Vencimiento', formatVencimientoDueDate(item.fecha)),
                  _row('Importe', formatVencimientoMoney(item.importe)),
                  _row(
                    'Pendiente',
                    formatVencimientoMoney(item.importePendiente),
                  ),
                  if ((item.notas ?? '').isNotEmpty) _row('Notas', item.notas!),
                  if (_loading) ...[
                    const SizedBox(height: 16),
                    const Center(child: CircularProgressIndicator()),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: const TextStyle(
                        color: AppTheme.warning,
                        fontSize: 14,
                      ),
                    ),
                  ],
                  if (_detalle != null) ..._detalleBlocks(_detalle!),
                ],
              ),
            ),
            if (widget.onCobrar != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                child: SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton.icon(
                    onPressed: widget.onCobrar,
                    icon: const Icon(Icons.payments, size: 22),
                    label: const Text(
                      'Cobrar este documento',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _detalleBlocks(JsonMap detalle) {
    final orden = detalle['ordenPreparacion'];
    final ejercicioOrden = detalle['ejercicioOrden'];
    final formaPago = (detalle['formaPago'] ?? '').toString().trim();
    final importes = detalle['importes'] is Map
        ? JsonMap.from(detalle['importes'] as Map)
        : const <String, dynamic>{};
    final cliente = detalle['cliente'] is Map
        ? JsonMap.from(detalle['cliente'] as Map)
        : const <String, dynamic>{};
    final lineas = detalle['lineas'] is List
        ? List<dynamic>.from(detalle['lineas'] as List)
        : const <dynamic>[];
    final widgets = <Widget>[
      const SizedBox(height: 16),
      Text(
        'Datos del pedido',
        style: TextStyle(
          color: AppTheme.textPrimary,
          fontWeight: FontWeight.w900,
          fontSize: 16,
        ),
      ),
      const SizedBox(height: 8),
      if (orden != null && orden.toString() != '0')
        _row(
          'Orden de preparación',
          ejercicioOrden != null && ejercicioOrden.toString() != '0'
              ? '$ejercicioOrden-$orden'
              : '$orden',
        ),
      if ((cliente['poblacion'] ?? '').toString().trim().isNotEmpty)
        _row('Población', cliente['poblacion'].toString()),
      if (formaPago.isNotEmpty) _row('Forma de pago', formaPago),
      if (importes['total'] != null)
        _row('Total documento', formatVencimientoMoney(_asDouble(importes['total']))),
      if (importes['cancelado'] != null)
        _row('Ya cancelado', formatVencimientoMoney(_asDouble(importes['cancelado']))),
      if (detalle['anulado'] == true) _row('Estado ERP', 'Anulado'),
    ];
    if (lineas.isNotEmpty) {
      widgets.addAll([
        const SizedBox(height: 16),
        Text(
          'Líneas entregadas',
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.w900,
            fontSize: 16,
          ),
        ),
        const SizedBox(height: 8),
        for (final raw in lineas)
          if (raw is Map)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: RepartidorExecutivePanel(
                accentColor: AppTheme.info,
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (raw['descripcion'] ?? raw['codigo'] ?? 'Artículo')
                          .toString(),
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Ud: ${_asDouble(raw['unidades']).toStringAsFixed(2)} · '
                      '${formatVencimientoMoney(_asDouble(raw['importe']))}',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ),
      ]);
    }
    return widgets;
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: AppTheme.textTertiary,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 16,
              fontWeight: FontWeight.w700,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }

  double _asDouble(Object? value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }
}
