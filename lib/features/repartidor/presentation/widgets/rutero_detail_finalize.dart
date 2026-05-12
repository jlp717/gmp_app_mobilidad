import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_signature.dart';

class RuteroDetailFinalize extends StatelessWidget {
  const RuteroDetailFinalize({
    required this.albaran,
    required this.items,
    required this.productQuantities,
    required this.nombreController,
    required this.dniController,
    required this.observacionesController,
    required this.signatureController,
    required this.nombreError,
    required this.dniError,
    required this.firmaError,
    required this.observacionesError,
    required this.suggestedNames,
    required this.suggestedDnis,
    required this.hasDiscrepancy,
    required this.isSubmitting,
    required this.isUrgent,
    required this.onSubmit,
    required this.getPaymentTypeLabel,
    required this.buildPrinterConfigSection,
    super.key,
  });

  final AlbaranEntrega albaran;
  final List<EntregaItem> items;
  final Map<String, int> productQuantities;
  final TextEditingController nombreController;
  final TextEditingController dniController;
  final TextEditingController observacionesController;
  final SignatureController signatureController;
  final String? nombreError;
  final String? dniError;
  final String? firmaError;
  final String? observacionesError;
  final List<String> suggestedNames;
  final List<String> suggestedDnis;
  final bool hasDiscrepancy;
  final bool isSubmitting;
  final bool isUrgent;
  final VoidCallback onSubmit;
  final String Function() getPaymentTypeLabel;
  final Widget Function() buildPrinterConfigSection;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildReceiverData(context),
          const SizedBox(height: 16),
          if (hasDiscrepancy) ...[
            _buildDiscrepancyWarning(),
            const SizedBox(height: 12),
          ],
          _buildObservaciones(),
          const SizedBox(height: 12),
          buildPrinterConfigSection(),
          const SizedBox(height: 20),
          RuteroDetailSignature(
            signatureController: signatureController,
            firmaError: firmaError,
          ),
          const SizedBox(height: 24),
          _buildSubmitButton(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildReceiverData(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.person, color: AppTheme.neonBlue, size: 20),
              SizedBox(width: 8),
              Text(
                'DATOS DEL RECEPTOR',
                style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                  letterSpacing: 1,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          RawAutocomplete<String>(
            textEditingController: nombreController,
            focusNode: FocusNode(),
            optionsBuilder: (TextEditingValue textEditingValue) {
              if (textEditingValue.text.isEmpty) {
                return const Iterable<String>.empty();
              }
              return suggestedNames.where((String option) {
                return option
                    .toUpperCase()
                    .contains(textEditingValue.text.toUpperCase());
              });
            },
            fieldViewBuilder:
                (context, controller, focusNode, onEditingComplete) {
              return TextField(
                controller: controller,
                focusNode: focusNode,
                onEditingComplete: onEditingComplete,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: InputDecoration(
                  labelText: 'Nombre y Apellidos *',
                  prefixIcon: const Icon(Icons.person_outline, size: 20),
                  filled: true,
                  fillColor: AppTheme.darkBase,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  errorText: nombreError,
                  errorStyle: const TextStyle(color: AppTheme.error),
                ),
              );
            },
            optionsViewBuilder: (context, onSelected, options) {
              return Align(
                alignment: Alignment.topLeft,
                child: Material(
                  elevation: 4,
                  color: AppTheme.darkCard,
                  child: SizedBox(
                    height: 200,
                    width: MediaQuery.of(context).size.width -
                        Responsive.value(context, phone: 40, desktop: 80),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(8),
                      itemCount: options.length,
                      itemBuilder: (BuildContext context, int index) {
                        final option = options.elementAt(index);
                        return ListTile(
                          tileColor: AppTheme.darkBase,
                          title: Text(option,
                              style: const TextStyle(
                                color: AppTheme.textPrimary,
                              )),
                          onTap: () {
                            onSelected(option);
                          },
                        );
                      },
                    ),
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          RawAutocomplete<String>(
            textEditingController: dniController,
            focusNode: FocusNode(),
            optionsBuilder: (TextEditingValue textEditingValue) {
              if (textEditingValue.text.isEmpty) {
                return const Iterable<String>.empty();
              }
              return suggestedDnis.where((String option) {
                return option
                    .toUpperCase()
                    .contains(textEditingValue.text.toUpperCase());
              });
            },
            fieldViewBuilder:
                (context, controller, focusNode, onEditingComplete) {
              return TextField(
                controller: controller,
                focusNode: focusNode,
                onEditingComplete: onEditingComplete,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: InputDecoration(
                  labelText: 'DNI / NIF *',
                  prefixIcon: const Icon(Icons.badge_outlined, size: 20),
                  filled: true,
                  fillColor: AppTheme.darkBase,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  errorText: dniError,
                  errorStyle: const TextStyle(color: AppTheme.error),
                ),
              );
            },
            optionsViewBuilder: (context, onSelected, options) {
              return Align(
                alignment: Alignment.topLeft,
                child: Material(
                  elevation: 4,
                  color: AppTheme.darkCard,
                  child: SizedBox(
                    height: 200,
                    width: MediaQuery.of(context).size.width -
                        Responsive.value(context, phone: 40, desktop: 80),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(8),
                      itemCount: options.length,
                      itemBuilder: (BuildContext context, int index) {
                        final option = options.elementAt(index);
                        return ListTile(
                          tileColor: AppTheme.darkBase,
                          title: Text(option,
                              style: const TextStyle(
                                color: AppTheme.textPrimary,
                              )),
                          onTap: () {
                            onSelected(option);
                          },
                        );
                      },
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildDiscrepancyWarning() {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.15),
        border: Border.all(color: Colors.orange),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text(
        'ATENCIÓN: Si marca en verde sin modificar cantidades, '
        'la entrega está OK. Si modifica o quita cantidades, la '
        'entrega NO coincide â€” debe añadir observaciones en la '
        "pestaña 'Observaciones' antes de confirmar.",
        style: TextStyle(
          color: Colors.orange,
          fontSize: 13,
        ),
      ),
    );
  }

  Widget _buildObservaciones() {
    return TextField(
      controller: observacionesController,
      maxLines: 3,
      style: const TextStyle(color: AppTheme.textPrimary),
      decoration: InputDecoration(
        labelText: 'Observaciones',
        hintText: 'Añadir nota sobre la entrega...',
        alignLabelWithHint: true,
        errorText: observacionesError,
        filled: true,
        fillColor: AppTheme.darkCard,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    );
  }

  Widget _buildSubmitButton() {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppTheme.neonBlue, AppTheme.neonCyan],
        ),
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonBlue.withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ElevatedButton(
        onPressed: isSubmitting ? null : onSubmit,
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          foregroundColor: AppTheme.darkBase,
          padding: const EdgeInsets.symmetric(vertical: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        child: isSubmitting
            ? const SizedBox(
                height: 24,
                width: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppTheme.darkBase,
                ),
              )
            : const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.check_circle, size: 24),
                  SizedBox(width: 12),
                  Text(
                    'CONFIRMAR ENTREGA',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
