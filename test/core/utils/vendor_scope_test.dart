import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';

void main() {
  test('jefe Todos sends ALL instead of a joined vendor list', () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '98',
        authVendorCodes: const <String>['01', '02', '10'],
        selectedVendor: 'ALL',
        fallbackVendorCodes: '01,02,10',
        isJefeVentas: true,
      ),
      'ALL',
    );
  });

  test('jefe Ver como sends the selected vendor', () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '98',
        authVendorCodes: const <String>['01', '02', '10'],
        selectedVendor: '10',
        fallbackVendorCodes: '01,02,10',
        isJefeVentas: true,
      ),
      '10',
    );
  });

  test('plain commercial ignores persisted ALL from a previous jefe session',
      () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '10',
        authVendorCodes: const <String>['10'],
        selectedVendor: 'ALL',
        fallbackVendorCodes: '10',
        isJefeVentas: false,
      ),
      '10',
    );
  });

  test('plain commercial cannot request another vendor', () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '10',
        authVendorCodes: const <String>['10'],
        selectedVendor: '15',
        fallbackVendorCodes: '10',
        isJefeVentas: false,
      ),
      '10',
    );
  });

  test('any explicitly scoped commercial can use its authorized team', () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '10',
        authVendorCodes: const <String>['10', '11', '12'],
        selectedVendor: 'ALL',
        fallbackVendorCodes: '10,11,12',
        isJefeVentas: false,
      ),
      '10,11,12',
    );
  });

  test('a commercial without a multi-vendor claim stays self-scoped', () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '02',
        authVendorCodes: const <String>['02'],
        selectedVendor: 'ALL',
        fallbackVendorCodes: '02',
        isJefeVentas: false,
      ),
      '02',
    );
  });
}
