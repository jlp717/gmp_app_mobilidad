// ignore_for_file: public_member_api_docs, use_enums

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/liquidacion_domain.dart';
import 'package:intl/intl.dart';

export '../../domain/liquidacion_domain.dart';

final NumberFormat _moneyFormat =
    NumberFormat.currency(locale: 'es_ES', symbol: '€');

class ComercialLiquidacionDiariaPage extends ConsumerStatefulWidget {
  const ComercialLiquidacionDiariaPage({
    required this.employeeCode,
    super.key,
    this.isJefeVentas = false,
    this.forceShowVendorSelector = false,
    this.initialSummary = const ComercialLiquidacionSummary(),
    this.onSubmit,
  });

  final String employeeCode;
  final bool isJefeVentas;
  final bool forceShowVendorSelector;
  final ComercialLiquidacionSummary initialSummary;
  final FutureOr<void> Function(ComercialLiquidacionDraft draft)? onSubmit;

  @override
  ConsumerState<ComercialLiquidacionDiariaPage> createState() =>
      _ComercialLiquidacionDiariaPageState();
}

class _ComercialLiquidacionDiariaPageState
    extends ConsumerState<ComercialLiquidacionDiariaPage> {
  final _formKey = GlobalKey<FormState>();
  final _ingresoBancoController = TextEditingController();
  final _entregadoController = TextEditingController();
  final _ingresoBancoFocus = FocusNode();
  final _entregadoFocus = FocusNode();

  late DateTime _sessionDate;
  bool _isSaving = false;
  DateTime? _lastSavedAt;

  @override
  void initState() {
    super.initState();
    _sessionDate = DateTime.now();
    _ingresoBancoController.addListener(_markDirty);
    _entregadoController.addListener(_markDirty);
  }

  @override
  void dispose() {
    _ingresoBancoController
      ..removeListener(_markDirty)
      ..dispose();
    _entregadoController
      ..removeListener(_markDirty)
      ..dispose();
    _ingresoBancoFocus.dispose();
    _entregadoFocus.dispose();
    super.dispose();
  }

  void _markDirty() {
    if (mounted) setState(() {});
  }

  ComercialLiquidacionDraft get _draft => ComercialLiquidacionDraft(
        employeeCode: widget.employeeCode,
        date: _sessionDate,
        expectedTotal: widget.initialSummary.totalAIngresar,
        ingresoBanco: _amount(_ingresoBancoController.text),
        entregado: _amount(_entregadoController.text),
      );

  bool get _hasInput =>
      _ingresoBancoController.text.trim().isNotEmpty ||
      _entregadoController.text.trim().isNotEmpty;

  bool get _amountsAreValid =>
      parseAmount(_ingresoBancoController.text) != null &&
      parseAmount(_entregadoController.text) != null;

  bool get _canSave => _hasInput && _amountsAreValid && !_isSaving;

  @override
  Widget build(BuildContext context) {
    final draft = _draft;
    final status = _LiquidacionStatus.fromDraft(
      draft,
      hasInput: _hasInput,
      amountsAreValid: _amountsAreValid,
    );

    return Scaffold(
      backgroundColor: AppColors.transparent,
      appBar: AppBar(
        title: const Text('Liquidación diaria'),
        backgroundColor: AppTheme.inkSurface,
        actions: [
          Tooltip(
            message: 'Limpiar importes',
            child: IconButton(
              icon: const Icon(Icons.restart_alt_rounded),
              onPressed: _hasInput && !_isSaving ? _clearDraft : null,
            ),
          ),
        ],
      ),
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: Column(
          children: [
            if (widget.isJefeVentas || widget.forceShowVendorSelector)
              GlobalVendorSelector(
                isJefeVentas: widget.isJefeVentas,
                forceShow: widget.forceShowVendorSelector,
              ),
            Expanded(
              child: Form(
                key: _formKey,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    return SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 112),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 1180),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _LiquidacionHero(
                                date: _sessionDate,
                                employeeCode: widget.employeeCode,
                                totalAIngresar:
                                    widget.initialSummary.totalAIngresar,
                                status: status,
                              ),
                              const SizedBox(height: 16),
                              _MetricGrid(
                                metrics: [
                                  _MetricData(
                                    icon: Icons.payments_outlined,
                                    label: 'Total efectivo',
                                    value: widget.initialSummary.totalEfectivo,
                                    color: AppTheme.success,
                                  ),
                                  _MetricData(
                                    icon: Icons.receipt_long_outlined,
                                    label: 'Total cheques',
                                    value: widget.initialSummary.totalCheques,
                                    color: AppTheme.info,
                                  ),
                                  _MetricData(
                                    icon: Icons.event_repeat_outlined,
                                    label: 'Total postdatados',
                                    value:
                                        widget.initialSummary.totalPostdatados,
                                    color: AppTheme.warning,
                                  ),
                                  _MetricData(
                                    icon: Icons.account_balance_wallet_outlined,
                                    label: 'Saldo actual',
                                    value: widget.initialSummary.saldoActual,
                                    color: AppTheme.accentIndigo,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              _LiquidacionWorkspace(
                                ingresoBancoController: _ingresoBancoController,
                                entregadoController: _entregadoController,
                                ingresoBancoFocus: _ingresoBancoFocus,
                                entregadoFocus: _entregadoFocus,
                                draft: draft,
                                status: status,
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
            _SaveBar(
              draft: draft,
              status: status,
              isSaving: _isSaving,
              canSave: _canSave,
              lastSavedAt: _lastSavedAt,
              onSave: _save,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    if (!_canSave) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _isSaving = true);
    final draft = _draft;

    try {
      final submit = widget.onSubmit;
      if (submit != null) {
        await submit(draft);
      } else {
        await Future<void>.delayed(const Duration(milliseconds: 220));
      }
      if (!mounted) return;
      setState(() => _lastSavedAt = DateTime.now());
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            submit == null
                ? 'Liquidación preparada. Pendiente de conectar grabación real.'
                : 'Liquidación guardada.',
          ),
        ),
      );
    } catch (error, stackTrace) {
      debugPrint('Commercial liquidation save failed: $error');
      debugPrintStack(
        label: 'Commercial liquidation save stack',
        stackTrace: stackTrace,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content:
                Text('No se pudo guardar la liquidación. Inténtalo de nuevo.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _clearDraft() {
    _ingresoBancoController.clear();
    _entregadoController.clear();
    _lastSavedAt = null;
    setState(() {});
  }
}

class _LiquidacionHero extends StatelessWidget {
  const _LiquidacionHero({
    required this.date,
    required this.employeeCode,
    required this.totalAIngresar,
    required this.status,
  });

  final DateTime date;
  final String employeeCode;
  final double totalAIngresar;
  final _LiquidacionStatus status;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 720;
        final copy = _HeroCopy(
          date: date,
          employeeCode: employeeCode,
          status: status,
        );
        final total = _HeroTotal(totalAIngresar: totalAIngresar);

        return AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: AppTheme.cardGradient,
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            border: Border.all(
              color: status.color.withValues(alpha: 0.34),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.systemBlack.withValues(alpha: 0.28),
                blurRadius: 24,
                offset: const Offset(0, 14),
              ),
              BoxShadow(
                color: status.color.withValues(alpha: 0.10),
                blurRadius: 26,
              ),
            ],
          ),
          child: isWide
              ? Row(
                  children: [
                    Expanded(flex: 6, child: copy),
                    const SizedBox(width: 16),
                    Expanded(flex: 4, child: total),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    copy,
                    const SizedBox(height: 16),
                    total,
                  ],
                ),
        );
      },
    );
  }
}

class _HeroCopy extends StatelessWidget {
  const _HeroCopy({
    required this.date,
    required this.employeeCode,
    required this.status,
  });

  final DateTime date;
  final String employeeCode;
  final _LiquidacionStatus status;

  @override
  Widget build(BuildContext context) {
    final codeLabel = employeeCode.trim().isEmpty
        ? 'Comercial sin código'
        : employeeCode.contains(',')
            ? 'Equipo comercial'
            : 'Comercial $employeeCode';

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppTheme.info.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            border: Border.all(color: AppTheme.info.withValues(alpha: 0.22)),
          ),
          child: const Icon(
            Icons.point_of_sale_rounded,
            color: AppTheme.info,
            size: 26,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    'Liquidación diaria',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.themedWhite,
                        ),
                  ),
                  _StatusPill(status: status),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '${_formatDate(date)} · $codeLabel',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Resumen de caja para cuadrar banco, efectivo entregado y '
                'saldo pendiente antes de cerrar el día.',
                style: TextStyle(
                  color: AppTheme.textSecondary.withValues(alpha: 0.88),
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _HeroTotal extends StatelessWidget {
  const _HeroTotal({required this.totalAIngresar});

  final double totalAIngresar;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface.withValues(alpha: 0.56),
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.activeRing.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Total a ingresar',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              _money(totalAIngresar),
              style: TextStyle(
                color: AppColors.themedWhite,
                fontSize: 34,
                fontWeight: FontWeight.w900,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.metrics});

  final List<_MetricData> metrics;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 980
            ? 4
            : constraints.maxWidth >= 620
                ? 2
                : 1;
        const gap = 12.0;
        final width = (constraints.maxWidth - (gap * (columns - 1))) / columns;

        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: metrics
              .map(
                (metric) => SizedBox(
                  width: width,
                  child: _MetricTile(metric: metric),
                ),
              )
              .toList(growable: false),
        );
      },
    );
  }
}

