import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:intl/intl.dart';

/// Corporate palette aligned with ERP/PDF liquidación (#003d7a / #067a58).
abstract final class LiquidacionBrand {
  static const navy = AppColors.legacyFF003D7A;
  static const navyDeep = AppColors.legacyFF1A5490;
  static const green = AppColors.forest;
  static const greenDark = AppColors.legacyFF067A58;
  static const sky = AppColors.legacyFFD7ECFF;
}

String formatLiquidacionMoney(double value, {bool withSymbol = true}) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return withSymbol ? '$fixed €' : fixed;
}

/// Full-screen liquidación layout — executive cockpit, ERP-shaped content.
class LiquidacionDiariaScreen extends ConsumerWidget {
  const LiquidacionDiariaScreen({
    required this.gmpRef,
    required this.repartidorId,
    required this.sessionDate,
    required this.summary,
    required this.ingresoBancoController,
    required this.isClosed,
    required this.isAggregate,
    required this.isSaving,
    required this.canCreateAdjustments,
    required this.isSubmittingEntry,
    required this.closedResult,
    required this.onBack,
    required this.onSave,
    required this.onExpense,
    required this.onBankDeposit,
    required this.onAdjustment,
    required this.onPreviewPdf,
    required this.onSharePdf,
    required this.cobrosPanel,
    required this.ledgerPanel,
    super.key,
  });

  final String gmpRef;
  final String repartidorId;
  final DateTime sessionDate;
  final RepartidorDailySummary summary;
  final TextEditingController ingresoBancoController;
  final bool isClosed;
  final bool isAggregate;
  final bool isSaving;
  final bool canCreateAdjustments;
  final bool isSubmittingEntry;
  final RepartidorLiquidacionResult? closedResult;
  final VoidCallback? onBack;
  final VoidCallback onSave;
  final VoidCallback onExpense;
  final VoidCallback onBankDeposit;
  final VoidCallback onAdjustment;
  final VoidCallback? onPreviewPdf;
  final VoidCallback? onSharePdf;
  final Widget cobrosPanel;
  final Widget? ledgerPanel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      children: [
        _LiquidacionHeroHeader(
          gmpRef: gmpRef,
          repartidorId: repartidorId,
          sessionDate: sessionDate,
          isClosed: isClosed,
          onBack: onBack,
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
            children: [
              _LiquidacionSectionHeading(
                icon: Icons.receipt_long_rounded,
                label: 'Cobros de la liquidación',
                trailing: '${summary.cobrosCount} mov.',
              ),
              const SizedBox(height: 10),
              cobrosPanel,
              const SizedBox(height: 10),
              _LiquidacionTotalStrip(amount: summary.totalCobrosDia),
              const SizedBox(height: 24),
              const _LiquidacionSectionHeading(
                icon: Icons.account_balance_wallet_outlined,
                label: 'Resumen tesorería',
              ),
              const SizedBox(height: 12),
              LayoutBuilder(
                builder: (context, constraints) {
                  final wide = constraints.maxWidth >= 560;
                  final treasury = _LiquidacionTreasuryFields(
                    summary: summary,
                    ingresoBancoController: ingresoBancoController,
                    ingresoEnabled: !isClosed && !isAggregate,
                  );
                  if (wide) {
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: treasury.leftColumn),
                        const SizedBox(width: 12),
                        Expanded(child: treasury.rightColumn),
                      ],
                    );
                  }
                  return Column(
                    children: [
                      treasury.leftColumn,
                      const SizedBox(height: 8),
                      treasury.rightColumn,
                    ],
                  );
                },
              ),
              const SizedBox(height: 12),
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: ingresoBancoController,
                builder: (context, value, _) {
                  final ingreso = _parseEuro(value.text);
                  final diff = summary.totalAIngresar - ingreso;
                  return _LiquidacionCuadreBanner(
                    totalAIngresar: summary.totalAIngresar,
                    ingresoBanco: ingreso,
                    diff: diff,
                  );
                },
              ),
              if (!isClosed && !isAggregate) ...[
                const SizedBox(height: 16),
                _LiquidacionQuickActions(
                  isSubmitting: isSubmittingEntry,
                  canCreateAdjustments: canCreateAdjustments,
                  onExpense: onExpense,
                  onBankDeposit: onBankDeposit,
                  onAdjustment: onAdjustment,
                ),
              ],
              if (ledgerPanel != null) ...[
                const SizedBox(height: 16),
                ledgerPanel!,
              ],
              if (isClosed && closedResult != null) ...[
                const SizedBox(height: 16),
                _LiquidacionClosedCard(
                  result: closedResult!,
                  onPreview: onPreviewPdf,
                  onShare: onSharePdf,
                ),
              ],
            ],
          ),
        ),
        if (!isAggregate)
          _LiquidacionCloseBar(
            isSaving: isSaving,
            isClosed: isClosed,
            onPressed: onSave,
          ),
      ],
    );
  }

  static double _parseEuro(String raw) {
    final normalized =
        raw.trim().replaceAll('€', '').replaceAll(' ', '').replaceAll(',', '.');
    return double.tryParse(normalized) ?? 0;
  }
}

