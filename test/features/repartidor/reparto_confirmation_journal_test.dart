import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';

class _MemoryStore implements RepartoConfirmationJournalStore {
  final Map<String, RepartoConfirmationJournalEntry> entries = {};

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entries[deliveryId.trim()];

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    entries[entry.deliveryId] = entry;
  }

  @override
  Future<void> delete(String deliveryId) async {
    entries.remove(deliveryId.trim());
  }
}

void main() {
  test('resetIfNotAcknowledged clears a blocked journal', () async {
    final store = _MemoryStore();
    final journal = RepartoConfirmationJournal(store);
    await store.write(
      const RepartoConfirmationJournalEntry(
        deliveryId: '2026-A-1-42-C1',
        state: RepartoOperationState.manualReview,
        evidences: {},
      ),
    );

    await journal.resetIfNotAcknowledged('2026-A-1-42-C1');
    expect(await store.read('2026-A-1-42-C1'), isNull);
  });

  test('resetIfNotAcknowledged keeps acknowledged deliveries locked', () async {
    final store = _MemoryStore();
    final journal = RepartoConfirmationJournal(store);
    await store.write(
      const RepartoConfirmationJournalEntry(
        deliveryId: '2026-A-1-42-C1',
        state: RepartoOperationState.acknowledged,
        evidences: {},
        confirmationId: '7',
      ),
    );

    expect(
      () => journal.resetIfNotAcknowledged('2026-A-1-42-C1'),
      throwsA(isA<RepartoAlreadyAcknowledgedException>()),
    );
    expect(
      (await store.read('2026-A-1-42-C1'))?.state,
      RepartoOperationState.acknowledged,
    );
  });

  test('history reprint ZPL includes title, total, receptor and DNI', () {
    final zpl = ZebraPrintService.generateHistoryDeliveryZpl(
      title: 'FACTURA F-9836',
      clientName: 'WOK SUSHI TORO',
      dateLabel: '17/08/2026',
      total: 247.17,
      receptorNombre: 'Ana',
      receptorApellidos: 'Lopez',
      receptorDni: '12345678Z',
    );
    expect(zpl, contains('FACTURA F-9836'));
    expect(zpl, contains('247.17'));
    expect(zpl, contains('Receptor: Ana Lopez'));
    expect(zpl, contains('DNI: 12345678Z'));
    expect(zpl, contains('^XZ'));
  });
}