class _MetricTile extends StatefulWidget {
  const _MetricTile({required this.metric});

  final _MetricData metric;

  @override
  State<_MetricTile> createState() => _MetricTileState();
}

class _MetricTileState extends State<_MetricTile> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final metric = widget.metric;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _hovered
              ? AppTheme.softPanel.withValues(alpha: 0.92)
              : AppTheme.raisedSurface.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(
            color: metric.color.withValues(alpha: _hovered ? 0.42 : 0.22),
          ),
          boxShadow: [
            if (_hovered)
              BoxShadow(
                color: metric.color.withValues(alpha: 0.08),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: metric.color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              child: Icon(metric.icon, color: metric.color, size: 21),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    metric.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _money(metric.value),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppColors.themedWhite,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LiquidacionWorkspace extends StatelessWidget {
  const _LiquidacionWorkspace({
    required this.ingresoBancoController,
    required this.entregadoController,
    required this.ingresoBancoFocus,
    required this.entregadoFocus,
    required this.draft,
    required this.status,
  });

  final TextEditingController ingresoBancoController;
  final TextEditingController entregadoController;
  final FocusNode ingresoBancoFocus;
  final FocusNode entregadoFocus;
  final ComercialLiquidacionDraft draft;
  final _LiquidacionStatus status;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 820;
        final form = _InputPanel(
          ingresoBancoController: ingresoBancoController,
          entregadoController: entregadoController,
          ingresoBancoFocus: ingresoBancoFocus,
          entregadoFocus: entregadoFocus,
        );
        final balance = _BalancePanel(draft: draft, status: status);

        if (!isWide) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              form,
              const SizedBox(height: 16),
              balance,
            ],
          );
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 5, child: form),
            const SizedBox(width: 16),
            Expanded(flex: 4, child: balance),
          ],
        );
      },
    );
  }
}

