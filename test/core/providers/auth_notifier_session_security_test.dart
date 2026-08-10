import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/services/auth_session_persistence.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _AuthAdapter implements HttpClientAdapter {
  _AuthAdapter(this.respond);

  final Future<ResponseBody> Function(RequestOptions options) respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

class _SeededAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async {
    bindAuthClientCallbacks();
    ApiClient.setAuthToken('access-old');
    ApiClient.authSessionExpiresAt =
        DateTime.now().add(const Duration(days: 1));
    return AuthState(
      user: managerUser,
      vendedorCodes: managerUser.vendedorCodes,
      activeMode: 'COMERCIAL',
      isInitialized: true,
    );
  }

  @override
  Future<bool> ensureSessionIsStillValid() async => true;
}

class _EmptyAuthNotifier extends AuthNotifier {
  @override
  Future<AuthState> build() async {
    bindAuthClientCallbacks();
    return const AuthState(isInitialized: true);
  }

  @override
  void preWarmAuthenticatedSession(AuthState authenticated) {}
}

const managerUser = UserModel(
  id: 'V050',
  code: '050',
  name: 'Jefe',
  company: 'GMP',
  role: 'JEFE_VENTAS',
  vendedorCode: '050',
  isJefeVentas: true,
  tipoVendedor: '-',
  availableRoles: ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'],
  availableModes: ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
  vendedorCodes: ['050', '051'],
  claimsVersion: 1,
);

Map<String, dynamic> canonicalResponse({
  required String role,
  required String activeMode,
  required String accessTokenKey,
}) {
  final reparto = role == 'REPARTIDOR';
  final codes = reparto ? ['050'] : ['050', '051'];
  final user = UserModel(
    id: 'V050',
    code: '050',
    name: reparto ? 'Repartidor' : 'Jefe',
    company: 'GMP',
    role: role,
    vendedorCode: '050',
    isJefeVentas: role == 'JEFE_VENTAS',
    codigoConductor: reparto ? '050' : null,
    matricula: reparto ? '1234ABC' : null,
    tipoVendedor: '-',
    availableRoles: const ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'],
    availableModes: const ['COMERCIAL', 'ALMACEN', 'REPARTIDOR'],
    vendedorCodes: codes,
    claimsVersion: 1,
  );
  return {
    'success': true,
    accessTokenKey: 'access-new-$role',
    'refreshToken': 'refresh-new-$role',
    'refreshExpiresIn': 604800,
    'role': role,
    'activeMode': activeMode,
    'availableRoles': user.availableRoles,
    'availableModes': user.availableModes,
    'isJefeVentas': user.isJefeVentas,
    'isRepartidor': user.isRepartidor,
    'codigoConductor': user.codigoConductor,
    'matricula': user.matricula,
    'vendorCodes': codes,
    'vendedorCodes': codes,
    'tipoVendedor': user.tipoVendedor,
    'showCommissions': user.showCommissions,
    'claimsVersion': user.claimsVersion,
    'user': {
      ...user.toJson(),
      'vendedorCode': '050',
      'activeMode': activeMode,
      'isRepartidor': user.isRepartidor,
      'vendorCodes': codes,
    },
  };
}

AuthSessionPersistence fakePersistence({
  required Map<String, String> secure,
  required Map<String, Object> preferences,
  int? failAtWrite,
}) {
  var writeIndex = 0;
  Future<void> beforeWrite() async {
    if (writeIndex++ == failAtWrite) throw StateError('injected write failure');
  }

  return AuthSessionPersistence(
    writeSecure: (key, value) async {
      await beforeWrite();
      secure[key] = value;
    },
    deleteSecure: (key) async => secure.remove(key),
    writeString: (key, value) async {
      await beforeWrite();
      preferences[key] = value;
    },
    writeStringList: (key, value) async {
      await beforeWrite();
      preferences[key] = List<String>.from(value);
    },
    deletePreference: (key) async => preferences.remove(key),
  );
}

