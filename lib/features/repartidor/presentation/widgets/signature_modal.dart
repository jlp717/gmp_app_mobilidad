/// SIGNATURE MODAL WIDGET
/// Pantalla completa para captura de firma digital del cliente
/// Utiliza el paquete 'signature' para canvas-based drawing
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_operation_safety.dart';
import 'package:signature/signature.dart';

/// Modal de firma digital para captura de firma del cliente
/// Retorna la firma como base64 string o null si se cancela
class SignatureModal extends StatefulWidget {
  const SignatureModal({
    super.key,
    this.title = 'Firma del Cliente',
    this.subtitle = 'Por favor, firme dentro del recuadro',
    this.onCancel,
    this.onConfirm,
  });
  final String title;
  final String subtitle;
  final VoidCallback? onCancel;
  final Function(String base64Signature)? onConfirm;

  /// Muestra el modal y retorna la firma como base64 o null
  static Future<String?> show(
    BuildContext context, {
    String title = 'Firma del Cliente',
    String subtitle = 'Por favor, firme dentro del recuadro',
  }) async {
    return showModalBottomSheet<String?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => SignatureModal(title: title, subtitle: subtitle),
    );
  }

  @override
  State<SignatureModal> createState() => _SignatureModalState();
}

class _SignatureModalState extends State<SignatureModal> {
  late SignatureController _controller;
  bool _isEmpty = true;

  @override
  void initState() {
    super.initState();
    _controller = SignatureController(
      exportBackgroundColor: Colors.white,
    );

    _controller.addListener(() {
      if (mounted) {
        setState(() {
          _isEmpty = _controller.isEmpty;
        });
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _confirmSignature() async {
    if (_controller.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Por favor, firme antes de confirmar'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    try {
      // Exportar firma como PNG bytes
      final signatureBytes = await _controller.toPngBytes();
      if (signatureBytes != null) {
        // Convertir a base64
        final base64Signature = base64Encode(signatureBytes);

        if (widget.onConfirm != null) {
          widget.onConfirm!(base64Signature);
        }

        if (mounted) {
          Navigator.of(context).pop(base64Signature);
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              repartidorSafeOperationMessage(
                error: error,
                operation: 'signature',
              ),
            ),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  void _clearSignature() {
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return RepartidorExecutiveSheet(
      height: Responsive.modalHeight(context),
      accentColor: AppTheme.info,
      child: Column(
        children: [
          // Header (responsive padding)
          Padding(
            padding: EdgeInsets.all(
                Responsive.padding(context, small: 12, large: 20)),
            child: Column(
              children: [
                Row(
                  children: [
                    const RepartidorExecutiveIcon(
                      icon: Icons.edit_note,
                      color: AppTheme.info,
                      size: 24,
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.title,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            widget.subtitle,
                            style: TextStyle(
                              fontSize: 13,
                              color:
                                  AppTheme.textSecondary.withValues(alpha: 0.8),
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Clear button
                    IconButton(
                      onPressed: _clearSignature,
                      icon: const Icon(Icons.refresh),
                      color: AppTheme.textSecondary,
                      tooltip: 'Limpiar',
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Signature Canvas
          Expanded(
            child: RepartidorExecutivePanel(
              margin: const EdgeInsets.symmetric(horizontal: 20),
              accentColor: _isEmpty ? AppTheme.info : AppTheme.success,
              padding: EdgeInsets.zero,
              borderRadius: AppTheme.radiusLg,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                child: Stack(
                  children: [
                    // Signature pad
                    Signature(
                      controller: _controller,
                      backgroundColor: Colors.white,
                    ),

                    // Placeholder text when empty
                    if (_isEmpty)
                      Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.gesture,
                              size: 48,
                              color:
                                  AppTheme.textTertiary.withValues(alpha: 0.45),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'Firme aquí',
                              style: TextStyle(
                                fontSize: 16,
                                color: AppTheme.textTertiary
                                    .withValues(alpha: 0.7),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),

          // Action Buttons (responsive padding)
          Padding(
            padding: EdgeInsets.all(
                Responsive.padding(context, small: 12, large: 20)),
            child: Row(
              children: [
                // Cancel button
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      widget.onCancel?.call();
                      Navigator.of(context).pop();
                    },
                    icon: const Icon(Icons.close),
                    label: const Text('Cancelar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.textSecondary,
                      side: const BorderSide(color: AppTheme.borderColor),
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
                    ),
                  ),
                ),

                const SizedBox(width: 16),

                // Confirm button
                Expanded(
                  flex: 2,
                  child: ElevatedButton.icon(
                    onPressed: _isEmpty ? null : _confirmSignature,
                    icon: const Icon(Icons.check),
                    label: const Text('Confirmar Firma'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor:
                          _isEmpty ? AppTheme.softPanel : AppTheme.success,
                      disabledBackgroundColor: AppTheme.softPanel,
                      disabledForegroundColor: AppTheme.textTertiary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Safe area bottom padding
          SizedBox(height: MediaQuery.of(context).padding.bottom),
        ],
      ),
    );
  }
}
