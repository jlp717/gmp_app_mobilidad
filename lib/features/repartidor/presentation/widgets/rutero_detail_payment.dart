import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_standalone_cobro.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_tab_bar.dart';
import 'package:intl/intl.dart';

String ruteroPaymentMethodLabel(String method, {bool compact = false}) {
  switch (method) {
    case 'EFECTIVO':
      return 'Efectivo';
    case 'TARJETA':
      return 'Tarjeta';
    case 'BIZUM':
      return 'Bizum';
    case 'TRANSFERENCIA':
      return compact ? 'Transf.' : 'Transferencia';
    default:
      return method;
  }
}

/// User-facing scope label: document cobrable vs deuda global del cliente.
String ruteroDocumentScopePhrase(AlbaranEntrega albaran) =>
    albaran.numeroFactura > 0 ? 'esta factura' : 'este albarán';

String ruteroDocumentScopeTitle(AlbaranEntrega albaran) =>
    albaran.numeroFactura > 0 ? 'Esta factura' : 'Este albarán';

class RuteroDetailPayment extends StatelessWidget {
  const RuteroDetailPayment({
    required this.albaran,
    required this.selectedPaymentMethod,
    required this.isPaid,
    required this.pagoError,
    required this.importeCobradoController,
    required this.importeCobradoError,
    required this.onPaymentMethodChanged,
    required this.onPaidChanged,
    required this.onContinueToFinalize,
    required this.getPaymentTypeLabel,
    this.notasController,
    this.importeFieldKey,
    this.errorBannerKey,
    this.highlightPayment = false,
    this.scrollController,
    this.importeFocusNode,
    this.canRegisterCobro = false,
    this.isRegisteringCobro = false,
    this.sendEmail = false,
    this.onSendEmailChanged,
    this.onRegisterCobro,
    this.showDeliveryPrepToggle = true,
    this.showContinueToFinalize = true,
    super.key,
  });

  final AlbaranEntrega albaran;
  final String selectedPaymentMethod;
  final bool isPaid;
  final String? pagoError;
  final TextEditingController importeCobradoController;
  final String? importeCobradoError;
  final void Function(String method) onPaymentMethodChanged;
  final VoidCallback onPaidChanged;
  final VoidCallback onContinueToFinalize;
  final String Function() getPaymentTypeLabel;
  final TextEditingController? notasController;
  final Key? importeFieldKey;
  final Key? errorBannerKey;
  final bool highlightPayment;
  final ScrollController? scrollController;
  final FocusNode? importeFocusNode;
  final bool canRegisterCobro;
  final bool isRegisteringCobro;
  final bool sendEmail;
  final ValueChanged<bool>? onSendEmailChanged;
  final VoidCallback? onRegisterCobro;
  final bool showDeliveryPrepToggle;
  final bool showContinueToFinalize;

  bool get _isUrgent => albaran.esCTR;
  bool get _hasCollectibleBalance => albaran.tieneSaldoCobrable;

