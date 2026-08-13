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

  test('commercial 80 ALL keeps the Almeria team scope', () {
    expect(
      resolveRuteroRequestVendorCodes(
        userCode: '80',
        authVendorCodes: const <String>['80', '72', '73', '81', '83'],
        selectedVendor: 'ALL',
        fallbackVendorCodes: '80,72,73,81,83',
        isJefeVentas: false,
      ),
      '80,72,73,81,83',
    );
  });
}
