import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/design/a11y_tokens.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Aviso de acceso: dice qué falló y qué hacer, con un solo botón.
class LoginAccessErrorDialog extends StatelessWidget {
  const LoginAccessErrorDialog({
    required this.message,
    required this.whatToDo,
    super.key,
  });

  final String message;
  final String whatToDo;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      title: const Text(
        'No se pudo entrar',
        style: TextStyle(
          color: AppTheme.error,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message,
              style: A11yTokens.body.copyWith(color: AppTheme.textPrimary),
            ),
            const SizedBox(height: 12),
            Text(
              whatToDo,
              style: A11yTokens.body.copyWith(color: AppTheme.textSecondary),
            ),
          ],
        ),
      ),
      actions: [
        Semantics(
          button: true,
          label: 'Entendido',
          child: FilledButton(
            style: A11yTokens.touchButton(),
            onPressed: () => Navigator.pop(context),
            child: const Text('Entendido'),
          ),
        ),
      ],
    );
  }
}
