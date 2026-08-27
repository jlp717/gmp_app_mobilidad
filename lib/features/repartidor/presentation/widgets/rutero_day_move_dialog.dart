import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_route_feedback.dart';

class RuteroDayMoveDialog extends StatefulWidget {
  const RuteroDayMoveDialog(
      {super.key,
      required this.date,
      required this.repartidorId,
      required this.stops});
  final DateTime date;
  final String repartidorId;
  final List<AlbaranEntrega> stops;

  @override
  State<RuteroDayMoveDialog> createState() => _RuteroDayMoveDialogState();
}

class _RuteroDayMoveDialogState extends State<RuteroDayMoveDialog> {
  final _position = TextEditingController(text: '1');
  DateTime? _target;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _position.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final position = int.tryParse(_position.text.trim());
    if (_target == null || position == null || position < 1 || position > 500) {
      setState(() => _error = 'Elige otro día y una posición entre 1 y 500.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await RuteroRouteApi.moveDay(
        repartidorId: widget.repartidorId,
        dateYmd: widget.date.toIso8601String().substring(0, 10),
        targetDateYmd: _target!.toIso8601String().substring(0, 10),
        position: position - 1,
        orden: widget.stops
            .asMap()
            .entries
            .map((entry) => <String, dynamic>{
                  'documentId': entry.value.id,
                  'cliente': entry.value.codigoCliente,
                  'posicion': entry.key,
                })
            .toList(growable: false),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) setState(() => _error = ruteroRouteError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const days = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo'
    ];
    return AlertDialog(
      title: const Text('Cambiar de día'),
      content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(
            '${widget.stops.length} parada(s) de ${widget.stops.first.nombreCliente}'),
        const SizedBox(height: 12),
        const Text(
            'La parada se moverá solo dentro de esta semana, de lunes a domingo. El cambio quedará guardado para este repartidor y esta semana.'),
        const SizedBox(height: 12),
        DropdownButtonFormField<DateTime>(
          initialValue: _target,
          decoration: const InputDecoration(labelText: 'Día de destino'),
          items: ruteroNaturalWeek(widget.date)
              .where((d) => d.weekday != widget.date.weekday)
              .map((date) => DropdownMenuItem(
                    value: date,
                    child: Text(
                        '${days[date.weekday - 1]} ${date.day}/${date.month}'),
                  ))
              .toList(),
          onChanged: _busy ? null : (value) => setState(() => _target = value),
        ),
        TextField(
            controller: _position,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
                labelText: 'Posición deseada',
                helperText: '1 es la primera parada del día')),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Semantics(liveRegion: true, child: Text(_error!))),
      ])),
      actions: [
        TextButton(
            onPressed: _busy ? null : () => Navigator.pop(context),
            child: const Text('Cerrar')),
        FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Guardando…' : 'Mover parada')),
      ],
    );
  }
}
