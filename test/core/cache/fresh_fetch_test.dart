import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/cache/fresh_fetch.dart';

void main() {
  test('fresh inside ttl, stale after ttl, missing is not fresh', () {
    final now = DateTime(2026, 9, 16, 12, 0);
    expect(isUiDataFresh(null, now: now), isFalse);
    expect(
      isUiDataFresh(now.subtract(const Duration(minutes: 9)), now: now),
      isTrue,
    );
    expect(
      isUiDataFresh(now.subtract(const Duration(minutes: 11)), now: now),
      isFalse,
    );
  });
}