  bool get _methodsEnabled => _hasCollectibleBalance && !isRegisteringCobro;

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.padding(context, small: 14, large: 20);
    final viewInsets = MediaQuery.viewInsetsOf(context);
    final safeBottom = MediaQuery.paddingOf(context).bottom;
    final bottomPadding =
        12 + viewInsets.bottom + (viewInsets.bottom > 0 ? 8 : safeBottom);
    return SafeArea(
      top: false,
      minimum: EdgeInsets.zero,
      child: SingleChildScrollView(
        controller: scrollController,
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(
          horizontalPadding,
          12,
          horizontalPadding,
          bottomPadding,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (pagoError != null || importeCobradoError != null) ...[
              RuteroErrorSpotlight(
                key: errorBannerKey,
                active: highlightPayment,
                message: pagoError ?? importeCobradoError,
                child: const SizedBox.shrink(),
              ),
              const SizedBox(height: 12),
            ],
            _buildAmountCard(context),
            const SizedBox(height: 20),
            _buildPaymentMethodSelector(context),
            if (_hasCollectibleBalance) ...[
              const SizedBox(height: 20),
              _buildCollectedAmountField(),
              if (notasController != null) ...[
                const SizedBox(height: 12),
                _buildNotesField(),
              ],
              if (onSendEmailChanged != null) ...[
                const SizedBox(height: 12),
                _buildEmailToggle(),
              ],
              if (onRegisterCobro != null) ...[
                const SizedBox(height: 16),
                _buildRegisterButton(),
              ],
            ],
            if (showDeliveryPrepToggle) ...[
              const SizedBox(height: 12),
              _buildMarkAsPaid(),
            ],
            if (showContinueToFinalize) ...[
              const SizedBox(height: 16),
              _buildContinueButton(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildAmountCard(BuildContext context) {
    final compact = Responsive.isSmall(context);
    final paymentType = getPaymentTypeLabel();
    final collectable = effectiveDocumentCollectable(albaran);
    final documentTotal = albaran.importeTotal;
    final scopePhrase = ruteroDocumentScopePhrase(albaran);
    final scopeTitle = ruteroDocumentScopeTitle(albaran);
    final showsDocumentTotal = _hasCollectibleBalance &&
        !albaran.isPendingPrice &&
        (documentTotal - collectable).abs() > 0.01;
    final currency = NumberFormat.currency(symbol: '€', locale: 'es_ES');
    return Semantics(
      label: _hasCollectibleBalance
          ? 'Saldo cobrable de $scopePhrase, '
              '${currency.format(collectable)}'
          : 'Sin saldo cobrable en $scopePhrase',
      child: RepartidorExecutivePanel(
        padding: EdgeInsets.all(compact ? 14 : 18),
        accentColor: _isUrgent ? AppTheme.error : AppTheme.success,
        child: Column(
          children: [
            Text(
              'Saldo cobrable de $scopePhrase',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: compact ? 11 : 12,
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              albaran.isPendingPrice
                  ? 'Pendiente de precio'
                  : _hasCollectibleBalance
                      ? currency.format(collectable)
                      : 'Sin saldo cobrable',
              style: TextStyle(
                color: albaran.isPendingPrice
                    ? AppTheme.warning
                    : _isUrgent
                        ? AppTheme.error
                        : AppTheme.textPrimary,
                fontSize: Responsive.fontSize(context, small: 26, large: 36),
                fontWeight: FontWeight.bold,
              ),
            ),
            if (showsDocumentTotal) ...[
              const SizedBox(height: 6),
              Text(
                'Total de $scopePhrase: ${currency.format(documentTotal)}',
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: compact ? 10 : 11,
                  fontWeight: FontWeight.w500,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            if (_hasCollectibleBalance &&
                albaran.cobroSaldoCapped &&
                (albaran.importeCvcPendiente ?? 0) > collectable + 0.004) ...[
              const SizedBox(height: 8),
              Text(
                'Deuda total del cliente: '
                '${currency.format(albaran.importeCvcPendiente)}. '
                'Solo puedes cobrar el saldo de $scopePhrase.',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: compact ? 10 : 11,
                  height: 1.35,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.center,
              child: Container(
                width: double.infinity,
                padding: EdgeInsets.symmetric(
                  horizontal: compact ? 10 : 14,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: (albaran.isPendingPrice
                          ? AppTheme.warning
                          : _isUrgent
                              ? AppTheme.error
                              : AppTheme.success)
                      .withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      albaran.isPendingPrice
                          ? Icons.hourglass_top
                          : _isUrgent
                              ? Icons.priority_high
                              : Icons.info_outline,
                      size: 15,
                      color: albaran.isPendingPrice
                          ? AppTheme.warning
                          : _isUrgent
                              ? AppTheme.error
                              : AppTheme.success,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        albaran.isPendingPrice
                            ? 'Precio pendiente en ERP'
                            : !_hasCollectibleBalance
                                ? 'Sin saldo cobrable en $scopePhrase'
                                : _isUrgent
                                    ? 'Cobro obligatorio · $paymentType'
                                    : 'Cobro opcional · $paymentType',
                        style: TextStyle(
                          color: albaran.isPendingPrice
                              ? AppTheme.warning
                              : !_hasCollectibleBalance
                                  ? AppTheme.textSecondary
                                  : _isUrgent
                                      ? AppTheme.error
                                      : AppTheme.success,
                          fontSize: compact ? 10 : 11,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPaymentMethodSelector(BuildContext context) {
    final compact = Responsive.isSmall(context);
    final gap = compact ? 8.0 : 10.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Método de pago',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        SizedBox(height: compact ? 8 : 10),
        Row(
          children: [
            Expanded(
              child: _buildPaymentOption(
                context,
                'EFECTIVO',
                Icons.money,
              ),
            ),
            SizedBox(width: gap),
            Expanded(
              child: _buildPaymentOption(
                context,
                'TARJETA',
                Icons.credit_card,
              ),
            ),
          ],
        ),
        SizedBox(height: gap),
        Row(
          children: [
            Expanded(
              child: _buildPaymentOption(
                context,
                'BIZUM',
                Icons.phone_android,
              ),
            ),
            SizedBox(width: gap),
            Expanded(
              child: _buildPaymentOption(
                context,
                'TRANSFERENCIA',
                Icons.account_balance,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPaymentOption(
    BuildContext context,
    String method,
    IconData icon,
  ) {
    final compact = Responsive.isSmall(context);
    final isSelected = selectedPaymentMethod == method;
    final visibleLabel = ruteroPaymentMethodLabel(method, compact: compact);

    return Semantics(
      button: true,
      selected: isSelected,
      enabled: _methodsEnabled,
      label: 'Método de pago $visibleLabel',
      child: GestureDetector(
        onTap: _methodsEnabled
            ? () {
                HapticFeedback.selectionClick();
                onPaymentMethodChanged(method);
              }
            : null,
        child: RepartidorExecutivePanel(
          accentColor: AppTheme.info,
          selected: isSelected,
          padding: EdgeInsets.symmetric(
            vertical: compact ? 10 : 12,
            horizontal: 2,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                color: isSelected ? AppTheme.info : AppTheme.textSecondary,
                size: compact ? 20 : 24,
              ),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  visibleLabel,
                  style: TextStyle(
                    color: isSelected ? AppTheme.info : AppTheme.textSecondary,
                    fontWeight: FontWeight.w600,
                    fontSize: compact ? 10 : 11,
                  ),
                  maxLines: 1,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMarkAsPaid() {
    final scopePhrase = ruteroDocumentScopePhrase(albaran);
    final scopeTitle = ruteroDocumentScopeTitle(albaran);
    final methodLabel = ruteroPaymentMethodLabel(selectedPaymentMethod);
    return Semantics(
      button: true,
      toggled: isPaid && _hasCollectibleBalance,
      enabled: _methodsEnabled,
      label: !_hasCollectibleBalance
          ? 'Sin saldo cobrable. Entrega sin cobro'
          : isPaid
              ? 'Cobro preparado con $methodLabel'
              : 'Preparar cobro con la entrega',
      child: InkWell(
        onTap: _methodsEnabled
            ? () {
                HapticFeedback.selectionClick();
                onPaidChanged();
              }
            : null,
        borderRadius: BorderRadius.circular(12),
        child: RepartidorExecutivePanel(
          accentColor: _hasCollectibleBalance
              ? AppTheme.success
              : AppTheme.textSecondary,
          selected: isPaid && _hasCollectibleBalance,
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              AnimatedContainer(
                duration: AppTheme.animFast,
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: isPaid && _hasCollectibleBalance
                      ? AppTheme.success
                      : AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isPaid && _hasCollectibleBalance
                        ? AppTheme.success
                        : AppTheme.borderColor,
                    width: 2,
                  ),
                ),
                child: isPaid
                    ? Icon(Icons.check, color: AppColors.themedWhite, size: 16)
                    : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Preparar cobro con la entrega',
                      style: TextStyle(
                        color: isPaid && _hasCollectibleBalance
                            ? AppTheme.success
                            : AppTheme.textPrimary,
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      !_hasCollectibleBalance
                          ? '$scopeTitle no tiene saldo cobrable. Puedes entregar sin cobrar.'
                          : isPaid
                              ? 'Cobro preparado con $methodLabel'
                              : 'Opcional salvo cobro obligatorio. No registra el cobro hasta confirmar.',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 11,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              if (isPaid && _hasCollectibleBalance)
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withValues(alpha: 0.2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.check_circle,
                    color: AppTheme.success,
                    size: 22,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCollectedAmountField() {
    return RuteroErrorSpotlight(
      key: importeFieldKey,
      active: highlightPayment && importeCobradoError != null,
      message: importeCobradoError,
      child: TextField(
        focusNode: importeFocusNode,
        controller: importeCobradoController,
        enabled: !isRegisteringCobro,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp('[0-9,.]')),
        ],
        style: TextStyle(
          color: AppTheme.textPrimary,
          fontWeight: FontWeight.bold,
        ),
        decoration: ruteroErrorInputDecoration(
          label: 'Importe cobrado de ${ruteroDocumentScopePhrase(albaran)}',
          suffixText: '€',
          errorText: importeCobradoError,
        ),
      ),
    );
  }

  Widget _buildNotesField() {
    return TextField(
      controller: notasController,
      enabled: !isRegisteringCobro,
      maxLength: 60,
      style: TextStyle(color: AppTheme.textPrimary),
      decoration: InputDecoration(
        labelText: 'Anotación (opcional)',
        counterStyle: TextStyle(color: AppTheme.textTertiary, fontSize: 11),
        labelStyle: TextStyle(color: AppTheme.textSecondary),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppTheme.borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppTheme.info),
        ),
      ),
    );
  }

  Widget _buildEmailToggle() {
    final email = albaran.emailCliente.trim();
    final hasEmail = email.isNotEmpty;
    return Semantics(
      toggled: sendEmail,
      label: 'Enviar documento por email',
      child: SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        value: sendEmail && hasEmail,
        onChanged: !hasEmail || isRegisteringCobro ? null : onSendEmailChanged,
        activeColor: AppTheme.info,
        title: Text(
          'Enviar documento por email',
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
        subtitle: Text(
          hasEmail ? email : 'Este cliente no tiene email en ficha',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }

  Widget _buildRegisterButton() {
    return Semantics(
      button: true,
      enabled: canRegisterCobro && !isRegisteringCobro,
      label: 'Registrar cobro',
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: canRegisterCobro && !isRegisteringCobro
              ? () {
                  HapticFeedback.mediumImpact();
                  onRegisterCobro?.call();
                }
              : null,
          icon: isRegisteringCobro
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.payments, size: 20),
          label: Text(
            isRegisteringCobro ? 'Registrando…' : 'Registrar cobro',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.success,
            foregroundColor: AppColors.themedWhite,
            disabledBackgroundColor: AppTheme.softPanel,
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContinueButton() {
    return Semantics(
      button: true,
      enabled: !isRegisteringCobro,
      label: 'Continuar a finalizar entrega',
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: isRegisteringCobro
              ? null
              : () {
                  HapticFeedback.mediumImpact();
                  onContinueToFinalize();
                },
          icon: const Icon(Icons.arrow_forward, size: 20),
          label: const Text(
            'Continuar a finalizar',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.info,
            foregroundColor: AppColors.themedWhite,
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
    );
  }
}
