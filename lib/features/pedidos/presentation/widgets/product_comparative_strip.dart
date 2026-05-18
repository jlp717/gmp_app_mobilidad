/// Product Comparative Strip
/// =========================
/// Widget compacto que muestra para un producto+cliente la comparativa de
/// envases comprados este año vs año anterior, con variación %.
///
/// Pensado para integrar dentro del [AddToOrderSheet] cuando el vendedor
/// toca un producto. Le da contexto inmediato:
///   "Este año: 145 cj · Año pasado: 132 cj · +9.8% YoY"
///
/// Backend: GET /api/pedidos/product-comparative/:productCode
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class ProductComparativeStrip extends StatefulWidget {
  const ProductComparativeStrip({
    super.key,
    required this.productCode,
    this.clientCode,
    this.vendedorCode,
  });

  final String productCode;
  final String? clientCode;
  final String? vendedorCode;

  @override
  State<ProductComparativeStrip> createState() =>
      _ProductComparativeStripState();
}

class _ProductComparativeStripState extends State<ProductComparativeStrip> {
  bool _loading = true;
  bool _expanded = false;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final response = await ApiClient.get(
        '/pedidos/product-comparative/${Uri.encodeComponent(widget.productCode)}',
        queryParameters: <String, String>{
          if (widget.clientCode != null && widget.clientCode!.isNotEmpty)
            'clientCode': widget.clientCode!,
          if (widget.vendedorCode != null && widget.vendedorCode!.isNotEmpty)
            'vendedorCode': widget.vendedorCode!,
        },
      );
      if (mounted && response['success'] == true) {
        setState(() => _data = response);
      }
    } catch (_) {
      // Silencioso: si falla el strip simplemente no se muestra el detalle
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _fmtInt(num? v) =>
      (v ?? 0).toDouble().round().toString();

  String _fmtPct(num? v) {
    if (v == null) return '—';
    final d = v.toDouble();
    final sign = d >= 0 ? '+' : '';
    return '$sign${d.toStringAsFixed(1)}%';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: SizedBox(
          height: 22,
          child: Center(
            child: SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 1.5),
            ),
          ),
        ),
      );
    }
    final data = _data;
    if (data == null) return const SizedBox.shrink();
    final cur = data['currentYear'] as Map<String, dynamic>? ?? const {};
    final prev = data['previousYear'] as Map<String, dynamic>? ?? const {};
    final variation = data['variation'] as Map<String, dynamic>? ?? const {};

    final totalCur = (cur['total'] as num?)?.toDouble() ?? 0;
    final totalPrev = (prev['total'] as num?)?.toDouble() ?? 0;
    final ytdCur = (variation['ytdCur'] as num?)?.toDouble() ?? 0;
    final ytdPrev = (variation['ytdPrev'] as num?)?.toDouble() ?? 0;
    final variacionAnual = variation['envasesPct'] as num?;
    final variacionYtd = variation['ytdEnvasesPct'] as num?;

    // Si no hay datos en ningún año, ocultar completamente.
    if (totalCur == 0 && totalPrev == 0) return const SizedBox.shrink();

    final color = variacionYtd == null
        ? Colors.white60
        : (variacionYtd >= 0 ? AppTheme.neonGreen : Colors.redAccent);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => setState(() => _expanded = !_expanded),
        borderRadius: BorderRadius.circular(8),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          padding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: color.withValues(alpha: 0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    variacionYtd != null && variacionYtd >= 0
                        ? Icons.trending_up
                        : (variacionYtd != null
                            ? Icons.trending_down
                            : Icons.compare_arrows),
                    color: color,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: RichText(
                      text: TextSpan(
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                        ),
                        children: [
                          TextSpan(
                            text: '${_fmtInt(ytdCur)} cj',
                            style: const TextStyle(
                                fontWeight: FontWeight.w700),
                          ),
                          TextSpan(
                            text: '  vs ',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.5),
                            ),
                          ),
                          TextSpan(
                            text: '${_fmtInt(ytdPrev)} cj',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.7),
                            ),
                          ),
                          TextSpan(
                            text: '  (mismo periodo año anterior)',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.4),
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      _fmtPct(variacionYtd),
                      style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 18,
                    color: Colors.white.withValues(alpha: 0.4),
                  ),
                ],
              ),
              if (_expanded) ...[
                const SizedBox(height: 10),
                _buildMonthlyMiniBars(cur, prev, color),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _kpiSmall(
                      'Año en curso',
                      '${_fmtInt(totalCur)} cj',
                      color,
                    ),
                    const SizedBox(width: 12),
                    _kpiSmall(
                      'Año anterior',
                      '${_fmtInt(totalPrev)} cj',
                      Colors.white60,
                    ),
                    const SizedBox(width: 12),
                    _kpiSmall(
                      'Var. total',
                      _fmtPct(variacionAnual),
                      color,
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _kpiSmall(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(6),
        ),
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
            Text(
              value,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Mini barras mensuales: 12 columnas, cada una con 2 mini-barras
  /// (anterior gris, actual color).
  Widget _buildMonthlyMiniBars(
    Map<String, dynamic> cur,
    Map<String, dynamic> prev,
    Color color,
  ) {
    final monthsCur = (cur['monthly'] as List? ?? const [])
        .map((e) =>
            (e as Map<String, dynamic>?)?['envases'] as num? ?? 0)
        .map((e) => e.toDouble())
        .toList();
    final monthsPrev = (prev['monthly'] as List? ?? const [])
        .map((e) =>
            (e as Map<String, dynamic>?)?['envases'] as num? ?? 0)
        .map((e) => e.toDouble())
        .toList();
    if (monthsCur.length != 12 || monthsPrev.length != 12) {
      return const SizedBox.shrink();
    }
    final max = [
      ...monthsCur,
      ...monthsPrev,
    ].fold<double>(0, (m, x) => x > m ? x : m);
    if (max == 0) return const SizedBox.shrink();

    const labels = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    final now = DateTime.now();

    return SizedBox(
      height: 56,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(12, (i) {
          final curH = (monthsCur[i] / max) * 40.0;
          final prevH = (monthsPrev[i] / max) * 40.0;
          final isCurrentMonth = i + 1 == now.month;
          return Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 1.5),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  SizedBox(
                    height: 42,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 5,
                          height: prevH < 2 ? 2 : prevH,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.25),
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                        const SizedBox(width: 2),
                        Container(
                          width: 5,
                          height: curH < 2 ? 2 : curH,
                          decoration: BoxDecoration(
                            color: color,
                            borderRadius: BorderRadius.circular(2),
                            boxShadow: isCurrentMonth
                                ? [
                                    BoxShadow(
                                      color: color.withValues(alpha: 0.6),
                                      blurRadius: 4,
                                    ),
                                  ]
                                : null,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    labels[i],
                    style: TextStyle(
                      color: isCurrentMonth
                          ? color
                          : Colors.white.withValues(alpha: 0.45),
                      fontSize: 9,
                      fontWeight: isCurrentMonth
                          ? FontWeight.w700
                          : FontWeight.normal,
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }
}
