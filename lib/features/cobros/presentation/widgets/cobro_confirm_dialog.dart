import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/design/a11y_tokens.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Confirmación de dinero antes de registrar un cobro.
///
/// Devuelve las observaciones escritas, o null si se cancela.
class CobroConfirmDialog extends StatefulWidget {
  const CobroConfirmDialog({
    required this.cliente,
    required this.importeLabel,
    required this.formaPago,
    super.key,
  });

  final String cliente;
  final String importeLabel;
  final String formaPago;

  @override
  State<CobroConfirmDialog> createState() => _CobroConfirmDialogState();
}

class _CobroConfirmDialogState extends State<CobroConfirmDialog> {
  final _formKey = GlobalKey<FormState>();
  final _notes = TextEditingController();

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState?.validate() != true) return;
    Navigator.of(context).pop(_notes.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      title: const Text(
        'Revisa este cobro',
        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
      ),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Cliente: ${widget.cliente}',
                style: A11yTokens.body.copyWith(color: AppColors.themedWhite70),
              ),
              const SizedBox(height: 8),
              Text(
                'Vas a cobrar ${widget.importeLabel}.',
                style: A11yTokens.title.copyWith(color: AppColors.themedWhite),
              ),
              const SizedBox(height: 8),
              Text(
                'Forma de pago: ${widget.formaPago}',
                style: A11yTokens.body.copyWith(color: AppColors.themedWhite70),
              ),
              const SizedBox(height: 8),
              Text(
                'Esta acción registra el dinero. Revísala antes de confirmar.',
                style: A11yTokens.body.copyWith(color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 16),
              Semantics(
                textField: true,
                label: 'Observaciones obligatorias del cobro',
                child: TextFormField(
                  controller: _notes,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 500,
                  style: const TextStyle(fontSize: A11yTokens.minText),
                  decoration: const InputDecoration(
                    labelText: 'Observaciones del cobro',
                    hintText: 'Escribe el motivo o el detalle del cobro',
                    errorStyle: TextStyle(fontSize: A11yTokens.minText),
                  ),
                  validator: (value) => (value?.trim().isEmpty ?? true)
                      ? 'Escribe una observación. El cobro no se guarda sin ella.'
                      : null,
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        Semantics(
          button: true,
          label: 'Cancelar cobro',
          child: TextButton(
            style: A11yTokens.touchButton(),
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar'),
          ),
        ),
        Semantics(
          button: true,
          label: 'Confirmar cobro',
          child: FilledButton(
            style: A11yTokens.touchButton(),
            onPressed: _submit,
            child: const Text('Confirmar cobro'),
          ),
        ),
      ],
    );
  }
}