class _LiquidacionHeroHeader extends StatelessWidget {
  const _LiquidacionHeroHeader({
    required this.gmpRef,
    required this.repartidorId,
    required this.sessionDate,
    required this.isClosed,
    this.onBack,
  });

  final String gmpRef;
  final String repartidorId;
  final DateTime sessionDate;
  final bool isClosed;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final nowLabel = DateFormat('yyyy-MM-dd HH:mm').format(DateTime.now());
    final jornada =
        DateFormat('EEEE, d MMMM yyyy', 'es_ES').format(sessionDate);

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [LiquidacionBrand.navy, LiquidacionBrand.navyDeep],
        ),
        border: Border(
          bottom: BorderSide(color: LiquidacionBrand.green, width: 3),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 16, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (onBack != null)
                    IconButton(
                      onPressed: onBack,
                      icon: Icon(
                        Icons.arrow_back_rounded,
                        color: AppColors.themedWhite,
                      ),
                      tooltip: 'Volver',
                    ),
                  const RepartidorExecutiveIcon(
                    icon: Icons.account_balance_wallet_outlined,
                    color: LiquidacionBrand.green,
                    size: 28,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Liquidación Diaria',
                          style:
                              Theme.of(context).textTheme.titleLarge?.copyWith(
                                    color: AppColors.themedWhite,
                                    fontWeight: FontWeight.w800,
                                  ),
                        ),
                        Text(
                          gmpRef,
                          style: const TextStyle(
                            color: LiquidacionBrand.sky,
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _StatusChip(isClosed: isClosed),
                ],
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 16,
                runSpacing: 6,
                children: [
                  _MetaChip(label: 'Fecha', value: nowLabel),
                  _MetaChip(label: 'Vendedor', value: repartidorId),
                  _MetaChip(label: 'Usuario', value: repartidorId),
                  _MetaChip(label: 'Jornada', value: jornada),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.isClosed});

  final bool isClosed;

  @override
  Widget build(BuildContext context) {
    final color = isClosed ? AppColors.textSecondary : LiquidacionBrand.green;
    final label = isClosed ? 'Cerrada' : 'Abierta';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
        border: Border.all(color: color.withValues(alpha: 0.55)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: isClosed ? AppColors.textSecondary : LiquidacionBrand.green,
          fontWeight: FontWeight.w800,
          fontSize: 11,
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(color: AppColors.legacyFF9EC5EA, fontSize: 11),
        children: [
          TextSpan(
            text: '$label: ',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          TextSpan(text: value, style: TextStyle(color: AppColors.themedWhite)),
        ],
      ),
    );
  }
}

class _LiquidacionSectionHeading extends StatelessWidget {
  const _LiquidacionSectionHeading({
    required this.icon,
    required this.label,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: LiquidacionBrand.navy),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label.toUpperCase(),
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w800,
              fontSize: 12,
              letterSpacing: 0.6,
            ),
          ),
        ),
        if (trailing != null)
          Text(
            trailing!,
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
      ],
    );
  }
}

/// ERP-style cobros grid (horizontal scroll on narrow screens).
class LiquidacionCobrosTable extends StatelessWidget {
  const LiquidacionCobrosTable({
    required this.cobros,
    required this.onCobroTap,
    super.key,
  });

  final List<RepartidorCobroDia> cobros;
  final ValueChanged<RepartidorCobroDia>? onCobroTap;

  static const _headers = [
    'Fecha',
    'Cliente',
    'Nombre',
    'Tipo cobro',
    'Documento',
    'Importe',
  ];

  static const _widths = [108.0, 88.0, 140.0, 72.0, 108.0, 72.0];

