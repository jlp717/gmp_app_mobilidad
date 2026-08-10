import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_clientes_page.dart';

HistoryClient _client(int id, {String? name}) {
  return HistoryClient(
    id: 'C$id',
    name: name ?? 'Cliente $id',
    address: 'Calle $id',
    totalDocuments: id,
  );
}

void _useWideTestViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1440, 2560);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Widget _page(RepartidorClientsLoader loader) {
  return MaterialApp(
    home: RepartidorClientesPage(
      repartidorId: '05',
      clientsLoader: loader,
      searchDebounce: Duration.zero,
    ),
  );
}

void main() {
  testWidgets('a late search response cannot overwrite the latest query', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    final initial = Completer<HistoryClientsPage>();
    final slow = Completer<HistoryClientsPage>();
    final fast = Completer<HistoryClientsPage>();

    await tester.pumpWidget(
      _page(({
        required String repartidorId,
        required int limit,
        required int offset,
        required bool forceRefresh,
        String? search,
      }) {
        if (search == 'slow') return slow.future;
        if (search == 'fast') return fast.future;
        return initial.future;
      }),
    );
    initial.complete((
      clients: <HistoryClient>[_client(1, name: 'Lista completa')],
      hasMore: false
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'slow');
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'fast');
    await tester.pump();
    fast.complete((
      clients: <HistoryClient>[_client(2, name: 'Resultado nuevo')],
      hasMore: false
    ));
    await tester.pumpAndSettle();
    slow.complete((
      clients: <HistoryClient>[_client(3, name: 'Resultado tardío')],
      hasMore: false
    ));
    await tester.pumpAndSettle();

    expect(find.text('Resultado nuevo'), findsOneWidget);
    expect(find.text('Resultado tardío'), findsNothing);
  });

  testWidgets('clearing search reloads the complete list', (tester) async {
    _useWideTestViewport(tester);
    final searches = <String?>[];

    await tester.pumpWidget(
      _page(({
        required String repartidorId,
        required int limit,
        required int offset,
        required bool forceRefresh,
        String? search,
      }) async {
        searches.add(search);
        return (
          clients: search == null
              ? <HistoryClient>[_client(1, name: 'Todos los clientes')]
              : <HistoryClient>[_client(2, name: 'Alpha')],
          hasMore: false,
        );
      }),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Alpha');
    await tester.pumpAndSettle();
    expect(find.text('Alpha'), findsWidgets);

    await tester.tap(find.byIcon(Icons.clear));
    await tester.pumpAndSettle();

    expect(searches.last, isNull);
    expect(find.text('Todos los clientes'), findsOneWidget);
    expect(find.textContaining('Ã'), findsNothing);
  });

  testWidgets('manual refresh bypasses cache', (tester) async {
    _useWideTestViewport(tester);
    final forceRefreshValues = <bool>[];

    await tester.pumpWidget(
      _page(({
        required String repartidorId,
        required int limit,
        required int offset,
        required bool forceRefresh,
        String? search,
      }) async {
        forceRefreshValues.add(forceRefresh);
        return (clients: <HistoryClient>[_client(1)], hasMore: false);
      }),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Actualizar'));
    await tester.pumpAndSettle();

    expect(forceRefreshValues, <bool>[false, true]);
  });

  testWidgets('loads a second page and renders more than 100 clients', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    final offsets = <int>[];

    await tester.pumpWidget(
      _page(({
        required String repartidorId,
        required int limit,
        required int offset,
        required bool forceRefresh,
        String? search,
      }) async {
        offsets.add(offset);
        if (offset == 0) {
          return (
            clients:
                List<HistoryClient>.generate(100, (index) => _client(index)),
            hasMore: true
          );
        }
        return (
          clients: List<HistoryClient>.generate(
            20,
            (index) => _client(100 + index),
          ),
          hasMore: false
        );
      }),
    );
    await tester.pumpAndSettle();

    final scrollable = find.byType(Scrollable).last;
    for (var attempt = 0; attempt < 12 && !offsets.contains(100); attempt++) {
      await tester.drag(scrollable, const Offset(0, -1800));
      await tester.pump();
    }
    await tester.pumpAndSettle();

    expect(offsets, contains(100));
    expect(find.text('120 clientes'), findsOneWidget);
  });

  testWidgets('shows an error with a retry action', (tester) async {
    _useWideTestViewport(tester);
    var attempts = 0;

    await tester.pumpWidget(
      _page(({
        required String repartidorId,
        required int limit,
        required int offset,
        required bool forceRefresh,
        String? search,
      }) async {
        attempts++;
        if (attempts == 1) throw StateError('private DB2 detail');
        return (clients: <HistoryClient>[_client(1)], hasMore: false);
      }),
    );
    await tester.pumpAndSettle();

    expect(find.text('No se pudieron cargar los clientes'), findsOneWidget);
    expect(find.textContaining('DB2'), findsNothing);
    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();

    expect(find.text('Cliente 1'), findsOneWidget);
  });
}
