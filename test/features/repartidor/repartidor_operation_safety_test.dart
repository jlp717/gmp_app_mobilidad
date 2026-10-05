import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_operation_safety.dart';

void main() {
  test('la nota que no carga explica qué hacer', () {
    final message = repartidorSafeOperationMessage(
      error: Exception('hidden'),
      operation: 'receiptPrint',
    );
    expect(message, contains('nota de entrega'));
    expect(message, contains('Reintentar'));
    expect(message, isNot(contains('hidden')));
  });
}
