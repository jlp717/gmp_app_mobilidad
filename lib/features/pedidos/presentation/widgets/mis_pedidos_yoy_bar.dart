/// Mis Pedidos — Comparativa YoY (Year over Year)
/// ================================================
/// Banda compacta que muestra al vendedor su acumulado del año en curso vs
/// el mismo periodo del año anterior. Inspirado en el comparador de
/// semanas del rutero. Le da contexto rápido: "voy mejor/peor que el año pasado".
///
/// Reutiliza el endpoint /api/pedidos/purchase-history-global filtrado por
/// vendedor.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class MisPedidosYoYBar extends StatefulWidget {
  const MisPedidosYoYBar({
    super.key,
    required this.vendedorCodes,
  });

  /// Vendedor(es) a comparar. Lista separada por coma o "ALL".
  final String vendedorCodes;

  @override
  State<MisPedidosYoYBar> createState() => _MisPedidosYoYBarState();
}

class _MisPedidosYoYBarState extends State<MisPedidosYoYBar> {
  bool _loading = true;
  Map<String, dynamic>? _summary;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant MisPedidosYoYBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.vendedorCodes != widget.vendedorCodes) _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final now = DateTime.now();
      final fromIso =
          DateTime(now.year, 1, 1).toIso8601String().substring(0, 10);
      final toIso = now.toIso8601String().substring(0, 10);
      final response = await ApiClient.get(
        '/pedidos/purchase-history-global',
        queryParameters: <String, String>{
          'from': fromIso,
          'to': toIso,
          'vendedorCode': widget.vendedorCodes,
          'limit': '1', // no necesitamos las líneas
        },
        cacheKey: 'pedidos:yoy:${widget.vendedorCodes}:$fromIso:$toIso:summary',
        cacheTTL: CacheService.shortTTL,
      );
      if (mounted && response['success'] == true) {
        setState(() => _summary = response['summary'] as Map<String, dynamic>?);
      }
    } catch (e) {
      // Sin datos la barra se oculta, pero el error queda registrado.
      debugPrint('[MisPedidosYoYBar] load error: $e');
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

  String _fmtPct(num? v) {
    if (v == null) return '—';
    final d = v.toDouble();
    final sign = d >= 0 ? '+' : '';
    return '$sign${d.toStringAsFixed(1)}%';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Container(
        height: 56,
        margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    final s = _summary;
    if (s == null) return const SizedBox.shrink();
    final total = (s['totalVendido'] as num?)?.toDouble() ?? 0;
    final comp = s['comparativaAnoAnterior'] as Map<String, dynamic>? ?? {};
    final totalLastYear = (comp['totalAnoAnterior'] as num?)?.toDouble() ?? 0;
    final variation = comp['variacionPct'] as num?;
    if (total == 0 && totalLastYear == 0) return const SizedBox.shrink();

    final color = variation == null
        ? Colors.white60
        : (variation >= 0 ? AppTheme.neonGreen : Colors.redAccent);
    final now = DateTime.now();
    final monthLabel = [
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
    ][now.month - 1];

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            color.withValues(alpha: 0.18),
            AppTheme.darkSurface.withValues(alpha: 0.6),
          ],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(
            variation != null && variation >= 0
                ? Icons.trending_up
                : (variation != null
                    ? Icons.trending_down
                    : Icons.compare_arrows),
            color: color,
            size: 22,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Acumulado hasta hoy ($monthLabel)',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 10,
                  ),
                ),
                const SizedBox(height: 2),
                RichText(
                  text: TextSpan(
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    children: [
                      TextSpan(
                        text: _fmtMoney(total),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                      TextSpan(
                        text: '  vs ',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.5),
                        ),
                      ),
                      TextSpan(
                        text: _fmtMoney(totalLastYear),
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.75),
                        ),
                      ),
                      TextSpan(
                        text: '   año pasado',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.45),
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.22),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              _fmtPct(variation),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w800,
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
