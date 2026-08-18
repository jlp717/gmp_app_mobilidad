import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';
import 'package:test/test.dart';

class _MemoryJournalStore implements RepartoConfirmationJournalStore {
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

RepartoConfirmationRequest _emptyPrepaidRequest({
  String repartidorId = '08',
  bool allowEmptyLineas = true,
}) {
  final signatureId = 'ev_${List<String>.filled(64, 'a').join()}';
  return RepartoConfirmationRequest(
    itemId: '2026-A-1-42-C1',
    status: RepartoDeliveryStatus.entregado,
    occurredAt: DateTime.now().toUtc(),
    lineas: const <RepartoDeliveryLine>[],
    allowEmptyLineas: allowEmptyLineas,
    repartidorId: repartidorId,
    receiver: const RepartoReceiver(
      nombre: 'Ana',
      apellidos: 'Prueba',
      dni: '12345678Z',
    ),
    firma: signatureId,
  );
}

void main() {
  test('serializa el prepago vacio autorizado sin exponer el flag local', () {
    final json = _emptyPrepaidRequest().toJson();
    final delivery = json['delivery']! as Map<String, dynamic>;

    expect(delivery['lineas'], isEmpty);
    expect(delivery['repartidorId'], '08');
    expect(delivery, isNot(contains('allowEmptyLineas')));
  });

  test('mantiene bloqueada una entrega vacia sin autorizacion prepago', () {
    expect(
      () => _emptyPrepaidRequest(allowEmptyLineas: false).toJson(),
      throwsA(isA<RepartoConfirmationValidationException>()),
    );
  });

  test('prepare conserva owner y la huella cambia al cambiar de conductor', () {
    final operation = RepartoConfirmationOperation(
      keyGenerator: () => 'rep-contract-fixed',
    );
    final owner08 = _emptyPrepaidRequest();
    final prepared = operation.prepare(owner08);
    final delivery = prepared.toJson()['delivery']! as Map<String, dynamic>;

    expect(delivery['repartidorId'], '08');
    expect(
      RepartoConfirmationOperation.fingerprintFor(owner08),
      isNot(
        RepartoConfirmationOperation.fingerprintFor(
          _emptyPrepaidRequest(repartidorId: '09'),
        ),
      ),
    );
  });

  test('prepare persistente conserva owner y prepago vacio', () async {
    final journal = RepartoConfirmationJournal(_MemoryJournalStore());
    final operation = RepartoPersistentConfirmationOperation(
      journal,
      keyGenerator: () => 'rep-persistent-fixed',
    );

    final prepared = await operation.prepare(_emptyPrepaidRequest());
    final delivery = prepared.toJson()['delivery']! as Map<String, dynamic>;

    expect(delivery['repartidorId'], '08');
    expect(delivery['lineas'], isEmpty);
  });
}
