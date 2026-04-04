import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../utils/responsive.dart';

/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/// 📧 EMAIL FORM MODAL
/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
///
/// Modal con formulario de envío de email.
/// Campos: destinatario (validado), asunto (pre-rellenado), cuerpo (opcional).
///
/// Uso:
///   final result = await EmailFormModal.show(
///     context,
///     defaultSubject: 'Factura FAV-1234 - Granja Mari Pepa',
///     defaultBody: 'Adjunto le remitimos la factura...',
///   );
///   if (result != null) {
///     // result.email, result.subject, result.body
///   }
/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class EmailFormResult {
  final String email;
  final String subject;
  final String body;

  const EmailFormResult({
    required this.email,
    required this.subject,
    required this.body,
  });
}

class EmailFormModal extends StatefulWidget {
  final String defaultSubject;
  final String defaultBody;

  const EmailFormModal({
    super.key,
    this.defaultSubject = '',
    this.defaultBody = '',
  });

  /// Show the modal and return the form result, or null if cancelled
  static Future<EmailFormResult?> show(
    BuildContext context, {
    String defaultSubject = '',
    String defaultBody = '',
  }) {
    return showDialog<EmailFormResult>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => EmailFormModal(
        defaultSubject: defaultSubject,
        defaultBody: defaultBody,
      ),
    );
  }

  @override
  State<EmailFormModal> createState() => _EmailFormModalState();
}

class _EmailFormModalState extends State<EmailFormModal> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _emailController;
  late final TextEditingController _subjectController;
  late final TextEditingController _bodyController;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController();
    _subjectController = TextEditingController(text: widget.defaultSubject);
    _bodyController = TextEditingController(text: widget.defaultBody);
  }

  @override
  void dispose() {
    _emailController.dispose();
    _subjectController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  String? _validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'El email es obligatorio';
    }
    final regex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
    if (!regex.hasMatch(value.trim())) {
      return 'Email inválido';
    }
    return null;
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      Navigator.pop(
        context,
        EmailFormResult(
          email: _emailController.text.trim(),
          subject: _subjectController.text.trim(),
          body: _bodyController.text.trim(),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: Responsive.clampWidth(context, 420),
        padding: EdgeInsets.all(Responsive.padding(context, small: 16, large: 24)),
        decoration: BoxDecoration(
          color: AppTheme.darkSurface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
          boxShadow: [
            BoxShadow(
              color: AppTheme.neonBlue.withOpacity(0.15),
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
                      color: AppTheme.neonBlue.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.email_rounded, color: AppTheme.neonBlue, size: 22),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      'Enviar por Email',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: Responsive.fontSize(context, small: 16, large: 20),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppTheme.textSecondary, size: 20),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Email field
              _buildLabel('Destinatario *'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                validator: _validateEmail,
                autofocus: true,
                style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                decoration: _inputDecoration(
                  hint: 'email@ejemplo.com',
                  icon: Icons.alternate_email,
                ),
              ),
              const SizedBox(height: 16),

              // Subject field
              _buildLabel('Asunto'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _subjectController,
                style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                decoration: _inputDecoration(
                  hint: 'Asunto del email',
                  icon: Icons.subject,
                ),
              ),
              const SizedBox(height: 16),

              // Body field
              _buildLabel('Mensaje (opcional)'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _bodyController,
                maxLines: 3,
                style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                decoration: _inputDecoration(
                  hint: 'Escriba un mensaje personalizado...',
                  icon: Icons.message_outlined,
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
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    ),
                    child: const Text('Cancelar'),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton.icon(
                    onPressed: _submit,
                    icon: const Icon(Icons.send_rounded, size: 18),
                    label: const Text('Enviar'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.neonBlue,
                      foregroundColor: AppTheme.darkBase,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
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
        letterSpacing: 0.5,
      ),
    );
  }

  InputDecoration _inputDecoration({required String hint, required IconData icon}) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5), fontSize: 13),
      prefixIcon: Icon(icon, color: AppTheme.textSecondary, size: 18),
      filled: true,
      fillColor: AppTheme.darkBase,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: AppTheme.borderColor.withOpacity(0.5)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: AppTheme.borderColor.withOpacity(0.3)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppTheme.neonBlue, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppTheme.error),
      ),
    );
  }
}
