import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/performance/scroll_cache_extent.dart';

void main() {
  group('denseScrollCacheExtent', () {
    test('mirrors one viewport for dense lists', () {
      expect(denseScrollCacheExtent(800), 800);
      expect(denseScrollCacheExtent(640.5), 640.5);
    });

    test('zero or negative viewports yield no cache', () {
      expect(denseScrollCacheExtent(0), 0);
      expect(denseScrollCacheExtent(-12), 0);
    });
  });
}
