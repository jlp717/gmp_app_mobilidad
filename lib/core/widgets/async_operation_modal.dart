import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/// ⏳ ASYNC OPERATION MODAL
/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/// 
/// Modal centrado y bloqueante para operaciones asíncronas.
/// Estados: loading → success (auto-cierre) | error (reintentar/cerrar)
///
/// Uso:
///   final controller = AsyncOperationModal.show(context, text: 'Generando PDF...');
///   try {
///     await someOperation();
///     controller.success('PDF generado correctamente');
///   } catch (e) {
///     controller.error('Error: $e', onRetry: () => tryAgain());
///   }
/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

enum _ModalState { loading, success, error }

class AsyncOperationModalController {
  final BuildContext _context;
  final _stateNotifier = ValueNotifier<_ModalState>(_ModalState.loading);
  final _textNotifier = ValueNotifier<String>('');
  final _errorTextNotifier = ValueNotifier<String>('');
  VoidCallback? _onRetry;
  bool _closed = false;

  AsyncOperationModalController(this._context, String initialText) {
    _textNotifier.value = initialText;
  }

  /// Transition to success state → auto-closes after 1.5s
  void success([String? text]) {
    if (_closed) return;
    _textNotifier.value = text ?? '¡Completado!';
    _stateNotifier.value = _ModalState.success;
    Future.delayed(const Duration(milliseconds: 1500), () => close());
  }

  /// Transition to error state with retry option
  void error(String message, {VoidCallback? onRetry}) {
    if (_closed) return;
    _errorTextNotifier.value = message;
    _onRetry = onRetry;
    _stateNotifier.value = _ModalState.error;
  }

  /// Close the modal
  void close() {
    if (_closed) return;
    _closed = true;
    if (Navigator.canPop(_context)) {
      Navigator.of(_context).pop();
    }
  }

  /// Update loading text
  void updateText(String text) {
    _textNotifier.value = text;
  }

  void dispose() {
    _stateNotifier.dispose();
    _textNotifier.dispose();
    _errorTextNotifier.dispose();
  }
}

class AsyncOperationModal extends StatelessWidget {
  final AsyncOperationModalController controller;

  const AsyncOperationModal({super.key, required this.controller});

  /// Show the modal and return a controller
  static AsyncOperationModalController show(
    BuildContext context, {
    required String text,
  }) {
    final controller = AsyncOperationModalController(context, text);

    showDialog(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.black.withOpacity(0.7),
      builder: (_) => AsyncOperationModal(controller: controller),
    );

    return controller;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Center(
        child: Material(
          color: Colors.transparent,
          child: ValueListenableBuilder<_ModalState>(
            valueListenable: controller._stateNotifier,
            builder: (context, state, _) {
              return AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _buildContent(context, state),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context, _ModalState state) {
    return Container(
      key: ValueKey(state),
      width: 320,
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: _borderColor(state),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: _borderColor(state).withOpacity(0.3),
            blurRadius: 30,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildIcon(state),
          const SizedBox(height: 20),
          _buildText(state),
          if (state == _ModalState.error) ...[
            const SizedBox(height: 20),
            _buildErrorActions(context),
          ],
        ],
      ),
    );
  }

  Color _borderColor(_ModalState state) {
    switch (state) {
      case _ModalState.loading:
        return AppTheme.neonBlue;
      case _ModalState.success:
        return AppTheme.success;
      case _ModalState.error:
        return AppTheme.error;
    }
  }

  Widget _buildIcon(_ModalState state) {
    switch (state) {
      case _ModalState.loading:
        return SizedBox(
          width: 56,
          height: 56,
          child: CircularProgressIndicator(
            color: AppTheme.neonBlue,
            strokeWidth: 3,
            backgroundColor: AppTheme.neonBlue.withOpacity(0.15),
          ),
        );
      case _ModalState.success:
        return Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppTheme.success.withOpacity(0.15),
            border: Border.all(color: AppTheme.success, width: 2),
          ),
          child: const Icon(Icons.check_rounded, color: AppTheme.success, size: 32),
        );
      case _ModalState.error:
        return Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppTheme.error.withOpacity(0.15),
            border: Border.all(color: AppTheme.error, width: 2),
          ),
          child: const Icon(Icons.error_outline_rounded, color: AppTheme.error, size: 32),
        );
    }
  }

  Widget _buildText(_ModalState state) {
    switch (state) {
      case _ModalState.loading:
        return ValueListenableBuilder<String>(
          valueListenable: controller._textNotifier,
          builder: (_, text, __) => Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
        );
      case _ModalState.success:
        return ValueListenableBuilder<String>(
          valueListenable: controller._textNotifier,
          builder: (_, text, __) => Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppTheme.success,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        );
      case _ModalState.error:
        return ValueListenableBuilder<String>(
          valueListenable: controller._errorTextNotifier,
          builder: (_, text, __) => Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 14,
            ),
          ),
        );
    }
  }

  Widget _buildErrorActions(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (controller._onRetry != null) ...[
          TextButton.icon(
            onPressed: () {
              controller.close();
              controller._onRetry?.call();
            },
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar'),
            style: TextButton.styleFrom(
              foregroundColor: AppTheme.neonBlue,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            ),
          ),
          const SizedBox(width: 12),
        ],
        TextButton(
          onPressed: () => controller.close(),
          style: TextButton.styleFrom(
            foregroundColor: AppTheme.textSecondary,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          ),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }
}
