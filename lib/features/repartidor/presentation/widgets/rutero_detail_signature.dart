import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:signature/signature.dart';

class RuteroDetailSignature extends StatelessWidget {
  const RuteroDetailSignature({
    required this.signatureController,
    required this.firmaError,
    super.key,
  });

  final SignatureController signatureController;
  final String? firmaError;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Icon(Icons.draw, color: AppTheme.info, size: 20),
                SizedBox(width: 8),
                Text(
                  'FIRMA DEL CLIENTE *',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            TextButton.icon(
              onPressed: signatureController.clear,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Borrar'),
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.error,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          height: Responsive.isLandscape(context)
              ? 120.0
              : Responsive.value(context, phone: 120, desktop: 160),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: firmaError != null ? AppTheme.error : AppTheme.borderColor,
              width: firmaError != null ? 2 : 1,
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Signature(
              controller: signatureController,
              backgroundColor: Colors.white,
            ),
          ),
        ),
        if (firmaError != null) ...[
          const SizedBox(height: 6),
          Text(
            firmaError!,
            style: const TextStyle(color: AppTheme.error, fontSize: 12),
          ),
        ],
      ],
    );
  }
}

class RuteroDetailSignaturePanel extends StatelessWidget {
  const RuteroDetailSignaturePanel({
    required this.signatureController,
    required this.firmaError,
    required this.isSubmitting,
    required this.onSubmit,
    required this.getPaymentTypeLabel,
    required this.isUrgent,
    super.key,
  });

  final SignatureController signatureController;
  final String? firmaError;
  final bool isSubmitting;
  final VoidCallback onSubmit;
  final String Function() getPaymentTypeLabel;
  final bool isUrgent;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: isSubmitting ? null : onSubmit,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.success,
            foregroundColor: Colors.white,
            disabledBackgroundColor: AppTheme.success,
            disabledForegroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 18),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            ),
          ),
          child: isSubmitting
              ? const SizedBox(
                  height: 24,
                  width: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
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
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}
