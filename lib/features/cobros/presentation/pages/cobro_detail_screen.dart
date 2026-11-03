import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/widgets/cobro_confirm_dialog.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';
import 'package:intl/intl.dart';

/// Smallest balance treated as real payable debt.
const double cobroPayableEpsilon = 0.0001;

/// Minimum amount allowed when the client has cobro riguroso.
double minimumCobroAmount(CobroPendiente cobro) {
  if (!cobro.cobroRiguroso || cobro.porcentajeMinimoCobro <= 0) {
    return 0;
  }
  return cobro.importePendiente * cobro.porcentajeMinimoCobro / 100;
}

/// Returns true when a document may still be charged.
bool isCobroPayable(CobroPendiente cobro) {
  return !cobro.documentoNoDisponible &&
      cobro.estado != EstadoCobro.alDia &&
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
  if (!isCobroPayable(cobro) ||
      amount <= cobroPayableEpsilon ||
      amount > cobro.importePendiente) {
    return false;
  }
  final min = minimumCobroAmount(cobro);
  if (min <= cobroPayableEpsilon) return true;
  if (amount + cobroPayableEpsilon >= cobro.importePendiente) return true;
  return amount + cobroPayableEpsilon >= min;
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

/// Commercial payment controls shared by the live detail screen and its
/// renderer contract. The available values and callbacks intentionally match
/// the existing payment workflow; this widget changes presentation only.
class CommercialPaymentControls extends StatelessWidget {
  /// Creates the commercial-only payment method and submit controls.
  const CommercialPaymentControls({
    required this.paymentMethod,
    required this.total,
    required this.isSubmitting,
    required this.onPaymentMethodChanged,
    required this.onSubmit,
    super.key,
  });

  /// Existing backend payment value selected by the commercial workflow.
  final String paymentMethod;

  /// Selected amount shown in the primary action.
  final double total;

  /// Whether the existing payment request is currently running.
  final bool isSubmitting;

  /// Preserved callback for changing the existing payment value.
  final ValueChanged<String> onPaymentMethodChanged;

  /// Preserved callback that starts the existing payment handler.
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.currency(locale: 'es_ES', symbol: '€');
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          top: BorderSide(color: AppTheme.info.withValues(alpha: 0.45)),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final stack = constraints.maxWidth < 620;
          final methodControl = Semantics(
            label: 'Forma de pago comercial: $paymentMethod',
            child: ConstrainedBox(
              key: const Key('commercial-payment-method-control'),
              constraints: const BoxConstraints(minHeight: 56),
              child: DropdownButtonFormField<String>(
                key: ValueKey(paymentMethod),
                initialValue: paymentMethod,
                dropdownColor: AppTheme.raisedSurface,
                style: TextStyle(
                  color: AppColors.themedWhite,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
                decoration: InputDecoration(
                  labelText: 'Forma de pago',
                  labelStyle: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                  filled: true,
                  fillColor: AppTheme.softPanel,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                  ),
                ),
                items: const ['CONTADO', 'CREDITO']
                    .map(
                      (method) => DropdownMenuItem<String>(
                        value: method,
                        child: Text(method),
                      ),
                    )
                    .toList(),
                onChanged: isSubmitting
                    ? null
                    : (value) {
                        if (value != null) onPaymentMethodChanged(value);
                      },
              ),
            ),
          );
          final submit = ElevatedButton(
            key: const Key('commercial-payment-submit'),
            onPressed: total > 0 && !isSubmitting ? onSubmit : null,
            style: ElevatedButton.styleFrom(
              minimumSize: const Size(56, 56),
              backgroundColor: AppTheme.info,
              foregroundColor: AppColors.systemWhite,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              textStyle: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusLg),
              ),
            ),
            child: isSubmitting
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.systemWhite,
                    ),
                  )
                : Text('Cobrar ${money.format(total)}'),
          );

          if (stack) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                methodControl,
                const SizedBox(height: 12),
                submit,
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: methodControl),
              const SizedBox(width: 16),
              Flexible(child: submit),
            ],
          );
        },
      ),
    );
  }
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
    'PGC': 'PGC',
    'PGP': 'PGP',
    'PAG': 'Pagaré',
    'CNP': 'CNP',
    'DEV': 'Devolución',
  };

  String? _formatDate(DateTime? value) {
    if (value == null) return null;
    final y = value.year.toString().padLeft(4, '0');
    final m = value.month.toString().padLeft(2, '0');
    final d = value.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _reloadPendientes({bool forceRefresh = true}) async {
    await _notifier.cargarCobrosPendientes(
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
      builder: AppTheme.pickerOverlay,
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
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 56),
              child: DropdownButton<String?>(
                value: _tipoDocumento,
                dropdownColor: AppTheme.raisedSurface,
                style: TextStyle(color: AppColors.themedWhite, fontSize: 18),
                hint: Text(
                  'Tipo documento',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 18,
                  ),
                ),
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
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: () => _pickDate(isDesde: true),
              icon: const Icon(Icons.calendar_today, size: 22),
              label: Text(
                _fechaDesde == null
                    ? 'Vence desde'
                    : DateFormat('dd/MM/yy').format(_fechaDesde!),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(56, 56),
                textStyle: const TextStyle(fontSize: 18),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: () => _pickDate(isDesde: false),
              icon: const Icon(Icons.event, size: 22),
              label: Text(
                _fechaHasta == null
                    ? 'Vence hasta'
                    : DateFormat('dd/MM/yy').format(_fechaHasta!),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(56, 56),
                textStyle: const TextStyle(fontSize: 18),
              ),
            ),
            const SizedBox(width: 8),
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
                style: TextButton.styleFrom(
                  minimumSize: const Size(56, 56),
                  textStyle: const TextStyle(fontSize: 18),
                ),
                child: const Text('Limpiar'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientHeader() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.softPanel,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.info.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.nombreCliente,
            style: TextStyle(
              color: AppColors.themedWhite,
              fontSize: 20,
              fontWeight: FontWeight.w800,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Código: ${widget.codigoCliente}',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 18,
              fontWeight: FontWeight.w600,
              height: 1.25,
            ),
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
        _notifier.cargarHistoricoCobros(
          widget.codigoCliente,
          vendedorCodes: widget.vendedorCodes,
          forceRefresh: true,
        ),
      ]);
    });
  }

  CobrosParams get _params => CobrosParams(employeeCode: widget.employeeCode);
  CobrosNotifier get _notifier => ref.read(cobrosProvider(_params).notifier);
  CobrosState get _state => ref.read(cobrosProvider(_params));

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
    final pendientesById = _payableById(_state.cobrosPendientes);
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
    final cobro = _payableById(_state.cobrosPendientes)[cobroId];
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
      final min = minimumCobroAmount(cobro);
      _partialErrors[cobroId] = cobro.cobroRiguroso && min > cobroPayableEpsilon
          ? 'Mínimo ${cobro.porcentajeMinimoCobro.toStringAsFixed(0)}%: ${_currencyFormat.format(min)}. Sube el importe.'
          : 'Máximo: ${_currencyFormat.format(cobro.importePendiente)}. Baja el importe.';
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
        const SnackBar(
          content: Text(
            'Selecciona algún documento para cobrar. Marca al menos uno de la lista.',
            style: TextStyle(fontSize: 18, height: 1.3),
          ),
        ),
      );
      return;
    }

    // Check for validation errors in partial amounts
    if (_partialErrors.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Corrige los importes en rojo antes de cobrar. El mínimo y el máximo están junto a cada documento.',
            style: TextStyle(fontSize: 18, height: 1.3),
          ),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    final observations = await showDialog<String>(
      context: context,
      builder: (ctx) => CobroConfirmDialog(
        cliente: widget.nombreCliente,
        importeLabel: _currencyFormat.format(totalACobrar),
        formaPago: _formaPago,
      ),
    );

    if (observations == null || observations.isEmpty || !mounted) return;

    var fallos = 0;
    var exitos = 0;
    var importeExitoso = 0.0;
    final successfulIds = <String>{};
    final pendientesById = _payableById(_state.cobrosPendientes);
    final selectedEntries = _itemStates.entries
        .where((entry) => entry.value != 'NONE')
        .toList(growable: false);

    setState(() => _isSubmitting = true);

    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => const Center(child: CircularProgressIndicator()),
      ),
    );

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

      final success = await _notifier.registrarCobro(
        codigoCliente: widget.codigoCliente,
        referencia: cobro.paymentReference,
        importe: importe,
        formaPago: _formaPago,
        tipoVenta: tipoVenta,
        tipoModo: tipoModo,
        observaciones: observations,
        vendedorCodes: widget.vendedorCodes,
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
      await Future.wait([
        _reloadPendientes(forceRefresh: true),
        _notifier.cargarHistoricoCobros(
          widget.codigoCliente,
          vendedorCodes: widget.vendedorCodes,
          forceRefresh: true,
        ),
        _notifier.refreshLoadedPendingSummary(forceRefresh: true),
      ]);
      if (!mounted) return;
      final retrySelection = nextCobroSelectionAfterSubmit(
        currentSelection: _itemStates,
        successfulIds: successfulIds,
        latestCobros: _state.cobrosPendientes,
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
        const SnackBar(
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
    final unverifiedCobros =
        pendientes.where((c) => c.documentoNoDisponible).toList();
    final settledCobros = cobrosNonPayableItems(pendientes)
        .where((c) => !c.documentoNoDisponible)
        .toList();
    final historico = cobros.historicoCobros;
    final totalAbonar = _calcularTotalACobrar();
    final summaryPending = cobros.pendingForClient(widget.codigoCliente);

    // Calcular resumen del cliente solo con documentos cobrables.
    double totalPendiente = 0;
    double totalVencido = 0;
    var numDocs = 0;
    for (final c in payableCobros) {
      totalPendiente += c.importePendiente;
      numDocs++;
      if (c.isVencido) totalVencido += c.importePendiente;
    }

    final summaryMismatch = summaryPending > 0 &&
        cobros.hasPendingSummaryForClient(widget.codigoCliente) &&
        (summaryPending -
                    totalPendiente -
                    unverifiedCobros.fold<double>(
                        0, (sum, c) => sum + c.importePendiente))
                .abs() >
            0.05;

    // ponytail: widgets preconstruidos eager; .builder difiere inflate/layout. upgrade: itemBuilder por indice si los documentos crecen mucho.
    final detailRows = <Widget>[
      if (payableCobros.any((c) => c.cobroRiguroso) ||
          (cobros.resumenCobros?.porcentajeMinimoVendedor ?? 0) > 0) ...[
        Semantics(
          label: 'Aviso cobro minimo riguroso',
          child: Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.warning.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
              border:
                  Border.all(color: AppTheme.warning.withValues(alpha: 0.4)),
            ),
            child: Text(
              [
                if (payableCobros.any((c) => c.cobroRiguroso))
                  'Cliente con cobro riguroso. El importe parcial no puede bajar del ${payableCobros.firstWhere((c) => c.cobroRiguroso).porcentajeMinimoCobro.toStringAsFixed(0)}% del pendiente.',
                if ((cobros.resumenCobros?.porcentajeMinimoVendedor ?? 0) > 0)
                  'Mínimo vendedor (VDDX): ${cobros.resumenCobros!.porcentajeMinimoVendedor.toStringAsFixed(0)}%.',
              ].join(' '),
              style: TextStyle(
                color: AppColors.themedWhite,
                fontWeight: FontWeight.w600,
                fontSize: 18,
                height: 1.3,
              ),
            ),
          ),
        ),
      ],
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
      if (unverifiedCobros.isNotEmpty) ...[
        const SizedBox(height: 8),
        _buildSectionHeader(
          'Deuda pendiente de revisión',
          'Documento ERP no verificable. Cobro no disponible.',
          Icons.warning_amber_outlined,
          AppColors.warning,
        ),
        const SizedBox(height: 8),
        ...unverifiedCobros.map(_buildSettledCobroTile),
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
    ];

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      appBar: AppBar(
        toolbarHeight: 72,
        title: Text(
          'Detalle de cobros',
          style: TextStyle(
            color: AppColors.themedWhite,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ),
        backgroundColor: AppTheme.raisedSurface,
        iconTheme: IconThemeData(color: AppColors.themedWhite),
        elevation: 0,
        actions: [
          IconButton(
            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
            iconSize: 28,
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              await Future.wait([
                _notifier.cargarCobrosPendientes(
                  widget.codigoCliente,
                  tipoDocumento: _tipoDocumento,
                  fechaDesde: _formatDate(_fechaDesde),
                  fechaHasta: _formatDate(_fechaHasta),
                  vendedorCodes: widget.vendedorCodes,
                  forceRefresh: true,
                ),
                _notifier.cargarHistoricoCobros(
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
                  _notifier.cargarCobrosPendientes(
                    widget.codigoCliente,
                    tipoDocumento: _tipoDocumento,
                    fechaDesde: _formatDate(_fechaDesde),
                    fechaHasta: _formatDate(_fechaHasta),
                    vendedorCodes: widget.vendedorCodes,
                    forceRefresh: true,
                  ),
                  _notifier.cargarHistoricoCobros(
                    widget.codigoCliente,
                    vendedorCodes: widget.vendedorCodes,
                    forceRefresh: true,
                  ),
                ]);
              },
              color: AppTheme.info,
              child: Column(
                children: [
                  Expanded(
                    child: ListView(
                      padding: EdgeInsets.zero,
                      children: [
                        _buildClientHeader(),
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
                                const Icon(
                                  Icons.error_outline,
                                  color: AppTheme.error,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    cobros.error!,
                                    style: TextStyle(
                                      color: AppColors.themedWhite,
                                      fontSize: 18,
                                      height: 1.3,
                                    ),
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
                                    style: TextStyle(
                                      color: AppColors.themedWhite,
                                      fontSize: 18,
                                      height: 1.3,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        // Resumen del cliente
                        if (payableCobros.isNotEmpty ||
                            settledCobros.isNotEmpty)
                          Container(
                            margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color:
                                  AppTheme.raisedSurface.withValues(alpha: 0.5),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: totalVencido > 0
                                    ? AppTheme.error.withValues(alpha: 0.3)
                                    : AppTheme.info.withValues(alpha: 0.2),
                              ),
                            ),
                            child: SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Row(
                                children: [
                                  _detailSummaryItem(
                                    'Pendiente',
                                    _currencyFormat.format(totalPendiente),
                                    Icons.account_balance_wallet,
                                    totalPendiente > 0
                                        ? AppTheme.warning
                                        : AppTheme.success,
                                  ),
                                  const SizedBox(width: 12),
                                  _detailSummaryItem(
                                    'Vencido',
                                    _currencyFormat.format(totalVencido),
                                    Icons.error_outline,
                                    totalVencido > 0
                                        ? AppTheme.error
                                        : AppTheme.success,
                                  ),
                                  const SizedBox(width: 12),
                                  _detailSummaryItem(
                                    'Documentos',
                                    '$numDocs',
                                    Icons.receipt_long,
                                    AppTheme.info,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        // Total a cobrar (solo si hay seleccion)
                        if (payableCobros.isNotEmpty && totalAbonar > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 8,
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Total a cobrar:',
                                  style: TextStyle(
                                    color: AppColors.themedWhite,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  _currencyFormat.format(totalAbonar),
                                  style: const TextStyle(
                                    color: AppTheme.success,
                                    fontSize: 24,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        if (payableCobros.isEmpty && settledCobros.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(32),
                            child: Column(
                              children: [
                                Icon(
                                  Icons.check_circle_outline,
                                  size: 64,
                                  color:
                                      AppTheme.success.withValues(alpha: 0.3),
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  'No hay cobros pendientes',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: AppColors.themedWhite,
                                    fontSize: 20,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'El cliente esta al dia',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 18,
                                    height: 1.3,
                                    color: AppTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          )
                        else
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(children: detailRows),
                          ),
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
    return Container(
      constraints: const BoxConstraints(minWidth: 180, minHeight: 88),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.softPanel,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: AppColors.themedWhite,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              color: AppColors.themedWhite,
              fontSize: 22,
              fontWeight: FontWeight.w800,
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
                style: TextStyle(
                  color: AppColors.themedWhite,
                  fontWeight: FontWeight.w700,
                  fontSize: 20,
                ),
              ),
              Text(
                subtitle,
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 18,
                  height: 1.25,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSettledCobroTile(CobroPendiente cobro) {
    final settledLabel = cobro.documentoNoDisponible
        ? 'Documento pendiente de revisar'
        : cobro.isSettledByRepartidor
            ? 'Cobrado por repartidor'
            : 'No cobrable';
    final statusColor =
        cobro.documentoNoDisponible ? AppColors.warning : AppColors.success;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: AppTheme.raisedSurface.withValues(alpha: 0.55),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: statusColor.withValues(alpha: 0.22)),
      ),
      child: ListTile(
        leading: Icon(
          cobro.documentoNoDisponible
              ? Icons.info_outline
              : Icons.check_circle_outline,
          color: cobro.documentoNoDisponible
              ? AppColors.warning
              : AppColors.success,
          semanticLabel: cobro.documentoNoDisponible
              ? 'Cobro no disponible: documento ERP pendiente de verificar'
              : 'Documento no cobrable',
        ),
        title: Text(
          cobro.conceptoVisible,
          style: TextStyle(
            color: AppColors.themedWhite,
            fontWeight: FontWeight.w600,
            fontSize: 18,
          ),
        ),
        subtitle: Text(
          '${cobro.tipo.label} ${cobro.referencia.isNotEmpty ? cobro.referencia : cobro.id}',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 18,
            height: 1.25,
          ),
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              _currencyFormat.format(cobro.importePendiente),
              style: TextStyle(
                color: AppColors.themedWhite,
                fontWeight: FontWeight.bold,
                fontSize: 20,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              settledLabel,
              style: TextStyle(
                color: AppColors.themedWhite,
                fontSize: 18,
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
        leading: const Icon(Icons.payments, color: AppTheme.info, size: 20),
        title: Text(
          cobro.referencia.isNotEmpty ? cobro.referencia : 'Cobro #${cobro.id}',
          style: TextStyle(
            color: AppColors.themedWhite,
            fontWeight: FontWeight.w600,
            fontSize: 18,
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
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 18,
            height: 1.25,
          ),
        ),
        trailing: Text(
          _currencyFormat.format(cobro.importe),
          style: const TextStyle(
            color: AppTheme.success,
            fontWeight: FontWeight.bold,
            fontSize: 20,
          ),
        ),
      ),
    );
  }

  Widget _buildCobroCard(CobroPendiente cobro) {
    final state = _itemStates[cobro.id] ?? 'NONE';
    final isPartial = state == 'PARCIAL';
    final subtitle = [
      if (cobro.tipoDocumento.isNotEmpty) cobro.tipoDocumento,
      '${cobro.tipo.label} ${cobro.referencia.isNotEmpty ? cobro.referencia : cobro.id}',
      if (cobro.isPedidoAppProvisional) 'pendiente de ERP',
      'Vto: ${cobro.fechaVencimiento != null ? DateFormat('dd/MM/yyyy').format(cobro.fechaVencimiento!) : 'N/A'}',
      if ((cobro.formaPago ?? '').isNotEmpty) 'FP: ${cobro.formaPago}',
      'Pendiente: ${_currencyFormat.format(cobro.importePendiente)}',
      if (cobro.isVencido) 'Mora ${cobro.diasMora}d',
    ].join(' · ');

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
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              cobro.conceptoVisible,
              style: TextStyle(
                color: AppColors.themedWhite,
                fontWeight: FontWeight.w700,
                fontSize: 20,
                height: 1.2,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (cobro.isPedidoAppProvisional)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.info.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.info),
                    ),
                    child: Text(
                      'PENDIENTE DE ERP',
                      style: TextStyle(
                        color: AppColors.themedWhite,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: cobro.estado.color.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: cobro.estado.color),
                  ),
                  child: Text(
                    cobro.estado.label.toUpperCase(),
                    style: TextStyle(
                      color: AppColors.themedWhite,
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  _currencyFormat.format(cobro.importePendiente),
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontWeight: FontWeight.w800,
                    fontSize: 22,
                  ),
                ),
              ],
            ),
          ],
        ),
        subtitle: Text(
          subtitle,
          style: TextStyle(
            color: AppColors.themedWhite,
            fontSize: 18,
            height: 1.3,
            fontWeight: cobro.isVencido ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _buildStateButton(
                      'NINGUNO',
                      cobro,
                      Icons.radio_button_unchecked,
                      value: 'NONE',
                    ),
                    _buildStateButton('COMPLETO', cobro, Icons.check_circle),
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
                    style: TextStyle(
                      color: AppColors.themedWhite,
                      fontSize: 18,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Importe a cobrar',
                      hintStyle: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 18,
                      ),
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
                      suffixStyle: TextStyle(
                        color: AppColors.themedWhite,
                        fontSize: 18,
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

    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 160, minHeight: 56),
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
        icon: Icon(icon, size: 24),
        label: Text(label),
        style: ElevatedButton.styleFrom(
          backgroundColor: isSelected ? AppTheme.success : AppTheme.inkSurface,
          foregroundColor:
              isSelected ? AppColors.systemWhite : AppColors.themedWhite,
          minimumSize: const Size(160, 56),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
          textStyle: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  Widget _buildBottomBar(double total) {
    return CommercialPaymentControls(
      paymentMethod: _formaPago,
      total: total,
      isSubmitting: _isSubmitting,
      onPaymentMethodChanged: (value) => setState(() => _formaPago = value),
      onSubmit: () => _submitCobro(total),
    );
  }
}
