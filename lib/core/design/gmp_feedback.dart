import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/design/a11y_tokens.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Traduce un fallo técnico a una frase que un comercial puede leer.
String gmpWhatHappened(String raw) {
  var text = raw.trim();
  final lowerPrefix = text.toLowerCase();
  if (lowerPrefix.startsWith('error:')) {
    text = text.substring(text.indexOf(':') + 1).trim();
  }
  if (text.isEmpty) {
    return 'No se pudo completar la acción.';
  }

  final lower = text.toLowerCase();
  final offline = lower.contains('socket') ||
      lower.contains('conex') ||
      lower.contains('timeout') ||
      lower.contains('network') ||
      lower.contains('handshake') ||
      lower.contains('connection') ||
      lower.contains('host lookup');
  if (offline) {
    return 'No hay conexión con el servidor.';
  }

  final technical = lower.contains('exception') ||
      lower.contains('stack') ||
      lower.contains('dio') ||
      lower.contains('formatexception') ||
      lower.contains('xmlhttp') ||
      text.contains('Error:');
  if (technical) {
    return 'No se pudieron cargar los datos.';
  }

  return text;
}

/// Dice qué hacer después del fallo. No repite la causa.
String gmpWhatToDo(String raw) {
  final lower = raw.toLowerCase();
  if (lower.contains('demasiados intentos') || lower.contains('429')) {
    return 'Espera unos minutos y vuelve a intentarlo.';
  }
  if (lower.contains('socket') ||
      lower.contains('conex') ||
      lower.contains('timeout') ||
      lower.contains('network') ||
      lower.contains('handshake') ||
      lower.contains('connection')) {
    return 'Comprueba la cobertura y pulsa Reintentar.';
  }
  return 'Pulsa Reintentar. Si sigue igual, avisa a oficina.';
}

/// Error visible: qué pasó y qué hacer, con un solo botón principal.
class GmpErrorPanel extends StatelessWidget {
  const GmpErrorPanel({
    required this.whatHappened,
    required this.whatToDo,
    super.key,
    this.onRetry,
    this.retryLabel = 'Reintentar',
  });

  final String whatHappened;
  final String whatToDo;
  final VoidCallback? onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Semantics(
          container: true,
          liveRegion: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: AppTheme.error),
              const SizedBox(height: 16),
              Text(
                whatHappened,
                textAlign: TextAlign.center,
                style: A11yTokens.body.copyWith(color: AppTheme.textPrimary),
              ),
              const SizedBox(height: 8),
              Text(
                whatToDo,
                textAlign: TextAlign.center,
                style: A11yTokens.body.copyWith(color: AppTheme.textSecondary),
              ),
              if (onRetry != null) ...[
                const SizedBox(height: 20),
                Semantics(
                  button: true,
                  label: retryLabel,
                  child: FilledButton(
                    style: A11yTokens.touchButton(),
                    onPressed: onRetry,
                    child: Text(retryLabel),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Vacío útil: explica el hueco y ofrece la siguiente acción.
class GmpEmptyPanel extends StatelessWidget {
  const GmpEmptyPanel({
    required this.title,
    required this.whatToDo,
    super.key,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String whatToDo;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final showAction = onAction != null && (actionLabel?.isNotEmpty ?? false);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppTheme.textSecondary),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: A11yTokens.title.copyWith(color: AppTheme.textPrimary),
            ),
            const SizedBox(height: 8),
            Text(
              whatToDo,
              textAlign: TextAlign.center,
              style: A11yTokens.body.copyWith(color: AppTheme.textSecondary),
            ),
            if (showAction) ...[
              const SizedBox(height: 20),
              Semantics(
                button: true,
                label: actionLabel,
                child: FilledButton(
                  style: A11yTokens.touchButton(),
                  onPressed: onAction,
                  child: Text(actionLabel!),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
