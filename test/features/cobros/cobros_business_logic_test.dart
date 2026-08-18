import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/pages/cobro_detail_screen.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/client_balance_badge.dart';

void main() {
  group('Cobros models', () {
    test('parses pedidos summary separately from facturas and albaranes', () {
      final resumen = ResumenCobros.fromJson({
        'totalPendiente': 42.5,
        'pedidos': {'cantidad': 2, 'total': 42.5},
      });

      expect(resumen.totalPendiente, 42.5);
      expect(resumen.numPedidos, 2);
      expect(resumen.numFacturas, 0);
      expect(resumen.numAlbaranes, 0);
    });

    test('classifies due today as vencido when backend estado is missing', () {
      final today = DateTime.now();
      final dueToday = DateTime(today.year, today.month, today.day);

      final cobro = CobroPendiente.fromJson({
        'id': 'cvc_M_1',
        'referencia': 'M-1',
        'tipo': 'factura',
        'fecha': dueToday.toIso8601String(),
        'fechaVencimiento': dueToday.toIso8601String(),
        'importeTotal': 100,
        'importePendiente': 25,
      });

      expect(cobro.estado, EstadoCobro.vencido);
    });

    test('uses backend descripcion as visible payment concept', () {
      final cobro = CobroPendiente.fromJson({
        'id': 'cvc_M_123',
        'referencia': 'M-123',
        'tipo': 'factura',
        'fecha': '2026-06-10T00:00:00.000Z',
        'fechaVencimiento': '2026-06-10T00:00:00.000Z',
        'importeTotal': 120,
        'importePendiente': 45,
        'descripcion': 'FAC M-123',
      });

      expect(cobro.descripcion, 'FAC M-123');
      expect(cobro.conceptoVisible, 'FAC M-123');
    });

    test('builds stable payment references by document source', () {
      final cvc = CobroPendiente.fromJson({
        'id': 'cvc_M_123_1',
        'referencia': 'M-123',
        'tipo': 'factura',
        'fecha': '2026-06-10T00:00:00.000Z',
        'importeTotal': 120,
        'importePendiente': 45,
        'docKey': {'source': 'CVC', 'serie': 'M', 'numero': 123},
      });
      final appOrder = CobroPendiente.fromJson({
        'id': 'PEDIDO:22:M-7',
        'referencia': 'M-7',
        'tipo': 'pedido_app',
        'fecha': '2026-06-23T00:00:00.000Z',
        'importeTotal': 30,
        'importePendiente': 30,
        'provisional': true,
        'docKey': {'source': 'PEDIDOS_CAB', 'id': 22},
      });

      expect(cvc.paymentReference, 'CVC:M-123');
      expect(appOrder.paymentReference, 'PEDIDO:22:M-7');
      expect(appOrder.isPedidoAppProvisional, isTrue);
    });
  });

  group('Cobros provider params', () {
    test('uses value equality for Riverpod family keys', () {
      const a = CobrosParams(employeeCode: '01');
      const b = CobrosParams(employeeCode: '01');
      const c = CobrosParams(employeeCode: '02');

      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a == c, isFalse);
    });

    test('builds backend-safe idempotency tokens for commercial payments', () {
      final token = buildCobroIdempotencyToken(
        employeeCode: '01',
        codigoCliente: '4300030041',
        referencia: 'M-1',
      );

      expect(token.length, greaterThanOrEqualTo(8));
      expect(token.length, lessThanOrEqualTo(128));
      expect(RegExp(r'^[A-Za-z0-9_.:-]+$').hasMatch(token), isTrue);
      expect(token, contains('01'));
      expect(token, contains('4300030041'));
    });

    test('sends bounded pagination params for pending summary', () async {
      final paths = <String>[];
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'GET' &&
              options.path.startsWith('/cobros/pending-summary/')) {
            paths.add(options.uri.toString());
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {
                  'success': true,
                  'summary': <String, dynamic>{},
                  'grandTotal': 0,
                  'grandTotalVencido': 0,
                },
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      final provider = CobrosProvider(employeeCode: '98');
      await provider.cargarPendingSummary(
        'ALL',
        limit: 9999,
        page: 0,
        offset: -10,
        tipoDocumento: 'COB',
        fechaDesde: '2026-06-01',
        fechaHasta: '2026-06-30',
      );

      expect(paths, hasLength(1));
      expect(paths.single, contains('/cobros/pending-summary/ALL'));
      expect(paths.single, contains('limit=2000'));
      expect(paths.single, contains('page=1'));
      expect(paths.single, contains('offset=0'));
      expect(paths.single, contains('tipoDocumento=COB'));
      expect(paths.single, contains('fechaDesde=2026-06-01'));
      expect(paths.single, contains('fechaHasta=2026-06-30'));
    });

    test('adds server cache buster and vendor scope on forced detail refresh',
        () async {
      final paths = <String>[];
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'GET' &&
              options.path.startsWith('/cobros/C001/pendientes')) {
            paths.add(options.uri.toString());
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {
                  'success': true,
                  'pendientes': {
                    'cobros': <dynamic>[],
                    'resumen': {'totalPendiente': 0},
                  },
                },
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      final provider = CobrosProvider(employeeCode: '01');
      await provider.cargarCobrosPendientes(
        'C001',
        vendedorCodes: '01',
        forceRefresh: true,
      );

      expect(paths, hasLength(1));
      expect(paths.single, contains('vendedorCodes=01'));
      expect(paths.single, contains('_ts='));
      expect(provider.cobrosPendientes, isEmpty);
    });
  });

  group('Pending summary status resolver', () {
    test('returns neutral status when summary entry is missing', () {
      expect(estadoFromPendingSummaryEntry(null), 'SIN_DATOS');
    });

    test('does not classify explicit SIN_DATOS as al dia', () {
      expect(
        estadoFromPendingSummaryEntry({'estado': 'SIN_DATOS'}),
        'SIN_DATOS',
      );
    });

    test('returns VENCIDO when pending and overdue amounts are positive', () {
      expect(
        estadoFromPendingSummaryEntry({'total': 42.5, 'vencido': 12.3}),
        'VENCIDO',
      );
    });

    test('returns PENDIENTE when pending amount is positive without overdue',
        () {
      expect(
        estadoFromPendingSummaryEntry({'total': 42.5, 'vencido': 0}),
        'PENDIENTE',
      );
    });

    test('returns AL_DIA only for explicit zero pending and overdue amounts',
        () {
      expect(
        estadoFromPendingSummaryEntry({'total': 0, 'vencido': 0}),
        'AL_DIA',
      );
    });
  });
  group('Client debt status parser', () {
    test('keeps missing balance distinct from explicit zero debt', () {
      expect(clientDebtFromMap(const {})['state'], 'none');
      final zeroDebt = clientDebtFromMap(const {'saldoPendiente': 0});
      expect(zeroDebt['state'], 'data');
      expect(clientDebtLabel(zeroDebt), 'Al día');
    });

    test('exposes loading and error instead of hiding failed debt loads', () {
      expect(
        clientDebtLabel(clientDebtFromMap(const {'balanceStatus': 'loading'})),
        'Consultando deuda',
      );
      expect(
        clientDebtLabel(clientDebtFromMap(const {'loadError': true})),
        'Deuda no disponible',
      );
    });

    test('classifies overdue debt before generic pending risk', () {
      final debt = clientDebtFromMap(const {
        'saldoPendiente': 250,
        'vencido': 10,
      });

      expect(debt['state'], 'data');
      expect(clientDebtLabel(debt), 'Vencido');
    });
  });

  group('Cobros delivery completion mutation contract', () {
    test('completarEntrega refuses retired mutation and does not POST',
        () async {
      final mutationBodies = <dynamic>[];
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST' && options.path == '/entregas/update') {
            mutationBodies.add(options.data);
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {'success': true},
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      final provider = CobrosProvider(employeeCode: 'TDD_RED_57');
      final ok = await provider.completarEntrega('alb-1');

      expect(ok, isFalse);
      expect(mutationBodies, isEmpty);
      expect(provider.error, contains('410'));
    });
  });

  group('Cobros payable UX rules', () {
    CobroPendiente buildCobro({
      required String id,
      required double pendiente,
      EstadoCobro estado = EstadoCobro.pendiente,
    }) {
      return CobroPendiente(
        id: id,
        referencia: id,
        tipo: TipoCobro.factura,
        fecha: DateTime(2026, 6, 13),
        importeTotal: 100,
        importePendiente: pendiente,
        estado: estado,
      );
    }

    test('filters zero and epsilon documents out of payable list', () {
      final payable = buildCobro(id: 'payable', pendiente: 12.34);
      final zero = buildCobro(id: 'zero', pendiente: 0);
      final epsilon = buildCobro(id: 'epsilon', pendiente: cobroPayableEpsilon);
      final paid = buildCobro(
        id: 'paid',
        pendiente: 20,
        estado: EstadoCobro.alDia,
      );

      expect(
        cobrosPayableItems([payable, zero, epsilon, paid]).map((c) => c.id),
        ['payable'],
      );
      expect(
        cobrosNonPayableItems([payable, zero, epsilon, paid]).map((c) => c.id),
        ['zero', 'epsilon', 'paid'],
      );
    });

    test('rejects overpay, zero and non-payable payment amounts', () {
      final cobro = buildCobro(id: 'doc', pendiente: 50);
      final zero = buildCobro(id: 'zero', pendiente: 0);

      expect(isValidCobroPaymentAmount(cobro, 0), isFalse);
      expect(isValidCobroPaymentAmount(cobro, 50.01), isFalse);
      expect(isValidCobroPaymentAmount(zero, 0.01), isFalse);
      expect(isValidCobroPaymentAmount(cobro, 50), isTrue);
    });

    test('keeps only failed retryable selections after partial success', () {
      final failed = buildCobro(id: 'failed', pendiente: 35);
      final nowPaid = buildCobro(id: 'now-paid', pendiente: 0);

      final nextSelection = nextCobroSelectionAfterSubmit(
        currentSelection: const {
          'success': 'COMPLETO',
          'failed': 'PARCIAL',
          'now-paid': 'COMPLETO',
          'ignored-none': 'NONE',
        },
        successfulIds: {'success'},
        latestCobros: [failed, nowPaid],
      );

      expect(nextSelection, {'failed': 'PARCIAL'});
    });
  });

  group('Cobros online retry idempotency', () {
    test('reuses idempotency token after an interrupted register attempt',
        () async {
      final requestBodies = <Map<String, dynamic>>[];
      var calls = 0;
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST' &&
              options.path == '/cobros/4300010363/registrar') {
            requestBodies.add(Map<String, dynamic>.from(options.data as Map));
            calls++;
            if (calls == 1) {
              handler.reject(
                DioException(
                  requestOptions: options,
                  type: DioExceptionType.sendTimeout,
                ),
              );
              return;
            }
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {'success': true},
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      final provider = CobrosProvider(employeeCode: '57');

      final first = await provider.registrarCobro(
        codigoCliente: '4300010363',
        referencia: 'M-1',
        importe: 12.34,
        formaPago: 'EFECTIVO',
        tipoVenta: TipoVenta.contado,
        tipoModo: TipoModoCobro.normal,
        reloadAfter: false,
      );
      final second = await provider.registrarCobro(
        codigoCliente: '4300010363',
        referencia: 'M-1',
        importe: 12.34,
        formaPago: 'EFECTIVO',
        tipoVenta: TipoVenta.contado,
        tipoModo: TipoModoCobro.normal,
        reloadAfter: false,
      );

      expect(first, isFalse);
      expect(second, isTrue);
      expect(requestBodies, hasLength(2));
      expect(
        requestBodies[1]['idempotencyToken'],
        requestBodies[0]['idempotencyToken'],
      );
    });
  });
}
