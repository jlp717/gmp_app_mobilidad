// ignore_for_file: public_member_api_docs, lines_longer_than_80_chars

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/widgets/async_operation_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/liquidacion_pdf_builder.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/widgets/repartidor_monthly_summary_bar.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

class RepartidorLiquidacionDiariaPage extends ConsumerStatefulWidget {
  const RepartidorLiquidacionDiariaPage({
    required this.repartidorId,
    this.showMonthlySummary = true,
    this.canCreateAdjustments = false,
    super.key,
  });

  final String repartidorId;
  final bool showMonthlySummary;

  /// This UI capability must be supplied by an authenticated JEFE/ADMIN
  /// parent. Its absence is deliberately fail-closed.
  final bool canCreateAdjustments;

  @override
  ConsumerState<RepartidorLiquidacionDiariaPage> createState() =>
      _RepartidorLiquidacionDiariaPageState();
}

class _RepartidorLiquidacionDiariaPageState
    extends ConsumerState<RepartidorLiquidacionDiariaPage> {
  late DateTime _sessionDate;
  late String _idempotencyToken;
  bool _saving = false;
  bool _submittingEntry = false;
  final Map<String, String> _entryTokens = <String, String>{};
  RepartidorLiquidacionResult? _closedResult;

  @override
  void initState() {
    super.initState();
    _sessionDate = _today();
    _idempotencyToken = widget.repartidorId.isEmpty
        ? ''
        : buildLiquidacionIdempotencyToken(widget.repartidorId, _sessionDate);
  }

  @override
  void didUpdateWidget(covariant RepartidorLiquidacionDiariaPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      _sessionDate = _today();
      _idempotencyToken = widget.repartidorId.isEmpty
          ? ''
          : buildLiquidacionIdempotencyToken(
              widget.repartidorId,
              _sessionDate,
            );
      _closedResult = null;
      _entryTokens.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    _refreshSessionDateIfSafe();

    if (widget.repartidorId.isEmpty) {
      return const _SelectSingleRepartidor();
    }

    final args = (
      repartidorId: widget.repartidorId,
      date: _sessionDate,
      // Always revalidate with server: stale Hive cache was showing zeros.
      forceRefresh: true,
    );
    final asyncSummary = ref.watch(repartidorDailySummaryProvider(args));
    final ledgerArgs = (repartidorId: widget.repartidorId, date: _sessionDate);
    // The canonical ledger endpoint accepts one numeric repartidor only.
    // Aggregate manager summaries remain read-only and must not issue an
    // invalid structured-ledger request.
    final asyncLedger = widget.repartidorId.contains(',')
        ? null
        : ref.watch(repartidorLiquidacionLedgerProvider(ledgerArgs));

    return Scaffold(
      backgroundColor: AppColors.inkSurface,
      body: asyncSummary.when(
        data: (summary) => _buildForm(summary, asyncLedger, ledgerArgs),
        loading: () => const Center(
          child: CircularProgressIndicator(color: AppColors.info),
        ),
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

  Widget _buildForm(
    RepartidorDailySummary summary,
    AsyncValue<RepartidorLiquidacionLedger>? asyncLedger,
    LiquidacionLedgerArgs ledgerArgs,
  ) {
    final isAggregate = widget.repartidorId.contains(',');
    final canWriteEntries = asyncLedger?.hasValue == true &&
        asyncLedger?.valueOrNull?.status == 'OPEN' &&
        _closedResult == null;
    return Column(
      children: [
        _ModernHeader(
          title: 'Liquidacion Diaria',
          date: _sessionDate,
          onGeneratePdf: () => _generatePdf(summary, asyncLedger?.valueOrNull),
          onSharePdf: () => _sharePdf(summary, asyncLedger?.valueOrNull),
        ),
        // Resumen acumulado del mes: cobrado / liquidado / pendiente.
        // Da contexto al repartidor antes de cerrar el dia.
        if (!isAggregate && widget.showMonthlySummary)
          RepartidorMonthlySummaryBar(repartidorId: widget.repartidorId),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SectionTitle(
                  icon: Icons.payments,
                  label: 'COBROS DEL DIA',
                ),
                _PaymentMethodCard(
                  icon: Icons.money,
                  label: 'Efectivo',
                  value: summary.totalEfectivo,
                  color: AppColors.success,
                ),
                const SizedBox(height: 8),
                _PaymentMethodCard(
                  icon: Icons.receipt_long,
                  label: 'Cheques',
                  value: summary.totalCheques,
                  color: AppColors.accentIndigo,
                ),
                const SizedBox(height: 8),
                _PaymentMethodCard(
                  icon: Icons.credit_card,
                  label: 'Tarjeta',
                  value: summary.totalTarjeta,
                  color: AppColors.info,
                ),
                const SizedBox(height: 8),
                _PaymentMethodCard(
                  icon: Icons.calendar_today,
                  label: 'Postdatados',
                  value: summary.totalPostdatados,
                  color: AppColors.warning,
                ),
                const SizedBox(height: 20),
                const _SectionTitle(
                  icon: Icons.account_balance_wallet,
                  label: 'BALANCE',
                ),
                _BalanceCard(
                  label: 'Entregado ERP (día)',
                  value: summary.entregado,
                  icon: Icons.local_shipping,
                ),
                const SizedBox(height: 8),
                _BalanceCard(
                  label: 'Deuda pendiente ERP',
                  value: summary.deudaPendiente,
                  icon: Icons.money_off,
                ),
                const SizedBox(height: 8),
                _BalanceCard(
                  label: 'Saldo actual',
                  value: summary.saldoActual,
                  icon: Icons.wallet,
                ),
                const SizedBox(height: 8),
                _BalanceCard(
                  label: 'Total a ingresar',
                  value: summary.totalAIngresar,
                  icon: Icons.upload_file,
                  highlight: true,
                ),
                const SizedBox(height: 24),
                if (asyncLedger != null) ...[
                  const _SectionTitle(
                    icon: Icons.receipt_long,
                    label: 'DESGLOSE DE LIQUIDACION',
                  ),
                  _LiquidacionLedgerPanel(
                    ledger: asyncLedger,
                    onRetry: () => ref.invalidate(
                      repartidorLiquidacionLedgerProvider(ledgerArgs),
                    ),
                  ),
                ],
                if (!isAggregate && canWriteEntries) ...[
                  const SizedBox(height: 12),
                  _LiquidacionEntryActions(
                    isSubmitting: _submittingEntry,
                    canCreateAdjustments: widget.canCreateAdjustments,
                    onExpense: () => _showEntryDialog(_EntryKind.expense),
                    onBankDeposit: () =>
                        _showEntryDialog(_EntryKind.bankDeposit),
                    onAdjustment: () => _showEntryDialog(_EntryKind.adjustment),
                  ),
                ],
                const SizedBox(height: 24),
                if (_closedResult != null) ...[
                  const SizedBox(height: 24),
                  _LiquidacionClosedState(result: _closedResult!),
                ],
                if (summary.cobros.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  const _SectionTitle(
                    icon: Icons.receipt,
                    label: 'COBROS DETALLE',
                  ),
                  _CobrosPreview(
                    cobros: summary.cobros,
                    canReverseCobros: summary.canReverseCobros,
                    repartidorId: widget.repartidorId,
                    onReversed: () {
                      final args = (
                        repartidorId: widget.repartidorId,
                        date: _sessionDate,
                        forceRefresh: true,
                      );
                      ref.invalidate(
                        repartidorDailySummaryProvider(args),
                      );
                    },
                  ),
                ],
              ],
            ),
          ),
        ),
        if (!isAggregate)
          _ModernSaveBar(
            isSaving: _saving,
            isClosed: _closedResult != null,
            onPressed: _save,
          ),
      ],
    );
  }

  Future<void> _generatePdf(
    RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  ) async {
    try {
      await LiquidacionPdfBuilder.preview(
        repartidorId: widget.repartidorId,
        date: _sessionDate,
        summary: summary,
        ledger: ledger,
      );
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            financeErrorMessage(error, 'No se pudo generar el PDF'),
          ),
        ),
      );
    }
  }

  Future<void> _sharePdf(
    RepartidorDailySummary summary,
    RepartidorLiquidacionLedger? ledger,
  ) async {
    try {
      await LiquidacionPdfBuilder.shareViaSystem(
        repartidorId: widget.repartidorId,
        date: _sessionDate,
        summary: summary,
        ledger: ledger,
      );
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            financeErrorMessage(error, 'No se pudo compartir el PDF'),
          ),
        ),
      );
    }
  }

  Future<void> _save() async {
    if (_saving) return;
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
      final result = await ref.read(repartidorLiquidacionActionsProvider).close(
            repartidorId: widget.repartidorId,
            date: _sessionDate,
            idempotencyToken: _idempotencyToken,
            sendEmails: true,
          );

      if (!mounted) return;
      setState(() => _closedResult = result);
      modal.success(
        result.isReplay
            ? 'Liquidacion ya cerrada anteriormente'
            : 'Liquidacion cerrada',
      );
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted) return;
      modal.error(
        financeErrorMessage(
          error,
          'No se pudo cerrar la liquidacion. Puedes reintentar.',
        ),
        onRetry: _save,
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _showEntryDialog(_EntryKind kind) async {
    if (_saving || _submittingEntry || _closedResult != null) return;
    final result =
        await showDialog<({double amount, String detail, String? observation})>(
      context: context,
      builder: (_) => _LiquidacionEntryDialog(kind: kind),
    );
    if (result == null || !mounted) return;
    await _submitEntry(kind, result.amount, result.detail, result.observation);
  }

  Future<void> _submitEntry(
    _EntryKind kind,
    double amount,
    String detail,
    String? observation,
  ) async {
    if (_submittingEntry || _closedResult != null) return;
    final fingerprint = buildLiquidacionEntryFingerprint(
      widget.repartidorId,
      _sessionDate,
      kind.name,
      amount: amount,
      detail: detail,
      observation: observation,
    );
    final token = _entryTokens.putIfAbsent(
      fingerprint,
      () => createLiquidacionEntryIdempotencyToken(
        widget.repartidorId,
        _sessionDate,
        kind.name,
        amount: amount,
        detail: detail,
        observation: observation,
      ),
    );
    setState(() => _submittingEntry = true);
    try {
      final actions = ref.read(repartidorLiquidacionActionsProvider);
      late RepartidorLiquidacionEntryResult result;
      switch (kind) {
        case _EntryKind.expense:
          result = await actions.createExpense(
              repartidorId: widget.repartidorId,
              date: _sessionDate,
              amount: amount,
              category: detail,
              idempotencyToken: token,
              observation: observation);
          break;
        case _EntryKind.bankDeposit:
          result = await actions.createBankDeposit(
              repartidorId: widget.repartidorId,
              date: _sessionDate,
              amount: amount,
              reference: detail,
              idempotencyToken: token,
              observation: observation);
          break;
        case _EntryKind.adjustment:
          result = await actions.createAdjustment(
              repartidorId: widget.repartidorId,
              date: _sessionDate,
              amount: amount,
              reason: detail,
              idempotencyToken: token,
              observation: observation);
          break;
      }
      _entryTokens.remove(fingerprint);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(result.isReplay
            ? 'Movimiento ya registrado; se recuperó el resultado anterior.'
            : 'Movimiento creado y verificado por el servidor.'),
        backgroundColor: AppColors.success,
      ));
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted) return;
      final requiresReconciliation = error is ApiException &&
          (error.statusCode == 409 ||
              error.code == 'LIQUIDACION_ENTRY_REPLAY_MISMATCH');
      if (requiresReconciliation) {
        ref
          ..invalidate(repartidorLiquidacionLedgerProvider((
            repartidorId: widget.repartidorId,
            date: _sessionDate,
          )))
          ..invalidate(repartidorDailySummaryProvider((
            repartidorId: widget.repartidorId,
            date: _sessionDate,
            forceRefresh: false,
          )));
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(requiresReconciliation
            ? 'El servidor detectó un conflicto. Conservamos este intento; recarga el desglose antes de decidir si reintentas.'
            : financeErrorMessage(error,
                'No se pudo registrar la entrada. Reintenta sin cerrar la aplicación.')),
        backgroundColor: AppColors.error,
        action: requiresReconciliation
            ? SnackBarAction(
                label: 'Recargar',
                onPressed: () => ref.invalidate(
                  repartidorLiquidacionLedgerProvider((
                    repartidorId: widget.repartidorId,
                    date: _sessionDate,
                  )),
                ),
              )
            : null,
      ));
    } finally {
      if (mounted) setState(() => _submittingEntry = false);
    }
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  void _refreshSessionDateIfSafe() {
    final today = _today();
    if (_saving || _closedResult != null || _sessionDate == today) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _saving) return;
      setState(() {
        _sessionDate = today;
        _entryTokens.clear();
        _idempotencyToken =
            buildLiquidacionIdempotencyToken(widget.repartidorId, _sessionDate);
      });
    });
  }
}

