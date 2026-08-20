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

  test('clearStaleAcknowledgedIfOpen unlocks a pending delivery', () async {
    final store = _MemoryStore();
    final journal = RepartoConfirmationJournal(store);
    await store.write(
      const RepartoConfirmationJournalEntry(
        deliveryId: '2026-A-1-99-C1',
        state: RepartoOperationState.acknowledged,
        evidences: {},
        confirmationId: '7',
      ),
    );

    await journal.clearStaleAcknowledgedIfOpen('2026-A-1-99-C1');
    expect(await store.read('2026-A-1-99-C1'), isNull);
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
      layout: const ThermalTicketLayout(widthMm: 80),
    );
    expect(zpl, contains('FACTURA F-9836'));
    expect(zpl, contains('247.17'));
    expect(zpl, contains('Receptor: Ana Lopez'));
    expect(zpl, contains('DNI: 12345678Z'));
    expect(zpl, contains('^PW'));
    expect(zpl, contains('^LT0'));
    expect(zpl, contains('^XZ'));
  });

  test('thermal layout keeps safe margins inside printable width', () {
    const narrow = ThermalTicketLayout(widthMm: 58);
    const wide = ThermalTicketLayout(widthMm: 80);

    // Printable width ≠ media width (avoids right-edge clipping).
    expect(wide.printWidthDots, 576); // 72mm @ 203dpi
    expect(narrow.printWidthDots, 384); // 48mm @ 203dpi

    for (final L in [narrow, wide]) {
      expect(L.xLeft, L.margin);
      expect(L.xRight, L.printWidthDots - L.margin);
      expect(L.contentWidth, L.xRight - L.xLeft);
      expect(L.yStart, L.marginTop);
      expect(L.logoMaxWidth, L.contentWidth);
      expect(L.colImp + 40, lessThanOrEqualTo(L.xRight));
      expect(L.centerX(L.logoMaxWidth), L.xLeft);
      expect(L.labelLength(100), 100 + L.marginBottom);
      // Logo centered element smaller than content stays inside box.
      final logoW = (L.contentWidth * 0.9).round();
      final cx = L.centerX(logoW);
      expect(cx, greaterThanOrEqualTo(L.xLeft));
      expect(cx + logoW, lessThanOrEqualTo(L.xRight));
    }

    expect(narrow.printWidthDots, lessThan(wide.printWidthDots));
    expect(ThermalTicketLayout.inferWidthMm('Zebra ZQ210'), 58);
    expect(ThermalTicketLayout.inferWidthMm('Zebra ZQ320'), 80);
  });
}
