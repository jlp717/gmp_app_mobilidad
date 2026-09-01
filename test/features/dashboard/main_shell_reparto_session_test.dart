import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';

UserModel _user({
  String code = 'J01',
  int claimsVersion = 1,
  String role = 'JEFE_VENTAS',
  bool isJefeVentas = false,
  String? codigoConductor,
}) {
  return UserModel(
    id: '1',
    code: code,
    name: 'Test',
    company: 'GMP',
    role: role,
    isJefeVentas: isJefeVentas,
    codigoConductor: codigoConductor,
    claimsVersion: claimsVersion,
  );
}

void main() {
  group('shouldPrepareRepartoSession', () {
    test('ignores transitions without a session', () {
      expect(
        shouldPrepareRepartoSession(
          previousUser: null,
          nextUser: null,
          previousMode: null,
          nextMode: null,
        ),
        isFalse,
      );
    });

    test('prepares when the auto-login lands after the shell mounted', () {
      expect(
        shouldPrepareRepartoSession(
          previousUser: null,
          nextUser: _user(),
          previousMode: null,
          nextMode: 'REPARTIDOR',
        ),
        isTrue,
        reason: 'Cold-start race: the shell mounted before the persisted '
            'session was restored; the late transition must prepare reparto.',
      );
    });

    test('skips duplicate emissions for the same identity and mode', () {
      expect(
        shouldPrepareRepartoSession(
          previousUser: _user(),
          nextUser: _user(),
          previousMode: 'REPARTIDOR',
          nextMode: 'REPARTIDOR',
        ),
        isFalse,
      );
    });

    test('prepares again when the claims identity rotates', () {
      expect(
        shouldPrepareRepartoSession(
          previousUser: _user(claimsVersion: 1),
          nextUser: _user(claimsVersion: 2),
          previousMode: 'REPARTIDOR',
          nextMode: 'REPARTIDOR',
        ),
        isTrue,
      );
      expect(
        shouldPrepareRepartoSession(
          previousUser: _user(code: 'J01'),
          nextUser: _user(code: 'J02'),
          previousMode: 'REPARTIDOR',
          nextMode: 'REPARTIDOR',
        ),
        isTrue,
      );
    });

    test('prepares again when the active mode changes', () {
      expect(
        shouldPrepareRepartoSession(
          previousUser: _user(),
          nextUser: _user(),
          previousMode: 'COMERCIAL',
          nextMode: 'REPARTIDOR',
        ),
        isTrue,
      );
    });

    test('mode comparison ignores case and surrounding whitespace', () {
      expect(
        shouldPrepareRepartoSession(
          previousUser: _user(),
          nextUser: _user(),
          previousMode: ' repartidor ',
          nextMode: 'REPARTIDOR',
        ),
        isFalse,
      );
    });
  });

  group('resolveFleetRepartidorId', () {
    final options = <Map<String, dynamic>>[
      {'code': 'R01', 'name': 'Uno'},
      {'code': 'R02', 'name': 'Dos'},
    ];

    test('returns the explicit driver selection', () {
      expect(
        resolveFleetRepartidorId(
          selectedRepartidor: 'R02',
          repartidoresOptions: options,
        ),
        'R02',
      );
    });

    test('joins the whole authorized fleet when ALL is selected', () {
      expect(
        resolveFleetRepartidorId(
          selectedRepartidor: 'ALL',
          repartidoresOptions: options,
        ),
        'R01,R02',
      );
      expect(
        resolveFleetRepartidorId(
          selectedRepartidor: null,
          repartidoresOptions: options,
        ),
        'R01,R02',
      );
    });

    test('returns null instead of garbage ids when the fleet is empty', () {
      expect(
        resolveFleetRepartidorId(
          selectedRepartidor: 'ALL',
          repartidoresOptions: const [],
        ),
        isNull,
        reason: 'Callers must show the retryable panel, never vendedor '
            'codes the backend rejects with 403/422.',
      );
      expect(
        resolveFleetRepartidorId(
          selectedRepartidor: null,
          repartidoresOptions: const [],
        ),
        isNull,
      );
    });

    test('ignores options without usable codes', () {
      expect(
        resolveFleetRepartidorId(
          selectedRepartidor: 'ALL',
          repartidoresOptions: const [
            {'code': '', 'name': 'Vacio'},
            {'code': 'R07', 'name': 'Siete'},
          ],
        ),
        'R07',
      );
    });
  });
}