class LiquidacionDiariaPage extends RepartidorLiquidacionDiariaPage {
  const LiquidacionDiariaPage({
    required super.repartidorId,
    super.key,
  });
}

enum _EntryKind {
  expense('Registrar gasto', 'Categoría', 40),
  bankDeposit('Registrar ingreso bancario', 'Referencia bancaria', 80),
  adjustment('Registrar ajuste', 'Motivo del ajuste', 120);

  const _EntryKind(this.title, this.detailLabel, this.detailMaxLength);
  final String title;
  final String detailLabel;
  final int detailMaxLength;
}

class _LiquidacionEntryDialog extends StatefulWidget {
  const _LiquidacionEntryDialog({required this.kind});
  final _EntryKind kind;

  @override
  State<_LiquidacionEntryDialog> createState() =>
      _LiquidacionEntryDialogState();
}

class _LiquidacionEntryDialogState extends State<_LiquidacionEntryDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _detailController = TextEditingController();
  final _observationController = TextEditingController();

  @override
  void dispose() {
    _amountController.dispose();
    _detailController.dispose();
    _observationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.kind.title),
        content: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _amountController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                    signed: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Importe (EUR)'),
                  validator: (value) {
                    final amount = double.tryParse(
                      (value ?? '').trim().replaceAll(',', '.'),
                    );
                    if (amount == null ||
                        !amount.isFinite ||
                        (widget.kind == _EntryKind.adjustment
                            ? amount == 0
                            : amount <= 0) ||
                        amount.abs() > 99999999 ||
                        ((amount * 100).round() - amount * 100).abs() >
                            0.000001) {
                      return widget.kind == _EntryKind.adjustment
                          ? 'Indica un importe con signo distinto de cero y dos decimales como máximo.'
                          : 'Indica un importe positivo con dos decimales como máximo.';
                    }
                    return null;
                  },
                ),
                TextFormField(
                  controller: _detailController,
                  maxLength: widget.kind.detailMaxLength,
                  decoration:
                      InputDecoration(labelText: widget.kind.detailLabel),
                  validator: (value) => (value == null || value.trim().isEmpty)
                      ? 'Este campo es obligatorio.'
                      : null,
                ),
                TextFormField(
                  controller: _observationController,
                  maxLength: 250,
                  decoration: const InputDecoration(
                    labelText: 'Observación (opcional)',
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              if (_formKey.currentState?.validate() != true) return;
              Navigator.pop(context, (
                amount: double.parse(
                  _amountController.text.trim().replaceAll(',', '.'),
                ),
                detail: _detailController.text.trim(),
                observation: _observationController.text.trim().isEmpty
                    ? null
                    : _observationController.text.trim(),
              ));
            },
            child: const Text('Registrar'),
          ),
        ],
      );
}

