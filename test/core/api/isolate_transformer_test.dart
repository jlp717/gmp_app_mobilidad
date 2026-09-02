import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/isolate_transformer.dart';
import 'package:gmp_app_mobilidad/core/utils/compute_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('uses the synchronous path below the 50 KB threshold', () {
    final result = smartParseJson('{"ok":true}');

    expect(result, isNot(isA<Future<dynamic>>()));
    expect(result, <String, dynamic>{'ok': true});
  });

  test('uses an isolate for payloads at or above the 50 KB threshold',
      () async {
    final payload = 'x' * (50 * 1024);
    final result = smartParseJson('{"payload":"$payload"}');

    expect(result, isA<Future<dynamic>>());
    final decoded = await (result as Future<dynamic>);
    expect(decoded, isA<Map<String, dynamic>>());
    expect((decoded as Map<String, dynamic>)['payload'], payload);
  });

  test('preserves JSON parse errors on the synchronous path', () {
    expect(() => smartParseJson('{invalid'), throwsFormatException);
  });

  test('Dio transformer is wired to the threshold-aware decoder', () {
    expect(IsolateTransformer(), isA<SyncTransformer>());
  });
}
