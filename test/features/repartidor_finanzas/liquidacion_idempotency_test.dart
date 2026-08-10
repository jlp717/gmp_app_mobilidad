import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

void main() {
  setUp(() {
    ApiClient.resetForTesting();
    ApiClient.dio.options.baseUrl = 'https://invalid.invalid';
  });

  tearDown(ApiClient.resetForTesting);

  group('buildLiquidacionIdempotencyToken', () {
    test('is stable for the same repartidor and business day', () {
      final morning = buildLiquidacionIdempotencyToken(
        '94',
        DateTime(2026, 4, 23, 8),
      );
      final evening = buildLiquidacionIdempotencyToken(
        '94',
        DateTime(2026, 4, 23, 22, 59),
      );

      expect(morning, 'liq_94_20260423');
      expect(evening, morning);
    });

    test('changes with repartidor or business day', () {
      final base =
          buildLiquidacionIdempotencyToken('94', DateTime(2026, 4, 23));

      expect(
        buildLiquidacionIdempotencyToken('95', DateTime(2026, 4, 23)),
        isNot(base),
      );
      expect(
        buildLiquidacionIdempotencyToken('94', DateTime(2026, 4, 24)),
        isNot(base),
      );
    });
  });

  test('structured-entry token is opaque, bounded, and stable for one retry',
      () {
    final entropy = List<int>.generate(16, (index) => index);
    final first = createLiquidacionEntryIdempotencyToken(
      '94',
      DateTime(2026, 4, 23),
      'expense',
      amount: 12.50,
      detail: 'Combustible',
      observation: 'Ruta norte',
      entropy: entropy,
    );
    final retry = createLiquidacionEntryIdempotencyToken(
      '94',
      DateTime(2026, 4, 23),
      'expense',
      amount: 12.50,
      detail: 'Combustible',
      observation: 'Ruta norte',
      entropy: entropy,
    );
    expect(retry, first);
    expect(first, startsWith('le_94_20260423_expense_'));
    expect(first.length, lessThanOrEqualTo(128));
    expect(
      createLiquidacionEntryIdempotencyToken(
        '94',
        DateTime(2026, 4, 23),
        'expense',
        amount: 13,
        detail: 'Combustible',
        observation: 'Ruta norte',
        entropy: entropy,
      ),
      isNot(first),
    );
  });

  test('structured-entry fingerprint and token do not collide on delimiters',
      () {
    const entropy = <int>[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    final firstFingerprint = buildLiquidacionEntryFingerprint(
      '94',
      DateTime(2026, 4, 23),
      'expense',
      amount: 12.5,
      detail: 'A|B',
      observation: 'C',
    );
    final secondFingerprint = buildLiquidacionEntryFingerprint(
      '94',
      DateTime(2026, 4, 23),
      'expense',
      amount: 12.5,
      detail: 'A',
      observation: 'B|C',
    );

    expect(secondFingerprint, isNot(firstFingerprint));
    expect(
      createLiquidacionEntryIdempotencyToken(
        '94',
        DateTime(2026, 4, 23),
        'expense',
        amount: 12.5,
        detail: 'A|B',
        observation: 'C',
        entropy: entropy,
      ),
      isNot(
        createLiquidacionEntryIdempotencyToken(
          '94',
          DateTime(2026, 4, 23),
          'expense',
          amount: 12.5,
          detail: 'A',
          observation: 'B|C',
          entropy: entropy,
        ),
      ),
    );
  });

  test('close sends only the approved server-authoritative payload', () async {
    late String endpoint;
    late Map<String, dynamic> payload;
    final service = RepartidorFinanzasService(
      liquidacionPost: (requestEndpoint, requestPayload) async {
        endpoint = requestEndpoint;
        payload = requestPayload;
        return LiquidacionTransportResponse(statusCode: 201, body: {
          'created': true,
          'liquidacion': {
            'id': 'liq-1',
            'marker': 'marker-1',
            'repartidorId': '94',
            'date': '2026-04-23',
            'status': 'CLOSED',
            'snapshot': {
              'deliveries': 0,
              'payments': 0,
              'expenses': 0,
              'adjustments': 0,
              'pending': 0,
              'balance': 0,
            },
          },
          'outboxIntent': {'id': 'outbox-1'},
        });
      },
    );

    final result = await service.closeLiquidacion(
      repartidorId: '94',
      date: DateTime(2026, 4, 23),
      idempotencyToken: 'liq_94_20260423',
      matricula: '1234 ABC',
      codigoVehiculo: 'FURGON1',
      sendEmails: true,
    );

    expect(endpoint, '/repartidor-finanzas/liquidaciones');
    expect(payload.keys, {
      'repartidorId',
      'date',
      'idempotencyToken',
      'matricula',
      'codigoVehiculo',
      'sendEmails',
    });
    expect(result.created, isTrue);
    expect(result.status, 'CLOSED');
    expect(result.outboxPending, isTrue);
  });

  test('structured entries use strict endpoints and accept created or replay',
      () async {
    final requests = <String, Map<String, dynamic>>{};
    final service = RepartidorFinanzasService(
      liquidacionPost: (endpoint, payload) async {
        requests[endpoint] = payload;
        final type = endpoint.endsWith('gastos')
            ? 'EXPENSE'
            : endpoint.endsWith('ajustes')
                ? 'ADJUSTMENT'
                : 'BANK_DEPOSIT';
        return _transport(
          statusCode: endpoint.endsWith('gastos') ? 201 : 200,
          body: _entryResponse(
            created: endpoint.endsWith('gastos'),
            type: type,
            payload: payload,
          ),
        );
      },
    );
    final expense = await service.createLiquidacionExpense(
      repartidorId: '94',
      date: DateTime(2026, 4, 23),
      amount: 12.5,
      category: 'Combustible',
      idempotencyToken: 'entry-expense-1',
    );
    final deposit = await service.createLiquidacionBankDeposit(
      repartidorId: '94',
      date: DateTime(2026, 4, 23),
      amount: 10,
      reference: 'ING-1',
      idempotencyToken: 'entry-deposit-1',
    );
    expect(expense.created, isTrue);
    expect(expense.entry.type, 'EXPENSE');
    expect(deposit.isReplay, isTrue);
    expect(deposit.entry.type, 'BANK_DEPOSIT');
    expect(requests['/repartidor-finanzas/liquidaciones/gastos']!['category'],
        'Combustible');
    expect(
        requests['/repartidor-finanzas/liquidaciones/ingresos-bancarios']![
            'reference'],
        'ING-1');
  });

  test('liquidacion transport requires exact status and created pairing',
      () async {
    final validBody = _entryResponse(
      created: true,
      type: 'EXPENSE',
      payload: {
        'repartidorId': '94',
        'date': '2026-04-23',
        'amount': 1,
        'category': 'Parking',
      },
    );
    final invalidResponses = <LiquidacionTransportResponse>[
      _transport(statusCode: 200, body: validBody),
      _transport(statusCode: 201, body: {...validBody, 'created': false}),
      _transport(statusCode: 202, body: validBody),
    ];
    for (final response in invalidResponses) {
      final service = RepartidorFinanzasService(
        liquidacionPost: (_, __) async => response,
      );
      await expectLater(
        service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: 'Parking',
          idempotencyToken: 'expense-token-1',
        ),
        throwsA(isA<RepartidorLiquidacionContractException>()),
      );
    }
  });

  test('strict response rejects malformed identity, money, extras and shape',
      () {
    final valid = _entryResponse(
      created: true,
      type: 'EXPENSE',
      payload: {
        'repartidorId': '94',
        'date': '2026-04-23',
        'amount': 12.5,
        'category': 'Combustible',
      },
    );
    final malformed = <Map<String, dynamic>>[
      {...valid, 'extra': true},
      {...valid, 'created': 'true'},
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'type': 'ADJUSTMENT'}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'type': 'expense'}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'repartidorId': '95'}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'date': '2026-02-30'}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'amount': 0}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'amount': -1}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'amount': 1.001}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'amount': 100000000}
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'createdAt': 'not-date'}
      },
      {
        ...valid,
        'entry': {
          ...valid['entry'] as Map,
          'createdAt': '2026-02-30T10:00:00.000Z',
        },
      },
      {
        ...valid,
        'entry': {...valid['entry'] as Map, 'unknown': 'x'}
      },
    ];
    for (final response in malformed) {
      expect(
        () => RepartidorLiquidacionEntryResult.fromJson(
          response,
          expectedType: 'EXPENSE',
          expectedRepartidorId: '94',
          expectedDate: '2026-04-23',
        ),
        throwsA(isA<RepartidorLiquidacionContractException>()),
      );
    }
  });

  test('data layer rejects invalid requests before invoking the adapter',
      () async {
    var calls = 0;
    final service = RepartidorFinanzasService(
      liquidacionPost: (_, __) async {
        calls++;
        throw StateError('must not reach adapter');
      },
    );
    final invalidCalls = <Future<Object?> Function()>[
      () => service.createLiquidacionExpense(
          repartidorId: 'ALL',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: 'X',
          idempotencyToken: 'expense-token-1'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 0,
          category: 'X',
          idempotencyToken: 'expense-token-1'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: -1,
          category: 'X',
          idempotencyToken: 'expense-token-1'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 100000000,
          category: 'X',
          idempotencyToken: 'expense-token-1'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1.001,
          category: 'X',
          idempotencyToken: 'expense-token-1'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: List.filled(41, 'X').join(),
          idempotencyToken: 'expense-token-1'),
      () => service.createLiquidacionBankDeposit(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          reference: 'X',
          observation: List.filled(251, 'X').join(),
          idempotencyToken: 'deposit-token-1'),
      () => service.createLiquidacionAdjustment(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 0,
          reason: 'X',
          idempotencyToken: 'adjustment-token-1'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: 'X',
          idempotencyToken: 'bad token'),
      () => service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(10000, 4, 23),
          amount: 1,
          category: 'X',
          idempotencyToken: 'expense-token-1'),
    ];
    for (final call in invalidCalls) {
      await expectLater(
          call(), throwsA(isA<RepartidorLiquidacionInputException>()));
    }
    expect(calls, 0);
  });

  test('409, 503 and offline failures propagate without success parsing',
      () async {
    for (final error in <ApiException>[
      ApiException('conflict',
          statusCode: 409, code: 'LIQUIDACION_ENTRY_REPLAY_MISMATCH'),
      ApiException('unavailable', statusCode: 503),
      ApiException('offline', statusCode: 0),
    ]) {
      final service = RepartidorFinanzasService(
        liquidacionPost: (_, __) => Future.error(error),
      );
      await expectLater(
        service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: 'Parking',
          idempotencyToken: 'expense-token-1',
        ),
        throwsA(same(error)),
      );
    }
  });

  test('default liquidacion transport maps in-memory Dio failures safely',
      () async {
    for (final expected in <({int? statusCode, String code})>[
      (statusCode: 409, code: 'LIQUIDACION_CONFLICT'),
      (statusCode: 503, code: 'LIQUIDACION_SERVER_UNAVAILABLE'),
      (statusCode: null, code: 'LIQUIDACION_TIMEOUT'),
      (statusCode: null, code: 'LIQUIDACION_NETWORK'),
    ]) {
      ApiClient.dio.httpClientAdapter = _LiquidacionErrorAdapter(expected);
      final service = RepartidorFinanzasService();

      await expectLater(
        service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: 'Parking',
          idempotencyToken: 'expense-token-1',
        ),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode',
                  expected.statusCode ?? 0)
              .having((error) => error.code, 'code', expected.code)
              .having((error) => error.message, 'sanitized message',
                  isNot(contains('cliente@privado.invalid'))),
        ),
      );
    }
  });

  test('double submit shares one in-flight request and one result', () async {
    final response = Completer<LiquidacionTransportResponse>();
    var calls = 0;
    final service = RepartidorFinanzasService(
      liquidacionPost: (_, __) {
        calls++;
        return response.future;
      },
    );
    Future<RepartidorLiquidacionEntryResult> submit() =>
        service.createLiquidacionExpense(
          repartidorId: '94',
          date: DateTime(2026, 4, 23),
          amount: 1,
          category: 'Parking',
          idempotencyToken: 'expense-token-1',
        );
    final first = submit();
    final second = submit();
    expect(calls, 1);
    response.complete(_transport(
      statusCode: 201,
      body: _entryResponse(
        created: true,
        type: 'EXPENSE',
        payload: {
          'repartidorId': '94',
          'date': '2026-04-23',
          'amount': 1,
          'category': 'Parking',
        },
      ),
    ));
    final results = await Future.wait([first, second]);
    expect(results.every((result) => result.created), isTrue);
    expect(calls, 1);
  });

  test('OPEN ledger is exact and totals must match its entries', () async {
    Map<String, dynamic> ledgerResponse({double total = 2}) => {
          'success': true,
          'ledger': {
            'repartidorId': '94',
            'date': '2026-04-23',
            'status': 'OPEN',
            'expenses': [
              {
                'id': 'entry-1',
                'type': 'EXPENSE',
                'repartidorId': '94',
                'date': '2026-04-23',
                'amount': 2,
                'category': 'Parking',
                'status': 'PENDING',
                'createdAt': '2026-04-23T10:00:00.000Z',
              },
            ],
            'adjustments': const [],
            'bankDeposits': const [],
            'totals': {
              'expenses': total,
              'adjustments': 0,
              'bankDeposits': 0,
            },
          },
        };
    final service = RepartidorFinanzasService(
      liquidacionGet: (_, {queryParameters}) async => ledgerResponse(),
    );
    final ledger = await service.getLiquidacionLedger(
      repartidorId: '94',
      date: DateTime(2026, 4, 23),
    );
    expect(ledger.status, 'OPEN');
    expect(ledger.expenses.single.detail, 'Parking');

    final malformed = RepartidorFinanzasService(
      liquidacionGet: (_, {queryParameters}) async => ledgerResponse(total: 3),
    );
    await expectLater(
      malformed.getLiquidacionLedger(
        repartidorId: '94',
        date: DateTime(2026, 4, 23),
      ),
      throwsA(isA<RepartidorLiquidacionContractException>()),
    );
  });
}