class _LiquidacionEntryActions extends StatelessWidget {
  const _LiquidacionEntryActions({
    required this.isSubmitting,
    required this.canCreateAdjustments,
    required this.onExpense,
    required this.onBankDeposit,
    required this.onAdjustment,
  });

  final bool isSubmitting;
  final bool canCreateAdjustments;
  final VoidCallback onExpense;
  final VoidCallback onBankDeposit;
  final VoidCallback onAdjustment;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      accentColor: AppColors.info,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Registrar movimiento',
              style: TextStyle(
                  color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          const Text('Los importes se validan y calculan en el servidor.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                  onPressed: isSubmitting ? null : onExpense,
                  icon: const Icon(Icons.receipt_long),
                  label: const Text('Gasto')),
              OutlinedButton.icon(
                  onPressed: isSubmitting ? null : onBankDeposit,
                  icon: const Icon(Icons.account_balance),
                  label: const Text('Ingreso banco')),
              if (canCreateAdjustments)
                OutlinedButton.icon(
                    onPressed: isSubmitting ? null : onAdjustment,
                    icon: const Icon(Icons.tune),
                    label: const Text('Ajuste')),
            ],
          ),
          if (isSubmitting) ...[
            const SizedBox(height: 12),
            const LinearProgressIndicator(),
          ],
        ],
      ),
    );
  }
}