class _InputPanel extends StatelessWidget {
  const _InputPanel({
    required this.ingresoBancoController,
    required this.entregadoController,
    required this.ingresoBancoFocus,
    required this.entregadoFocus,
  });

  final TextEditingController ingresoBancoController;
  final TextEditingController entregadoController;
  final FocusNode ingresoBancoFocus;
  final FocusNode entregadoFocus;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.premiumPanel(
        accentColor: AppTheme.info,
        opacity: 0.72,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _PanelHeader(
            icon: Icons.edit_note_rounded,
            title: 'Registro',
            subtitle: 'Indica cuánto se ingresa en banco y cuánto se entrega.',
          ),
          const SizedBox(height: 16),
          _MoneyField(
            controller: ingresoBancoController,
            focusNode: ingresoBancoFocus,
            label: 'Ingreso en banco',
            hintText: '0,00',
            icon: Icons.account_balance_rounded,
            textInputAction: TextInputAction.next,
            onFieldSubmitted: (_) => entregadoFocus.requestFocus(),
          ),
          const SizedBox(height: 14),
          _MoneyField(
            controller: entregadoController,
            focusNode: entregadoFocus,
            label: 'Entregado',
            hintText: '0,00',
            icon: Icons.handshake_rounded,
            textInputAction: TextInputAction.done,
          ),
        ],
      ),
    );
  }
}