class _LiquidacionErrorAdapter implements HttpClientAdapter {
  const _LiquidacionErrorAdapter(this.expected);

  final ({int? statusCode, String code}) expected;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    if (expected.statusCode case final statusCode?) {
      return Future.value(
        ResponseBody.fromString(
          jsonEncode(<String, dynamic>{
            'error': 'cliente@privado.invalid',
            'code': 'SENSITIVE_SERVER_CODE',
          }),
          statusCode,
          headers: <String, List<String>>{
            Headers.contentTypeHeader: <String>['application/json'],
          },
        ),
      );
    }
    return Future.error(
      DioException(
        requestOptions: options,
        type: expected.code == 'LIQUIDACION_TIMEOUT'
            ? DioExceptionType.connectionTimeout
            : DioExceptionType.connectionError,
      ),
    );
  }

  @override
  void close({bool force = false}) {}
}

LiquidacionTransportResponse _transport({
  required int statusCode,
  required Map<String, dynamic> body,
}) =>
    LiquidacionTransportResponse(statusCode: statusCode, body: body);

Map<String, dynamic> _entryResponse({
  required bool created,
  required String type,
  required Map<String, dynamic> payload,
}) {
  final detailKey = switch (type) {
    'EXPENSE' => 'category',
    'ADJUSTMENT' => 'reason',
    _ => 'reference',
  };
  return {
    'success': true,
    'created': created,
    'entry': {
      'id': 'entry-1',
      'type': type,
      'repartidorId': payload['repartidorId'],
      'date': payload['date'],
      'amount': payload['amount'],
      detailKey: payload[detailKey],
      if (payload['observation'] != null) 'observation': payload['observation'],
      'status': 'PENDING',
      'createdAt': '2026-04-23T10:00:00.000Z',
    },
  };
}