  @override
  Widget build(BuildContext context) {
    if (cobros.isEmpty) {
      return RepartidorExecutivePanel(
        accentColor: AppColors.textSecondary,
        child: Text(
          'Sin cobros en el periodo.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
      );
    }

    return RepartidorExecutivePanel(
      accentColor: LiquidacionBrand.navy,
      padding: EdgeInsets.zero,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowColor: WidgetStateProperty.all(LiquidacionBrand.navy),
            headingTextStyle: TextStyle(
              color: AppColors.themedWhite,
              fontWeight: FontWeight.w700,
              fontSize: 10,
            ),
            dataTextStyle: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10,
            ),
            columnSpacing: 8,
            horizontalMargin: 12,
            columns: [
              for (var i = 0; i < _headers.length; i++)
                DataColumn(
                  label: SizedBox(
                    width: _widths[i],
                    child: Text(_headers[i]),
                  ),
                ),
            ],
            rows: [
              for (final cobro in cobros)
                DataRow(
                  onSelectChanged:
                      onCobroTap == null ? null : (_) => onCobroTap!(cobro),
                  cells: [
                    DataCell(Text(cobro.fecha.isEmpty ? '—' : cobro.fecha)),
                    DataCell(Text(cobro.codigoCliente)),
                    DataCell(
                      Text(
                        cobro.nombreCliente.isNotEmpty
                            ? cobro.nombreCliente
                            : cobro.codigoCliente,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    DataCell(Text(cobro.tipoCobro)),
                    DataCell(Text(cobro.documento)),
                    DataCell(
                      Text(
                        formatLiquidacionMoney(cobro.importe),
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: LiquidacionBrand.greenDark,
                        ),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LiquidacionTotalStrip extends StatelessWidget {
  const _LiquidacionTotalStrip({required this.amount});

  final double amount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: LiquidacionBrand.greenDark,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'TOTAL',
              style: TextStyle(
                color: AppColors.themedWhite,
                fontWeight: FontWeight.w800,
                fontSize: 14,
              ),
            ),
          ),
          Text(
            formatLiquidacionMoney(amount),
            style: TextStyle(
              color: AppColors.themedWhite,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }
}

class _LiquidacionTreasuryFields {
  _LiquidacionTreasuryFields({
    required this.summary,
    required this.ingresoBancoController,
    required this.ingresoEnabled,
  });

  final RepartidorDailySummary summary;
  final TextEditingController ingresoBancoController;
  final bool ingresoEnabled;

  Widget get leftColumn => Column(
        children: [
          _TreasuryMetricCard(
            label: 'Total Efectivo',
            value: summary.totalEfectivo,
            accent: LiquidacionBrand.greenDark,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Total Cheques',
            value: summary.totalCheques,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Total Tarjeta',
            value: summary.totalTarjeta,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Total Postdatados',
            value: summary.totalPostdatados,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Total Cobros Día',
            value: summary.totalCobrosDia,
            accent: LiquidacionBrand.greenDark,
            emphasized: true,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Total repartido',
            value: summary.entregado,
          ),
        ],
      );

  Widget get rightColumn => Column(
        children: [
          _TreasuryMetricCard(
            label: 'Saldo actual',
            value: summary.saldoActual,
            accent: summary.saldoActual < 0 ? AppColors.error : null,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Deuda pendiente',
            value: summary.deudaPendiente,
            accent: summary.deudaPendiente > 0 ? AppColors.error : null,
          ),
          const SizedBox(height: 8),
          _TreasuryMetricCard(label: 'Gastos', value: summary.gastos),
          if (summary.ajustes != 0) ...[
            const SizedBox(height: 8),
            _TreasuryMetricCard(label: 'Ajustes', value: summary.ajustes),
          ],
          const SizedBox(height: 8),
          _TreasuryMetricCard(
            label: 'Total a ingresar',
            value: summary.totalAIngresar,
            accent: LiquidacionBrand.greenDark,
            emphasized: true,
          ),
          const SizedBox(height: 8),
          _IngresoBancoField(
            controller: ingresoBancoController,
            enabled: ingresoEnabled,
          ),
        ],
      );
}

class _TreasuryMetricCard extends StatelessWidget {
  const _TreasuryMetricCard({
    required this.label,
    required this.value,
    this.accent,
    this.emphasized = false,
  });

  final String label;
  final double value;
  final Color? accent;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final color = accent ?? AppColors.textPrimary;
    return RepartidorExecutivePanel(
      accentColor: accent ?? LiquidacionBrand.navy,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: AppColors.textPrimary,
                fontWeight: emphasized ? FontWeight.w800 : FontWeight.w600,
                fontSize: emphasized ? 13 : 12,
              ),
            ),
          ),
          Text(
            formatLiquidacionMoney(value, withSymbol: false),
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w800,
              fontSize: emphasized ? 15 : 14,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            '€',
            style: TextStyle(
              color: AppColors.textSecondary.withValues(alpha: 0.85),
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }
}

class _IngresoBancoField extends StatelessWidget {
  const _IngresoBancoField({
    required this.controller,
    required this.enabled,
  });

  final TextEditingController controller;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      accentColor: LiquidacionBrand.navy,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Ingreso en Banco',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: controller,
            enabled: enabled,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textAlign: TextAlign.right,
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w800,
              fontSize: 17,
            ),
            decoration: InputDecoration(
              isDense: true,
              filled: true,
              fillColor: AppColors.softPanel,
              suffixText: '€',
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: BorderSide(color: AppColors.borderColor),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: BorderSide(color: AppColors.borderColor),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: const BorderSide(
                  color: LiquidacionBrand.navy,
                  width: 1.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LiquidacionCuadreBanner extends StatelessWidget {
  const _LiquidacionCuadreBanner({
    required this.totalAIngresar,
    required this.ingresoBanco,
    required this.diff,
  });

  final double totalAIngresar;
  final double ingresoBanco;
  final double diff;

  @override
  Widget build(BuildContext context) {
    final balanced = diff.abs() < 0.01;
    final color = balanced ? LiquidacionBrand.greenDark : AppColors.warning;
    final label = balanced
        ? 'Cuadrada'
        : 'Descuadre ${formatLiquidacionMoney(diff.abs())}';

    return RepartidorExecutivePanel(
      accentColor: color,
      child: Row(
        children: [
          Icon(
            balanced ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
            color: color,
            size: 22,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: color,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
                Text(
                  'A ingresar ${formatLiquidacionMoney(totalAIngresar)} · '
                  'Banco ${formatLiquidacionMoney(ingresoBanco)}',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
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

class _LiquidacionQuickActions extends StatelessWidget {
  const _LiquidacionQuickActions({
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
      accentColor: LiquidacionBrand.navy,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Movimientos del día',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _ActionChip(
                icon: Icons.money_off_csred_rounded,
                label: 'Gasto',
                onTap: isSubmitting ? null : onExpense,
              ),
              _ActionChip(
                icon: Icons.account_balance_rounded,
                label: 'Ingreso banco',
                onTap: isSubmitting ? null : onBankDeposit,
              ),
              if (canCreateAdjustments)
                _ActionChip(
                  icon: Icons.tune_rounded,
                  label: 'Ajuste',
                  onTap: isSubmitting ? null : onAdjustment,
                ),
            ],
          ),
          if (isSubmitting) ...[
            const SizedBox(height: 12),
            const LinearProgressIndicator(color: LiquidacionBrand.navy),
          ],
        ],
      ),
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({
    required this.icon,
    required this.label,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.softPanel,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: LiquidacionBrand.navy),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LiquidacionClosedCard extends StatelessWidget {
  const _LiquidacionClosedCard({
    required this.result,
    this.onPreview,
    this.onShare,
  });

  final RepartidorLiquidacionResult result;
  final VoidCallback? onPreview;
  final VoidCallback? onShare;

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutivePanel(
      accentColor: AppColors.success,
      child: Row(
        children: [
          const Icon(Icons.verified_rounded, color: AppColors.success),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  result.isReplay
                      ? 'Liquidación ya cerrada (reintento seguro)'
                      : 'Liquidación cerrada correctamente',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  'Ref. ${result.marker}',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          if (onPreview != null)
            IconButton(
              tooltip: 'Ver PDF',
              onPressed: onPreview,
              icon: const Icon(Icons.picture_as_pdf_outlined),
              color: LiquidacionBrand.navy,
              constraints: const BoxConstraints(minWidth: 24, minHeight: 24),
            ),
          if (onShare != null)
            IconButton(
              tooltip: 'Compartir PDF',
              onPressed: onShare,
              icon: const Icon(Icons.share_outlined),
              color: LiquidacionBrand.navy,
            ),
        ],
      ),
    );
  }
}

class _LiquidacionCloseBar extends StatelessWidget {
  const _LiquidacionCloseBar({
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
        MediaQuery.paddingOf(context).bottom + 12,
      ),
      decoration: BoxDecoration(
        color: AppColors.raisedSurface,
        border: Border(top: BorderSide(color: AppColors.borderColor)),
      ),
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton.icon(
          onPressed: isSaving || isClosed ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: LiquidacionBrand.greenDark,
            foregroundColor: AppColors.themedWhite,
            disabledBackgroundColor: AppColors.mutedPanel,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            ),
            elevation: 0,
          ),
          icon: isSaving
              ? SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.themedWhite,
                  ),
                )
              : Icon(isClosed ? Icons.lock_rounded : Icons.lock_open_rounded),
          label: Text(
            isClosed
                ? 'Liquidación cerrada'
                : 'Cerrar día y grabar liquidación',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
        ),
      ),
    );
  }
}
