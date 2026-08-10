import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/main_shell.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _EmptyApiAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final payload = options.path.contains('/warehouse/dashboard') ? '{}' : '[]';
    return ResponseBody.fromString(
      payload,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _ModeSwitchAuthNotifier extends AuthNotifier {
  static final List<String> requestedRoles = <String>[];
  static String? failingRole;
  static Completer<void>? switchGate;

  static void reset() {
    requestedRoles.clear();
    failingRole = null;
    switchGate = null;
  }

  @override
  Future<AuthState> build() async => const AuthState(
        isInitialized: true,
        activeMode: 'ALMACEN',
        vendedorCodes: ['050'],
        user: UserModel(
          id: 'V050',
          code: '050',
          name: 'Jefe',
          company: 'GMP',
          role: 'JEFE_VENTAS',
          isJefeVentas: true,
          availableRoles: ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'],
          availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
          vendedorCodes: ['050', '051'],
        ),
      );

  @override
  Future<bool> switchRole(String newRole, {String? viewAs}) async {
    requestedRoles.add(newRole);
    await switchGate?.future;
    final current = state.requireValue;
    if (newRole == failingRole) {
      state = AsyncValue.data(
        current.copyWith(isLoading: false, error: 'ROLE_SWITCH_FAILED'),
      );
      return false;
    }

    final activeMode = newRole == 'ALMACEN'
        ? 'ALMACEN'
        : newRole == 'REPARTIDOR'
            ? 'REPARTIDOR'
            : 'COMERCIAL';
    final reparto = newRole == 'REPARTIDOR';
    final updatedUser = UserModel(
      id: 'V050',
      code: '050',
      name: reparto ? 'Repartidor' : 'Jefe',
      company: 'GMP',
      role: reparto ? 'REPARTIDOR' : 'JEFE_VENTAS',
      isJefeVentas: !reparto,
      codigoConductor: reparto ? '050' : null,
      matricula: reparto ? '1234ABC' : null,
      availableRoles: const ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'],
      availableModes: const ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
      vendedorCodes: reparto ? const ['050'] : const ['050', '051'],
    );
    state = AsyncValue.data(
      current.copyWith(
        user: updatedUser,
        vendedorCodes: updatedUser.vendedorCodes,
        activeMode: activeMode,
        isLoading: false,
        error: '',
      ),
    );
    return true;
  }
}

Future<ProviderContainer> _pumpMainShell(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  SharedPreferences.setMockInitialValues(const {});
  ApiClient.resetForTesting();
  ApiClient.dio.httpClientAdapter = _EmptyApiAdapter();

  final container = ProviderContainer(
    overrides: [
      authProvider.overrideWith(_ModeSwitchAuthNotifier.new),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(ApiClient.resetForTesting);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        home: MainShell(contentOverride: SizedBox.shrink()),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 150));
  return container;
}

Future<void> _selectMode(WidgetTester tester, String value) async {
  final switcher = tester.widget<PopupMenuButton<String>>(
    find.byKey(const ValueKey('main-shell-mode-switch')).first,
  );
  switcher.onSelected!(value);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

void main() {
  setUp(_ModeSwitchAuthNotifier.reset);

  testWidgets(
    'MainShell rotates the session mode ALMACEN -> Ventas -> ALMACEN',
    (tester) async {
      final container = await _pumpMainShell(tester);

      expect(
        find.descendant(
          of: find.byKey(const ValueKey('main-shell-mode-switch')).first,
          matching: find.byIcon(Icons.warehouse_rounded),
        ),
        findsOneWidget,
      );
      expect(find.text('Expediciones'), findsWidgets);

      await _selectMode(tester, 'VENTAS');

      expect(_ModeSwitchAuthNotifier.requestedRoles, ['JEFE_VENTAS']);
      expect(
        container.read(authProvider).requireValue.user!.role,
        'JEFE_VENTAS',
      );
      expect(container.read(authProvider).requireValue.activeMode, 'COMERCIAL');
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('main-shell-mode-switch')).first,
          matching: find.byIcon(Icons.store),
        ),
        findsOneWidget,
      );

      await _selectMode(tester, 'ALMACEN');

      expect(
        _ModeSwitchAuthNotifier.requestedRoles,
        ['JEFE_VENTAS', 'ALMACEN'],
      );
      expect(
        container.read(authProvider).requireValue.user!.role,
        'JEFE_VENTAS',
      );
      expect(container.read(authProvider).requireValue.activeMode, 'ALMACEN');
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('main-shell-mode-switch')).first,
          matching: find.byIcon(Icons.warehouse_rounded),
        ),
        findsOneWidget,
      );
      expect(find.text('Expediciones'), findsWidgets);
    },
  );

  testWidgets('failed mode switch is visible and keeps the current mode',
      (tester) async {
    _ModeSwitchAuthNotifier.failingRole = 'JEFE_VENTAS';
    final container = await _pumpMainShell(tester);

    await _selectMode(tester, 'VENTAS');

    expect(_ModeSwitchAuthNotifier.requestedRoles, ['JEFE_VENTAS']);
    expect(container.read(authProvider).requireValue.activeMode, 'ALMACEN');
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('main-shell-mode-switch')).first,
        matching: find.byIcon(Icons.warehouse_rounded),
      ),
      findsOneWidget,
    );
    expect(find.text('Expediciones'), findsWidgets);
    expect(
      find.text('No se pudo cambiar el perfil. Mantienes el perfil actual.'),
      findsOneWidget,
    );
  });

  testWidgets('rapid repeated selection performs one session switch',
      (tester) async {
    _ModeSwitchAuthNotifier.switchGate = Completer<void>();
    final container = await _pumpMainShell(tester);
    final switcher = tester.widget<PopupMenuButton<String>>(
      find.byKey(const ValueKey('main-shell-mode-switch')).first,
    );

    switcher.onSelected!('VENTAS');
    switcher.onSelected!('VENTAS');
    await tester.pump();

    expect(_ModeSwitchAuthNotifier.requestedRoles, ['JEFE_VENTAS']);
    _ModeSwitchAuthNotifier.switchGate!.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(container.read(authProvider).requireValue.activeMode, 'COMERCIAL');
    expect(_ModeSwitchAuthNotifier.requestedRoles, ['JEFE_VENTAS']);
  });

  testWidgets('manager-driver replaces profile and scope REPARTO -> Ventas',
      (tester) async {
    final container = await _pumpMainShell(tester);

    await _selectMode(tester, 'REPARTO');
    var auth = container.read(authProvider).requireValue;
    expect(auth.user!.role, 'REPARTIDOR');
    expect(auth.user!.isJefeVentas, isFalse);
    expect(auth.user!.codigoConductor, '050');
    expect(auth.vendedorCodes, ['050']);
    expect(find.byKey(const ValueKey('main-shell-mode-switch')), findsWidgets);

    await _selectMode(tester, 'VENTAS');
    auth = container.read(authProvider).requireValue;
    expect(
        _ModeSwitchAuthNotifier.requestedRoles, ['REPARTIDOR', 'JEFE_VENTAS']);
    expect(auth.user!.role, 'JEFE_VENTAS');
    expect(auth.user!.isJefeVentas, isTrue);
    expect(auth.user!.codigoConductor, isNull);
    expect(auth.vendedorCodes, ['050', '051']);
  });

  test('liquidation adjustments follow canonical role, not visual mode', () {
    const manager = UserModel(
      id: 'V050',
      code: '050',
      name: 'Jefe',
      company: 'GMP',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
    );
    const repartidor = UserModel(
      id: 'V050',
      code: '050',
      name: 'Repartidor',
      company: 'GMP',
      role: 'REPARTIDOR',
      codigoConductor: '050',
    );

    expect(canCreateRepartidorLiquidationAdjustments(manager), isTrue);
    expect(canCreateRepartidorLiquidationAdjustments(repartidor), isFalse);
  });
}