class _BalancePanel extends StatelessWidget {
  const _BalancePanel({required this.draft, required this.status});

  final ComercialLiquidacionDraft draft;
  final _LiquidacionStatus status;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: status.color.withValues(alpha: 0.32)),
        boxShadow: [
          BoxShadow(
            color: status.color.withValues(alpha: 0.08),
            blurRadius: 22,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PanelHeader(
            icon: Icons.fact_check_outlined,
            title: 'Cuadre',
            subtitle: status.description,
          ),
          const SizedBox(height: 16),
          _BalanceRow(label: 'Esperado', value: draft.expectedTotal),
          _BalanceRow(label: 'Banco', value: draft.ingresoBanco),
          _BalanceRow(label: 'Entregado', value: draft.entregado),
          const SizedBox(height: 8),
          Divider(color: AppTheme.borderColor.withValues(alpha: 0.72)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  draft.isBalanced ? 'Diferencia' : 'Pendiente',
                  style: TextStyle(
                    color: AppColors.themedWhite,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Text(
                _money(draft.diferencia),
                style: TextStyle(
                  color: status.color,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MoneyField extends StatelessWidget {
  const _MoneyField({
    required this.controller,
    required this.focusNode,
    required this.label,
    required this.hintText,
    required this.icon,
    required this.textInputAction,
    this.onFieldSubmitted,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final String label;
  final String hintText;
  final IconData icon;
  final TextInputAction textInputAction;
  final ValueChanged<String>? onFieldSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      focusNode: focusNode,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textInputAction: textInputAction,
      onFieldSubmitted: onFieldSubmitted,
      validator: validateAmount,
      style: TextStyle(
        color: AppColors.themedWhite,
        fontWeight: FontWeight.w800,
        fontFeatures: [FontFeature.tabularFigures()],
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: hintText,
        prefixIcon: Icon(icon),
        suffixText: '€',
      ),
    );
  }
}

class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.draft,
    required this.status,
    required this.isSaving,
    required this.canSave,
    required this.onSave,
    required this.lastSavedAt,
  });

  final ComercialLiquidacionDraft draft;
  final _LiquidacionStatus status;
  final bool isSaving;
  final bool canSave;
  final VoidCallback onSave;
  final DateTime? lastSavedAt;

  @override
  Widget build(BuildContext context) {
    final savedAt = lastSavedAt == null
        ? null
        : 'Último guardado ${_formatClock(lastSavedAt!)}';

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: BoxDecoration(
        color: AppTheme.inkSurface.withValues(alpha: 0.98),
        border: Border(
          top: BorderSide(color: AppTheme.activeRing.withValues(alpha: 0.16)),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.systemBlack.withValues(alpha: 0.30),
            blurRadius: 18,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 160),
                child: Column(
                  key: ValueKey('${status.label}_${draft.diferencia}_$savedAt'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      status.label,
                      style: TextStyle(
                        color: status.color,
                        fontSize: 13,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      savedAt ?? 'Registrado: ${_money(draft.registrado)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              height: 44,
              child: ElevatedButton.icon(
                key: const ValueKey('comercial-liquidacion-save-button'),
                onPressed: canSave ? onSave : null,
                icon: isSaving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check_rounded, size: 18),
                label: Text(isSaving ? 'Guardando' : 'Guardar'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PanelHeader extends StatelessWidget {
  const _PanelHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: AppTheme.activeRing.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          ),
          child: Icon(icon, color: AppTheme.activeRing, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: AppColors.themedWhite,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                  height: 1.32,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _BalanceRow extends StatelessWidget {
  const _BalanceRow({required this.label, required this.value});

  final String label;
  final double value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Text(
            _money(value),
            style: TextStyle(
              color: AppColors.themedWhite,
              fontSize: 14,
              fontWeight: FontWeight.w800,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final _LiquidacionStatus status;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: status.color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
        border: Border.all(color: status.color.withValues(alpha: 0.34)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(status.icon, color: status.color, size: 15),
          const SizedBox(width: 6),
          Text(
            status.label,
            style: TextStyle(
              color: status.color,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricData {
  const _MetricData({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final double value;
  final Color color;
}

class _LiquidacionStatus {
  const _LiquidacionStatus._({
    required this.kind,
    required this.label,
    required this.description,
    required this.color,
    required this.icon,
  });

  factory _LiquidacionStatus.fromDraft(
    ComercialLiquidacionDraft draft, {
    required bool hasInput,
    required bool amountsAreValid,
  }) {
    return switch (classifyLiquidacionStatus(
      draft,
      hasInput: hasInput,
      amountsAreValid: amountsAreValid,
    )) {
      LiquidacionStatusKind.pending => _pending,
      LiquidacionStatusKind.balanced => _balanced,
      LiquidacionStatusKind.mismatch => _mismatch,
      LiquidacionStatusKind.invalid => _invalid,
    };
  }

  final LiquidacionStatusKind kind;
  final String label;
  final String description;
  final Color color;
  final IconData icon;

  static final _pending = _LiquidacionStatus._(
    kind: LiquidacionStatusKind.pending,
    label: 'Pendiente',
    description: 'Aún no hay importes introducidos.',
    color: AppTheme.textSecondary,
    icon: Icons.hourglass_empty_rounded,
  );

  static const _balanced = _LiquidacionStatus._(
    kind: LiquidacionStatusKind.balanced,
    label: 'Cuadrada',
    description: 'Banco y entregado cuadran con el total a ingresar.',
    color: AppTheme.success,
    icon: Icons.verified_rounded,
  );

  static const _mismatch = _LiquidacionStatus._(
    kind: LiquidacionStatusKind.mismatch,
    label: 'Descuadre',
    description: 'La diferencia queda visible antes de guardar.',
    color: AppTheme.warning,
    icon: Icons.warning_amber_rounded,
  );

  static const _invalid = _LiquidacionStatus._(
    kind: LiquidacionStatusKind.invalid,
    label: 'Revisar',
    description: 'Hay un importe con formato no válido.',
    color: AppTheme.error,
    icon: Icons.error_outline_rounded,
  );
}

double _amount(String value) => parseAmount(value) ?? 0;

String _money(double value) => _moneyFormat.format(value);

String _formatDate(DateTime date) {
  const weekdays = [
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
    'Domingo',
  ];
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  final weekday = weekdays[(date.weekday - 1).clamp(0, 6)];
  final month = months[(date.month - 1).clamp(0, 11)];
  return '$weekday, ${date.day} de $month de ${date.year}';
}

String _formatClock(DateTime date) {
  final hour = date.hour.toString().padLeft(2, '0');
  final minute = date.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}
