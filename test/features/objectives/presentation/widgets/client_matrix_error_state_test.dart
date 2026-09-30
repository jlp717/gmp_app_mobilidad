import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/widgets/client_matrix_error_state.dart';

void main() {
  testWidgets('shows the failure reason and invokes the retry action', (
    tester,
  ) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ClientMatrixErrorState(
            message: 'El servicio no pudo cargar la evolución ahora.',
            onRetry: () => retried = true,
          ),
        ),
      ),
    );

    expect(
      find.text('El servicio no pudo cargar la evolución ahora.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Reintentar'));
    expect(retried, isTrue);
  });
}
