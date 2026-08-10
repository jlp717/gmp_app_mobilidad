import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';

void main() {
  const signatureId =
      'ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const photoId =
      'ev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const receiver = RepartoReceiver(
    nombre: 'Ana',
    apellidos: 'Recibe',
    dni: '12345678Z',
  );

  RepartoDeliveryLine line({
    num delivered = 10,
    num rejected = 0,
    num pending = 0,
    RepartoDifferenceReason? reason,
  }) =>
      RepartoDeliveryLine(
        lineaId: '1',
        codigoArticulo: 'ART-1',
        cantidadPedida: 10,
        cantidadEntregada: delivered,
        cantidadRechazada: rejected,
        cantidadPendiente: pending,
        motivoDiferencia: reason,
      );

  RepartoConfirmationRequest request({
    RepartoDeliveryStatus status = RepartoDeliveryStatus.entregado,
    List<RepartoDeliveryLine>? lines,
    RepartoReceiver? deliveryReceiver = receiver,
    String? signature = signatureId,
    List<String> evidenceIds = const <String>[],
    RepartoIncident? incident,
    String? observations,
    RepartoPayment? payment,
  }) =>
      RepartoConfirmationRequest(
        itemId: 'delivery-1',
        status: status,
        occurredAt: DateTime.utc(2026, 8, 3, 10),
        lineas: lines ?? <RepartoDeliveryLine>[line()],
        receiver: deliveryReceiver,
        firma: signature,
        evidencias: evidenceIds,
        incidencia: incident,
        observaciones: observations,
        cobro: payment,
      );

  group('RepartoConfirmationRequest', () {
    test('serializes a complete delivery using canonical backend names', () {
      final json = request().toJson();

      expect(json['cobro'], isNull);
      expect(json['delivery'], <String, dynamic>{
        'itemId': 'delivery-1',
        'status': 'ENTREGADO',
        'occurredAt': '2026-08-03T10:00:00.000Z',
        'lineas': <Map<String, dynamic>>[
          <String, dynamic>{
            'lineaId': '1',
            'codigoArticulo': 'ART-1',
            'cantidadPedida': 10,
            'cantidadEntregada': 10,
            'cantidadRechazada': 0,
            'cantidadPendiente': 0,
            'motivoDiferencia': null,
          },
        ],
        'receiver': <String, dynamic>{
          'nombre': 'Ana',
          'apellidos': 'Recibe',
          'dni': '12345678Z',
        },
        'firma': signatureId,
        'forceUpdate': false,
      });
    });

    test('accepts the four terminal delivery states only with their invariants',
        () {
      expect(request().toJson(), isNotEmpty);
      expect(
        request(
          status: RepartoDeliveryStatus.parcial,
          lines: <RepartoDeliveryLine>[
            line(
              delivered: 6,
              pending: 4,
              reason: RepartoDifferenceReason.productoFaltante,
            ),
          ],
        ).toJson(),
        isNotEmpty,
      );
      expect(
        request(
          status: RepartoDeliveryStatus.noEntregado,
          lines: <RepartoDeliveryLine>[
            line(
              delivered: 0,
              pending: 10,
              reason: RepartoDifferenceReason.clienteAusente,
            ),
          ],
          deliveryReceiver: null,
          signature: null,
          incident: const RepartoIncident(
            tipo: RepartoIncidentType.clienteAusente,
            motivo: 'Cliente ausente',
          ),
          observations: 'Se intentó la entrega.',
        ).toJson(),
        isNotEmpty,
      );
      expect(
        request(
          status: RepartoDeliveryStatus.rechazado,
          lines: <RepartoDeliveryLine>[
            line(
              delivered: 0,
              rejected: 10,
              reason: RepartoDifferenceReason.rechazoCliente,
            ),
          ],
        ).toJson(),
        isNotEmpty,
      );
    });

    test('rejects line, receiver, status, payment and non-delivery violations',
        () {
      expect(
        () => request(
          lines: <RepartoDeliveryLine>[line(delivered: 9)],
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(
          deliveryReceiver: const RepartoReceiver(
            nombre: 'Ana',
            apellidos: 'Recibe',
            dni: '12345678A',
          ),
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(
          status: RepartoDeliveryStatus.entregado,
          lines: <RepartoDeliveryLine>[
            line(
              delivered: 5,
              pending: 5,
              reason: RepartoDifferenceReason.productoFaltante,
            ),
          ],
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(
          status: RepartoDeliveryStatus.noEntregado,
          lines: <RepartoDeliveryLine>[
            line(
              delivered: 0,
              pending: 10,
              reason: RepartoDifferenceReason.clienteAusente,
            ),
          ],
          deliveryReceiver: null,
          signature: null,
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(
          status: RepartoDeliveryStatus.rechazado,
          lines: <RepartoDeliveryLine>[
            line(
              delivered: 0,
              rejected: 10,
              reason: RepartoDifferenceReason.rechazoCliente,
            ),
          ],
          payment: const RepartoPayment(
            importeCobrado: 1,
            formaPago: 'EFECTIVO',
          ),
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
    });

    test(
        'allows payment only for complete or partial delivery and keeps no actor fields',
        () {
      final json = request(
        payment: const RepartoPayment(
          entregaId: 'delivery-1',
          importeCobrado: 12.5,
          formaPago: 'EFECTIVO',
        ),
      ).toJson();

      expect(json['cobro'], isA<Map<String, dynamic>>());
      expect(
          (json['delivery'] as Map<String, dynamic>)
              .containsKey('repartidorId'),
          isFalse);
      expect(
          (json['cobro'] as Map<String, dynamic>)
              .containsKey('codigoRepartidor'),
          isFalse);
      final payment = json['cobro'] as Map<String, dynamic>;
      expect(payment, <String, dynamic>{
        'entregaId': 'delivery-1',
        'importeCobrado': 12.5,
        'formaPago': 'EFECTIVO',
      });
      for (final field in <String>[
        'codigoCliente',
        'tipoDocumento',
        'origenDocumento',
        'subempresaDocumento',
        'xdeDocumento',
        'dexDocumento',
        'importePendiente',
        'pantallaOrigen',
      ]) {
        expect(payment.containsKey(field), isFalse);
      }
    });

    test('preserves fractional delivered and pending quantities', () {
      final json = request(
        status: RepartoDeliveryStatus.parcial,
        lines: <RepartoDeliveryLine>[
          line(
            delivered: 6.25,
            pending: 3.75,
            reason: RepartoDifferenceReason.productoFaltante,
          ),
        ],
      ).toJson();
      final lines =
          (json['delivery'] as Map<String, dynamic>)['lineas'] as List<dynamic>;
      final serialized = lines.single as Map<String, dynamic>;

      expect(serialized['cantidadEntregada'], 6.25);
      expect(serialized['cantidadPendiente'], 3.75);
    });

    test('keeps final JSON free of base64 and accepts 20 opaque photo IDs', () {
      final ids = List<String>.filled(20, photoId);
      final json = request(evidenceIds: ids).toJson();
      final encoded = jsonEncode(json);

      expect(encoded, isNot(contains('base64,')));
      expect(encoded, isNot(contains('data:image')));
      expect(
        (json['delivery'] as Map<String, dynamic>)['evidencias'],
        ids,
      );
    });

    test('rejects evidence count and non-opaque ID boundaries', () {
      expect(
        () => request(evidenceIds: List<String>.filled(21, photoId)).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(signature: 'data:image/png;base64,AAAA').toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(evidenceIds: const <String>['/tmp/photo.jpg']).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
    });

    test('rejects payment values outside the canonical backend bounds', () {
      expect(
        () => request(
          payment: const RepartoPayment(
            importeCobrado: 100000000,
            formaPago: 'EFECTIVO',
          ),
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
      expect(
        () => request(
          payment: RepartoPayment(
            importeCobrado: 1,
            formaPago: List<String>.filled(21, 'X').join(),
            notas: List<String>.filled(501, 'N').join(),
          ),
        ).toJson(),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
    });
  });

  group('RepartoConfirmationOperation', () {
    test(
        'preserves key and UTC occurrence time on retry, regenerating only for material change',
        () {
      var generated = 0;
      final operation = RepartoConfirmationOperation(
        keyGenerator: () => 'rep-key-${++generated}',
        clock: () => DateTime.parse('2026-08-03T12:34:56+02:00'),
      );

      final first = operation.prepare(request());
      final retry = operation.prepare(request());
      final changed =
          operation.prepare(request(observations: 'Cambio material'));

      expect(first.idempotencyKey, 'rep-key-1');
      expect(first.isRetry, isFalse);
      expect(retry.idempotencyKey, first.idempotencyKey);
      expect(retry.isRetry, isTrue);
      expect(retry.toJson()['delivery']?['occurredAt'],
          '2026-08-03T10:34:56.000Z');
      expect(changed.idempotencyKey, 'rep-key-2');
      expect(changed.isRetry, isFalse);
    });

    test('makes a double submit visible without dropping the retry operation',
        () {
      final operation =
          RepartoConfirmationOperation(keyGenerator: () => 'rep-key');
      operation.prepare(request());

      expect(operation.beginSubmit(), isTrue);
      expect(operation.beginSubmit(), isFalse);
      operation.endSubmit();
      expect(operation.beginSubmit(), isTrue);
    });

    test('uses a canonical fingerprint for equivalent maps and lists', () {
      final first = <String, dynamic>{
        'delivery': <String, dynamic>{
          'status': 'ENTREGADO',
          'lineas': <Map<String, dynamic>>[
            <String, dynamic>{'codigo': 'A', 'cantidad': 1},
          ],
        },
      };
      final equivalent = <String, dynamic>{
        'delivery': <String, dynamic>{
          'lineas': <Map<String, dynamic>>[
            <String, dynamic>{'cantidad': 1, 'codigo': 'A'},
          ],
          'status': 'ENTREGADO',
        },
      };

      expect(
        RepartoConfirmationOperation.fingerprintForJson(first),
        RepartoConfirmationOperation.fingerprintForJson(equivalent),
      );
    });

    test('generates a backend-valid idempotency key by default', () {
      final prepared = RepartoConfirmationOperation().prepare(request());

      expect(
        RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(
          prepared.idempotencyKey,
        ),
        isTrue,
      );
    });
  });
}
