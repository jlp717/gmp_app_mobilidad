/// Albaran Info Dialog
/// ===================
/// Shows linked delivery notes (albaranes) for an order
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class AlbaranInfoDialog {
  static Future<void> show(
    BuildContext context, {
    required int orderId,
  }) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => _AlbaranInfoBody(orderId: orderId),
    );
  }
}

class _AlbaranInfoBody extends StatefulWidget {
  const _AlbaranInfoBody({required this.orderId});

  final int orderId;

  @override
  State<_AlbaranInfoBody> createState() => _AlbaranInfoBodyState();
}

class _AlbaranInfoBodyState extends State<_AlbaranInfoBody> {
  List<Map<String, dynamic>> _albaranes = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAlbaranes();
  }

  Future<void> _loadAlbaranes() async {
    try {
      final albaranes = await PedidosService.getOrderAlbaran(widget.orderId);
      if (mounted) {
        setState(() {
          _albaranes = albaranes;
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.darkSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Text(
        'Albaranes vinculados',
        style: TextStyle(color: Colors.white),
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: AppTheme.neonBlue),
              )
            : _error != null
                ? Center(
                    child: Text(
                      'Error: $_error',
                      style: const TextStyle(color: AppTheme.error),
                    ),
                  )
                : _albaranes.isEmpty
                    ? const Center(
                        child: Text(
                          'No se encontraron albaranes vinculados',
                          style: TextStyle(color: Colors.white70),
                        ),
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: _albaranes.map((a) {
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppTheme.darkCard,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  "${a['serie'] ?? ''} ${a['numeroAlbaran'] ?? ''}",
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  "Fecha: ${a['fecha'] ?? ''}",
                                  style: const TextStyle(
                                    color: Colors.white70,
                                    fontSize: 12,
                                  ),
                                ),
                                Text(
                                  "Importe: ${PedidosFormatters.money((a['importe'] as num? ?? 0).toDouble())}",
                                  style: const TextStyle(
                                    color: AppTheme.neonGreen,
                                    fontSize: 12,
                                  ),
                                ),
                                Text(
                                  "Estado: ${a['situacion'] ?? ''}",
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cerrar', style: TextStyle(color: Colors.white54)),
        ),
      ],
    );
  }
}
