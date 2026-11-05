import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';

class _ShellAuthNotifier extends AuthNotifier {
  _ShellAuthNotifier(this.user);

  final UserModel user;

  @override
  Future<AuthState> build() async => AuthState(
        user: user,
        vendedorCodes: user.vendedorCodes,
        isInitialized: true,
      );
}

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

  group('MainShell accessible tablet sidebar', () {
    Future<void> pumpShell(
      WidgetTester tester,
      UserModel user, {
      Size size = const Size(800, 1280),
      double textScale = 2,
    }) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = size;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith(() => _ShellAuthNotifier(user)),
          ],
          child: MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: size,
                textScaler: TextScaler.linear(textScale),
              ),
              child: const MainShell(
                contentOverride: ColoredBox(color: Colors.white),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('commercial labels stay readable in the tablet matrix',
        (tester) async {
      final user = _user(code: '35', role: 'COMERCIAL').copyWith(
        vendedorCodes: const ['35'],
        availableModes: const ['COMERCIAL'],
      );
      for (final viewport in const [
        (Size(800, 1280), 1.0),
        (Size(800, 1280), 2.0),
        (Size(1280, 800), 1.0),
        (Size(1280, 800), 2.0),
      ]) {
        await pumpShell(
          tester,
          user,
          size: viewport.$1,
          textScale: viewport.$2,
        );
        final pedidos = find.text('Pedidos');
        expect(pedidos, findsOneWidget);
        final labelStyle = tester.widget<AnimatedDefaultTextStyle>(
          find
              .ancestor(
                of: pedidos,
                matching: find.byType(AnimatedDefaultTextStyle),
              )
              .first,
        );
        expect(labelStyle.style.fontSize, greaterThanOrEqualTo(18));
        expect(
          tester.takeException(),
          isNull,
          reason: '${viewport.$1.width}x${viewport.$1.height} ${viewport.$2}x',
        );
      }
    });

    for (final user in [
      _user(
        code: '35',
        role: 'COMERCIAL',
      ).copyWith(
        vendedorCodes: const ['35'],
        availableModes: const ['COMERCIAL'],
      ),
      _user(
        code: '95',
        isJefeVentas: true,
      ).copyWith(
        vendedorCodes: const ['35', '36'],
        availableModes: const ['COMERCIAL', 'REPARTIDOR'],
      ),
    ]) {
      testWidgets('${user.role} keeps full labels and 56dp controls at 200%',
          (tester) async {
        await pumpShell(tester, user);

        final navList = find.byType(ListView).first;
        for (var attempt = 0;
            attempt < 8 && find.text('Liquidación').evaluate().isEmpty;
            attempt += 1) {
          await tester.drag(navList, const Offset(0, -160));
          await tester.pump();
        }
        expect(find.text('Liquidación'), findsOneWidget);
        final liquidacion = tester.widget<Text>(find.text('Liquidación'));
        expect(liquidacion.data, 'Liquidación');
        expect(liquidacion.maxLines, 2);
        expect(liquidacion.overflow, TextOverflow.visible);
        expect(tester.getSize(find.text('Liquidación')).width, greaterThan(90));
        final navTextStyle = tester.widget<AnimatedDefaultTextStyle>(
          find
              .ancestor(
                of: find.text('Liquidación'),
                matching: find.byType(AnimatedDefaultTextStyle),
              )
              .first,
        );
        expect(navTextStyle.style.fontSize, greaterThanOrEqualTo(18));

        for (final entry in const [
          ('Ajustes de avisos', 'Avisos'),
          ('Ocultar o mostrar navegacion lateral', 'Ocultar'),
          ('Cerrar sesion', 'Salir'),
        ]) {
          final control = find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.label == entry.$1,
          );
          expect(control, findsOneWidget, reason: entry.$1);
          expect(tester.getSize(control).height, greaterThanOrEqualTo(56));
          expect(
            tester.widget<Text>(find.text(entry.$2)).style?.fontSize,
            greaterThanOrEqualTo(18),
          );
        }

        if (user.isJefeVentas) {
          expect(
            find.byKey(const ValueKey('main-shell-mode-switch')),
            findsOneWidget,
          );
          expect(
            find.text('Ventas'),
            findsNothing,
            reason: 'El selector lateral conserva la variante compacta.',
          );
        }

        await tester.tap(
          find.byWidgetPredicate(
            (widget) =>
                widget is Semantics &&
                widget.properties.label ==
                    'Ocultar o mostrar navegacion lateral',
          ),
        );
        await tester.pumpAndSettle();
        final reopen = find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              widget.properties.label == 'Mostrar navegacion lateral',
        );
        expect(reopen, findsOneWidget);
        expect(tester.getSize(reopen).width, greaterThanOrEqualTo(56));
      });
    }
  });
}