class _LiquidacionLedgerPanel extends StatelessWidget {
  const _LiquidacionLedgerPanel({required this.ledger, required this.onRetry});
  final AsyncValue<RepartidorLiquidacionLedger> ledger;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ledger.when(
        loading: () => const RepartidorExecutivePanel(
          accentColor: AppColors.info,
          child: Center(
              child: Padding(
                  padding: EdgeInsets.all(12),
                  child: CircularProgressIndicator(color: AppColors.info))),
        ),
        error: (error, _) => RepartidorExecutivePanel(
          accentColor: AppColors.error,
          child: Column(children: [
            const Text(
                'No se pudo cargar el desglose. No registres movimientos hasta reintentar.',
                style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 8),
            OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar')),
          ]),
        ),
        data: (value) => RepartidorExecutivePanel(
          accentColor:
              value.status == 'CLOSED' ? AppColors.success : AppColors.info,
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
                value.status == 'CLOSED'
                    ? 'Liquidación cerrada'
                    : 'Jornada abierta',
                style: const TextStyle(
                    color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            _LedgerTotal(label: 'Gastos', value: value.expensesTotal),
            _LedgerTotal(label: 'Ajustes', value: value.adjustmentsTotal),
            _LedgerTotal(
                label: 'Ingresos bancarios', value: value.bankDepositsTotal),
            if (value.expenses.isEmpty &&
                value.adjustments.isEmpty &&
                value.bankDeposits.isEmpty)
              const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Aún no hay movimientos estructurados.',
                      style: TextStyle(color: AppColors.textSecondary))),
          ]),
        ),
      );
}

