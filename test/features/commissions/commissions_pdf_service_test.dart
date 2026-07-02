import 'dart:convert';
import 'dart:typed_data';

import 'package:gmp_app_mobilidad/features/commissions/data/pdf_error_parser.dart';
import 'package:test/test.dart';

void main() {
  group('extractServerErrorMessage', () {
    test('extracts error and details from JSON bytes', () {
      final bytes = Uint8List.fromList(
        utf8.encode(
          jsonEncode({
            'success': false,
            'error': 'Error obteniendo datos de ventas',
            'details': 'SQL0204 VENTAS_B',
          }),
        ),
      );

      expect(
        extractServerErrorMessage(bytes),
        'Error obteniendo datos de ventas: SQL0204 VENTAS_B',
      );
    });

    test('extracts details from a decoded map', () {
      expect(
        extractServerErrorMessage({
          'success': false,
          'details': 'Error generando PDF',
        }),
        'Error generando PDF',
      );
    });

    test('keeps plain text errors readable', () {
      expect(
        extractServerErrorMessage(
          'Servidor no disponible',
        ),
        'Servidor no disponible',
      );
    });
  });
}
