import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_rutero_reorder_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_rutero_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_navigation_button.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_day_move_dialog.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_stop_status_badges.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_route_map_view.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_route_api.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../helpers/rutero_offline_transport.dart';

class MemoryTiles extends TileProvider {
  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) =>
      MemoryImage(TileProvider.transparentImage);
}

Map<String, dynamic> row(String id, {String status = 'PENDIENTE'}) => {
      'id': id,
      'numeroAlbaran': 1,
      'ejercicio': 2026,
      'codigoCliente': 'C1',
      'nombreCliente': 'Cliente $id',
      'fecha': '2026-08-27',
      'importe': 100,
      'estado': status,
      'esCTR': true,
    };

class SeededEntregas extends EntregasNotifier {
  @override
  EntregasState build() => EntregasState(
      repartidorId: '05',
      fechaSeleccionada: DateTime(2026, 8, 27),
      albaranes: [AlbaranEntrega.fromJson(row('DOC-1'))]);
}

class SeededCombinedEntregas extends EntregasNotifier {
  @override
  EntregasState build() => EntregasState(
      repartidorId: '05,94',
      fechaSeleccionada: DateTime(2026, 8, 27),
      albaranes: [AlbaranEntrega.fromJson(row('DOC-1'))]);
}

void main() {
  late InterceptorsWrapper fake;
  late RuteroOfflineTransport offlineTransport;
  var failOrder = false;
  final puts = <RequestOptions>[];
  final moves = <RequestOptions>[];
  final pendingGets = <RequestOptions>[];
  var pendingPagesRemaining = 0;
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });

  setUp(() {
    offlineTransport = RuteroOfflineTransport()..install();
    puts.clear();
    moves.clear();
    pendingGets.clear();
    failOrder = false;
    pendingPagesRemaining = 0;
    fake = InterceptorsWrapper(onRequest: (request, handler) {
      if (request.method == 'PUT') puts.add(request);
      if (request.method == 'GET' &&
          request.path.contains('/entregas/pendientes/')) {
        pendingGets.add(request);
      }
      if (request.method == 'GET' &&
          request.path.contains('/entregas/pendientes/')) {
        final offset = int.tryParse(
              request.uri.queryParameters['offset'] ?? '0',
            ) ??
            0;
        final hasMore = pendingPagesRemaining > 0;
        if (hasMore) pendingPagesRemaining -= 1;
        handler.resolve(Response<Map<String, dynamic>>(
          requestOptions: request,
          statusCode: 200,
          data: {
            'success': true,
            'albaranes': [row('DOC-1'), row('DOC-2')],
            'hasMore': hasMore,
            'pagination': {
              'hasMore': hasMore,
              'nextOffset': hasMore
                  ? offset +
                      (int.tryParse(
                              request.uri.queryParameters['limit'] ?? '100') ??
                          100)
                  : offset + 2,
            },
          },
        ));
        return;
      }
      if (request.method == 'POST' && request.path.endsWith('/move')) {
        moves.add(request);
        handler.resolve(Response<Map<String, dynamic>>(
          requestOptions: request,
          statusCode: 200,
          data: {
            'success': true,
            'affectedDocuments': ['DOC-1']
          },
        ));
        return;
      }
      if (failOrder && request.path.contains('/rutero/order/')) {
        if (request.method == 'GET') {
          handler.resolve(Response<Map<String, dynamic>>(
            requestOptions: request,
            statusCode: 200,
            data: {'success': true, 'revision': '', 'orden': []},
          ));
        } else {
          handler.reject(DioException(
              requestOptions: request,
              type: DioExceptionType.badResponse,
              response: Response(
                  requestOptions: request,
                  statusCode: 422,
                  data: {'code': 'RUTERO_ORDER_REVISION_REQUIRED'})));
        }
        return;
      }
      handler.resolve(Response<Map<String, dynamic>>(
        requestOptions: request,
        statusCode: 200,
        data: request.path.contains('/entregas/pendientes/')
            ? {
                'success': true,
                'albaranes': [row('DOC-1'), row('DOC-2')],
                'hasMore': false
              }
            : request.path.contains('stops-geo')
                ? {'success': true, 'stops': []}
                : {
                    'success': true,
                    'revision': 'rev-1',
                    'orden': request.method == 'PUT'
                        ? (request.data['orden'] as List<dynamic>)
                            .map((item) =>
                                (item as Map<String, dynamic>)['documentId'])
                            .toList()
                        : ['DOC-1', 'DOC-2']
                  },
      ));
    });
    ApiClient.dio.interceptors.add(fake);
  });
  tearDown(() {
    ApiClient.dio.interceptors.remove(fake);
    offlineTransport.restore();
  });

  testWidgets('failed initial revision stays visible and cannot save',
      (tester) async {
    failOrder = true;
    await tester.binding.setSurfaceSize(const Size(1000, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
        home: RepartidorRuteroReorderModal(
      repartidorId: '05',
      date: DateTime(2026, 8, 27),
      albaranes: [AlbaranEntrega.fromJson(row('DOC-1'))],
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guardar'));
    expect(puts, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('main delivery list loads all global route pages',
      (tester) async {
    pendingPagesRemaining = 1;
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: RepartidorRuteroPage(
            repartidorId: '05',
            weekLoader: ({
              required String repartidorId,
              required DateTime date,
              required bool forceRefresh,
            }) async =>
                {'success': true, 'days': <dynamic>[]},
          ),
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    expect(pendingGets, hasLength(2));
    expect(
        pendingGets.every(
          (request) => request.uri.queryParameters['routeOrder'] == 'true',
        ),
        isTrue);
  });

  testWidgets(
      'delivery records remain reachable on a short mobile viewport with sync notice',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 640));
    addTearDown(() async {
      OfflineSyncNotifier.refreshCounts(pending: 0, failed: 0);
      await tester.binding.setSurfaceSize(null);
    });
    OfflineSyncNotifier.refreshCounts(pending: 1, failed: 0);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: RepartidorRuteroPage(
            repartidorId: '05',
            weekLoader: ({
              required String repartidorId,
              required DateTime date,
              required bool forceRefresh,
            }) async =>
                {
              'success': true,
              'days': <dynamic>[],
            },
          ),
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(seconds: 2));

    expect(find.byType(CustomScrollView), findsOneWidget);
    expect(find.byType(ActionChip), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.drag(
      find.byType(CustomScrollView),
      const Offset(0, -600),
    );
    await tester.pump();
    expect(find.text('Cliente DOC-1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('position menu saves both documents in chosen order',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
        home: RepartidorRuteroReorderModal(
      repartidorId: '05',
      date: DateTime(2026, 8, 27),
      albaranes: [],
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Opciones de la parada 2'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cambiar posición'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Parada 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guardar'));
    await tester.pumpAndSettle();
    final rows = puts.single.data['orden'] as List;
    expect(rows.map((row) => row['documentId']), ['DOC-2', 'DOC-1']);
    expect(puts.single.data['baseRevision'], 'rev-1');
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('fallback keeps sequence numbers and missing next stop',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? selected;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: RuteroRouteMapView(
      useWebView: false,
      fallbackTileProvider: MemoryTiles(),
      ordered: [
        AlbaranEntrega.fromJson(row('A', status: 'ENTREGADO')),
        AlbaranEntrega.fromJson(row('B')),
        AlbaranEntrega.fromJson(row('C'))
      ],
      metaByDocumentId: const {
        'A': RuteroStopWindow(documentId: 'A', cliente: 'C1', lat: 37, lng: -2),
        'C': RuteroStopWindow(documentId: 'C', cliente: 'C1', lat: 37, lng: -2),
      },
      onStopSelected: (id) => selected = id,
    ))));
    await tester.pumpAndSettle();
    expect(find.text('1'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.textContaining('Siguiente: parada 2'), findsOneWidget);
    await tester.tap(find.textContaining('Siguiente: parada 2'));
    expect(selected, 'B');
    expect(find.textContaining('1 sin ubicación'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  group('native navigation', () {
    Future<void> pumpNavigation(
      WidgetTester tester,
      Future<bool> Function(Uri) launcher,
    ) =>
        tester.pumpWidget(MaterialApp(
          home: Scaffold(
            body: RuteroNavigationButton(lat: 37, lng: -2, launcher: launcher),
          ),
        ));

    for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
      final schemes = platform == TargetPlatform.android
          ? ['google.navigation', 'geo']
          : ['comgooglemaps', 'maps'];

      void expectPrimary(Uri uri) {
        expect(uri.scheme, schemes.first);
        expect(uri.scheme, isNot('https'));
        if (platform == TargetPlatform.android) {
          // google.navigation puts its parameters in the opaque URI path.
          expect(Uri.splitQueryString(uri.path), {
            'q': '37.0,-2.0',
            'mode': 'd',
          });
        } else {
          expect(uri.queryParameters, {
            'daddr': '37.0,-2.0',
            'directionsmode': 'driving',
          });
        }
      }

      testWidgets('$platform navigation stops after primary success',
          (tester) async {
        final attempts = <Uri>[];
        await pumpNavigation(tester, (uri) async {
          attempts.add(uri);
          return true;
        });
        await tester.tap(find.text('Navegar a esta parada'));
        await tester.pumpAndSettle();
        expect(attempts, hasLength(1));
        expectPrimary(attempts.single);
        expect(find.byType(SnackBar), findsNothing);
        expect(find.text('Navegar a esta parada'), findsOneWidget);
      }, variant: TargetPlatformVariant.only(platform));

      for (final throwsError in [false, true]) {
        testWidgets('$platform navigation falls back after error=$throwsError',
            (tester) async {
          final attempts = <Uri>[];
          await pumpNavigation(tester, (uri) async {
            attempts.add(uri);
            if (attempts.length == 1) {
              if (throwsError) throw StateError('unavailable');
              return false;
            }
            return true;
          });
          await tester.tap(find.text('Navegar a esta parada'));
          await tester.pumpAndSettle();
          expect(attempts.map((uri) => uri.scheme), schemes);
          expect(attempts.any((uri) => uri.scheme == 'https'), isFalse);
          expectPrimary(attempts.first);
          if (platform == TargetPlatform.android) {
            expect(attempts.last.path, '37.0,-2.0');
          } else {
            expect(attempts.last.queryParameters, {
              'daddr': '37.0,-2.0',
              'dirflg': 'd',
            });
          }
          expect(find.byType(SnackBar), findsNothing);
          expect(find.text('Navegar a esta parada'), findsOneWidget);
        }, variant: TargetPlatformVariant.only(platform));

        testWidgets('$platform navigation reports all errors=$throwsError',
            (tester) async {
          final attempts = <Uri>[];
          await pumpNavigation(tester, (uri) async {
            attempts.add(uri);
            if (throwsError) throw StateError('unavailable');
            return false;
          });
          await tester.tap(find.text('Navegar a esta parada'));
          await tester.pumpAndSettle();
          expect(attempts.map((uri) => uri.scheme), schemes);
          expect(attempts.any((uri) => uri.scheme == 'https'), isFalse);
          expect(find.byType(SnackBar), findsOneWidget);
          expect(find.textContaining('No se pudo abrir la navegación'),
              findsOneWidget);
          expect(
              tester
                  .widget<FilledButton>(find.bySubtype<FilledButton>())
                  .onPressed,
              isNotNull);
        }, variant: TargetPlatformVariant.only(platform));
      }
    }

    for (final platform in [
      TargetPlatform.linux,
      TargetPlatform.macOS,
      TargetPlatform.windows,
      TargetPlatform.fuchsia,
    ]) {
      testWidgets('$platform navigation shows error without launching a URL',
          (tester) async {
        final attempts = <Uri>[];
        await pumpNavigation(tester, (uri) async {
          attempts.add(uri);
          return true;
        });
        await tester.tap(find.text('Navegar a esta parada'));
        await tester.pumpAndSettle();
        expect(attempts, isEmpty);
        expect(find.byType(SnackBar), findsOneWidget);
      }, variant: TargetPlatformVariant.only(platform));
    }

    testWidgets('navigation ignores repeated taps while opening',
        (tester) async {
      final pending = Completer<bool>();
      final attempts = <Uri>[];
      await pumpNavigation(tester, (uri) {
        attempts.add(uri);
        return pending.future;
      });
      await tester.tap(find.text('Navegar a esta parada'));
      await tester.tap(find.text('Navegar a esta parada'));
      await tester.pump();
      expect(attempts, hasLength(1));
      expect(
          tester.widget<FilledButton>(find.bySubtype<FilledButton>()).onPressed,
          isNull);
      pending.complete(true);
      await tester.pumpAndSettle();
      expect(attempts, hasLength(1));
      expect(find.byType(SnackBar), findsNothing);
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));

    testWidgets('navigation allows ten seconds per attempt then reports error',
        (tester) async {
      final attempts = <Uri>[];
      await pumpNavigation(tester, (uri) {
        attempts.add(uri);
        return Completer<bool>().future;
      });
      await tester.tap(find.text('Navegar a esta parada'));
      await tester.pump(const Duration(seconds: 9));
      expect(attempts, hasLength(1));
      await tester.pump(const Duration(seconds: 1));
      expect(attempts.map((uri) => uri.scheme), ['google.navigation', 'geo']);
      await tester.pump(const Duration(seconds: 9));
      expect(find.byType(SnackBar), findsNothing);
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsOneWidget);
      expect(
          tester.widget<FilledButton>(find.bySubtype<FilledButton>()).onPressed,
          isNotNull);
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));
  });

  testWidgets('route without coordinates still exposes summary and next stop',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: RuteroRouteMapView(
      ordered: [AlbaranEntrega.fromJson(row('A'))],
      metaByDocumentId: const {},
      useWebView: false,
    ))));
    expect(find.textContaining('1 paradas restantes'), findsOneWidget);
    expect(find.textContaining('Siguiente: parada 1'), findsOneWidget);
    expect(find.text('No hay ubicaciones disponibles'), findsOneWidget);
  });

  testWidgets(
      'day move dialog sends a same-week move and closes after acknowledgement',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: RuteroDayMoveDialog(
      date: DateTime(2026, 8, 27),
      repartidorId: '05',
      stops: [AlbaranEntrega.fromJson(row('A'))],
    ))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mover parada'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Elige otro día'), findsOneWidget);
    await tester.tap(find.byType(DropdownButtonFormField<DateTime>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Viernes 28/8').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '3');
    await tester.tap(find.text('Mover parada'));
    await tester.pumpAndSettle();
    expect(moves, hasLength(1));
    expect(moves.single.data['targetDate'], '2026-08-28');
    expect(moves.single.data['position'], 2);
    expect(puts, isEmpty);
  });

  testWidgets('delivery and payment are independent readable badges',
      (tester) async {
    final semantics = tester.ensureSemantics();
    for (final status in ['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO']) {
      final doc = AlbaranEntrega.fromJson({
        ...row('DOC-1', status: status),
        'cobrado': true,
        'importeCobrado': 40,
        'importePendienteCobro': 60,
        'cobroParcial': true
      });
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(body: RuteroStopStatusBadges(albaran: doc))));
      expect(find.text('Entrega: ${doc.estado.label}'), findsOneWidget);
      expect(find.bySemanticsLabel('Entrega: ${doc.estado.label}'),
          findsOneWidget);
      expect(find.textContaining('Cobro parcial'), findsOneWidget);
    }
    semantics.dispose();
  });

  test(
      'acknowledged state updates immediately, queued state never does; reload uses server projection',
      () async {
    final container = ProviderContainer(
        overrides: [entregasProvider.overrideWith(SeededEntregas.new)]);
    addTearDown(container.dispose);
    final notifier = container.read(entregasProvider.notifier);
    final response = <String, dynamic>{
      'success': true,
      'confirmationId': '42',
      'cobroId': '43',
      'deliveryStatus': 'PARCIAL'
    };
    notifier.applyAcknowledgedDelivery(
        deliveryId: 'DOC-1',
        repartidorId: '05',
        response: {...response, 'queued': true});
    expect(container.read(entregasProvider).albaranes.single.estado,
        EstadoEntrega.pendiente);
    notifier.applyAcknowledgedDelivery(
        deliveryId: 'DOC-1',
        repartidorId: '05',
        response: response,
        acceptedPaymentAmount: 40,
        acceptedPaymentMethod: 'EFECTIVO');
    final immediate = container.read(entregasProvider).albaranes.single;
    expect(immediate.estado, EstadoEntrega.parcial);
    expect(immediate.hasAppCobro, isTrue);
    expect(
        immediate.importePendienteCobro, isNull); // Never invent the balance.
    ApiClient.dio.interceptors.remove(fake);
    fake = InterceptorsWrapper(
        onRequest: (request, handler) =>
            handler.resolve(Response<Map<String, dynamic>>(
              requestOptions: request,
              statusCode: 200,
              data: {
                'success': true,
                'albaranes': [
                  {
                    ...row('DOC-1', status: 'PARCIAL'),
                    'cobrado': true,
                    'importeCobrado': 40,
                    'importePendienteCobro': 60,
                    'cobroParcial': true
                  },
                ]
              },
            )));
    ApiClient.dio.interceptors.add(fake);
    await notifier.cargarAlbaranesPendientes(forceRefresh: true);
    final reloaded = container.read(entregasProvider).albaranes.single;
    expect(reloaded.estado, EstadoEntrega.parcial);
    expect(reloaded.cobroParcial, isTrue);
    expect(reloaded.importePendienteCobro, 60);

    final combined = ProviderContainer(
        overrides: [entregasProvider.overrideWith(SeededCombinedEntregas.new)]);
    addTearDown(combined.dispose);
    final combinedNotifier = combined.read(entregasProvider.notifier);
    combinedNotifier.applyAcknowledgedDelivery(
        deliveryId: 'DOC-1',
        repartidorId: '05',
        response: response,
        acceptedPaymentAmount: 40,
        acceptedPaymentMethod: 'EFECTIVO');
    expect(combined.read(entregasProvider).albaranes.single.estado,
        EstadoEntrega.parcial);
  });
}
