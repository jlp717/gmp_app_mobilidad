import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_operation_safety.dart';

void main() {
  group('repartidor operation safety', () {
    const hostileError =
        'SQLSTATE=08001 /private/Javier/recibos/42?dni=12345678Z '
        'Authorization: Bearer test-token-not-for-display';

    test('never exposes hostile operation data in user-facing messages', () {
      const operations = <String>[
        'camera',
        'technicalSheet',
        'pdfPreview',
        'pdfDownload',
        'pdfShare',
        'signature',
        'printer',
      ];

      for (final operation in operations) {
        final message = repartidorSafeOperationMessage(
          error: hostileError,
          operation: operation,
        );
        expect(message, isNot(contains('SQLSTATE')));
        expect(message, isNot(contains('/private/')));
        expect(message, isNot(contains('12345678Z')));
        expect(message, isNot(contains('Bearer')));
        expect(message, isNot(contains('test-token-not-for-display')));
      }
    });

    test('only attaches image credentials to the canonical product endpoint',
        () {
      final canonical = '${ApiConfig.baseUrl}/products/ART-1/image';

      expect(repartidorProtectedImageHeaders(canonical), isNotNull);
      expect(
        repartidorProtectedImageHeaders(
            'https://evil.invalid/products/ART-1/image'),
        isNull,
      );
      expect(
        repartidorProtectedImageHeaders(
            '${ApiConfig.baseUrl}/clientes/42/image'),
        isNull,
      );
    });

    test('owned repartidor surfaces keep diagnostic data out of UI and logs',
        () {
      final rutero = File(
        'lib/features/repartidor/presentation/pages/repartidor_rutero_page.dart',
      ).readAsStringSync();
      final panel = File(
        'lib/features/repartidor/presentation/pages/repartidor_panel_page.dart',
      ).readAsStringSync();
      final signature = File(
        'lib/features/entregas/presentation/widgets/signature_pad.dart',
      ).readAsStringSync();
      final zebra = File(
        'lib/features/repartidor/data/zebra_print_service.dart',
      ).readAsStringSync();

      expect(rutero, isNot(contains(r'Error loading week data: $e')));
      expect(panel, isNot(contains(r"message: 'Error: $_error'")));
      expect(signature, isNot(contains(r'Error guardando firma: $e')));
      expect(signature, contains('No se pudo guardar la firma.'));
      expect(zebra, isNot(contains(r"debugPrint('[ZEBRA] $addr")));
      expect(zebra, isNot(contains(r"debugPrint('[ZEBRA] $e")));
      expect(zebra, isNot(contains(r"debugPrint('[ZEBRA] $error")));
    });
  });
}
