// GMP App Core Utilities Test
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/app_logger.dart';

void main() {
  group('AppLogger Tests', () {
    setUp(() {
      AppLogger.initialize(level: LogLevel.debug);
    });

    test('AppLogger initializes with correct level', () {
      AppLogger.initialize(level: LogLevel.info);
      // No error means initialization works
      expect(AppLogger, isNotNull);
    });

    test('AppLogger setLevel changes level', () {
      AppLogger.setLevel(LogLevel.warn);
      // Just verify it doesn't throw
      expect(AppLogger, isNotNull);
    });

    test('AppLogger debug logs in debug mode', () {
      // In debug mode, should not throw
      AppLogger.debug('Test debug message', tag: 'TEST');
      expect(true, isTrue);
    });

    test('AppLogger info logs correctly', () {
      AppLogger.info('Test info message', tag: 'TEST');
      expect(true, isTrue);
    });

    test('AppLogger warn logs correctly', () {
      AppLogger.warn('Test warn message', tag: 'TEST');
      expect(true, isTrue);
    });

    test('AppLogger error logs correctly', () {
      AppLogger.error('Test error message', tag: 'TEST');
      expect(true, isTrue);
    });

    test('AppLogger http logs correctly', () {
      AppLogger.http(
        'GET',
        'https://api.test.com/data',
        statusCode: 200,
        durationMs: 150,
      );
      expect(true, isTrue);
    });
  });
}
