/// Repartidor — Resumen acumulado del mes en curso
/// ================================================
/// Banda compacta visible en la cabecera de "Liquidacion Diaria" que muestra
/// al repartidor cuanto lleva cobrado / liquidado en el mes en curso. Da
/// contexto en una mirada antes de cerrar el dia.
///
/// Backend: GET /api/repartidor-finanzas/summary/:repartidorId?year=&month=
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class RepartidorMonthlySummaryBar extends StatefulWidget {
  const RepartidorMonthlySummaryBar({
    super.key,
    required this.repartidorId,
  });

  final String repartidorId;

  @override
  State<RepartidorMonthlySummaryBar> createState() =>
      _RepartidorMonthlySummaryBarState();
}

class _RepartidorMonthlySummaryBarState
    extends State<RepartidorMonthlySummaryBar> {
  bool _loading = true;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant RepartidorMonthlySummaryBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) _load();
  }

  Future<void> _load() async {
    if (widget.repartidorId.isEmpty) {
      setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    try {
      final now = DateTime.now();
      final response = await ApiClient.get(
        '/repartidor-finanzas/summary/${Uri.encodeComponent(widget.repartidorId)}',
        queryParameters: {
          'year': now.year.toString(),
          'month': now.month.toString(),
        },
      );
      if (mounted && response['success'] == true) {
        setState(() => _data = response);
      }
    } catch (_) {
      // silencioso
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
    final data = _data;
    if (data == null) return const SizedBox.shrink();

    // Estructura del response:
    // { success, repartidorId, year, month, summary: {...}, liquidaciones: [...] }
    final summary = data['summary'] as Map<String, dynamic>? ?? {};
    final totalCobrado =
        (summary['totalCobrado'] as num?)?.toDouble() ?? 0;
    final totalLiquidado =
        (summary['totalLiquidado'] as num?)?.toDouble() ?? 0;
    final saldoPendiente =
        (summary['saldoPendiente'] as num?)?.toDouble() ?? 0;
    final numLiq = (data['liquidaciones'] as List?)?.length ?? 0;

    if (totalCobrado == 0 && totalLiquidado == 0 && saldoPendiente == 0) {
      return const SizedBox.shrink();
    }

    final now = DateTime.now();
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.neonBlue.withValues(alpha: 0.12),
            AppTheme.darkSurface.withValues(alpha: 0.6),
          ],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: AppTheme.neonBlue.withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.calendar_month,
                  color: AppTheme.neonBlue, size: 14,),
              const SizedBox(width: 6),
              Text(
                'Acumulado de ${meses[now.month - 1]}',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.65),
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const Spacer(),
              if (numLiq > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 6, vertical: 2,),
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    '$numLiq cierres',
                    style: const TextStyle(
                      color: AppTheme.neonBlue,
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
                child: _kpi('Cobrado', _fmtMoney(totalCobrado),
                    AppTheme.neonGreen,),
              ),
              Container(
                width: 1, height: 28,
                color: Colors.white.withValues(alpha: 0.1),
              ),
              Expanded(
                child: _kpi('Liquidado', _fmtMoney(totalLiquidado),
                    AppTheme.neonBlue,),
              ),
              Container(
                width: 1, height: 28,
                color: Colors.white.withValues(alpha: 0.1),
              ),
              Expanded(
                child: _kpi(
                  'Pendiente',
                  _fmtMoney(saldoPendiente),
                  saldoPendiente > 0 ? Colors.amber : AppTheme.neonGreen,
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
              color: Colors.white.withValues(alpha: 0.5),
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
