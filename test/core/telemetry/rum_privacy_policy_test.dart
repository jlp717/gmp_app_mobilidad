import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_privacy_policy.dart';

void main() {
  final wireCases = (jsonDecode(
    File('backend/tests/fixtures/hermetic/rum-wire-cases.json')
        .readAsStringSync(),
  ) as List)
      .cast<Map>();

  test('matches shared RUM wire cases', () {
    for (final wireCase in wireCases) {
      final input = Map<String, dynamic>.from(wireCase['input'] as Map);
      final expected =
          Map<String, dynamic>.from(wireCase['expectedWire'] as Map);
      expect(sanitizeRumEvent(input), expected);
    }
  });
  test('sanitizes synthetic PII paths, screens, rid and extra fields', () {
    final event = sanitizeRumEvent({
      'endpoint': '/clients/Javier-12345678Z?email=a@b.test',
      'screen': 'Javier 12345678Z',
      'method': 'post',
      'status': 200,
      't_req': 0,
      'bytes': 0,
      'net': 'wifi',
      'rid': 'secret-rid',
      'extra': 'x',
    });
    expect(event, {
      'screen': 'unknown',
      'endpoint': '/clients',
      'method': 'POST',
      'status': 200,
      't_req': 0,
      'bytes': 0,
      'net': 'wifi'
    });
  });
  test('normalization is idempotent and preserves known groups', () {
    final event = sanitizeRumEvent(
        {'endpoint': '/api/pedidos/123', 'method': 'GET', 't_req': 1});
    expect(event!['endpoint'], '/pedidos');
    final group = sanitizeRumEvent(
        {'endpoint': '/pedidos', 'method': 'GET', 't_req': 1})!;
    expect(sanitizeRumEvent(group), group);
  });
}
