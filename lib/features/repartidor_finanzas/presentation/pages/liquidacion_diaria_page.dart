// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/widgets/async_operation_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

class RepartidorLiquidacionDiariaPage extends ConsumerStatefulWidget {
  const RepartidorLiquidacionDiariaPage({
    required this.repartidorId,
    super.key,
  });

  final String repartidorId;

  @override
  ConsumerState<RepartidorLiquidacionDiariaPage> createState() =>
      _RepartidorLiquidacionDiariaPageState();
}

class _RepartidorLiquidacionDiariaPageState
    extends ConsumerState<RepartidorLiquidacionDiariaPage> {
  final _formKey = GlobalKey<FormState>();
  final _ingresoBancoController = TextEditingController();
  final _entregadoController = TextEditingController();
  late DateTime _sessionDate;
  late String _idempotencyToken;
  bool _saving = false;
  final _draftsByRepartidor = <String, _LiquidacionDraft>{};

  static const _topBar = Color(0xFF202020);
  static const _background = Color(0xFFDCDCDC);
  static const _blueText = Color(0xFF6799D6);
  static const _redText = Color(0xFFE0503C);

  @override
  void initState() {
    super.initState();
    _sessionDate = _today();
    _idempotencyToken = _newToken(widget.repartidorId, _sessionDate);
  }

  @override
  void didUpdateWidget(covariant RepartidorLiquidacionDiariaPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      _storeDraft(oldWidget.repartidorId);
      _restoreDraft(widget.repartidorId);
    }
  }

  @override
  void dispose() {
    _ingresoBancoController.dispose();
    _entregadoController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _refreshSessionDateIfSafe();

    if (widget.repartidorId.isEmpty || widget.repartidorId.contains(',')) {
      return const _SelectSingleRepartidor();
    }

    final args = (
      repartidorId: widget.repartidorId,
      date: _sessionDate,
      forceRefresh: false,
    );
    final asyncSummary = ref.watch(repartidorDailySummaryProvider(args));

    return Scaffold(
      backgroundColor: _background,
      body: asyncSummary.when(
        data: _buildForm,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) {
          Sentry.captureException(error, stackTrace: stackTrace);
          return _ErrorState(
            message: financeErrorMessage(
              error,
              'No se pudo cargar la liquidacion',
            ),
            onRetry: () => ref.invalidate(repartidorDailySummaryProvider(args)),
          );
        },
      ),
    );
  }

  Widget _buildForm(RepartidorDailySummary summary) {
    return Column(
      children: [
        const _TitleBar(title: 'Liquidacion Diaria'),
        Expanded(
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(10, 12, 10, 120),
              child: Column(
                children: [
                  _AmountLine(
                    label: 'Total efectivo',
                    value: summary.totalEfectivo,
                  ),
                  _AmountLine(
                    label: 'Total cheques',
                    value: summary.totalCheques,
                  ),
                  _AmountLine(
                    label: 'Total tarjeta',
                    value: summary.totalTarjeta,
                  ),
                  _AmountLine(
                    label: 'Total postdatados',
                    value: summary.totalPostdatados,
                  ),
                  const SizedBox(height: 16),
                  _AmountLine(
                    label: 'Saldo actual',
                    value: summary.saldoActual,
                  ),
                  _AmountLine(
                    label: 'Total a ingresar',
                    value: summary.totalAIngresar,
                    valueColor: _redText,
                  ),
                  const SizedBox(height: 18),
                  _MoneyInputLine(
                    label: 'Ingreso en banco',
                    controller: _ingresoBancoController,
                    autofocus: true,
                  ),
                  const SizedBox(height: 22),
                  Container(height: 3, color: const Color(0xFF666666)),
                  const SizedBox(height: 22),
                  _AmountLine(
                    label: 'Total efectivo',
                    value: summary.totalEfectivo,
                  ),
                  const SizedBox(height: 18),
                  _MoneyInputLine(
                    label: 'Entregado',
                    controller: _entregadoController,
                  ),
                  const SizedBox(height: 22),
                  if (summary.cobros.isNotEmpty)
                    _CobrosPreview(cobros: summary.cobros),
                ],
              ),
            ),
          ),
        ),
        _BottomSaveBar(
          isSaving: _saving,
          onPressed: () => _save(summary),
        ),
      ],
    );
  }

  Future<void> _save(RepartidorDailySummary summary) async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_sessionDate != _today()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'La fecha de liquidacion ha cambiado. '
            'Reabre la pantalla antes de grabar.',
          ),
        ),
      );
      return;
    }
    setState(() => _saving = true);

    final modal = AsyncOperationModal.show(
      context,
      text: 'Grabando liquidacion...',
    );

    try {
      final ingresoBanco = _parseAmount(_ingresoBancoController.text);
      final entregado = _parseAmount(_entregadoController.text);
      await ref.read(repartidorLiquidacionActionsProvider).close(
            repartidorId: widget.repartidorId,
            date: _sessionDate,
            idempotencyToken: _idempotencyToken,
            summary: summary,
            ingresoBanco: ingresoBanco,
            entregado: entregado,
          );

      if (!mounted) return;
      modal.success('Liquidacion grabada');
      _draftsByRepartidor.remove(widget.repartidorId);
      _sessionDate = _today();
      _idempotencyToken = _newToken(widget.repartidorId, _sessionDate);
      _ingresoBancoController.clear();
      _entregadoController.clear();
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted) return;
      modal.error(
        financeErrorMessage(
          error,
          'No se pudo grabar. El formulario se mantiene para reintentar.',
        ),
        onRetry: () => _save(summary),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  static String _newToken(String repartidorId, DateTime businessDate) {
    final ymd = DateFormat('yyyyMMdd').format(businessDate);
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    return 'liq_${repartidorId}_${ymd}_$timestamp';
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  void _refreshSessionDateIfSafe() {
    final today = _today();
    final hasDraft = _ingresoBancoController.text.trim().isNotEmpty ||
        _entregadoController.text.trim().isNotEmpty;
    if (_saving || hasDraft || _sessionDate == today) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _saving) return;
      setState(() {
        _sessionDate = today;
        _idempotencyToken = _newToken(widget.repartidorId, _sessionDate);
      });
    });
  }

  void _storeDraft(String repartidorId) {
    if (repartidorId.isEmpty) return;
    final hasDraft = _ingresoBancoController.text.trim().isNotEmpty ||
        _entregadoController.text.trim().isNotEmpty;
    if (!hasDraft) {
      _draftsByRepartidor.remove(repartidorId);
      return;
    }
    _draftsByRepartidor[repartidorId] = _LiquidacionDraft(
      ingresoBanco: _ingresoBancoController.text,
      entregado: _entregadoController.text,
      sessionDate: _sessionDate,
      idempotencyToken: _idempotencyToken,
    );
  }

  void _restoreDraft(String repartidorId) {
    final draft = _draftsByRepartidor[repartidorId];
    if (draft == null) {
      _ingresoBancoController.clear();
      _entregadoController.clear();
      _sessionDate = _today();
      _idempotencyToken = _newToken(repartidorId, _sessionDate);
      return;
    }
    _ingresoBancoController.text = draft.ingresoBanco;
    _entregadoController.text = draft.entregado;
    _sessionDate = draft.sessionDate;
    _idempotencyToken = draft.idempotencyToken;
  }

  static double _parseAmount(String value) {
    return double.tryParse(value.trim().replaceAll(',', '.')) ?? 0;
  }

  static String? _validateAmount(String? value) {
    final normalized = (value ?? '').trim().replaceAll(',', '.');
    if (normalized.isEmpty) return 'Obligatorio';
    final amount = double.tryParse(normalized);
    if (amount == null) return 'Importe invalido';
    if (amount < 0) return 'No puede ser negativo';
    final decimals = normalized.contains('.') ? normalized.split('.').last : '';
    if (decimals.length > 2) return 'Maximo 2 decimales';
    return null;
  }
}

