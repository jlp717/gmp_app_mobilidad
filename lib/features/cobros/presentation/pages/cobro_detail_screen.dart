import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';
import 'package:intl/intl.dart';

/// Smallest balance treated as real payable debt.
const double cobroPayableEpsilon = 0.0001;

/// Returns true when a document may still be charged.
bool isCobroPayable(CobroPendiente cobro) {
  return cobro.estado != EstadoCobro.alDia &&
      cobro.importePendiente > cobroPayableEpsilon;
}

/// Filters documents that can appear in the actionable payment list.
List<CobroPendiente> cobrosPayableItems(Iterable<CobroPendiente> cobros) {
  return cobros.where(isCobroPayable).toList(growable: false);
}

/// Filters documents shown only as paid or non-actionable context.
List<CobroPendiente> cobrosNonPayableItems(Iterable<CobroPendiente> cobros) {
  return cobros
      .where((cobro) => !isCobroPayable(cobro))
      .toList(growable: false);
}

/// Validates a full or partial payment amount before submit.
bool isValidCobroPaymentAmount(CobroPendiente cobro, double amount) {
  return isCobroPayable(cobro) &&
      amount > cobroPayableEpsilon &&
      amount <= cobro.importePendiente;
}

/// Removes successful or no-longer-payable documents after submit.
Map<String, String> nextCobroSelectionAfterSubmit({
  required Map<String, String> currentSelection,
  required Set<String> successfulIds,
  required Iterable<CobroPendiente> latestCobros,
}) {
  final retryableIds =
      cobrosPayableItems(latestCobros).map((cobro) => cobro.id).toSet();

  return Map<String, String>.fromEntries(
    currentSelection.entries.where((entry) {
      return entry.value != 'NONE' &&
          !successfulIds.contains(entry.key) &&
          retryableIds.contains(entry.key);
    }),
  );
}

class CobroDetailScreen extends ConsumerStatefulWidget {
  const CobroDetailScreen({
    required this.codigoCliente,
    required this.nombreCliente,
    required this.employeeCode,
    super.key,
  });
  final String codigoCliente;
  final String nombreCliente;
  final String employeeCode;

  @override
  ConsumerState<CobroDetailScreen> createState() => _CobroDetailScreenState();
}

