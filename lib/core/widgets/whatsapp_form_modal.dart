import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// ---------------------------------------------------------------------------
/// WhatsApp form modal
/// ---------------------------------------------------------------------------
///
/// Modal con formulario para compartir por WhatsApp.
/// Campos: teléfono (validado +34), mensaje personalizado.
///
/// Usa Share nativo (gratis) para adjuntar el PDF al compartir.
///
/// Uso:
///   final result = await WhatsAppFormModal.show(
///     context,
///     defaultMessage: 'Le adjunto la factura FAV-1234',
///   );
///   if (result != null) {
///     // result.phone, result.message
///     // -> use Share.shareXFiles with the PDF
///   }
/// ---------------------------------------------------------------------------

class WhatsAppFormResult {
  const WhatsAppFormResult({
    required this.phone,
    required this.message,
  });
  final String phone;
  final String message;
}

class WhatsAppFormModal extends StatefulWidget {
  const WhatsAppFormModal({
    super.key,
    this.defaultMessage = '',
  });
  final String defaultMessage;

  /// Show the modal and return the form result, or null if cancelled
  static Future<WhatsAppFormResult?> show(
    BuildContext context, {
    String defaultMessage = '',
  }) {
    return showDialog<WhatsAppFormResult>(
      context: context,
      builder: (ctx) => WhatsAppFormModal(defaultMessage: defaultMessage),
    );
  }

  @override
  State<WhatsAppFormModal> createState() => _WhatsAppFormModalState();
}

class _WhatsAppFormModalState extends State<WhatsAppFormModal> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _phoneController;
  late final TextEditingController _messageController;

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController(text: '+34');
    _messageController = TextEditingController(text: widget.defaultMessage);
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  String? _validatePhone(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'El teléfono es obligatorio';
    }
    // Remove spaces, dashes, parentheses
    final cleaned = value.replaceAll(RegExp(r'[\s\-\(\)]'), '');
    // Must start with + and have at least 9 digits
    if (!RegExp(r'^\+?\d{9,15}$').hasMatch(cleaned)) {
      return 'Formato inválido. Ej: +34612345678';
    }
    return null;
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      final cleanPhone =
          _phoneController.text.replaceAll(RegExp(r'[\s\-\(\)]'), '');
      Navigator.pop(
        context,
        WhatsAppFormResult(
          phone: cleanPhone,
          message: _messageController.text.trim(),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    const whatsAppGreen = AppColors.whatsappGreen;

    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: Responsive.clampWidth(context, 400),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: whatsAppGreen.withValues(alpha: 0.3)),
          boxShadow: [
            BoxShadow(
              color: whatsAppGreen.withValues(alpha: 0.15),
              blurRadius: 30,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: whatsAppGreen.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child:
                        const Icon(Icons.chat, color: whatsAppGreen, size: 22),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Text(
                      'Compartir por WhatsApp',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(
                      Icons.close,
                      color: AppTheme.textSecondary,
                      size: 20,
                    ),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Padding(
                padding: EdgeInsets.only(left: 2),
                child: Text(
                  'Se compartirá el PDF automáticamente. Seleccione WhatsApp en el menú que aparece.',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 12),
                ),
              ),
              const SizedBox(height: 20),

              // Phone field
              _buildLabel('Teléfono *'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                validator: _validatePhone,
                autofocus: true,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[\d\+\s\-\(\)]')),
                ],
                style:
                    const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                decoration: _inputDecoration(
                  hint: '+34 612 345 678',
                  icon: Icons.phone,
                  borderColor: whatsAppGreen,
                ),
              ),
              const SizedBox(height: 16),

              // Message field
              _buildLabel('Mensaje personalizado'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _messageController,
                maxLines: 3,
                style:
                    const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                decoration: _inputDecoration(
                  hint: 'Escriba un mensaje...',
                  icon: Icons.message_outlined,
                  borderColor: whatsAppGreen,
                ),
              ),
              const SizedBox(height: 24),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    style: TextButton.styleFrom(
                      foregroundColor: AppTheme.textSecondary,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 12,
                      ),
                    ),
                    child: const Text('Cancelar'),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton.icon(
                    onPressed: _submit,
                    icon: const Icon(Icons.send_rounded, size: 18),
                    label: const Text('Compartir'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: whatsAppGreen,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 24,
                        vertical: 12,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
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

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: AppTheme.textSecondary,
        fontSize: 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String hint,
    required IconData icon,
    Color borderColor = AppTheme.info,
  }) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(
        color: AppTheme.textSecondary.withValues(alpha: 0.5),
        fontSize: 13,
      ),
      prefixIcon: Icon(icon, color: AppTheme.textSecondary, size: 18),
      filled: true,
      fillColor: AppTheme.inkSurface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide:
            BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.5)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide:
            BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.3)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: borderColor, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppTheme.error),
      ),
    );
  }
}
