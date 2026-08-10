import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('ACK tombstone disables modal submission after restart',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final store = _SeededJournalStore(
      RepartoConfirmationJournalEntry(
        deliveryId: 'delivery-1',
        state: RepartoOperationState.acknowledged,
        evidences: const <String, RepartoEvidenceJournalRecord>{},
        confirmationFingerprint:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        confirmationIdempotencyKey: 'confirmation-key-first',
        occurredAt: DateTime.utc(2026, 8, 3, 12),
        confirmationId: '81',
      ),
    );
    final albaran = AlbaranEntrega(
      id: 'delivery-1',
      numeroAlbaran: 1,
      ejercicio: 2026,
      codigoCliente: 'client-1',
      nombreCliente: 'Cliente',
      fecha: '2026-08-03',
      importeTotal: 10,
      items: <EntregaItem>[
        EntregaItem(
          itemId: 'line-1',
          codigoArticulo: 'article-1',
          descripcion: 'Producto',
          cantidadPedida: 1,
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Consumer(
              builder: (context, ref, _) => RuteroDetailModal(
                albaran: albaran,
                ref: ref,
                confirmationJournalStore: store,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('FINALIZAR'));
    await tester.pumpAndSettle();

    final label = find.text('ENTREGA YA CONFIRMADA');
    expect(label, findsOneWidget);
    final buttonFinder = find.ancestor(
      of: label,
      matching: find.byType(ElevatedButton),
    );
    expect(buttonFinder, findsOneWidget);
    expect(tester.widget<ElevatedButton>(buttonFinder).onPressed, isNull);
    expect(store.writeCalls, 0);
    expect(store.entry.state, RepartoOperationState.acknowledged);
  });

  testWidgets('persisted manual review remains blocked after widget restart',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final store = _SeededJournalStore(
      const RepartoConfirmationJournalEntry(
        deliveryId: 'delivery-manual-review',
        state: RepartoOperationState.manualReview,
        evidences: <String, RepartoEvidenceJournalRecord>{},
      ),
    );
    final albaran = AlbaranEntrega(
      id: 'delivery-manual-review',
      numeroAlbaran: 1,
      ejercicio: 2026,
      codigoCliente: 'client-1',
      nombreCliente: 'Cliente',
      fecha: '2026-08-03',
      importeTotal: 10,
      items: <EntregaItem>[
        EntregaItem(
          itemId: 'line-1',
          codigoArticulo: 'article-1',
          descripcion: 'Producto',
          cantidadPedida: 1,
        ),
      ],
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Consumer(
              builder: (context, ref, _) => RuteroDetailModal(
                albaran: albaran,
                ref: ref,
                confirmationJournalStore: store,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pumpAndSettle();
    await tester.tap(find.text('FINALIZAR'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ElevatedButton>(
            find.widgetWithText(ElevatedButton, 'CONFIRMAR ENTREGA'),
          )
          .onPressed,
      isNull,
    );
    expect(store.writeCalls, 0);
    expect(store.entry.state, RepartoOperationState.manualReview);
  });

  for (final statusCode in <int>[500, 422, 200]) {
    test('$statusCode with already-confirmed code stays in manual review UI',
        () {
      expect(
        repartoConfirmationErrorDisposition(
          error: ApiException(
            'ambiguous result',
            statusCode: statusCode,
            code: 'DELIVERY_ALREADY_CONFIRMED',
          ),
          acknowledged: false,
        ),
        RepartoConfirmationErrorDisposition.manualReview,
      );
    });
  }

  test('canonical 409 shows already-confirmed UI only after local ACK', () {
    final error = ApiException(
      'already confirmed',
      statusCode: 409,
      code: 'DELIVERY_ALREADY_CONFIRMED',
    );

    expect(
      repartoConfirmationErrorDisposition(
        error: error,
        acknowledged: false,
      ),
      RepartoConfirmationErrorDisposition.manualReview,
    );
    expect(
      repartoConfirmationErrorDisposition(
        error: error,
        acknowledged: true,
      ),
      RepartoConfirmationErrorDisposition.alreadyConfirmed,
    );
  });
}

class _SeededJournalStore implements RepartoConfirmationJournalStore {
  _SeededJournalStore(this.entry);

  RepartoConfirmationJournalEntry entry;
  int writeCalls = 0;

  @override
  Future<void> delete(String deliveryId) async {
    throw StateError('ACK tombstones must not be deleted');
  }

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entry.deliveryId == deliveryId ? entry : null;

  @override
  Future<void> write(RepartoConfirmationJournalEntry value) async {
    writeCalls++;
    entry = value;
  }
}
