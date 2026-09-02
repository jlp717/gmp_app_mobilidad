// ignore_for_file: public_member_api_docs

/// Repartidor — Resumen acumulado del mes en curso
/// ================================================
/// Banda compacta visible en la cabecera de "Liquidacion Diaria" que muestra
/// al repartidor cuanto lleva cobrado / liquidado en el mes en curso. Da
/// contexto en una mirada antes de cerrar el dia.
///
/// Backend: GET /api/repartidor-finanzas/summary/:repartidorId?year=&month=
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

typedef RepartidorMonthlySummaryLoader = Future<RepartidorMonthlySummary>
    Function(String repartidorId, int year, int month);

class RepartidorMonthlySummaryBar extends StatefulWidget {
  const RepartidorMonthlySummaryBar({
    required this.repartidorId,
    super.key,
    this.loader,
  });

  final String repartidorId;
  final RepartidorMonthlySummaryLoader? loader;

  @override
  State<RepartidorMonthlySummaryBar> createState() =>
      _RepartidorMonthlySummaryBarState();
}

class _RepartidorMonthlySummaryBarState
    extends State<RepartidorMonthlySummaryBar> {
  bool _loading = true;
  RepartidorMonthlySummary? _data;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant RepartidorMonthlySummaryBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId ||
        oldWidget.loader != widget.loader) {
      _load();
    }
  }

  Future<void> _load() async {
    if (widget.repartidorId.trim().isEmpty) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _failed = false;
      _data = null;
    });
    try {
      final now = DateTime.now();
      final loader = widget.loader;
      final data = loader == null
          ? await RepartidorFinanzasService().getMonthlySummary(
              repartidorId: widget.repartidorId,
              year: now.year,
              month: now.month,
            )
          : await loader(widget.repartidorId, now.year, now.month);
      if (mounted) setState(() => _data = data);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _fmtMoney(num? v) {
    final value = (v ?? 0).toDouble();
    return '${value.toStringAsFixed(0).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]}.',
        )}€';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: SizedBox(
          height: 16,
          child: LinearProgressIndicator(minHeight: 2),
        ),
      );
    }
    if (_failed) {
      return Padding(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            Icon(Icons.cloud_off, size: 14, color: AppTheme.warning),
            SizedBox(width: 6),
            Text(
              'Resumen mensual no disponible',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
            ),
          ],
        ),
      );
    }
    final data = _data;
    if (data == null || data.isEmpty) return const SizedBox.shrink();

    final totalCobrado = data.totalCobrado;
    final totalLiquidado = data.totalLiquidado;
    final saldoPendiente = data.saldoPendiente;
    final numLiq = data.liquidacionesCount;

    const meses = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: AppTheme.borderColor.withValues(alpha: 0.8),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.calendar_month,
                color: AppTheme.info,
                size: 14,
              ),
              const SizedBox(width: 6),
              Text(
                'Acumulado de ${meses[data.period.month - 1]}',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const Spacer(),
              if (numLiq > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.softPanel,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    '$numLiq cierres',
                    style: const TextStyle(
                      color: AppTheme.info,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _kpi(
                  'Cobrado',
                  _fmtMoney(totalCobrado),
                  AppTheme.success,
                ),
              ),
              Container(
                width: 1,
                height: 28,
                color: AppTheme.borderColor.withValues(alpha: 0.7),
              ),
              Expanded(
                child: _kpi(
                  'Liquidado',
                  _fmtMoney(totalLiquidado),
                  AppTheme.info,
                ),
              ),
              Container(
                width: 1,
                height: 28,
                color: AppTheme.borderColor.withValues(alpha: 0.7),
              ),
              Expanded(
                child: _kpi(
                  'Pendiente',
                  _fmtMoney(saldoPendiente),
                  saldoPendiente > 0 ? AppTheme.warning : AppTheme.success,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _kpi(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: AppTheme.textTertiary,
              fontSize: 10,
            ),
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
