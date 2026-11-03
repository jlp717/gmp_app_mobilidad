import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const pathProviderChannel = MethodChannel('plugins.flutter.io/path_provider');
  const secureStorageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  late Directory cacheDirectory;
  final secureValues = <String, String>{};

  setUpAll(() async {
    cacheDirectory = await Directory.systemTemp.createTemp('api_epoch_cache_');
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(pathProviderChannel, (call) async {
      if (call.method == 'getApplicationDocumentsDirectory' ||
          call.method == 'getApplicationDocumentsPath') {
        return cacheDirectory.path;
      }
      return cacheDirectory.path;
    });
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (call) async {
      final args = Map<String, dynamic>.from(call.arguments as Map);
      final key = args['key'] as String?;
      switch (call.method) {
        case 'write':
          secureValues[key!] = args['value'] as String;
          return null;
        case 'read':
          return secureValues[key];
        case 'delete':
          secureValues.remove(key);
          return null;
        case 'deleteAll':
          secureValues.clear();
          return null;
      }
      return null;
    });
    await CacheService.init();
  });

  tearDown(() async {
    ApiClient.resetForTesting();
    await CacheService.clearAll();
  });

  tearDownAll(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(pathProviderChannel, null);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  test('expected auth epoch rejects before a replacement bearer is attached',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final epochA = ApiClient.authMutationEpoch;
    final release = Completer<void>();
    final adapter = _CaptureAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final request = ApiClient.runForAuthEpoch(epochA, () async {
      await release.future;
      return ApiClient.post('/pedidos/create', const {'clientCode': 'C1'});
    });

    ApiClient.setAuthToken('token-b');
    release.complete();

    await expectLater(
      request,
      throwsA(
        isA<ApiException>()
            .having((error) => error.code, 'code', 'AUTH_CONTEXT_CHANGED'),
      ),
    );
    expect(adapter.fetchCount, 0);
    expect(adapter.authorizationHeaders, isEmpty);
  });

  test('stable expected auth epoch reaches transport with its bearer',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final adapter = _CaptureAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final response = await ApiClient.runForAuthEpoch(
      ApiClient.authMutationEpoch,
      () => ApiClient.post('/pedidos/create', const {'clientCode': 'C1'}),
    );

    expect(response['ok'], isTrue);
    expect(adapter.fetchCount, 1);
    expect(adapter.authorizationHeaders, ['Bearer token-a']);
  });

  test('expected auth epoch also fences a delayed GET before dispatch',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final epochA = ApiClient.authMutationEpoch;
    final release = Completer<void>();
    final adapter = _CaptureAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final request = ApiClient.runForAuthEpoch(epochA, () async {
      await release.future;
      return ApiClient.get(
        '/pedidos',
        forceRefresh: true,
        cacheResponse: false,
      );
    });

    ApiClient.setAuthToken('token-b');
    release.complete();

    await expectLater(
      request,
      throwsA(
        isA<ApiException>()
            .having((error) => error.code, 'code', 'AUTH_CONTEXT_CHANGED'),
      ),
    );
    expect(adapter.fetchCount, 0);
  });

  test('expected auth epoch rejects an in-flight GET before publication',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final epochA = ApiClient.authMutationEpoch;
    final responseGate = Completer<void>();
    final adapter = _CaptureAdapter(responseGate: responseGate);
    ApiClient.dio.httpClientAdapter = adapter;

    final request = ApiClient.runForAuthEpoch(
      epochA,
      () => ApiClient.get(
        '/pedidos',
        forceRefresh: true,
        cacheResponse: false,
      ),
    );
    while (adapter.fetchCount == 0) {
      await Future<void>.delayed(Duration.zero);
    }

    ApiClient.setAuthToken('token-b');
    responseGate.complete();

    await expectLater(
      request,
      throwsA(
        isA<ApiException>()
            .having((error) => error.code, 'code', 'AUTH_CONTEXT_CHANGED'),
      ),
    );
    expect(adapter.fetchCount, 1);
  });

  test('auth-bound map GET bypasses cache read and write', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    const cacheKey = 'auth-bound-map-cache';
    await CacheService.set(cacheKey, const {'source': 'cached'});
    final adapter = _CaptureAdapter(
      responseJson: const {'source': 'network'},
    );
    ApiClient.dio.httpClientAdapter = adapter;

    final response = await ApiClient.runForAuthEpoch(
      ApiClient.authMutationEpoch,
      () => ApiClient.get('/pedidos', cacheKey: cacheKey),
    );

    expect(response, const {'source': 'network'});
    expect(adapter.fetchCount, 1);
    expect(
      CacheService.get<Map<dynamic, dynamic>>(cacheKey),
      const {'source': 'cached'},
    );
  });

  test('auth-bound list GET bypasses cache read and write', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    const cacheKey = 'auth-bound-list-cache';
    await CacheService.set(cacheKey, const ['cached']);
    final adapter = _CaptureAdapter(responseJson: const ['network']);
    ApiClient.dio.httpClientAdapter = adapter;

    final response = await ApiClient.runForAuthEpoch(
      ApiClient.authMutationEpoch,
      () => ApiClient.getList('/pedidos', cacheKey: cacheKey),
    );

    expect(response, const ['network']);
    expect(adapter.fetchCount, 1);
    expect(CacheService.get<List<dynamic>>(cacheKey), const ['cached']);
  });

  test('auth-bound GET calls never share a pending request', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final responseGate = Completer<void>();
    final adapter = _CaptureAdapter(responseGate: responseGate);
    ApiClient.dio.httpClientAdapter = adapter;
    final epoch = ApiClient.authMutationEpoch;

    final first = ApiClient.runForAuthEpoch(
      epoch,
      () => ApiClient.get('/pedidos', cacheKey: 'bound-dedupe'),
    );
    final second = ApiClient.runForAuthEpoch(
      epoch,
      () => ApiClient.get('/pedidos', cacheKey: 'bound-dedupe'),
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final dispatchedBeforeRelease = adapter.fetchCount;
    responseGate.complete();
    await Future.wait([first, second]);

    expect(dispatchedBeforeRelease, 2);
  });

  test('auth-bound list GET calls never share a pending request', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final responseGate = Completer<void>();
    final adapter = _CaptureAdapter(
      responseGate: responseGate,
      responseJson: const ['network'],
    );
    ApiClient.dio.httpClientAdapter = adapter;
    final epoch = ApiClient.authMutationEpoch;

    final first = ApiClient.runForAuthEpoch(
      epoch,
      () => ApiClient.getList('/pedidos', cacheKey: 'bound-list-dedupe'),
    );
    final second = ApiClient.runForAuthEpoch(
      epoch,
      () => ApiClient.getList('/pedidos', cacheKey: 'bound-list-dedupe'),
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final dispatchedBeforeRelease = adapter.fetchCount;
    responseGate.complete();
    await Future.wait([first, second]);

    expect(dispatchedBeforeRelease, 2);
  });

  test('ordinary GET keeps cache and pending-request deduplication', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final responseGate = Completer<void>();
    final adapter = _CaptureAdapter(responseGate: responseGate);
    ApiClient.dio.httpClientAdapter = adapter;

    final first = ApiClient.get('/pedidos', cacheKey: 'normal-cache');
    final second = ApiClient.get('/pedidos', cacheKey: 'normal-cache');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final concurrentDispatches = adapter.fetchCount;
    responseGate.complete();
    await Future.wait([first, second]);
    final cached = await ApiClient.get('/pedidos', cacheKey: 'normal-cache');

    expect(concurrentDispatches, 1);
    expect(adapter.fetchCount, 1);
    expect(cached['ok'], isTrue);
  });
}

class _CaptureAdapter implements HttpClientAdapter {
  _CaptureAdapter({this.responseGate, this.responseJson = const {'ok': true}});

  final Completer<void>? responseGate;
  final Object responseJson;
  int fetchCount = 0;
  final authorizationHeaders = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    fetchCount++;
    authorizationHeaders.add(options.headers['Authorization']?.toString());
    await responseGate?.future;
    return ResponseBody.fromString(
      jsonEncode(responseJson),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
