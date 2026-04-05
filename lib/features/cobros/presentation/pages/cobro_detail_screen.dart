import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_theme.dart';
import '../../providers/cobros_provider.dart';
import '../../data/models/cobros_models.dart';

class CobroDetailScreen extends ConsumerStatefulWidget {
  final String codigoCliente;
  final String nombreCliente;
  final String employeeCode;

  const CobroDetailScreen({
    super.key,
    required this.codigoCliente,
    required this.nombreCliente,
    required this.employeeCode,
  });

  @override
  ConsumerState<CobroDetailScreen> createState() => _CobroDetailScreenState();
}

class _CobroDetailScreenState extends ConsumerState<CobroDetailScreen> {
  final _currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
  String _formaPago = 'CONTADO';
  final Map<String, String> _itemStates = {};
  final Map<String, double> _partialAmounts = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _provider.cargarCobrosPendientes(widget.codigoCliente);
    });
  }

  CobrosProvider get _provider =>
      ref.read(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));

  double _calcularTotalACobrar() {
    double total = 0.0;
    _itemStates.forEach((id, state) {
      if (state == 'COMPLETO') {
        final item = _provider.cobrosPendientes.firstWhere((e) => e.id == id);
        total += item.importePendiente;
      } else if (state == 'PARCIAL') {
        total += (_partialAmounts[id] ?? 0.0);
      }
    });
    return total;
  }

  Future<void> _submitCobro(double totalACobrar) async {
    if (totalACobrar <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecciona algún documento para cobrar')),
      );
      return;
    }

    final int exitos = 0;
    int fallos = 0;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );

    for (var entry in _itemStates.entries) {
      if (entry.value == 'NONE') continue;
      final cobro = _provider.cobrosPendientes.firstWhere(
        (e) => e.id == entry.key,
        orElse: () => CobroPendiente(
          id: entry.key, referencia: entry.key,
          tipo: TipoCobro.normal, fecha: DateTime.now(),
          importeTotal: 0, importePendiente: 0, fechaVencimiento: null,
        ),
      );
      if (cobro.importePendiente <= 0) continue;

      final importe = entry.value == 'PARCIAL'
          ? (_partialAmounts[entry.key] ?? 0.0)
          : cobro.importePendiente;

      final tipoVenta = _formaPago == 'CONTADO' ? TipoVenta.contado : TipoVenta.credito;
      final tipoModo = _formaPago == 'CONTADO' ? TipoModoCobro.normal : TipoModoCobro.especial;

      final success = await _provider.registrarCobro(
        codigoCliente: widget.codigoCliente,
        referencia: cobro.referencia,
        importe: importe,
        formaPago: _formaPago,
        tipoVenta: tipoVenta,
        tipoModo: tipoModo,
      );
      if (!success) fallos++;
    }

    final int exitosCalc = _itemStates.values.where((s) => s != 'NONE').length - fallos;

    Navigator.of(context).pop();

    if (fallos == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Cobro registrado correctamente: ${_currencyFormat.format(totalACobrar)}'),
          backgroundColor: AppTheme.success,
        ),
      );
      _provider.cargarCobrosPendientes(widget.codigoCliente);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Terminado con $fallos errores. Revisa los datos.'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final cobros = ref.watch(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));
    final pendientes = cobros.cobrosPendientes;
    final totalAbonar = _calcularTotalACobrar();

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.nombreCliente,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            Text(
              'Código: ${widget.codigoCliente}',
              style: const TextStyle(fontSize: 12, color: Colors.white70),
            ),
          ],
        ),
        backgroundColor: AppTheme.darkSurface,
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: cobros.isLoading && pendientes.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (cobros.error != null)
                  Container(
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppTheme.error.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppTheme.error),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: AppTheme.error),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(cobros.error!,
                              style: const TextStyle(color: Colors.white)),
                        ),
                      ],
                    ),
                  ),
                if (pendientes.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Total a cobrar:',
                            style: TextStyle(color: Colors.white70, fontSize: 16)),
                        Text(
                          _currencyFormat.format(totalAbonar),
                          style: TextStyle(
                            color: totalAbonar > 0 ? AppTheme.success : AppTheme.textSecondary,
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
                Expanded(
                  child: pendientes.isEmpty
                      ? const Center(
                          child: Text('No hay cobros pendientes',
                              style: TextStyle(color: AppTheme.textSecondary)),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: pendientes.length,
                          itemBuilder: (context, index) {
                            final cobro = pendientes[index];
                            return _buildCobroCard(cobro);
                          },
                        ),
                ),
                if (pendientes.isNotEmpty)
                  _buildBottomBar(totalAbonar),
              ],
            ),
    );
  }

  Widget _buildCobroCard(CobroPendiente cobro) {
    final state = _itemStates[cobro.id] ?? 'NONE';
    final isPartial = state == 'PARCIAL';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: state != 'NONE'
            ? BorderSide(color: AppTheme.success.withOpacity(0.4))
            : BorderSide.none,
      ),
      child: ExpansionTile(
        leading: Icon(
          state == 'COMPLETO' ? Icons.check_circle : state == 'PARCIAL' ? Icons.indeterminate_check_box : Icons.radio_button_unchecked,
          color: state != 'NONE' ? AppTheme.success : AppTheme.textSecondary,
        ),
        title: Text(
          cobro.referencia ?? cobro.id,
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          'Vencimiento: ${cobro.fechaVencimiento != null ? DateFormat('dd/MM/yyyy').format(cobro.fechaVencimiento!) : 'N/A'}',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
        ),
        trailing: Text(
          _currencyFormat.format(cobro.importePendiente),
          style: TextStyle(
            color: AppTheme.neonBlue,
            fontWeight: FontWeight.bold,
            fontSize: 16,
          ),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              children: [
                Row(
                  children: [
                    _buildStateButton('NINGUNO', cobro, Icons.radio_button_unchecked),
                    const SizedBox(width: 8),
                    _buildStateButton('COMPLETO', cobro, Icons.check_circle),
                    const SizedBox(width: 8),
                    _buildStateButton('PARCIAL', cobro, Icons.indeterminate_check_box),
                  ],
                ),
                if (isPartial) ...[
                  const SizedBox(height: 12),
                  TextField(
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: 'Importe a cobrar',
                      hintStyle: const TextStyle(color: Colors.white54),
                      filled: true,
                      fillColor: AppTheme.darkBase,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(color: AppTheme.neonBlue.withOpacity(0.3)),
                      ),
                    ),
                    onChanged: (value) {
                      final amount = double.tryParse(value.replaceAll(',', '.'));
                      if (amount != null) {
                        _partialAmounts[cobro.id] = amount;
                        setState(() {});
                      }
                    },
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStateButton(String label, CobroPendiente cobro, IconData icon) {
    final current = _itemStates[cobro.id] ?? 'NONE';
    final isSelected = current == label;

    return Expanded(
      child: ElevatedButton.icon(
        onPressed: () => setState(() {
          _itemStates[cobro.id] = isSelected ? 'NONE' : label;
          if (!isSelected && label != 'PARCIAL') {
            _partialAmounts.remove(cobro.id);
          }
        }),
        icon: Icon(icon, size: 18),
        label: Text(label, style: const TextStyle(fontSize: 11)),
        style: ElevatedButton.styleFrom(
          backgroundColor: isSelected ? AppTheme.success : AppTheme.darkBase,
          foregroundColor: isSelected ? Colors.white : Colors.white70,
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        ),
      ),
    );
  }

  Widget _buildBottomBar(double total) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        border: Border(top: BorderSide(color: AppTheme.neonBlue.withOpacity(0.2))),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Forma de pago',
                    style: TextStyle(color: Colors.white70, fontSize: 12)),
                DropdownButton<String>(
                  value: _formaPago,
                  dropdownColor: AppTheme.darkSurface,
                  style: const TextStyle(color: Colors.white),
                  items: ['CONTADO', 'CREDITO'].map((p) {
                    return DropdownMenuItem(value: p, child: Text(p));
                  }).toList(),
                  onChanged: (v) { if (v != null) setState(() => _formaPago = v); },
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          ElevatedButton(
            onPressed: total > 0 ? () => _submitCobro(total) : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text(
              'Cobrar ${_currencyFormat.format(total)}',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
          ),
        ],
      ),
    );
  }
}
