import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_tab_bar.dart';
import 'package:intl/intl.dart';

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
    this.importeFieldKey,
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
  final Key? importeFieldKey;

  bool get _isUrgent => albaran.esCTR;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (pagoError != null || importeCobradoError != null) ...[
            _buildPaymentError(
              pagoError ?? importeCobradoError ?? '',
            ),
            const SizedBox(height: 16),
          ],
          _buildAmountCard(context),
          const SizedBox(height: 24),
          _buildPaymentMethodSelector(),
          const SizedBox(height: 24),
          _buildMarkAsPaid(),
          if (isPaid) ...[
            const SizedBox(height: 16),
            _buildCollectedAmountField(),
          ],
          const SizedBox(height: 24),
          _buildContinueButton(),
        ],
      ),
    );
  }

  Widget _buildAmountCard(BuildContext context) {
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.all(24),
      accentColor: _isUrgent ? AppTheme.error : AppTheme.success,
      child: Column(
        children: [
          const Text(
            'TOTAL A COBRAR',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            NumberFormat.currency(symbol: '€', locale: 'es_ES')
                .format(albaran.importeTotal),
            style: TextStyle(
              color: _isUrgent ? AppTheme.error : AppTheme.textPrimary,
              fontSize: Responsive.fontSize(context, small: 28, large: 42),
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: (_isUrgent ? AppTheme.error : AppTheme.success)
                  .withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _isUrgent ? Icons.priority_high : Icons.info_outline,
                  size: 16,
                  color: _isUrgent ? AppTheme.error : AppTheme.success,
                ),
                const SizedBox(width: 8),
                Text(
                  _isUrgent
                      ? 'COBRO OBLIGATORIO - ${getPaymentTypeLabel()}'
                      : 'COBRO OPCIONAL - ${getPaymentTypeLabel()}',
                  style: TextStyle(
                    color: _isUrgent ? AppTheme.error : AppTheme.success,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentMethodSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'MÉTODO DE PAGO',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildPaymentOption('EFECTIVO', Icons.money)),
            const SizedBox(width: 12),
            Expanded(
              child: _buildPaymentOption('TARJETA', Icons.credit_card),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildPaymentOption('BIZUM', Icons.phone_android),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildPaymentOption(
                'TRANSFERENCIA',
                Icons.account_balance,
                label: 'Transferencia',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPaymentOption(
    String method,
    IconData icon, {
    String? label,
  }) {
    final isSelected = selectedPaymentMethod == method;

    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        onPaymentMethodChanged(method);
      },
      child: RepartidorExecutivePanel(
        accentColor: AppTheme.info,
        selected: isSelected,
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          children: [
            Icon(
              icon,
              color: isSelected ? AppTheme.info : AppTheme.textSecondary,
              size: 28,
            ),
            const SizedBox(height: 8),
            Text(
              label ?? method,
              style: TextStyle(
                color: isSelected ? AppTheme.info : AppTheme.textSecondary,
                fontWeight: FontWeight.bold,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMarkAsPaid() {
    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        onPaidChanged();
      },
      borderRadius: BorderRadius.circular(12),
      child: RepartidorExecutivePanel(
        accentColor: AppTheme.success,
        selected: isPaid,
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            AnimatedContainer(
              duration: AppTheme.animFast,
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: isPaid ? AppTheme.success : AppTheme.softPanel,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: isPaid ? AppTheme.success : AppTheme.borderColor,
                  width: 2,
                ),
              ),
              child: isPaid
                  ? const Icon(Icons.check, color: Colors.white, size: 18)
                  : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'MARCAR COMO COBRADO',
                    style: TextStyle(
                      color: isPaid ? AppTheme.success : AppTheme.textPrimary,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    isPaid
                        ? 'Cobro preparado con $selectedPaymentMethod'
                        : 'Confirmar recepción del pago',
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            if (isPaid)
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_circle,
                  color: AppTheme.success,
                  size: 24,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildCollectedAmountField() {
    return TextField(
      key: importeFieldKey,
      controller: importeCobradoController,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]')),
      ],
      style: const TextStyle(
        color: AppTheme.textPrimary,
        fontWeight: FontWeight.bold,
      ),
      decoration: ruteroErrorInputDecoration(
        label: 'Importe cobrado',
        suffixText: 'EUR',
        errorText: importeCobradoError,
      ),
    );
  }

  Widget _buildPaymentError(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.error.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.error, width: 1.6),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            color: AppTheme.error,
            size: 22,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppTheme.error,
                fontSize: 14,
                fontWeight: FontWeight.w800,
                height: 1.3,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildContinueButton() {
    return ElevatedButton.icon(
      onPressed: () {
        HapticFeedback.mediumImpact();
        onContinueToFinalize();
      },
      icon: const Icon(Icons.arrow_forward),
      label: const Text('CONTINUAR A FINALIZAR'),
      style: ElevatedButton.styleFrom(
        backgroundColor: AppTheme.info,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }
}
