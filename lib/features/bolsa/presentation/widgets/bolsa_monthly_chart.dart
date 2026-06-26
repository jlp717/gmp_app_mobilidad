/// Bolsa - Histórico mensual (últimos 12 meses)
/// ==============================================
/// Tarjeta con gráfico de barras agrupado: acumulado (verde) vs consumido
/// (ámbar) para cada uno de los últimos 12 meses. Permite al jefe ver la
/// evolución de la bolsa de un vendedor de un vistazo.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';

class BolsaMonthlyChart extends StatelessWidget {
  const BolsaMonthlyChart({super.key, required this.history});

  final List<BolsaMonthlyPoint> history;

  static const _months = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) return const SizedBox.shrink();
    final maxVal = history.fold<double>(0, (acc, p) {
      final localMax = p.acumulado > p.consumido ? p.acumulado : p.consumido;
      return localMax > acc ? localMax : acc;
    });
    if (maxVal <= 0) return const SizedBox.shrink();

    final totalAcum = history.fold<double>(0, (a, p) => a + p.acumulado);
    final totalCons = history.fold<double>(0, (a, p) => a + p.consumido);
    final saldoNeto = totalAcum - totalCons;
    final now = DateTime.now();
    final currentKey = '${now.year}-${now.month}';

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: AppTheme.info.withValues(alpha: 0.18),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.show_chart,
                color: AppTheme.info,
                size: 18,
              ),
              const SizedBox(width: 6),
              const Text(
                'Histórico 12 meses',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              _legendDot('Acum.', AppTheme.success),
              const SizedBox(width: 8),
              _legendDot('Cons.', AppTheme.warning),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 128,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: history.map((p) {
                  final isCurrent = '${p.ejercicio}-${p.mes}' == currentKey;
                  final acumH = (p.acumulado / maxVal) * 86;
                  final consH = (p.consumido / maxVal) * 86;
                  return SizedBox(
                    width: 72,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          if (p.acumulado > 0 || p.consumido > 0)
                            Text(
                              _kFormat(p.acumulado),
                              style: TextStyle(
                                fontSize: 8,
                                color: Colors.white.withValues(alpha: 0.45),
                              ),
                            ),
                          const SizedBox(height: 2),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              _bar(
                                height: acumH,
                                color: AppTheme.success,
                                glow: isCurrent,
                              ),
                              const SizedBox(width: 2),
                              _bar(
                                height: consH,
                                color: AppTheme.warning,
                                glow: isCurrent,
                              ),
                            ],
                          ),
                          const SizedBox(height: 5),
                          Text(
                            _months[(p.mes - 1).clamp(0, 11)],
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight:
                                  isCurrent ? FontWeight.w800 : FontWeight.w500,
                              color: isCurrent
                                  ? AppTheme.info
                                  : Colors.white.withValues(alpha: 0.55),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _stat('Acumulado total', _eur(totalAcum), AppTheme.success),
              const SizedBox(width: 8),
              _stat('Consumido total', _eur(totalCons), AppTheme.warning),
              const SizedBox(width: 8),
              _stat(
                'Saldo neto',
                _eur(saldoNeto),
                saldoNeto >= 0 ? AppTheme.info : AppTheme.error,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _bar(
      {required double height, required Color color, bool glow = false}) {
    final h = height.isFinite && height > 0 ? height : 0.0;
    return Container(
      width: 7,
      height: h,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.85),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(2)),
        boxShadow: glow
            ? [BoxShadow(color: color.withValues(alpha: 0.55), blurRadius: 6)]
            : null,
      ),
    );
  }

  Widget _legendDot(String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.65),
            fontSize: 10,
          ),
        ),
      ],
    );
  }

  Widget _stat(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.55),
                fontSize: 9,
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
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _kFormat(double v) {
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(v >= 10000 ? 0 : 1)}k';
    return v.toStringAsFixed(0);
  }

  static String _eur(double v) {
    return '${v.toStringAsFixed(0).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]}.',
        )}€';
  }
}
