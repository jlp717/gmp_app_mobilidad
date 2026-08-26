import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_clientes_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_historico_page.dart';

void main() {
  testWidgets('a concrete client owner is preserved from Clientes under ALL',
      (tester) async {
    String? clientId;
    String? clientName;
    String? owner;

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorClientesPage(
          repartidorId: 'ALL',
          isJefeMode: true,
          clientsLoader: ({
            required repartidorId,
            required limit,
            required offset,
            required forceRefresh,
            search,
          }) async =>
              (
            clients: [
              HistoryClient(
                id: 'C1',
                name: 'Cliente 1',
                address: 'Calle 1',
                totalDocuments: 1,
                repCode: '08',
              ),
            ],
            hasMore: false,
          ),
          onNavigateToHistoryWithOwner: (id, name, repartidorId) {
            clientId = id;
            clientName = name;
            owner = repartidorId;
          },
        ),
      ),
    );

    await tester.pumpAndSettle();
    await tester.tap(find.text('Cliente 1'));

    expect(clientId, 'C1');
    expect(clientName, 'Cliente 1');
    expect(owner, '08');
  });

  testWidgets('Histórico loads an initial client with its concrete owner',
      (tester) async {
    String? loadedOwner;

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorHistoricoPage(
          repartidorId: 'ALL',
          initialClientId: 'C1',
          initialClientName: 'Cliente 1',
          initialRepartidorId: '08',
          clientsPageLoader: ({
            required repartidorId,
            required limit,
            required offset,
            required forceRefresh,
            search,
          }) async =>
              (clients: const <HistoryClient>[], hasMore: false),
          documentsLoader: ({
            required clientId,
            required repartidorId,
            dateFrom,
            dateTo,
            year,
          }) async {
            loadedOwner = repartidorId;
            return const [];
          },
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(loadedOwner, '08');
  });

  testWidgets('Histórico debounces client searches and restarts pagination',
      (tester) async {
    final calls = <({String? search, int offset})>[];

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorHistoricoPage(
          repartidorId: '08',
          clientsPageLoader: ({
            required repartidorId,
            required limit,
            required offset,
            required forceRefresh,
            search,
          }) async {
            calls.add((search: search, offset: offset));
            return (
              clients: [
                HistoryClient(
                  id: search == null ? 'BASE' : 'ACME',
                  name: search == null ? 'Cliente base' : 'Cliente ACME',
                  address: 'Calle 1',
                  totalDocuments: 1,
                  repCode: '08',
                ),
              ],
              hasMore: search == null,
            );
          },
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(calls, [(search: null, offset: 0)]);

    await tester.enterText(
      find.byType(TextField).first,
      'ACME',
    );
    await tester.pump(const Duration(milliseconds: 250));
    expect(calls, [(search: null, offset: 0)]);

    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
    expect(calls, [
      (search: null, offset: 0),
      (search: 'ACME', offset: 0),
    ]);
    expect(find.text('Cliente ACME'), findsOneWidget);
  });

  testWidgets('documents paginate and expose a retryable load-more action',
      (tester) async {
    final offsets = <int>[];

    HistoryDocument document(String id, int number) => HistoryDocument(
          id: id,
          type: 'albaran',
          number: number,
          date: '2026-08-26',
          amount: 10,
          pending: 0,
          status: 'delivered',
          hasSignature: false,
          serie: 'A',
          ejercicio: 2026,
          terminal: 1,
          deliveryRepartidor: '08',
        );

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorHistoricoPage(
          repartidorId: 'ALL',
          initialClientId: 'C1',
          initialClientName: 'Cliente 1',
          initialRepartidorId: '08',
          clientsPageLoader: ({
            required repartidorId,
            required limit,
            required offset,
            required forceRefresh,
            search,
          }) async =>
              (clients: const <HistoryClient>[], hasMore: false),
          documentsPageLoader: ({
            required clientId,
            required repartidorId,
            required limit,
            required offset,
            dateFrom,
            dateTo,
            year,
          }) async {
            offsets.add(offset);
            return (
              documents: [document('D$offset', offset + 1)],
              hasMore: offset == 0,
            );
          },
        ),
      ),
    );

    await tester.pumpAndSettle();
    expect(offsets, [0]);
    expect(
      find.byKey(const ValueKey('history-documents-load-more')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('history-documents-load-more')));
    await tester.pumpAndSettle();

    expect(offsets, [0, 1]);
    expect(
      find.byKey(const ValueKey('history-documents-load-more')),
      findsNothing,
    );
  });
}