class _LedgerTotal extends StatelessWidget {
  const _LedgerTotal({required this.label, required this.value});
  final String label;
  final double value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Expanded(
              child: Text(label,
                  style: const TextStyle(color: AppColors.textSecondary))),
          Text(_money(value),
              style: const TextStyle(
                  color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
        ]),
      );
}

class _ModernHeader extends StatelessWidget {
  const _ModernHeader({
    required this.title,
    required this.date,
    this.onGeneratePdf,
    this.onSharePdf,
  });

  final String title;
  final DateTime date;
  final VoidCallback? onGeneratePdf;
  final VoidCallback? onSharePdf;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.of(context).padding.top + 12,
        16,
        16,
      ),
      decoration: const BoxDecoration(
        color: AppColors.raisedSurface,
        border: Border(
          bottom: BorderSide(color: AppColors.borderColor, width: 0.5),
        ),
      ),
      child: Row(
        children: [
          const RepartidorExecutiveIcon(
            icon: Icons.account_balance_wallet,
            color: AppColors.info,
            size: 24,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
                Text(
                  DateFormat('EEEE, d MMMM yyyy', 'es_ES').format(date),
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Generar PDF',
            onPressed: onGeneratePdf,
            icon: const Icon(Icons.picture_as_pdf, color: AppColors.info),
          ),
          IconButton(
            tooltip: 'Compartir (WhatsApp/Gmail)',
            onPressed: onSharePdf,
            icon: const Icon(Icons.share, color: AppColors.info),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.info),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w700,
              fontSize: 12,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }
}

class _PaymentMethodCard extends StatelessWidget {
  const _PaymentMethodCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final double value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      accentColor: color,
      child: Row(
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
          ),
          Text(
            _money(value, symbol: false),
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'EUR',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.label,
    required this.value,
    required this.icon,
    this.highlight = false,
  });

  final String label;
  final double value;
  final IconData icon;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final accentColor = highlight ? AppColors.warning : AppColors.info;
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      accentColor: accentColor,
      selected: highlight,
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: accentColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: accentColor, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
          ),
          Text(
            _money(value, symbol: false),
            style: TextStyle(
              color: accentColor,
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'EUR',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _LiquidacionClosedState extends StatelessWidget {
  const _LiquidacionClosedState({required this.result});

  final RepartidorLiquidacionResult result;

  @override
  Widget build(BuildContext context) {
    final status = result.isReplay
        ? 'Cierre recuperado (reintento seguro)'
        : 'Cierre confirmado por el servidor';
    final outbox = result.outboxPending
        ? 'El correo queda pendiente en la bandeja de salida.'
        : 'No hay correos pendientes.';
    return RepartidorExecutivePanel(
      accentColor: AppColors.success,
      child: ListTile(
        leading: const Icon(Icons.verified, color: AppColors.success),
        title: Text(
          '$status · ${result.status}',
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Text(
          '$outbox\nReferencia: ${result.marker}',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
      ),
    );
  }
}

class _CobrosPreview extends ConsumerWidget {
  const _CobrosPreview({
    required this.cobros,
    required this.canReverseCobros,
    this.repartidorId,
    this.onReversed,
  });

  final List<RepartidorCobroDia> cobros;

  /// Capability explícita del backend. La ausencia mantiene la UI bloqueada.
  final bool canReverseCobros;

  /// Repartidor activo. Necesario para autorizar la anulación.
  final String? repartidorId;

  /// Callback opcional para refrescar la pantalla tras una anulación.
  final VoidCallback? onReversed;

  void _showCobroDetail(
    BuildContext context,
    WidgetRef ref,
    RepartidorCobroDia cobro,
  ) {
    // Req #16: bottomSheet con detalle del cobro del día.
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (sheetCtx) {
        return RepartidorExecutiveSheet(
          accentColor: AppColors.success,
          height: MediaQuery.sizeOf(sheetCtx).height * 0.8,
          child: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.receipt_long,
                          color: AppColors.success,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              cobro.nombreCliente.isNotEmpty
                                  ? cobro.nombreCliente
                                  : cobro.codigoCliente,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                              ),
                            ),
                            Text(
                              'Cliente ${cobro.codigoCliente}',
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  _DetailRow(
                    icon: Icons.payments,
                    label: 'Importe',
                    value: _money(cobro.importe),
                    valueColor: AppColors.success,
                  ),
                  if (cobro.cobrado > 0)
                    _DetailRow(
                      icon: Icons.check_circle_outline,
                      label: 'Cobrado',
                      value: _money(cobro.cobrado),
                    ),
                  if (cobro.pendiente > 0)
                    _DetailRow(
                      icon: Icons.hourglass_bottom,
                      label: 'Pendiente',
                      value: _money(cobro.pendiente),
                      valueColor: AppColors.warning,
                    ),
                  if (cobro.tipoCobro.isNotEmpty)
                    _DetailRow(
                      icon: Icons.credit_card,
                      label: 'Tipo cobro',
                      value: cobro.tipoCobro,
                    ),
                  if (cobro.documento.isNotEmpty)
                    _DetailRow(
                      icon: Icons.description,
                      label: 'Documento',
                      value: cobro.documento,
                    ),
                  if (cobro.tipoDocumento.isNotEmpty)
                    _DetailRow(
                      icon: Icons.folder_open,
                      label: 'Tipo doc.',
                      value: cobro.tipoDocumento,
                    ),
                  if (cobro.fecha.isNotEmpty)
                    _DetailRow(
                      icon: Icons.calendar_today,
                      label: 'Fecha',
                      value: cobro.fecha,
                    ),
                  const SizedBox(height: 12),
                  // Req #16: anulación sólo con capability, token e identidad.
                  if (canReverseCobros &&
                      cobro.canBeReversed &&
                      (repartidorId ?? '').isNotEmpty)
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.error,
                          side: const BorderSide(color: AppColors.error),
                        ),
                        icon: const Icon(Icons.undo, size: 18),
                        label: const Text('Anular este cobro'),
                        onPressed: () async {
                          Navigator.of(sheetCtx).pop();
                          await _confirmAndReverse(context, ref, cobro);
                        },
                      ),
                    ),
                  if (canReverseCobros &&
                      cobro.canBeReversed &&
                      (repartidorId ?? '').isNotEmpty)
                    const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton(
                      onPressed: () => Navigator.of(sheetCtx).pop(),
                      child: const Text('Cerrar'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmAndReverse(
    BuildContext context,
    WidgetRef ref,
    RepartidorCobroDia cobro,
  ) async {
    if (!canReverseCobros ||
        !cobro.canBeReversed ||
        (repartidorId ?? '').isEmpty) {
      return;
    }
    final reasonCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) {
        return AlertDialog(
          backgroundColor: AppColors.raisedSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: AppColors.error.withValues(alpha: 0.28)),
          ),
          title: const Text(
            'Anular cobro',
            style: TextStyle(color: AppColors.textPrimary),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '¿Seguro que quieres anular el cobro de '
                '${cobro.nombreCliente.isNotEmpty ? cobro.nombreCliente : cobro.codigoCliente}'
                ' por ${cobro.importe.toStringAsFixed(2)} €?',
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reasonCtrl,
                autofocus: true,
                maxLength: 200,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'Motivo (obligatorio)',
                  hintText: 'Ej.: Cobro duplicado / error de importe',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogCtx, false),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.error,
              ),
              onPressed: () {
                if (reasonCtrl.text.trim().isEmpty) return;
                Navigator.pop(dialogCtx, true);
              },
              child: const Text('Anular'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;
    unawaited(HapticFeedback.mediumImpact());
    if (!context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final service = ref.read(repartidorFinanzasServiceProvider);
      await service.reverseCobro(
        repartidorId: repartidorId!,
        idempotencyToken: cobro.idempotencyToken!,
        reason: reasonCtrl.text.trim(),
      );
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AppColors.success,
          content: Text(
            'Cobro de ${cobro.importe.toStringAsFixed(2)} € anulado correctamente',
            // ignore: lines_longer_than_80_chars
          ),
        ),
      );
      onReversed?.call();
    } catch (error, stackTrace) {
      unawaited(Sentry.captureException(error, stackTrace: stackTrace));
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AppColors.error,
          content: Text(
            financeErrorMessage(error, 'No se pudo anular el cobro'),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return RepartidorExecutivePanel(
      accentColor: AppColors.success,
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (final cobro in cobros.take(8))
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => _showCobroDetail(context, ref, cobro),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: AppColors.borderColor.withValues(alpha: 0.15),
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Icon(
                          Icons.person,
                          color: AppColors.success,
                          size: 16,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              cobro.nombreCliente.isNotEmpty
                                  ? cobro.nombreCliente
                                  : cobro.codigoCliente,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            Text(
                              cobro.codigoCliente,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _money(cobro.importe),
                        style: const TextStyle(
                          color: AppColors.success,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(
                        Icons.chevron_right,
                        color: AppColors.textSecondary,
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, color: AppColors.textSecondary, size: 16),
          const SizedBox(width: 10),
          Text(
            '$label:',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 13,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: valueColor ?? AppColors.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ModernSaveBar extends StatelessWidget {
  const _ModernSaveBar({
    required this.isSaving,
    required this.isClosed,
    required this.onPressed,
  });

  final bool isSaving;
  final bool isClosed;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: const BoxDecoration(
        color: AppColors.raisedSurface,
        border:
            Border(top: BorderSide(color: AppColors.borderColor, width: 0.5)),
      ),
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton(
          onPressed: isSaving || isClosed ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.success,
            foregroundColor: AppColors.inkSurface,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            elevation: 0,
          ),
          child: isSaving
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: AppColors.inkSurface,
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.lock_outline, size: 22),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        // Req #16: cierre explicito de la jornada del repartidor.
                        isClosed
                            ? 'Liquidación cerrada'
                            : MediaQuery.of(context).size.width < 380
                                // ignore: lines_longer_than_80_chars
                                ? 'Cerrar día'
                                : 'Cerrar día y grabar liquidación',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
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
      backgroundColor: AppColors.inkSurface,
      body: Center(
        child: Text(
          'Selecciona un repartidor para liquidar',
          style: TextStyle(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 48),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.info,
                foregroundColor: AppColors.inkSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _money(double value, {bool symbol = true}) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return symbol ? '$fixed EUR' : fixed;
}