ResponseBody jsonResponse(Map<String, dynamic> body, {int status = 200}) {
  return ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

Future<ProviderContainer> containerFor(
  _AuthAdapter adapter,
  AuthSessionPersistence persistence,
) async {
  ApiClient.resetForTesting();
  ApiClient.dio.httpClientAdapter = adapter;
  final container = ProviderContainer(
    overrides: [
      authProvider.overrideWith(_SeededAuthNotifier.new),
      authSessionPersistenceProvider.overrideWithValue(persistence),
    ],
  );
  await container.read(authProvider.future);
  return container;
}

Future<ProviderContainer> unauthenticatedContainerFor(
  _AuthAdapter adapter,
  AuthSessionPersistence persistence,
) async {
  ApiClient.resetForTesting();
  ApiClient.dio.httpClientAdapter = adapter;
  final container = ProviderContainer(
    overrides: [
      authProvider.overrideWith(_EmptyAuthNotifier.new),
      authSessionPersistenceProvider.overrideWithValue(persistence),
    ],
  );
  await container.read(authProvider.future);
  return container;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues(const {}));
  tearDown(ApiClient.resetForTesting);

  test('login commits the complete canonical session before publishing it',
      () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(canonicalResponse(
        role: 'JEFE_VENTAS',
        activeMode: 'COMERCIAL',
        accessTokenKey: 'token',
      )),
    );
    final container = await unauthenticatedContainerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(
      await container.read(authProvider.notifier).login('operator', 'test-pin'),
      isTrue,
    );

    final auth = container.read(authProvider).requireValue;
    expect(auth.user, managerUser);
    expect(auth.activeMode, 'COMERCIAL');
    expect(auth.vendedorCodes, ['050', '051']);
    expect(ApiClient.authToken, 'access-new-JEFE_VENTAS');
    expect(secure['user_token'], 'access-new-JEFE_VENTAS');
    expect(secure['refresh_token'], 'refresh-new-JEFE_VENTAS');
    expect(secure['user_data'], isNotEmpty);
    expect(secure['session_expires_at'], isNotEmpty);
    expect(preferences['vendedor_codes'], ['050', '051']);
    expect(preferences[authActiveModePreferenceKey], 'COMERCIAL');
    expect(adapter.requests, hasLength(1));
    expect(adapter.requests.single.path, ApiConfig.login);
    expect(adapter.requests.single.data, {
      'username': 'operator',
      'password': 'test-pin',
    });
  });

  test('loginWithRole replaces the complete repartidor profile and scope',
      () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(canonicalResponse(
        role: 'REPARTIDOR',
        activeMode: 'REPARTIDOR',
        accessTokenKey: 'token',
      )),
    );
    final container = await unauthenticatedContainerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(
      await container
          .read(authProvider.notifier)
          .loginWithRole('operator', 'test-pin', 'REPARTIDOR'),
      isTrue,
    );

    final auth = container.read(authProvider).requireValue;
    expect(auth.user!.role, 'REPARTIDOR');
    expect(auth.user!.isJefeVentas, isFalse);
    expect(auth.user!.codigoConductor, '050');
    expect(auth.user!.matricula, '1234ABC');
    expect(auth.activeMode, 'REPARTIDOR');
    expect(auth.vendedorCodes, ['050']);
    expect(ApiClient.authToken, 'access-new-REPARTIDOR');
    expect(adapter.requests.single.data, {
      'username': 'operator',
      'password': 'test-pin',
      'role': 'REPARTIDOR',
    });
  });

  for (final malformedField in [
    'user',
    'refreshToken',
    'isJefeVentas',
    'claimsVersion',
  ]) {
    test('login rejects canonical response without $malformedField', () async {
      final secure = <String, String>{};
      final preferences = <String, Object>{};
      final response = canonicalResponse(
        role: 'JEFE_VENTAS',
        activeMode: 'COMERCIAL',
        accessTokenKey: 'token',
      )..remove(malformedField);
      final adapter = _AuthAdapter((_) async => jsonResponse(response));
      final container = await unauthenticatedContainerFor(
        adapter,
        fakePersistence(secure: secure, preferences: preferences),
      );
      addTearDown(container.dispose);

      expect(
        await container
            .read(authProvider.notifier)
            .login('operator', 'test-pin'),
        isFalse,
      );
      expect(
        container.read(authProvider).requireValue.isAuthenticated,
        isFalse,
      );
      expect(container.read(authProvider).requireValue.error,
          'No se pudo iniciar sesión.');
      expect(ApiClient.authToken, isNull);
      expect(secure, isEmpty);
      expect(preferences, isEmpty);
    });
  }

  test('login rejects an incomplete nested user projection', () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final response = canonicalResponse(
      role: 'JEFE_VENTAS',
      activeMode: 'COMERCIAL',
      accessTokenKey: 'token',
    );
    final rawUser = Map<String, dynamic>.from(response['user'] as Map);
    rawUser.remove('showCommissions');
    response['user'] = rawUser;
    final adapter = _AuthAdapter((_) async => jsonResponse(response));
    final container = await unauthenticatedContainerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(
      await container.read(authProvider.notifier).login('operator', 'test-pin'),
      isFalse,
    );
    expect(container.read(authProvider).requireValue.isAuthenticated, isFalse);
    expect(ApiClient.authToken, isNull);
    expect(secure, isEmpty);
    expect(preferences, isEmpty);
  });

  for (var failAt = 0; failAt < 6; failAt++) {
    test('login persistence failure $failAt leaves no session fragment',
        () async {
      final secure = <String, String>{};
      final preferences = <String, Object>{};
      final adapter = _AuthAdapter(
        (_) async => jsonResponse(canonicalResponse(
          role: 'JEFE_VENTAS',
          activeMode: 'COMERCIAL',
          accessTokenKey: 'token',
        )),
      );
      final container = await unauthenticatedContainerFor(
        adapter,
        fakePersistence(
          secure: secure,
          preferences: preferences,
          failAtWrite: failAt,
        ),
      );
      addTearDown(container.dispose);

      expect(
        await container
            .read(authProvider.notifier)
            .login('operator', 'test-pin'),
        isFalse,
      );
      expect(
        container.read(authProvider).requireValue.isAuthenticated,
        isFalse,
      );
      expect(ApiClient.authToken, isNull);
      expect(secure, isEmpty);
      expect(preferences, isEmpty);
    });
  }

  test('login failures do not log credentials or raw transport details',
      () async {
    final username = ['SENSITIVE', 'OPERATOR'].join('_');
    final password = ['SENSITIVE', 'PIN'].join('_');
    final sqlMarker = ['SQL', 'STATE'].join();
    final tokenMarker = ['secret', 'token'].join('-');
    final rawTransport = [
      sqlMarker,
      tokenMarker,
      ['C:', 'private', 'auth_repository.dart'].join('\\'),
    ].join(' ');
    final messages = <String>[];
    final previousDebugPrint = debugPrint;
    debugPrint = (message, {wrapWidth}) {
      if (message != null) messages.add(message);
    };
    addTearDown(() => debugPrint = previousDebugPrint);

    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final adapter = _AuthAdapter((options) async {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        error: rawTransport,
      );
    });
    final container = await unauthenticatedContainerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(
      await container.read(authProvider.notifier).login(username, password),
      isFalse,
    );

    final logs = messages.join('\n');
    expect(logs, isNot(contains(username)));
    expect(logs, isNot(contains(password)));
    expect(logs, isNot(contains(rawTransport)));
    expect(logs, isNot(contains(sqlMarker)));
    expect(logs, isNot(contains(tokenMarker)));
    expect(container.read(authProvider).requireValue.error,
        'No se pudo iniciar sesión.');
    expect(ApiClient.authToken, isNull);
  });

  test('switch replaces manager claims with repartidor profile and scope',
      () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(canonicalResponse(
        role: 'REPARTIDOR',
        activeMode: 'REPARTIDOR',
        accessTokenKey: 'token',
      )),
    );
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(await container.read(authProvider.notifier).switchRole('REPARTIDOR'),
        isTrue);

    final auth = container.read(authProvider).requireValue;
    expect(auth.user!.role, 'REPARTIDOR');
    expect(auth.user!.isJefeVentas, isFalse);
    expect(auth.user!.codigoConductor, '050');
    expect(auth.user!.matricula, '1234ABC');
    expect(auth.vendedorCodes, ['050']);
    expect(auth.activeMode, 'REPARTIDOR');
    expect(ApiClient.authToken, 'access-new-REPARTIDOR');
    expect(secure['refresh_token'], 'refresh-new-REPARTIDOR');
    expect(adapter.requests, hasLength(1));
  });

  for (var failAt = 0; failAt < 6; failAt++) {
    test('switch persistence failure $failAt forces clean relogin', () async {
      final secure = <String, String>{'user_token': 'access-old'};
      final preferences = <String, Object>{
        'vendedor_codes': ['050', '051']
      };
      final adapter = _AuthAdapter(
        (_) async => jsonResponse(canonicalResponse(
          role: 'REPARTIDOR',
          activeMode: 'REPARTIDOR',
          accessTokenKey: 'token',
        )),
      );
      final container = await containerFor(
        adapter,
        fakePersistence(
          secure: secure,
          preferences: preferences,
          failAtWrite: failAt,
        ),
      );
      addTearDown(container.dispose);

      expect(
        await container.read(authProvider.notifier).switchRole('REPARTIDOR'),
        isFalse,
      );
      expect(
          container.read(authProvider).requireValue.isAuthenticated, isFalse);
      expect(container.read(authProvider).requireValue.error,
          contains('Inicia sesion de nuevo'));
      expect(ApiClient.authToken, isNull);
      expect(secure, isEmpty);
      expect(preferences, isEmpty);
    });
  }

  test('lost switch response is ambiguous and forces relogin', () async {
    final secure = <String, String>{'user_token': 'access-old'};
    final preferences = <String, Object>{
      'vendedor_codes': ['050', '051']
    };
    final adapter = _AuthAdapter((options) async {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
      );
    });
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(await container.read(authProvider.notifier).switchRole('REPARTIDOR'),
        isFalse);
    expect(container.read(authProvider).requireValue.isAuthenticated, isFalse);
    expect(ApiClient.authToken, isNull);
  });

  test('definitive 403 keeps the old authenticated projection', () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(
        {'error': 'No autorizado', 'code': 'ROLE_NOT_ASSOCIATED'},
        status: 403,
      ),
    );
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(await container.read(authProvider.notifier).switchRole('REPARTIDOR'),
        isFalse);
    final auth = container.read(authProvider).requireValue;
    expect(auth.user, managerUser);
    expect(auth.activeMode, 'COMERCIAL');
    expect(ApiClient.authToken, 'access-old');
  });

  test('503 during switch is CAS-ambiguous and forces relogin', () async {
    final secure = <String, String>{'user_token': 'access-old'};
    final preferences = <String, Object>{
      'vendedor_codes': ['050', '051']
    };
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(
        {
          'error': 'session store unavailable',
          'code': 'AUTH_SESSION_STORE_UNAVAILABLE'
        },
        status: 503,
      ),
    );
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    expect(await container.read(authProvider.notifier).switchRole('REPARTIDOR'),
        isFalse);
    expect(container.read(authProvider).requireValue.isAuthenticated, isFalse);
    expect(ApiClient.authToken, isNull);
    expect(secure, isEmpty);
    expect(preferences, isEmpty);
  });

  test('refresh commits complete projection before publishing new bearer',
      () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(canonicalResponse(
        role: 'JEFE_VENTAS',
        activeMode: 'COMERCIAL',
        accessTokenKey: 'accessToken',
      )),
    );
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);
    ApiClient.refreshTokenReaderOverride = () async => 'refresh-old';

    expect(await ApiClient.refreshAccessToken(), isTrue);
    final auth = container.read(authProvider).requireValue;
    expect(auth.user, managerUser);
    expect(auth.vendedorCodes, ['050', '051']);
    expect(ApiClient.authToken, 'access-new-JEFE_VENTAS');
    expect(secure['refresh_token'], 'refresh-new-JEFE_VENTAS');
  });

  test('refresh persistence failure clears bearer and requires relogin',
      () async {
    final secure = <String, String>{'user_token': 'access-old'};
    final preferences = <String, Object>{
      'vendedor_codes': ['050', '051']
    };
    final adapter = _AuthAdapter(
      (_) async => jsonResponse(canonicalResponse(
        role: 'JEFE_VENTAS',
        activeMode: 'COMERCIAL',
        accessTokenKey: 'accessToken',
      )),
    );
    final container = await containerFor(
      adapter,
      fakePersistence(
        secure: secure,
        preferences: preferences,
        failAtWrite: 2,
      ),
    );
    addTearDown(container.dispose);
    ApiClient.refreshTokenReaderOverride = () async => 'refresh-old';

    expect(await ApiClient.refreshAccessToken(), isFalse);
    expect(container.read(authProvider).requireValue.isAuthenticated, isFalse);
    expect(ApiClient.authToken, isNull);
    expect(secure, isEmpty);
    expect(preferences, isEmpty);
  });

  test('lost refresh response after possible CAS forces relogin', () async {
    final secure = <String, String>{'user_token': 'access-old'};
    final preferences = <String, Object>{
      'vendedor_codes': ['050', '051']
    };
    final adapter = _AuthAdapter((options) async {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.receiveTimeout,
      );
    });
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);
    ApiClient.refreshTokenReaderOverride = () async => 'refresh-old';

    expect(await ApiClient.refreshAccessToken(), isFalse);
    expect(container.read(authProvider).requireValue.isAuthenticated, isFalse);
    expect(ApiClient.authToken, isNull);
    expect(adapter.requests, hasLength(1));
  });

  test('logout posts once with bearer before clearing local session', () async {
    final secure = <String, String>{'user_token': 'access-old'};
    final preferences = <String, Object>{
      'vendedor_codes': ['050', '051']
    };
    final adapter = _AuthAdapter((_) async => jsonResponse({'success': true}));
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    await container.read(authProvider.notifier).logout();

    expect(adapter.requests, hasLength(1));
    expect(adapter.requests.single.path, ApiConfig.logout);
    expect(adapter.requests.single.method, 'POST');
    expect(
        adapter.requests.single.headers['Authorization'], 'Bearer access-old');
    expect(ApiClient.authToken, isNull);
    expect(secure, isEmpty);
    expect(preferences, isEmpty);
    expect(container.read(authProvider).requireValue.isAuthenticated, isFalse);
  });

  test('remote logout failure is not retried and never preserves credentials',
      () async {
    final secure = <String, String>{'user_token': 'access-old'};
    final preferences = <String, Object>{
      'vendedor_codes': ['050', '051']
    };
    final adapter = _AuthAdapter(
      (_) async => jsonResponse({'error': 'unavailable'}, status: 503),
    );
    final container = await containerFor(
      adapter,
      fakePersistence(secure: secure, preferences: preferences),
    );
    addTearDown(container.dispose);

    await container.read(authProvider.notifier).logout();

    expect(adapter.requests, hasLength(1));
    expect(ApiClient.authToken, isNull);
    expect(secure, isEmpty);
    expect(preferences, isEmpty);
    expect(container.read(authProvider).requireValue.error,
        contains('no se pudo confirmar'));
  });
}
