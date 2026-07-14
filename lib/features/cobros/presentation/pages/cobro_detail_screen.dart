import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';
import 'package:intl/intl.dart';

/// Smallest balance treated as real payable debt.
const double cobroPayableEpsilon = 0.0001;

/// Maximum simultaneous payment registration calls from one submit.
const int maxConcurrentCobroRegistrations = 3;

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

/// Runs submit tasks with a small concurrency cap and keeps result order.
Future<List<T>> runBoundedCobroTasks<T>({
  required List<Future<T> Function()> tasks,
  int concurrency = maxConcurrentCobroRegistrations,
}) async {
  if (tasks.isEmpty) return <T>[];
  final width = concurrency < 1
      ? 1
      : concurrency > tasks.length
          ? tasks.length
          : concurrency;
  final results = <int, T>{};
  var nextIndex = 0;

  Future<void> worker() async {
    while (true) {
      final index = nextIndex++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  await Future.wait(List.generate(width, (_) => worker()));
  return [for (var i = 0; i < tasks.length; i++) results[i] as T];
}

class _CobroRegistrationResult {
  const _CobroRegistrationResult({
    required this.cobroId,
    required this.importe,
    required this.success,
  });

  final String cobroId;
  final double importe;
  final bool success;
}

class CobroDetailScreen extends ConsumerStatefulWidget {
  const CobroDetailScreen({
    required this.codigoCliente,
    required this.nombreCliente,
    required this.employeeCode,
    super.key,
    this.vendedorCodes,
  });
  final String codigoCliente;
  final String nombreCliente;
  final String employeeCode;
  final String? vendedorCodes;

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
  String? _tipoDocumento;
  DateTime? _fechaDesde;
  DateTime? _fechaHasta;

  static const _tipoDocumentoOptions = <String?, String>{
    null: 'Todos',
    'COB': 'Factura directa',
    'CAC': 'Albarán',
  };

  String? _formatDate(DateTime? value) {
    if (value == null) return null;
    final y = value.year.toString().padLeft(4, '0');
    final m = value.month.toString().padLeft(2, '0');
    final d = value.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _reloadPendientes({bool forceRefresh = true}) async {
    await _provider.cargarCobrosPendientes(
      widget.codigoCliente,
      tipoDocumento: _tipoDocumento,
      fechaDesde: _formatDate(_fechaDesde),
      fechaHasta: _formatDate(_fechaHasta),
      vendedorCodes: widget.vendedorCodes,
      forceRefresh: forceRefresh,
    );
  }

  Future<void> _pickDate({
    required bool isDesde,
  }) async {
    final initial = isDesde
        ? (_fechaDesde ?? DateTime.now())
        : (_fechaHasta ?? DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.dark(
            primary: AppTheme.info,
            surface: AppTheme.raisedSurface,
          ),
        ),
        child: child ?? const SizedBox.shrink(),
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isDesde) {
        _fechaDesde = picked;
      } else {
        _fechaHasta = picked;
      }
    });
    await _reloadPendientes();
  }

  Widget _buildCobrosFilters() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          DropdownButton<String?>(
            value: _tipoDocumento,
            dropdownColor: AppTheme.raisedSurface,
            style: const TextStyle(color: Colors.white, fontSize: 13),
            hint: const Text('Tipo documento',
                style: TextStyle(color: Colors.white54)),
            items: _tipoDocumentoOptions.entries
                .map(
                  (e) => DropdownMenuItem<String?>(
                    value: e.key,
                    child: Text(e.value),
                  ),
                )
                .toList(),
            onChanged: (value) async {
              setState(() => _tipoDocumento = value);
              await _reloadPendientes();
            },
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(isDesde: true),
            icon: const Icon(Icons.calendar_today, size: 16),
            label: Text(
              _fechaDesde == null
                  ? 'Vence desde'
                  : DateFormat('dd/MM/yy').format(_fechaDesde!),
            ),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickDate(isDesde: false),
            icon: const Icon(Icons.event, size: 16),
            label: Text(
              _fechaHasta == null
                  ? 'Vence hasta'
                  : DateFormat('dd/MM/yy').format(_fechaHasta!),
            ),
          ),
          if (_tipoDocumento != null ||
              _fechaDesde != null ||
              _fechaHasta != null)
            TextButton(
              onPressed: () async {
                setState(() {
                  _tipoDocumento = null;
                  _fechaDesde = null;
                  _fechaHasta = null;
                });
                await _reloadPendientes();
              },
              child: const Text('Limpiar'),
            ),
        ],
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await Future.wait([
        _reloadPendientes(forceRefresh: true),
        _provider.cargarHistoricoCobros(
          widget.codigoCliente,
          vendedorCodes: widget.vendedorCodes,
          forceRefresh: true,
        ),
      ]);
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
    return _pendientesById(
      cobrosPayableItems(
        pendientes.where((c) => !c.cobradoPorRepartidor),
      ),
    );
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
        backgroundColor: AppTheme.raisedSurface,
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

    final tipoVenta =
        _formaPago == 'CONTADO' ? TipoVenta.contado : TipoVenta.credito;
    final tipoModo =
        _formaPago == 'CONTADO' ? TipoModoCobro.normal : TipoModoCobro.especial;
    final registrationTasks = <Future<_CobroRegistrationResult> Function()>[];

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

      registrationTasks.add(() async {
        var success = false;
        try {
          success = await _provider.registrarCobro(
            codigoCliente: widget.codigoCliente,
            referencia: cobro.paymentReference,
            importe: importe,
            formaPago: _formaPago,
            tipoVenta: tipoVenta,
            tipoModo: tipoModo,
            vendedorCodes: widget.vendedorCodes,
            reloadAfter: false,
          );
        } catch (_) {
          success = false;
        }
        return _CobroRegistrationResult(
          cobroId: cobro.id,
          importe: importe,
          success: success,
        );
      });
    }

    final registrationResults =
        await runBoundedCobroTasks<_CobroRegistrationResult>(
      tasks: registrationTasks,
    );
    for (final result in registrationResults) {
      if (result.success) {
        exitos++;
        importeExitoso += result.importe;
        successfulIds.add(result.cobroId);
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
      await Future.wait([
        _reloadPendientes(forceRefresh: true),
        _provider.cargarHistoricoCobros(
          widget.codigoCliente,
          vendedorCodes: widget.vendedorCodes,
          forceRefresh: true,
        ),
        _provider.refreshLoadedPendingSummary(forceRefresh: true),
      ]);
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
    final payableCobros = cobrosPayableItems(
      pendientes.where((c) => !c.cobradoPorRepartidor),
    );
    final settledCobros = cobrosNonPayableItems(pendientes);
    final historico = cobros.historicoCobros;
    final totalAbonar = _calcularTotalACobrar();
    final summaryPending = cobros.pendingForClient(widget.codigoCliente);

    // Calcular resumen del cliente solo con documentos cobrables.
    double totalPendiente = 0;
    double totalVencido = 0;
    int numDocs = 0;
    for (final c in payableCobros) {
      totalPendiente += c.importePendiente;
      numDocs++;
      if (c.isVencido) totalVencido += c.importePendiente;
    }

    final summaryMismatch = summaryPending > 0 &&
        cobros.hasPendingSummaryForClient(widget.codigoCliente) &&
        (summaryPending - totalPendiente).abs() > 0.05;

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
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
        backgroundColor: AppTheme.raisedSurface,
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              await Future.wait([
                cobros.cargarCobrosPendientes(
                  widget.codigoCliente,
                  tipoDocumento: _tipoDocumento,
                  fechaDesde: _formatDate(_fechaDesde),
                  fechaHasta: _formatDate(_fechaHasta),
                  vendedorCodes: widget.vendedorCodes,
                  forceRefresh: true,
                ),
                cobros.cargarHistoricoCobros(
                  widget.codigoCliente,
                  vendedorCodes: widget.vendedorCodes,
                  forceRefresh: true,
                ),
              ]);
            },
            tooltip: 'Actualizar',
          ),
        ],
      ),
      body: cobros.isLoading && pendientes.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () async {
                await Future.wait([
                  cobros.cargarCobrosPendientes(
                    widget.codigoCliente,
                    tipoDocumento: _tipoDocumento,
                    fechaDesde: _formatDate(_fechaDesde),
                    fechaHasta: _formatDate(_fechaHasta),
                    vendedorCodes: widget.vendedorCodes,
                    forceRefresh: true,
                  ),
                  cobros.cargarHistoricoCobros(
                    widget.codigoCliente,
                    vendedorCodes: widget.vendedorCodes,
                    forceRefresh: true,
                  ),
                ]);
              },
              color: AppTheme.info,
              child: Column(
                children: [
                  _buildCobrosFilters(),
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
                  // Aviso si el resumen de lista y el detalle no cuadran (paginación ERP, etc.)
                  if (summaryMismatch)
                    Container(
                      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppTheme.warning.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppTheme.warning.withValues(alpha: 0.35),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.info_outline,
                            color: AppTheme.warning,
                            size: 16,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Resumen lista: ${_currencyFormat.format(summaryPending)} · '
                              'Detalle cobrable: ${_currencyFormat.format(totalPendiente)}. '
                              'Puede haber más documentos en ERP.',
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 11,
                              ),
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
                        color: AppTheme.raisedSurface.withValues(alpha: 0.5),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: totalVencido > 0
                              ? AppTheme.error.withValues(alpha: 0.3)
                              : AppTheme.info.withValues(alpha: 0.2),
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
                              AppTheme.info,
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
                                  'Incluye documentos ya registrados o sin saldo',
                                  Icons.verified_outlined,
                                  AppTheme.success,
                                ),
                                const SizedBox(height: 8),
                                ...settledCobros.map(_buildSettledCobroTile),
                              ],
                              if (historico.isNotEmpty) ...[
                                const SizedBox(height: 16),
                                _buildSectionHeader(
                                  'Historial de cobros',
                                  'Registros comerciales en DB2',
                                  Icons.history,
                                  AppTheme.info,
                                ),
                                const SizedBox(height: 8),
                                ...historico.map(_buildHistoricoTile),
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
    final settledLabel =
        cobro.isSettledByRepartidor ? 'Cobrado por repartidor' : 'No cobrable';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: AppTheme.raisedSurface.withValues(alpha: 0.55),
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
            Text(
              settledLabel,
              style: TextStyle(
                color: cobro.isSettledByRepartidor
                    ? AppTheme.info
                    : AppTheme.textSecondary,
                fontSize: 11,
                fontWeight: cobro.isSettledByRepartidor
                    ? FontWeight.w600
                    : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistoricoTile(CobroHistorico cobro) {
    final fecha = DateFormat('dd/MM/yyyy').format(cobro.fecha);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: AppTheme.raisedSurface.withValues(alpha: 0.7),
      child: ListTile(
        dense: true,
        leading: const Icon(Icons.payments, color: AppTheme.info, size: 20),
        title: Text(
          cobro.referencia.isNotEmpty ? cobro.referencia : 'Cobro #${cobro.id}',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
        subtitle: Text(
          [
            fecha,
            if (cobro.formaPago != null && cobro.formaPago!.isNotEmpty)
              cobro.formaPago!,
            if (cobro.observaciones.isNotEmpty) cobro.observaciones,
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
        ),
        trailing: Text(
          _currencyFormat.format(cobro.importe),
          style: const TextStyle(
            color: AppTheme.success,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildCobroCard(CobroPendiente cobro) {
    final state = _itemStates[cobro.id] ?? 'NONE';
    final isPartial = state == 'PARCIAL';
    final creditLabel = _creditDeadlineLabel(cobro);
    final subtitle = [
      '${cobro.tipo.label} ${cobro.referencia.isNotEmpty ? cobro.referencia : cobro.id}',
      if (cobro.isPedidoAppProvisional) 'pendiente de ERP',
      'Vencimiento: ${cobro.fechaVencimiento != null ? DateFormat('dd/MM/yyyy').format(cobro.fechaVencimiento!) : 'N/A'}',
      if (creditLabel != null) creditLabel,
      if (cobro.isVencido) 'Mora ${cobro.diasMora}d',
    ].join(' - ');

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppTheme.raisedSurface,
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
            if (cobro.isPedidoAppProvisional) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.info.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppTheme.info.withValues(alpha: 0.35),
                  ),
                ),
                child: const Text(
                  'APP',
                  style: TextStyle(
                    color: AppTheme.info,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
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
          subtitle,
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
            color: AppTheme.info,
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
                      fillColor: AppTheme.inkSurface,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(
                          color: AppTheme.info.withValues(alpha: 0.3),
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

  String? _creditDeadlineLabel(CobroPendiente cobro) {
    if (cobro.diasLimiteCredito == null &&
        cobro.fechaLimiteCredito == null &&
        cobro.diasRestantesCredito == null) {
      return null;
    }
    final parts = <String>[];
    if (cobro.diasLimiteCredito != null) {
      parts.add('Crédito ${cobro.diasLimiteCredito} días');
    }
    if (cobro.fechaLimiteCredito != null) {
      final fechaLimite = DateFormat(
        'dd/MM/yyyy',
      ).format(cobro.fechaLimiteCredito!);
      parts.add('límite $fechaLimite');
    }
    final restantes = cobro.diasRestantesCredito;
    if (restantes != null) {
      parts.add(
        restantes < 0
            ? 'vencido hace ${-restantes} días'
            : 'faltan $restantes días',
      );
    }
    return parts.join(' · ');
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
          backgroundColor: isSelected ? AppTheme.success : AppTheme.inkSurface,
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
        color: AppTheme.raisedSurface,
        border: Border(
            top: BorderSide(color: AppTheme.info.withValues(alpha: 0.2))),
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
                  dropdownColor: AppTheme.raisedSurface,
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
              backgroundColor: AppTheme.info,
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
