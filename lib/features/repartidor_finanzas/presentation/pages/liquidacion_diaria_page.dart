// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
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
      backgroundColor: AppColors.darkBase,
      body: asyncSummary.when(
        data: _buildForm,
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.neonBlue)),
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
        _ModernHeader(
          title: 'Liquidacion Diaria',
          date: _sessionDate,
        ),
        Expanded(
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _SectionTitle(icon: Icons.payments, label: 'COBROS DEL DIA'),
                  _PaymentMethodCard(
                    icon: Icons.money,
                    label: 'Efectivo',
                    value: summary.totalEfectivo,
                    color: AppColors.neonGreen,
                  ),
                  const SizedBox(height: 8),
                  _PaymentMethodCard(
                    icon: Icons.receipt_long,
                    label: 'Cheques',
                    value: summary.totalCheques,
                    color: AppColors.neonPurple,
                  ),
                  const SizedBox(height: 8),
                  _PaymentMethodCard(
                    icon: Icons.credit_card,
                    label: 'Tarjeta',
                    value: summary.totalTarjeta,
                    color: AppColors.neonBlue,
                  ),
                  const SizedBox(height: 8),
                  _PaymentMethodCard(
                    icon: Icons.calendar_today,
                    label: 'Postdatados',
                    value: summary.totalPostdatados,
                    color: AppColors.warning,
                  ),
                  const SizedBox(height: 20),
                  _SectionTitle(icon: Icons.account_balance_wallet, label: 'BALANCE'),
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
                  _SectionTitle(icon: Icons.input, label: 'REGISTRO'),
                  _MoneyInputLine(
                    label: 'Ingreso en banco',
                    controller: _ingresoBancoController,
                    icon: Icons.account_balance,
                    autofocus: true,
                  ),
                  const SizedBox(height: 16),
                  _MoneyInputLine(
                    label: 'Entregado',
                    controller: _entregadoController,
                    icon: Icons.handshake,
                  ),
                  if (summary.cobros.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    _SectionTitle(icon: Icons.receipt, label: 'COBROS DETALLE'),
                    _CobrosPreview(cobros: summary.cobros),
                  ],
                ],
              ),
            ),
          ),
        ),
        _ModernSaveBar(
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

class _ModernHeader extends StatelessWidget {
  const _ModernHeader({required this.title, required this.date});

  final String title;
  final DateTime date;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, MediaQuery.of(context).padding.top + 12, 16, 16),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.darkSurface, AppColors.darkBase],
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.neonBlue.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.account_balance_wallet, color: AppColors.neonBlue, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
                Text(
                  DateFormat('EEEE, d MMMM yyyy', 'es_ES').format(date),
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
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
          Icon(icon, size: 18, color: AppColors.neonBlue),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w700,
              fontSize: 12,
              letterSpacing: 1.2,
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
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
    final accentColor = highlight ? AppColors.warning : AppColors.neonBlue;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        gradient: highlight
            ? LinearGradient(
                colors: [
                  AppColors.warning.withValues(alpha: 0.15),
                  AppColors.darkSurface,
                ],
              )
            : null,
        color: highlight ? null : AppColors.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accentColor.withValues(alpha: 0.3)),
      ),
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
                color: Colors.white,
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

class _MoneyInputLine extends StatelessWidget {
  const _MoneyInputLine({
    required this.label,
    required this.controller,
    required this.icon,
    this.autofocus = false,
  });

  final String label;
  final TextEditingController controller;
  final IconData icon;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.neonBlue, size: 20),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 14,
              ),
            ),
          ),
          SizedBox(
            width: 120,
            child: TextFormField(
              controller: controller,
              autofocus: autofocus,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp('[0-9,.]'))],
              validator: _RepartidorLiquidacionDiariaPageState._validateAmount,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.neonGreen,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
              decoration: const InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                border: InputBorder.none,
                hintText: '0,00',
                hintStyle: TextStyle(color: AppColors.textSecondary, fontSize: 14),
              ),
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

class _CobrosPreview extends StatelessWidget {
  const _CobrosPreview({required this.cobros});

  final List<RepartidorCobroDia> cobros;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.darkSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderColor.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          for (final cobro in cobros.take(8))
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: AppColors.borderColor.withValues(alpha: 0.15)),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: AppColors.neonGreen.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Icon(Icons.person, color: AppColors.neonGreen, size: 16),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          cobro.nombreCliente.isNotEmpty ? cobro.nombreCliente : cobro.codigoCliente,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                        Text(
                          cobro.codigoCliente,
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    _money(cobro.importe),
                    style: const TextStyle(
                      color: AppColors.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
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

class _ModernSaveBar extends StatelessWidget {
  const _ModernSaveBar({required this.isSaving, required this.onPressed});

  final bool isSaving;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, MediaQuery.of(context).padding.bottom + 12),
      decoration: const BoxDecoration(
        color: AppColors.darkSurface,
        border: Border(top: BorderSide(color: AppColors.borderColor, width: 0.5)),
      ),
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton(
          onPressed: isSaving ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.neonGreen,
            foregroundColor: AppColors.darkBase,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            elevation: 0,
          ),
          child: isSaving
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.darkBase),
                )
              : const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.check_circle, size: 22),
                    SizedBox(width: 8),
                    Text(
                      'Grabar Liquidacion',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
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
      backgroundColor: AppColors.darkBase,
      body: Center(
        child: Text(
          'Selecciona un repartidor para liquidar',
          style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600),
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
                backgroundColor: AppColors.neonBlue,
                foregroundColor: AppColors.darkBase,
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
