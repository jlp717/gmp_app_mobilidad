import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_route_feedback.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';

import '../../../helpers/rutero_offline_transport.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late RuteroOfflineTransport offlineTransport;
  setUp(() => offlineTransport = RuteroOfflineTransport()..install());
  tearDown(() => offlineTransport.restore());
  group('Rutero HTTP contract', () {
    final calls = <RequestOptions>[];
    late InterceptorsWrapper interceptor;
    late Map<String, dynamic> Function(RequestOptions) responseFor;
    setUp(() {
      calls.clear();
      responseFor = (_) => {
            'success': true,
            'revision': 'next',
            'orden': [
              {'documentId': 'DOC-1'}
            ],
          };
      interceptor = InterceptorsWrapper(onRequest: (options, handler) {
        calls.add(options);
        handler.resolve(Response<Map<String, dynamic>>(
          requestOptions: options,
          statusCode: 200,
          data: responseFor(options),
        ));
      });
      ApiClient.dio.interceptors.add(interceptor);
    });
    tearDown(() => ApiClient.dio.interceptors.remove(interceptor));

    test(
        'save sends calendar date, revision and zero order; no idempotency header',
        () async {
      final saved = await RuteroRouteApi.saveOrder(
        repartidorId: '05',
        dateYmd: '2026-08-27',
        baseRevision: 'current',
        orden: [
          {'documentId': 'DOC-1', 'cliente': 'C1', 'posicion': 0}
        ],
      );
      expect(saved.revision, 'next');
      expect(calls.single.data['date'], '2026-08-27');
      expect(calls.single.data['baseRevision'], 'current');
      expect(calls.single.data['orden'].single['posicion'], 0);
      expect(
          calls.single.headers.keys
              .any((key) => key.toLowerCase() == 'idempotency-key'),
          isFalse);
      expect(calls.single.extra['skipRetry'], isTrue);
      expect(calls.single.receiveTimeout, const Duration(seconds: 30));
    });

    test('rejects an acknowledgement with a different sequence', () async {
      responseFor = (_) => {
            'success': true,
            'revision': 'next',
            'orden': ['DOC-1', 'DOC-2'],
          };
      await expectLater(
        RuteroRouteApi.saveOrder(
          repartidorId: '05',
          dateYmd: '2026-08-27',
          baseRevision: 'current',
          orden: [
            {'documentId': 'DOC-2'},
            {'documentId': 'DOC-1'},
          ],
        ),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'RUTERO_ORDER_ACK_MISMATCH')),
      );
    });

    test('an incomplete successful save is not accepted as an acknowledgement',
        () async {
      responseFor = (_) => {'success': true, 'revision': 'next', 'orden': []};
      await expectLater(
          RuteroRouteApi.saveOrder(
            repartidorId: '05',
            dateYmd: '2026-08-27',
            baseRevision: 'current',
            orden: [
              {'documentId': 'DOC-1', 'posicion': 0}
            ],
          ),
          throwsA(
              isA<ApiException>().having((e) => e.statusCode, 'status', 503)));
      expect(calls, hasLength(1));
    });

    test('full-day fetch follows all pages without search filters', () async {
      responseFor = (request) {
        final first = request.queryParameters['offset'] == 0;
        return {
          'success': true,
          'albaranes': [
            {'id': first ? 'A' : 'B'}
          ],
          'pagination': {'hasMore': first, 'nextOffset': first ? 100 : null}
        };
      };
      final rows = await RuteroRouteApi.fetchDayDocuments(
          repartidorId: '05', dateYmd: '2026-08-27');
      expect(rows.map((row) => row['id']), ['A', 'B']);
      expect(calls.map((r) => r.queryParameters['offset']), [0, 100]);
      expect(
          calls.every((r) => !r.queryParameters.containsKey('search')), isTrue);
    });

    test('nonadvancing pagination fails instead of saving a subset', () async {
      responseFor = (_) =>
          {'success': true, 'albaranes': [], 'hasMore': true, 'nextOffset': 0};
      await expectLater(
          RuteroRouteApi.fetchDayDocuments(
              repartidorId: '05', dateYmd: '2026-08-27'),
          throwsA(
              isA<ApiException>().having((e) => e.statusCode, 'status', 503)));
      expect(calls, hasLength(1));
    });

    test('day move requires a real ACK and opts into safe idempotent retries',
        () async {
      responseFor = (_) => {
            'success': true,
            'replayed': false,
            'sourceDate': '2026-08-27',
            'targetDate': '2026-08-28',
            'position': 2,
            'affectedDocuments': ['DOC-1'],
          };
      await RuteroRouteApi.moveDay(
          repartidorId: '05',
          dateYmd: '2026-08-27',
          targetDateYmd: '2026-08-28',
          position: 2,
          orden: [
            {'documentId': 'DOC-1'}
          ]);
      expect(calls.single.data['targetDate'], '2026-08-28');
      expect(calls.single.data['position'], 2);
      expect(calls.single.data['idempotencyKey'], startsWith('rutero-move-'));
      expect(calls.single.extra['idempotent'], isTrue);
      expect(calls.single.extra['maxRetries'], 2);
      expect(
          calls.single.headers.keys
              .any((k) => k.toLowerCase() == 'idempotency-key'),
          isFalse);
    });
  });
  test('missing revision fails locally without a save request', () async {
    await expectLater(
        RuteroRouteApi.saveOrder(
            repartidorId: '05',
            dateYmd: '2026-08-27',
            baseRevision: '',
            orden: []),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'RUTERO_ORDER_REVISION_REQUIRED')));
  });

  test(
      'calendar week keeps Sunday and year boundary without adding next Monday',
      () {
    final week = ruteroNaturalWeek(DateTime(2027, 1, 3));
    expect(week.first, DateTime(2026, 12, 28));
    expect(week.last, DateTime(2027, 1, 3));
    expect(week.length, 7);
  });

  test(
      'manual order clears previous estimates while preserving location/window',
      () {
    const meta = RuteroStopWindow(
        documentId: 'A',
        cliente: 'C',
        lat: 37,
        lng: -2,
        windowLabel: '09:00',
        etaLabel: '10:00',
        etaMinute: 600,
        distanceKmFromPrev: 15,
        travelMinutesFromPrev: 20);
    final cleared = meta.copyWith(clearTimeline: true);
    expect(cleared.etaLabel, isNull);
    expect(cleared.distanceKmFromPrev, isNull);
    expect(cleared.travelMinutesFromPrev, isNull);
    expect(cleared.lat, 37);
    expect(cleared.windowLabel, '09:00');
  });

  for (final status in [400, 409, 422, 503]) {
    test('HTTP $status maps to safe actionable copy', () {
      final message = ruteroRouteError(
          ApiException('SELECT internal details', statusCode: status));
      expect(message, isNot(contains('internal')));
      expect(message.toLowerCase(), contains('recarga'));
    });
  }

  group('RuteroOrderState', () {
    test('parsea revision y documentos desde filas o identificadores', () {
      final state = RuteroOrderState.fromJson({
        'routeRevision': 42,
        'items': [
          {'documentId': ' E-35-19 '},
          ' E-35-20 ',
          {'documentId': ''},
          null,
        ],
      });

      expect(state.revision, '42');
      expect(state.orden, ['E-35-19', 'E-35-20']);
    });

    test('usa una orden vacia si la respuesta no contiene una lista', () {
      final state = RuteroOrderState.fromJson({
        'version': 'rev-1',
        'orden': {'documentId': 'E-35-19'},
      });

      expect(state.revision, 'rev-1');
      expect(state.orden, isEmpty);
    });
  });

  group('isCompleteDocumentPermutation', () {
    const current = ['E-35-19', 'E-35-20', 'E-35-21'];

    test('rechaza propuestas vacias o parciales', () {
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const [],
        ),
        isFalse,
      );
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const ['E-35-19', 'E-35-20'],
        ),
        isFalse,
      );
    });

    test('rechaza documentos duplicados o vacios', () {
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const ['E-35-19', 'E-35-19', 'E-35-21'],
        ),
        isFalse,
      );
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const ['E-35-19', ' ', 'E-35-21'],
        ),
        isFalse,
      );
    });

    test('acepta una permutacion completa, tambien con espacios externos', () {
      expect(
        isCompleteDocumentPermutation(
          currentIds: current,
          proposedIds: const [' E-35-21 ', 'E-35-19', 'E-35-20'],
        ),
        isTrue,
      );
    });
  });
}
