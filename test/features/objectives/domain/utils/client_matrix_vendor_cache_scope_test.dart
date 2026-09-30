import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/objectives/domain/utils/client_matrix_vendor_cache_scope.dart';

void main() {
  group('clientMatrixVendorCacheScope', () {
    test('canonicalizes seller ordering and whitespace', () {
      expect(clientMatrixVendorCacheScope(' 02, 01 '), '01,02');
      expect(clientMatrixVendorCacheScope('01,02'), '01,02');
    });

    test('keeps different seller scopes in separate cache namespaces', () {
      expect(clientMatrixVendorCacheScope('01'), '01');
      expect(clientMatrixVendorCacheScope('02'), '02');
      expect(clientMatrixVendorCacheScope('ALL'), 'ALL');
    });

    test('returns null when scope comes only from the authenticated session',
        () {
      expect(clientMatrixVendorCacheScope(null), isNull);
      expect(clientMatrixVendorCacheScope('  , '), isNull);
    });
  });

  group('clientMatrixCacheKey', () {
    String? key(String? vendorScope) => clientMatrixCacheKey(
          clientCode: 'CLIENTE-1',
          vendorScope: vendorScope,
          years: '2024,2025,2026',
          startMonth: 1,
          endMonth: 9,
          productCode: '',
          productName: '',
          fi1: '',
          fi2: '',
          fi3: '',
          fi4: '',
          fi5: '',
        );

    test('separates persisted responses by seller scope', () {
      expect(key('01'), isNot(key('02')));
      expect(key('02'), contains('vendors:02'));
    });

    test('disables the persistent key when session scope is unknown', () {
      expect(key(null), isNull);
      expect(key(''), isNull);
    });
  });
}