class _CobroDetailScreenState extends ConsumerState<CobroDetailScreen> {
  final _currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
  String _formaPago = 'CONTADO';
  final Map<String, String> _itemStates = {};
  final Map<String, double> _partialAmounts = {};
  final Map<String, String> _partialErrors = {};
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _provider.cargarCobrosPendientes(
        widget.codigoCliente,
        forceRefresh: true,
      );
    });
  }

  CobrosProvider get _provider =>
      ref.read(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));

  Map<String, CobroPendiente> _pendientesById(List<CobroPendiente> pendientes) {
    return {
      for (final item in pendientes) item.id: item,
    };
  }

  Map<String, CobroPendiente> _payableById(List<CobroPendiente> pendientes) {
    return _pendientesById(cobrosPayableItems(pendientes));
  }

  double _calcularTotalACobrar() {
    var total = 0.0;
    final pendientesById = _payableById(_provider.cobrosPendientes);
    _itemStates.forEach((id, state) {
      final item = pendientesById[id];
      if (item == null) return;
      if (state == 'COMPLETO') {
        total += item.importePendiente;
      } else if (state == 'PARCIAL') {
        total += _partialAmounts[id] ?? 0.0;
      }
    });
    return total;
  }

  /// Valida el importe parcial de un cobro y actualiza errores visuales.
  void _validatePartialAmount(String cobroId, String rawValue) {
    final cobro = _payableById(_provider.cobrosPendientes)[cobroId];
    if (cobro == null) {
      _partialErrors[cobroId] = 'Documento no disponible para cobrar';
      setState(() {});
      return;
    }
    final amount = double.tryParse(rawValue.replaceAll(',', '.'));
    if (amount == null || amount <= 0) {
      _partialErrors[cobroId] = 'Importe invalido';
      // No almacenar importes inválidos: el total mostrado debe reflejar
      // solo cantidades válidas.
      _partialAmounts.remove(cobroId);
    } else if (!isValidCobroPaymentAmount(cobro, amount)) {
      _partialErrors[cobroId] =
          'Maximo: ${_currencyFormat.format(cobro.importePendiente)}';
      _partialAmounts.remove(cobroId);
    } else {
      _partialErrors.remove(cobroId);
      _partialAmounts[cobroId] = amount;
    }
    setState(() {});
  }

  Future<void> _submitCobro(double totalACobrar) async {
    if (_isSubmitting) return;
    if (totalACobrar <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selecciona algun documento para cobrar')),
      );
      return;
    }

    // Check for validation errors in partial amounts
    if (_partialErrors.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Corrige los importes parciales antes de cobrar'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    // Confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        title: const Text('Confirmar cobro'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Cliente: ${widget.nombreCliente}',
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 8),
            Text(
              'Importe: ${_currencyFormat.format(totalACobrar)}',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Forma de pago: $_formaPago',
              style: const TextStyle(color: Colors.white70, fontSize: 13),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Confirmar cobro'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    var fallos = 0;
    var exitos = 0;
    var importeExitoso = 0.0;
    final successfulIds = <String>{};
    final pendientesById = _payableById(_provider.cobrosPendientes);
    final selectedEntries = _itemStates.entries
        .where((entry) => entry.value != 'NONE')
        .toList(growable: false);

    setState(() => _isSubmitting = true);

    unawaited(showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    ));

    for (final entry in selectedEntries) {
      final cobro = pendientesById[entry.key];
      if (cobro == null) {
        fallos++;
        continue;
      }

      final importe = entry.value == 'PARCIAL'
          ? (_partialAmounts[entry.key] ?? 0.0)
          : cobro.importePendiente;

      if (!isValidCobroPaymentAmount(cobro, importe)) {
        fallos++;
        continue;
      }

      final tipoVenta =
          _formaPago == 'CONTADO' ? TipoVenta.contado : TipoVenta.credito;
      final tipoModo = _formaPago == 'CONTADO'
          ? TipoModoCobro.normal
          : TipoModoCobro.especial;

      final success = await _provider.registrarCobro(
        codigoCliente: widget.codigoCliente,
        referencia: cobro.referencia,
        importe: importe,
        formaPago: _formaPago,
        tipoVenta: tipoVenta,
        tipoModo: tipoModo,
        reloadAfter: false,
      );
      if (success) {
        exitos++;
        importeExitoso += importe;
        successfulIds.add(cobro.id);
      } else {
        fallos++;
      }
    }

    if (successfulIds.isNotEmpty) {
      setState(() {
        for (final id in successfulIds) {
          _itemStates.remove(id);
          _partialAmounts.remove(id);
          _partialErrors.remove(id);
        }
      });
      await _provider.cargarCobrosPendientes(
        widget.codigoCliente,
        forceRefresh: true,
      );
      if (!mounted) return;
      final retrySelection = nextCobroSelectionAfterSubmit(
        currentSelection: _itemStates,
        successfulIds: successfulIds,
        latestCobros: _provider.cobrosPendientes,
      );
      setState(() {
        _itemStates
          ..clear()
          ..addAll(retrySelection);
        _partialAmounts.removeWhere(
          (id, _) => !retrySelection.containsKey(id),
        );
        _partialErrors.removeWhere(
          (id, _) => !retrySelection.containsKey(id),
        );
      });
    }

    if (!mounted) return;
    Navigator.of(context).pop();
    setState(() => _isSubmitting = false);

    if (fallos == 0) {
      setState(() {
        _itemStates.clear();
        _partialAmounts.clear();
        _partialErrors.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Cobro registrado correctamente: ${_currencyFormat.format(importeExitoso)}',
          ),
          backgroundColor: AppTheme.success,
        ),
      );
    } else if (exitos > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '$exitos cobro(s) registrados. '
            '$fallos pendiente(s) siguen seleccionados para reintentar.',
          ),
          backgroundColor: AppTheme.warning,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('No se registró ningún cobro. Revisa los datos.'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final cobros = ref
        .watch(cobrosProvider(CobrosParams(employeeCode: widget.employeeCode)));
    final pendientes = cobros.cobrosPendientes;
    final payableCobros = cobrosPayableItems(pendientes);
    final settledCobros = cobrosNonPayableItems(pendientes);
    final totalAbonar = _calcularTotalACobrar();

    // Calcular resumen del cliente solo con documentos cobrables.
    double totalPendiente = 0;
    double totalVencido = 0;
    int numDocs = 0;
    for (final c in payableCobros) {
      totalPendiente += c.importePendiente;
      numDocs++;
      if (c.isVencido) totalVencido += c.importePendiente;
    }

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
              'Codigo: ${widget.codigoCliente}',
              style: const TextStyle(fontSize: 12, color: Colors.white70),
            ),
          ],
        ),
        backgroundColor: AppTheme.darkSurface,
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => cobros.cargarCobrosPendientes(
              widget.codigoCliente,
              forceRefresh: true,
            ),
            tooltip: 'Actualizar',
          ),
        ],
      ),
      body: cobros.isLoading && pendientes.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () => cobros.cargarCobrosPendientes(
                widget.codigoCliente,
                forceRefresh: true,
              ),
              color: AppTheme.neonBlue,
              child: Column(
                children: [
                  if (cobros.error != null)
                    Container(
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.error.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppTheme.error),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              color: AppTheme.error),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              cobros.error!,
                              style: const TextStyle(color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                    ),
                  // Resumen del cliente
                  if (payableCobros.isNotEmpty || settledCobros.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.darkSurface.withValues(alpha: 0.5),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: totalVencido > 0
                              ? AppTheme.error.withValues(alpha: 0.3)
                              : AppTheme.neonBlue.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: _detailSummaryItem(
                              'Pendiente',
                              _currencyFormat.format(totalPendiente),
                              Icons.account_balance_wallet,
                              totalPendiente > 0
                                  ? AppTheme.warning
                                  : AppTheme.success,
                            ),
                          ),
                          Container(
                            width: 1,
                            height: 32,
                            color: Colors.white.withValues(alpha: 0.08),
                          ),
                          Expanded(
                            child: _detailSummaryItem(
                              'Vencido',
                              _currencyFormat.format(totalVencido),
                              Icons.error_outline,
                              totalVencido > 0
                                  ? AppTheme.error
                                  : AppTheme.success,
                            ),
                          ),
                          Container(
                            width: 1,
                            height: 32,
                            color: Colors.white.withValues(alpha: 0.08),
                          ),
                          Expanded(
                            child: _detailSummaryItem(
                              'Documentos',
                              '$numDocs',
                              Icons.receipt_long,
                              AppTheme.neonBlue,
                            ),
                          ),
                        ],
                      ),
                    ),
                  // Total a cobrar (solo si hay seleccion)
                  if (payableCobros.isNotEmpty && totalAbonar > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Total a cobrar:',
                            style:
                                TextStyle(color: Colors.white70, fontSize: 14),
                          ),
                          Text(
                            _currencyFormat.format(totalAbonar),
                            style: TextStyle(
                              color: AppTheme.success,
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  Expanded(
                    child: payableCobros.isEmpty && settledCobros.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.check_circle_outline,
                                  size: 64,
                                  color:
                                      AppTheme.success.withValues(alpha: 0.3),
                                ),
                                const SizedBox(height: 16),
                                const Text(
                                  'No hay cobros pendientes',
                                  style:
                                      TextStyle(color: AppTheme.textSecondary),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'El cliente esta al dia',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: AppTheme.textSecondary
                                        .withValues(alpha: 0.7),
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                              if (payableCobros.isNotEmpty) ...[
                                _buildSectionHeader(
                                  'Pendientes de cobro',
                                  'Selecciona solo documentos con saldo real',
                                  Icons.payments_outlined,
                                  AppTheme.warning,
                                ),
                                const SizedBox(height: 8),
                                ...payableCobros.map(_buildCobroCard),
                              ],
                              if (settledCobros.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                _buildSectionHeader(
                                  'Al dia / no cobrables',
                                  'No se pueden seleccionar para evitar duplicados',
                                  Icons.verified_outlined,
                                  AppTheme.success,
                                ),
                                const SizedBox(height: 8),
                                ...settledCobros.map(_buildSettledCobroTile),
                              ],
                            ],
                          ),
                  ),
                  if (payableCobros.isNotEmpty) _buildBottomBar(totalAbonar),
                ],
              ),
            ),
    );
  }

  Widget _detailSummaryItem(
    String label,
    String value,
    IconData icon,
    Color color,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 12),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.5),
                  fontSize: 9,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(
    String title,
    String subtitle,
    IconData icon,
    Color color,
  ) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: color, size: 18),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSettledCobroTile(CobroPendiente cobro) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: AppTheme.surfaceColor.withValues(alpha: 0.55),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: AppTheme.success.withValues(alpha: 0.22)),
      ),
      child: ListTile(
        leading:
            const Icon(Icons.check_circle_outline, color: AppTheme.success),
        title: Text(
          cobro.conceptoVisible,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white70,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          '${cobro.tipo.label} ${cobro.referencia.isNotEmpty ? cobro.referencia : cobro.id}',
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              _currencyFormat.format(cobro.importePendiente),
              style: const TextStyle(
                color: AppTheme.success,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 2),
            const Text(
              'No cobrable',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
            ),
          ],
        ),
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
            ? BorderSide(color: AppTheme.success.withValues(alpha: 0.4))
            : BorderSide.none,
      ),
      child: ExpansionTile(
        leading: Icon(
          state == 'COMPLETO'
              ? Icons.check_circle
              : state == 'PARCIAL'
                  ? Icons.indeterminate_check_box
                  : Icons.radio_button_unchecked,
          color: state != 'NONE' ? AppTheme.success : AppTheme.textSecondary,
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                cobro.conceptoVisible,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            // Req #15: badge tricolor según estado del vencimiento.
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: cobro.estado.color.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: cobro.estado.color.withValues(alpha: 0.45),
                ),
              ),
              child: Text(
                cobro.estado.label.toUpperCase(),
                style: TextStyle(
                  color: cobro.estado.color,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
        subtitle: Text(
          '${cobro.tipo.label} ${cobro.referencia.isNotEmpty ? cobro.referencia : cobro.id}  -  '
          'Vencimiento: ${cobro.fechaVencimiento != null ? DateFormat('dd/MM/yyyy').format(cobro.fechaVencimiento!) : 'N/A'}'
          '${cobro.isVencido ? '  ·  Mora ${cobro.diasMora}d' : ''}',
          style: TextStyle(
            color: cobro.isVencido
                ? AppTheme.error.withValues(alpha: 0.9)
                : AppTheme.textSecondary,
            fontSize: 12,
            fontWeight: cobro.isVencido ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
        trailing: Text(
          _currencyFormat.format(cobro.importePendiente),
          style: const TextStyle(
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
                    _buildStateButton(
                      'NINGUNO',
                      cobro,
                      Icons.radio_button_unchecked,
                      value: 'NONE',
                    ),
                    const SizedBox(width: 8),
                    _buildStateButton('COMPLETO', cobro, Icons.check_circle),
                    const SizedBox(width: 8),
                    _buildStateButton(
                      'PARCIAL',
                      cobro,
                      Icons.indeterminate_check_box,
                    ),
                  ],
                ),
                if (isPartial) ...[
                  const SizedBox(height: 12),
                  TextField(
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: 'Importe a cobrar',
                      hintStyle: const TextStyle(color: Colors.white54),
                      filled: true,
                      fillColor: AppTheme.darkBase,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(
                          color: AppTheme.neonBlue.withValues(alpha: 0.3),
                        ),
                      ),
                      errorText: _partialErrors[cobro.id],
                      errorMaxLines: 1,
                      suffixText:
                          'Max: ${_currencyFormat.format(cobro.importePendiente)}',
                      suffixStyle: const TextStyle(
                        color: Colors.white54,
                        fontSize: 10,
                      ),
                    ),
                    onChanged: (value) =>
                        _validatePartialAmount(cobro.id, value),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStateButton(
    String label,
    CobroPendiente cobro,
    IconData icon, {
    String? value,
  }) {
    final stateValue = value ?? label;
    final current = _itemStates[cobro.id] ?? 'NONE';
    final isSelected = current == stateValue;

    return Expanded(
      child: ElevatedButton.icon(
        onPressed: _isSubmitting
            ? null
            : () => setState(() {
                  final nextState = isSelected ? 'NONE' : stateValue;
                  _itemStates[cobro.id] = nextState;
                  // Al salir del modo PARCIAL hay que limpiar también los errores:
                  // si quedaran errores huérfanos el botón Cobrar quedaría
                  // bloqueado sin ningún campo visible que corregir.
                  if (nextState != 'PARCIAL') {
                    _partialAmounts.remove(cobro.id);
                    _partialErrors.remove(cobro.id);
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
        border: Border(
            top: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.2))),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Forma de pago',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
                DropdownButton<String>(
                  value: _formaPago,
                  dropdownColor: AppTheme.darkSurface,
                  style: const TextStyle(color: Colors.white),
                  items: ['CONTADO', 'CREDITO'].map((p) {
                    return DropdownMenuItem(value: p, child: Text(p));
                  }).toList(),
                  onChanged: _isSubmitting
                      ? null
                      : (v) {
                          if (v != null) setState(() => _formaPago = v);
                        },
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          ElevatedButton(
            onPressed:
                total > 0 && !_isSubmitting ? () => _submitCobro(total) : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    'Cobrar ${_currencyFormat.format(total)}',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
          ),
        ],
      ),
    );
  }
}
