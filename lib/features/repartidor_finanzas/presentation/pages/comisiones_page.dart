// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

class RepartidorComisionesFinanzasPage extends ConsumerStatefulWidget {
  const RepartidorComisionesFinanzasPage({
    required this.repartidorId,
    super.key,
  });

  final String repartidorId;

  @override
  ConsumerState<RepartidorComisionesFinanzasPage> createState() =>
      _RepartidorComisionesFinanzasPageState();
}

class _RepartidorComisionesFinanzasPageState
    extends ConsumerState<RepartidorComisionesFinanzasPage> {
  final _tiersFormKey = GlobalKey<FormState>();
  List<RepartidorCommissionTier> _draftTiers = const [];
  bool _dirty = false;
  bool _saving = false;

  @override
  Widget build(BuildContext context) {
    if (widget.repartidorId.isEmpty || widget.repartidorId.contains(',')) {
      return const Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: Center(
          child: Text(
            'Selecciona un repartidor para consultar comisiones',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }

    final now = DateTime.now();
    final from = DateTime(now.year, now.month);
    final to = DateTime(now.year, now.month + 1, 0);
    final summaryArgs = (
      repartidorId: widget.repartidorId,
      from: from,
      to: to,
      forceRefresh: false,
    );
    final summaryAsync =
        ref.watch(repartidorCommissionSummaryProvider(summaryArgs));
    final tiersAsync = ref.watch(repartidorCommissionTiersProvider);
    final authUser = ref.watch(authProvider).value?.user;
    final canEditTiers = (authUser?.isJefeVentas ?? false) ||
        authUser?.role == 'JEFE_VENTAS' ||
        authUser?.role == 'ADMIN';

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: summaryAsync.when(
        data: (summary) => tiersAsync.when(
          data: (tiers) {
            if (!_dirty && _draftTiers.isEmpty) {
              _draftTiers = tiers;
            }
            return _buildContent(summary, tiers, canEditTiers: canEditTiers);
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stackTrace) {
            Sentry.captureException(error, stackTrace: stackTrace);
            return _ErrorState(
              message: financeErrorMessage(
                error,
                'No se pudieron cargar los tramos',
              ),
              onRetry: () => ref.invalidate(repartidorCommissionTiersProvider),
            );
          },
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) {
          Sentry.captureException(error, stackTrace: stackTrace);
          return _ErrorState(
            message: financeErrorMessage(error, 'No se pudo cargar el resumen'),
            onRetry: () => ref.invalidate(
              repartidorCommissionSummaryProvider(summaryArgs),
            ),
          );
        },
      ),
    );
  }

  Widget _buildContent(
    RepartidorCommissionSummary summary,
    List<RepartidorCommissionTier> loadedTiers, {
    required bool canEditTiers,
  }) {
    final tiers = _draftTiers.isEmpty ? loadedTiers : _draftTiers;
    final now = DateTime.now();

    return Column(
      children: [
        _Header(
          period: DateFormat('MM/yyyy').format(now),
          commission: summary.commission,
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              _SummaryGrid(summary: summary),
              const SizedBox(height: 12),
              _ReachedPanel(summary: summary),
              const SizedBox(height: 12),
              _TiersEditor(
                formKey: _tiersFormKey,
                tiers: tiers,
                canEdit: canEditTiers,
                saving: _saving,
                onChanged: _updateTier,
                onSave: () => _saveTiers(tiers),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _updateTier(int index, double thresholdPct, double commissionPct) {
    final current = _draftTiers.toList();
    if (index < 0 || index >= current.length) return;
    current[index] = RepartidorCommissionTier(
      id: current[index].id,
      thresholdPct: thresholdPct,
      commissionPct: commissionPct,
      sortOrder: index + 1,
    );
    setState(() {
      _draftTiers = current;
      _dirty = true;
    });
  }

  Future<void> _saveTiers(List<RepartidorCommissionTier> tiers) async {
    if (_saving) return;
    if (!(_tiersFormKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      await ref
          .read(repartidorLiquidacionActionsProvider)
          .saveCommissionTiers(tiers);
      if (!mounted) return;
      setState(() {
        _dirty = false;
        _draftTiers = const [];
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tramos guardados')),
      );
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            financeErrorMessage(error, 'No se pudieron guardar los tramos'),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class ComisionesPage extends RepartidorComisionesFinanzasPage {
  const ComisionesPage({
    required super.repartidorId,
    super.key,
  });
}

class _Header extends StatelessWidget {
  const _Header({
    required this.period,
    required this.commission,
  });

  final String period;
  final double commission;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.of(context).padding.top + 14,
        16,
        14,
      ),
      color: AppTheme.surfaceColor,
      child: Row(
        children: [
          const Icon(Icons.euro, color: AppTheme.neonGreen, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Comisiones',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  period,
                  style: const TextStyle(color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
          Text(
            _money(commission),
            style: const TextStyle(
              color: AppTheme.neonGreen,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.summary});

  final RepartidorCommissionSummary summary;

  @override
  Widget build(BuildContext context) {
    final cells = [
      _Metric(label: 'Repartido', value: _money(summary.deliveredAmount)),
      _Metric(label: 'Cobrado', value: _money(summary.collectedAmount)),
      _Metric(label: '% cobrado', value: _percent(summary.collectedPct)),
      _Metric(label: 'Comision extra', value: _money(summary.commission)),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 680) {
          return Column(
            children: [
              for (final cell in cells) ...[
                cell,
                const SizedBox(height: 8),
              ],
            ],
          );
        }
        return Row(
          children: [
            for (final cell in cells)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: cell,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReachedPanel extends StatelessWidget {
  const _ReachedPanel({required this.summary});

  final RepartidorCommissionSummary summary;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tramos alcanzados',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          if (summary.reached.isEmpty)
            const Text(
              'Sin tramo superado en el periodo',
              style: TextStyle(color: AppTheme.textSecondary),
            )
          else
            for (final reached in summary.reached) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Supera ${_percent(reached.thresholdPct)}',
                      style: const TextStyle(color: AppTheme.textPrimary),
                    ),
                  ),
                  Text(
                    '${_money(reached.excess)} x '
                    '${_percent(reached.commissionPct)} = '
                    '${_money(reached.commission)}',
                    style: const TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              const Divider(height: 18),
            ],
        ],
      ),
    );
  }
}

class _TiersEditor extends StatelessWidget {
  const _TiersEditor({
    required this.formKey,
    required this.tiers,
    required this.canEdit,
    required this.saving,
    required this.onChanged,
    required this.onSave,
  });

  final GlobalKey<FormState> formKey;
  final List<RepartidorCommissionTier> tiers;
  final bool canEdit;
  final bool saving;
  final void Function(int index, double thresholdPct, double commissionPct)
      onChanged;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Configuracion de tramos',
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                ElevatedButton.icon(
                  onPressed: saving || !canEdit ? null : onSave,
                  icon: saving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save, size: 16),
                  label: const Text('Guardar'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < tiers.length; i++) ...[
              _TierRow(
                key: ValueKey(_stableTierKey(i, tiers[i])),
                index: i,
                tier: tiers[i],
                enabled: canEdit,
                onChanged: onChanged,
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }

  String _stableTierKey(int index, RepartidorCommissionTier tier) {
    final id = tier.id;
    if (id != null && id.isNotEmpty) return 'tier-id-$id';
    return 'tier-new-$index-${tier.sortOrder}';
  }
}

class _TierRow extends StatefulWidget {
  const _TierRow({
    required super.key,
    required this.index,
    required this.tier,
    required this.enabled,
    required this.onChanged,
  });

  final int index;
  final RepartidorCommissionTier tier;
  final bool enabled;
  final void Function(int index, double thresholdPct, double commissionPct)
      onChanged;

  @override
  State<_TierRow> createState() => _TierRowState();
}

class _TierRowState extends State<_TierRow> {
  late final TextEditingController _thresholdController;
  late final TextEditingController _commissionController;

  @override
  void initState() {
    super.initState();
    _thresholdController = TextEditingController(
      text: _numberInput(widget.tier.thresholdPct),
    );
    _commissionController = TextEditingController(
      text: _numberInput(widget.tier.commissionPct),
    );
  }

  @override
  void dispose() {
    _thresholdController.dispose();
    _commissionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _NumberField(
            label: 'Umbral',
            suffix: '%',
            controller: _thresholdController,
            enabled: widget.enabled,
            onChanged: _emit,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _NumberField(
            label: 'Comision',
            suffix: '%',
            controller: _commissionController,
            enabled: widget.enabled,
            onChanged: _emit,
          ),
        ),
      ],
    );
  }

  void _emit() {
    widget.onChanged(
      widget.index,
      _parseNumber(_thresholdController.text),
      _parseNumber(_commissionController.text),
    );
  }
}

class _NumberField extends StatelessWidget {
  const _NumberField({
    required this.label,
    required this.suffix,
    required this.controller,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final String suffix;
  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      enabled: enabled,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp('[0-9,.]')),
      ],
      onChanged: (_) => onChanged(),
      validator: _validatePercent,
      style: const TextStyle(color: AppTheme.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        suffixText: suffix,
        isDense: true,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: child,
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
          Text(message, style: const TextStyle(color: AppTheme.textSecondary)),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: onRetry, child: const Text('Reintentar')),
        ],
      ),
    );
  }
}

String _numberInput(double value) {
  return value.toStringAsFixed(value.truncateToDouble() == value ? 0 : 2);
}

String? _validatePercent(String? value) {
  final normalized = (value ?? '').trim().replaceAll(',', '.');
  if (normalized.isEmpty) return 'Obligatorio';
  final parsed = double.tryParse(normalized);
  if (parsed == null) return 'Valor invalido';
  if (parsed < 0 || parsed > 100) return 'Entre 0 y 100';
  final decimals = normalized.contains('.') ? normalized.split('.').last : '';
  if (decimals.length > 3) return 'Maximo 3 decimales';
  return null;
}

double _parseNumber(String value) {
  return double.tryParse(value.trim().replaceAll(',', '.')) ?? 0;
}

String _money(double value) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return '$fixed EUR';
}

String _percent(double value) {
  final fixed = value.toStringAsFixed(1).replaceAll('.', ',');
  return '$fixed%';
}
