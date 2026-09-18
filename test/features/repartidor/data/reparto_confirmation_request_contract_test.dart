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
  DateTime? occurredAt,
  DateTime Function()? clock,
  RepartoNotificationPrefs? notifications,
}) {
  final signatureId = 'ev_${List<String>.filled(64, 'a').join()}';
  return RepartoConfirmationRequest(
    itemId: '2026-A-1-42-C1',
    status: RepartoDeliveryStatus.entregado,
    occurredAt: occurredAt ?? DateTime.now().toUtc(),
    lineas: const <RepartoDeliveryLine>[],
    allowEmptyLineas: allowEmptyLineas,
    repartidorId: repartidorId,
    receiver: const RepartoReceiver(
      nombre: 'Ana',
      apellidos: 'Prueba',
      dni: '12345678Z',
    ),
    firma: signatureId,
    clock: clock,
    notifications: notifications,
  );
}

Map<String, dynamic> _delivery(RepartoConfirmationRequest request) =>
    request.toJson()['delivery']! as Map<String, dynamic>;

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

  group('reloj de validacion de occurredAt', () {
    final fixedNow = DateTime.utc(2030, 1, 2, 3, 4, 5);

    test('acepta exactamente cinco minutos futuros con reloj inyectado', () {
      final request = _emptyPrepaidRequest(
        occurredAt: fixedNow.add(const Duration(minutes: 5)),
        clock: () => fixedNow,
      );

      expect(
        _delivery(request)['occurredAt'],
        '2030-01-02T03:09:05.000Z',
      );
    });

    test('rechaza un microsegundo posterior a la tolerancia vigente', () {
      final request = _emptyPrepaidRequest(
        occurredAt: fixedNow.add(
          const Duration(minutes: 5, microseconds: 1),
        ),
        clock: () => fixedNow,
      );

      expect(
        request.toJson,
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
    });

    test('mantiene timestamps offline historicos y no serializa el reloj', () {
      final historical = DateTime.utc(2020, 2, 29, 23, 59, 59);
      final request = _emptyPrepaidRequest(
        occurredAt: historical,
        clock: () => fixedNow,
      );

      final delivery = _delivery(request);
      expect(delivery['occurredAt'], '2020-02-29T23:59:59.000Z');
      expect(delivery, isNot(contains('clock')));
    });

    test('normaliza a UTC los instantes de cambio horario sin alterar limite',
        () {
      final cases = <({DateTime now, DateTime occurredAt, String wire})>[
        (
          now: DateTime.utc(2026, 3, 29, 0, 59, 59),
          occurredAt: DateTime.utc(2026, 3, 29, 1, 4, 59),
          wire: '2026-03-29T01:04:59.000Z',
        ),
        (
          now: DateTime.utc(2026, 10, 25, 0, 30),
          occurredAt: DateTime.utc(2026, 10, 25, 0, 35),
          wire: '2026-10-25T00:35:00.000Z',
        ),
      ];

      for (final item in cases) {
        final request = _emptyPrepaidRequest(
          occurredAt: item.occurredAt,
          clock: () => item.now,
        );
        expect(_delivery(request)['occurredAt'], item.wire);
      }
    });
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

  test('prepare persistente conserva su reloj sin cambiar la huella', () async {
    final fixedNow = DateTime.utc(2030, 1, 2, 3, 4, 5);
    final request = _emptyPrepaidRequest(
      occurredAt: fixedNow,
      clock: () => DateTime.utc(2000),
    );
    final fingerprint = RepartoConfirmationOperation.fingerprintFor(request);
    final operation = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(_MemoryJournalStore()),
      keyGenerator: () => 'rep-persistent-clock',
      clock: () => fixedNow,
    );

    final prepared = await operation.prepare(request);
    final delivery = prepared.toJson()['delivery']! as Map<String, dynamic>;

    expect(delivery['occurredAt'], '2030-01-02T03:04:05.000Z');
    expect(delivery, isNot(contains('clock')));
    expect(prepared.fingerprint, fingerprint);
  });

  test('serializa cobro+notificaciones al Finalizar, no un cobro suelto', () {
    final json = RepartoConfirmationRequest(
      itemId: '2026-P-15-2296-C1',
      status: RepartoDeliveryStatus.entregado,
      occurredAt: DateTime.now().toUtc().subtract(const Duration(minutes: 5)),
      lineas: const <RepartoDeliveryLine>[
        RepartoDeliveryLine(
          lineaId: '1',
          codigoArticulo: 'POLLO',
          cantidadPedida: 5.75,
          cantidadEntregada: 5.75,
          cantidadRechazada: 0,
          cantidadPendiente: 0,
        ),
      ],
      repartidorId: '08',
      receiver: const RepartoReceiver(
        nombre: 'Ana',
        apellidos: 'Prueba',
        dni: '12345678Z',
      ),
      firma: 'ev_${List<String>.filled(64, 'a').join()}',
      cobro: const RepartoPayment(
        entregaId: '2026-P-15-2296-C1',
        importeCobrado: 161.58,
        formaPago: 'EFECTIVO',
        notas: 'Cobro en ruta',
      ),
      notifications: const RepartoNotificationPrefs(
        sendClientEmail: true,
        sendWhatsApp: true,
        clientEmail: 'bar@cliente.test',
      ),
    ).toJson();

    expect(json['cobro'], isA<Map<String, dynamic>>());
    expect(json['cobro']['notas'], 'Cobro en ruta');
    expect(json['cobro']['notas'], isNot(isNull));
    expect(json['notifications'], {
      'sendClientEmail': true,
      'sendWhatsApp': true,
      'clientEmail': 'bar@cliente.test',
    });
  });

  test('cobro sin texto envía notas vacías, nunca null', () {
    const payment = RepartoPayment(
      importeCobrado: 10,
      formaPago: 'EFECTIVO',
    );
    expect(payment.toJson()['notas'], '');
    expect(payment.toJson().containsKey('notas'), isTrue);
  });

  test('integra reloj local y preferencias materiales de notificacion',
      () async {
    final fixedNow = DateTime.utc(2030, 1, 2, 3, 4, 5);
    const notifications = RepartoNotificationPrefs(
      sendClientEmail: true,
      clientEmail: 'cliente@example.test',
    );
    final request = _emptyPrepaidRequest(
      occurredAt: fixedNow,
      clock: () => fixedNow,
      notifications: notifications,
    );
    final otherClock = _emptyPrepaidRequest(
      occurredAt: fixedNow,
      clock: () => DateTime.utc(2040),
      notifications: notifications,
    );
    final otherNotifications = _emptyPrepaidRequest(
      occurredAt: fixedNow,
      clock: () => fixedNow,
      notifications: const RepartoNotificationPrefs(sendWhatsApp: true),
    );
    final fingerprint = RepartoConfirmationOperation.fingerprintFor(request);

    expect(
      RepartoConfirmationOperation.fingerprintFor(otherClock),
      fingerprint,
    );
    expect(
      RepartoConfirmationOperation.fingerprintFor(otherNotifications),
      isNot(fingerprint),
    );

    final operation = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(_MemoryJournalStore()),
      keyGenerator: () => 'rep-clock-notifications',
      clock: () => fixedNow,
    );
    final prepared = await operation.prepare(request);
    final wire = prepared.toJson();

    expect(wire['notifications'], notifications.toJson());
    expect(wire, isNot(contains('clock')));
    expect(wire['delivery'], isNot(contains('clock')));
    expect(prepared.fingerprint, fingerprint);
  });
}
