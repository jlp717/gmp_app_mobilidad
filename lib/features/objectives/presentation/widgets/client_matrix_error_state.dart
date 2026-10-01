import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/design/gmp_feedback.dart';

/// Visible, retryable error state for the client purchase matrix.
class ClientMatrixErrorState extends StatelessWidget {
  const ClientMatrixErrorState({
    required this.message,
    required this.onRetry,
    super.key,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return GmpErrorPanel(
      whatHappened: message,
      whatToDo: 'Pulsa Reintentar. Si sigue igual, avisa a oficina.',
      onRetry: onRetry,
    );
  }
}