class _LiquidacionDraft {
  const _LiquidacionDraft({
    required this.ingresoBanco,
    required this.entregado,
    required this.sessionDate,
    required this.idempotencyToken,
  });

  final String ingresoBanco;
  final String entregado;
  final DateTime sessionDate;
  final String idempotencyToken;
}

class LiquidacionDiariaPage extends RepartidorLiquidacionDiariaPage {
  const LiquidacionDiariaPage({
    required super.repartidorId,
    super.key,
  });
}

class _TitleBar extends StatelessWidget {
  const _TitleBar({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: MediaQuery.of(context).padding.top + 52,
      color: _RepartidorLiquidacionDiariaPageState._topBar,
      alignment: Alignment.bottomCenter,
      padding: const EdgeInsets.only(bottom: 14),
      child: Text(
        title,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
          fontSize: 16,
        ),
      ),
    );
  }
}

class _AmountLine extends StatelessWidget {
  const _AmountLine({
    required this.label,
    required this.value,
    this.valueColor = _RepartidorLiquidacionDiariaPageState._blueText,
  });

  final String label;
  final double value;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 27,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFD0D0D0))),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF333333),
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Text(
            _money(value, symbol: false),
            style: TextStyle(
              color: valueColor,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 22),
          const Text(
            'EUR',
            style: TextStyle(
              color: Color(0xFF333333),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _MoneyInputLine extends StatelessWidget {
  const _MoneyInputLine({
    required this.label,
    required this.controller,
    this.autofocus = false,
  });

  final String label;
  final TextEditingController controller;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF333333),
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: TextFormField(
              controller: controller,
              autofocus: autofocus,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[0-9,.]')),
              ],
              validator: _RepartidorLiquidacionDiariaPageState._validateAmount,
              textAlign: TextAlign.right,
              decoration: const InputDecoration(
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                border: OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(width: 18),
          const Text(
            'EUR',
            style: TextStyle(
              color: Color(0xFF333333),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _CobrosPreview extends StatelessWidget {
  const _CobrosPreview({required this.cobros});

  final List<RepartidorCobroDia> cobros;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.all(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Cobros de la liquidacion',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
          ),
          const SizedBox(height: 6),
          for (final cobro in cobros.take(6))
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${cobro.codigoCliente} ${cobro.nombreCliente}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11),
                    ),
                  ),
                  Text(
                    _money(cobro.importe),
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _BottomSaveBar extends StatelessWidget {
  const _BottomSaveBar({
    required this.isSaving,
    required this.onPressed,
  });

  final bool isSaving;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 72 + MediaQuery.of(context).padding.bottom,
      color: const Color(0xFF303030),
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).padding.bottom),
      child: TextButton(
        onPressed: isSaving ? null : onPressed,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isSaving)
              const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              const Icon(Icons.check, color: Color(0xFF08A718), size: 34),
            const SizedBox(height: 2),
            const Text(
              'Grabar',
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectSingleRepartidor extends StatelessWidget {
  const _SelectSingleRepartidor();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: _RepartidorLiquidacionDiariaPageState._background,
      body: Center(
        child: Text(
          'Selecciona un repartidor para liquidar',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: onRetry,
            child: const Text('Reintentar'),
          ),
        ],
      ),
    );
  }
}

String _money(double value, {bool symbol = true}) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return symbol ? '$fixed EUR' : fixed;
}
