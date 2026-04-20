// GMP App Provider Tests
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Test provider for mock
final testProvider = Provider<String>((ref) => 'test');

void main() {
  group('Provider Tests', () {
    test('Provider can be created', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final value = container.read(testProvider);
      expect(value, 'test');
    });

    test('ProviderContainer dispose works', () {
      final container = ProviderContainer();
      expect(container.dispose, returnsNormally);
    });
  });
}
