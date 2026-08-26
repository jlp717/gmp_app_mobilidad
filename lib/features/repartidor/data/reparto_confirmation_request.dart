// ignore_for_file: public_member_api_docs
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

enum RepartoDeliveryStatus {
  entregado('ENTREGADO'),
  parcial('PARCIAL'),
  noEntregado('NO_ENTREGADO'),
  rechazado('RECHAZADO');

  const RepartoDeliveryStatus(this.apiValue);

  final String apiValue;
}

enum RepartoDifferenceReason {
  productoFaltante('PRODUCTO_FALTANTE'),
  productoDanado('PRODUCTO_DANADO'),
  rechazoCliente('RECHAZO_CLIENTE'),
  clienteAusente('CLIENTE_AUSENTE'),
  direccionIncorrecta('DIRECCION_INCORRECTA'),
  accesoImposible('ACCESO_IMPOSIBLE'),
  otro('OTRO');

  const RepartoDifferenceReason(this.apiValue);

  final String apiValue;
}

enum RepartoIncidentType {
  clienteAusente('CLIENTE_AUSENTE'),
  direccionIncorrecta('DIRECCION_INCORRECTA'),
  accesoImposible('ACCESO_IMPOSIBLE'),
  vehiculo('VEHICULO'),
  productoDanado('PRODUCTO_DANADO'),
  rechazoCliente('RECHAZO_CLIENTE'),
  otro('OTRO');

  const RepartoIncidentType(this.apiValue);

  final String apiValue;
}

class RepartoConfirmationValidationException implements Exception {
  const RepartoConfirmationValidationException(this.message);

  final String message;

  @override
  String toString() => message;
}

class RepartoReceiver {
  const RepartoReceiver({
    required this.nombre,
    required this.apellidos,
    required this.dni,
  });

  final String nombre;
  final String apellidos;
  final String dni;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'nombre': nombre.trim(),
        'apellidos': apellidos.trim(),
        'dni': dni.trim().toUpperCase(),
      };
}

class RepartoIncident {
  const RepartoIncident({
    required this.tipo,
    required this.motivo,
    this.observaciones,
  });

  final RepartoIncidentType tipo;
  final String motivo;
  final String? observaciones;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'tipo': tipo.apiValue,
        'motivo': motivo.trim(),
        if (observaciones?.trim().isNotEmpty ?? false)
          'observaciones': observaciones!.trim(),
      };
}

class RepartoDeliveryLine {
  const RepartoDeliveryLine({
    required this.lineaId,
    required this.codigoArticulo,
    required this.cantidadPedida,
    required this.cantidadEntregada,
    required this.cantidadRechazada,
    required this.cantidadPendiente,
    this.motivoDiferencia,
    this.observaciones,
  });

  final String lineaId;
  final String codigoArticulo;
  final num cantidadPedida;
  final num cantidadEntregada;
  final num cantidadRechazada;
  final num cantidadPendiente;
  final RepartoDifferenceReason? motivoDiferencia;
  final String? observaciones;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'lineaId': lineaId.trim(),
        'codigoArticulo': codigoArticulo.trim(),
        'cantidadPedida': cantidadPedida,
        'cantidadEntregada': cantidadEntregada,
        'cantidadRechazada': cantidadRechazada,
        'cantidadPendiente': cantidadPendiente,
        'motivoDiferencia': motivoDiferencia?.apiValue,
        if (observaciones?.trim().isNotEmpty ?? false)
          'observaciones': observaciones!.trim(),
      };
}

class RepartoPayment {
  const RepartoPayment({
    required this.importeCobrado,
    required this.formaPago,
    this.entregaId,
    this.notas,
  });

  final String? entregaId;
  final num importeCobrado;
  final String formaPago;
  final String? notas;

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (entregaId?.trim().isNotEmpty ?? false)
          'entregaId': entregaId!.trim(),
        'importeCobrado': importeCobrado,
        'formaPago': formaPago.trim(),
        if (notas?.trim().isNotEmpty ?? false) 'notas': notas!.trim(),
      };
}

/// Immutable payload builder for the canonical reparto confirmation endpoint.
/// Ownership is derived from the bearer token; JEFE in Perfil Reparto must
/// also send [repartidorId] for the selected driver (Ver como).
class RepartoConfirmationRequest {
  const RepartoConfirmationRequest({
    required this.itemId,
    required this.status,
    required this.occurredAt,
    required this.lineas,
    this.allowEmptyLineas = false,
    this.repartidorId,
    this.receiver,
    this.firma,
    this.evidencias = const <String>[],
    this.observaciones,
    this.incidencia,
    this.latitud,
    this.longitud,
    this.cobro,
  });

  final String itemId;
  final RepartoDeliveryStatus status;
  final DateTime occurredAt;
  final List<RepartoDeliveryLine> lineas;

  /// Permite el prepago sin lineas validado por Rutero. No se serializa:
  /// el backend vuelve a contrastar el documento ERP y es la autoridad final.
  final bool allowEmptyLineas;

  final String? repartidorId;
  final RepartoReceiver? receiver;
  final String? firma;
  final List<String> evidencias;
  final String? observaciones;
  final RepartoIncident? incidencia;
  final double? latitud;
  final double? longitud;
  final RepartoPayment? cobro;

  Map<String, dynamic> toJson() {
    _validate();
    return <String, dynamic>{
      'delivery': <String, dynamic>{
        'itemId': itemId.trim(),
        'status': status.apiValue,
        'occurredAt': occurredAt.toUtc().toIso8601String(),
        if (_hasText(repartidorId)) 'repartidorId': repartidorId!.trim(),
        'lineas': lineas.map((line) => line.toJson()).toList(growable: false),
        if (receiver != null) 'receiver': receiver!.toJson(),
        if (_hasText(firma)) 'firma': firma!.trim(),
        if (evidencias.isNotEmpty)
          'evidencias':
              evidencias.map((id) => id.trim()).toList(growable: false),
        if (_hasText(observaciones)) 'observaciones': observaciones!.trim(),
        if (incidencia != null) 'incidencia': incidencia!.toJson(),
        if (latitud != null) 'latitud': latitud,
        if (longitud != null) 'longitud': longitud,
        'forceUpdate': false,
      },
      if (cobro != null) 'cobro': cobro!.toJson(),
    };
  }

  void _validate() {
    if (!_hasText(itemId)) _invalid('itemId es obligatorio');
    if ((lineas.isEmpty && !allowEmptyLineas) || lineas.length > 250) {
      _invalid('Debe existir entre una y 250 lineas');
    }
    if (occurredAt
        .isAfter(DateTime.now().toUtc().add(const Duration(minutes: 5)))) {
      _invalid('occurredAt no puede estar en el futuro');
    }
    final lineIds = <String>{};
    for (final line in lineas) {
      _validateLine(line);
      if (!lineIds.add(line.lineaId.trim())) _invalid('lineaId duplicado');
    }
    _validateReceiver();
    _validateEvidenceIds();
    _validateCoordinates();
    _validateStatus();
    _validatePayment();
  }

  void _validateLine(RepartoDeliveryLine line) {
    if (!_hasText(line.lineaId) || !_hasText(line.codigoArticulo)) {
      _invalid('lineaId y codigoArticulo son obligatorios');
    }
    final values = <num>[
      line.cantidadPedida,
      line.cantidadEntregada,
      line.cantidadRechazada,
      line.cantidadPendiente,
    ];
    if (values.any((value) => value.isNaN || value.isInfinite || value < 0) ||
        line.cantidadPedida <= 0) {
      _invalid('Las cantidades deben ser finitas y la pedida positiva');
    }
    final accounted = line.cantidadEntregada +
        line.cantidadRechazada +
        line.cantidadPendiente;
    if ((accounted - line.cantidadPedida).abs() > 0.0001) {
      _invalid('Las cantidades de linea deben conservar la cantidad pedida');
    }
    final hasDifference =
        line.cantidadRechazada > 0 || line.cantidadPendiente > 0;
    if (hasDifference != (line.motivoDiferencia != null)) {
      _invalid(
        'Cada diferencia requiere un motivo y no se permiten motivos sin diferencia',
      );
    }
  }

  void _validateReceiver() {
    if (status == RepartoDeliveryStatus.noEntregado) return;
    final value = receiver;
    if (value == null ||
        !_hasText(value.nombre) ||
        !_hasText(value.apellidos) ||
        !_isValidDniNie(value.dni)) {
      _invalid('Nombre, apellidos y DNI/NIE valido son obligatorios');
    }
    if (!_hasText(firma)) _invalid('La firma es obligatoria');
  }

  void _validateCoordinates() {
    if (latitud != null &&
        (latitud!.isNaN ||
            latitud!.isInfinite ||
            latitud! < -90 ||
            latitud! > 90)) {
      _invalid('Latitud invalida');
    }
    if (longitud != null &&
        (longitud!.isNaN ||
            longitud!.isInfinite ||
            longitud! < -180 ||
            longitud! > 180)) {
      _invalid('Longitud invalida');
    }
  }

  void _validateEvidenceIds() {
    if (_hasText(firma) && !_isValidEvidenceId(firma!)) {
      _invalid('Firma invalida');
    }
    if (evidencias.length > 20 ||
        evidencias.any((id) => !_isValidEvidenceId(id))) {
      _invalid('Evidencias invalidas');
    }
  }

  static bool _isValidEvidenceId(String value) =>
      RegExp(r'^ev_[a-f0-9]{64}$').hasMatch(value.trim());

  void _validateStatus() {
    final delivered =
        lineas.fold<num>(0, (sum, line) => sum + line.cantidadEntregada);
    final rejected =
        lineas.fold<num>(0, (sum, line) => sum + line.cantidadRechazada);
    final pending =
        lineas.fold<num>(0, (sum, line) => sum + line.cantidadPendiente);
    switch (status) {
      case RepartoDeliveryStatus.entregado:
        if (rejected > 0 || pending > 0) {
          _invalid('ENTREGADO exige todas las unidades entregadas');
        }
      case RepartoDeliveryStatus.parcial:
        if (delivered <= 0 || rejected + pending <= 0) {
          _invalid('PARCIAL exige entrega y diferencia');
        }
      case RepartoDeliveryStatus.noEntregado:
        if (delivered > 0 ||
            rejected > 0 ||
            receiver != null ||
            _hasText(firma) ||
            incidencia == null ||
            !_hasText(observaciones)) {
          _invalid(
            'NO_ENTREGADO exige lineas pendientes, incidencia y observaciones, sin receptor ni firma',
          );
        }
      case RepartoDeliveryStatus.rechazado:
        if (delivered > 0 || pending > 0) {
          _invalid('RECHAZADO exige todas las unidades rechazadas');
        }
    }
  }

  void _validatePayment() {
    if (cobro == null) return;
    if (status != RepartoDeliveryStatus.entregado &&
        status != RepartoDeliveryStatus.parcial) {
      _invalid('Solo ENTREGADO o PARCIAL permiten cobro');
    }
    if (cobro!.entregaId != null && cobro!.entregaId!.trim() != itemId.trim()) {
      _invalid('entregaId no coincide con itemId');
    }
    if (!_hasText(cobro!.formaPago) ||
        cobro!.formaPago.trim().length > 20 ||
        cobro!.importeCobrado <= 0 ||
        cobro!.importeCobrado > 99999999 ||
        cobro!.importeCobrado.isNaN ||
        cobro!.importeCobrado.isInfinite ||
        (cobro!.notas?.trim().length ?? 0) > 500) {
      _invalid('Cobro incompleto o invalido');
    }
  }

  static bool _hasText(String? value) => value?.trim().isNotEmpty ?? false;

  static bool _isValidDniNie(String value) {
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    final normalized = value.trim().toUpperCase();
    if (RegExp(r'^\d{8}[A-Z]$').hasMatch(normalized)) {
      return letters[int.parse(normalized.substring(0, 8)) % 23] ==
          normalized[8];
    }
    if (RegExp(r'^[XYZ]\d{7}[A-Z]$').hasMatch(normalized)) {
      final first =
          <String, String>{'X': '0', 'Y': '1', 'Z': '2'}[normalized[0]]!;
      return letters[int.parse('$first${normalized.substring(1, 8)}') % 23] ==
          normalized[8];
    }
    return false;
  }

  Never _invalid(String message) =>
      throw RepartoConfirmationValidationException(message);
}

/// Holds a key and occurrence time for a material confirmation. Rebuilding an
/// unchanged request is a retry; material changes explicitly receive a new key.
class RepartoConfirmationOperation {
  RepartoConfirmationOperation({
    String Function()? keyGenerator,
    DateTime Function()? clock,
  })  : _keyGenerator = keyGenerator ?? _defaultKey,
        _clock = clock ?? (() => DateTime.now().toUtc());

  final String Function() _keyGenerator;
  final DateTime Function() _clock;
  String? _fingerprint;
  String? _idempotencyKey;
  DateTime? _occurredAt;
  bool _submitting = false;

  bool get isSubmitting => _submitting;

  RepartoPreparedConfirmation prepare(RepartoConfirmationRequest request) {
    final materialFingerprint = fingerprintFor(request);
    final isRetry = _fingerprint == materialFingerprint;
    if (_fingerprint != materialFingerprint) {
      _fingerprint = materialFingerprint;
      _idempotencyKey = _keyGenerator();
      _occurredAt = _clock().toUtc();
    }
    return RepartoPreparedConfirmation(
      request: RepartoConfirmationRequest(
        itemId: request.itemId,
        status: request.status,
        occurredAt: _occurredAt!,
        lineas: request.lineas,
        allowEmptyLineas: request.allowEmptyLineas,
        repartidorId: request.repartidorId,
        receiver: request.receiver,
        firma: request.firma,
        evidencias: request.evidencias,
        observaciones: request.observaciones,
        incidencia: request.incidencia,
        latitud: request.latitud,
        longitud: request.longitud,
        cobro: request.cobro,
      ),
      idempotencyKey: _idempotencyKey!,
      isRetry: isRetry,
    );
  }

  bool beginSubmit() {
    if (_submitting) return false;
    _submitting = true;
    return true;
  }

  void endSubmit() => _submitting = false;

  static String fingerprintFor(RepartoConfirmationRequest request) {
    final material = RepartoConfirmationRequest(
      itemId: request.itemId,
      status: request.status,
      occurredAt: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      lineas: request.lineas,
      allowEmptyLineas: request.allowEmptyLineas,
      repartidorId: request.repartidorId,
      receiver: request.receiver,
      firma: request.firma,
      evidencias: request.evidencias,
      observaciones: request.observaciones,
      incidencia: request.incidencia,
      latitud: request.latitud,
      longitud: request.longitud,
      cobro: request.cobro,
    ).toJson();
    return fingerprintForJson(material);
  }

  static String fingerprintForJson(Map<String, dynamic> value) {
    final canonical = _canonicalize(value);
    return sha256.convert(utf8.encode(jsonEncode(canonical))).toString();
  }

  static Object? _canonicalize(Object? value) {
    if (value is List) {
      return value.map(_canonicalize).toList(growable: false);
    }
    if (value is Map) {
      final sortedKeys = value.keys.map((key) => key.toString()).toList()
        ..sort();
      return <String, Object?>{
        for (final key in sortedKeys) key: _canonicalize(value[key]),
      };
    }
    return value;
  }

  static String _defaultKey() {
    final random = Random.secure();
    final values = List<int>.generate(16, (_) => random.nextInt(256));
    return 'rep-${base64UrlEncode(values).replaceAll('=', '')}';
  }
}

class RepartoPreparedConfirmation {
  const RepartoPreparedConfirmation({
    required this.request,
    required this.idempotencyKey,
    required this.isRetry,
  });

  final RepartoConfirmationRequest request;
  final String idempotencyKey;
  final bool isRetry;

  String get fingerprint =>
      RepartoConfirmationOperation.fingerprintFor(request);

  Map<String, String> get headers =>
      <String, String>{'Idempotency-Key': idempotencyKey};
  Map<String, dynamic> toJson() => request.toJson();
}

/// Persists the material fingerprint, request key and occurrence time before
/// the network boundary so ambiguous retries keep the same operation identity.
class RepartoPersistentConfirmationOperation {
  RepartoPersistentConfirmationOperation(
    this._journal, {
    String Function()? keyGenerator,
    DateTime Function()? clock,
  })  : _keyGenerator =
            keyGenerator ?? RepartoConfirmationOperation._defaultKey,
        _clock = clock ?? (() => DateTime.now().toUtc());

  final RepartoConfirmationJournal _journal;
  final String Function() _keyGenerator;
  final DateTime Function() _clock;
  bool _submitting = false;

  bool beginSubmit() {
    if (_submitting) return false;
    _submitting = true;
    return true;
  }

  void endSubmit() => _submitting = false;

  Future<RepartoPreparedConfirmation> prepare(
    RepartoConfirmationRequest request,
  ) async {
    final fingerprint = RepartoConfirmationOperation.fingerprintFor(request);
    var entry = await _journal.loadOrCreate(request.itemId);
    _journal.ensureActive(entry);
    final storedFingerprint = entry.confirmationFingerprint;
    if (storedFingerprint != null && storedFingerprint != fingerprint) {
      await _journal.markManualReview(request.itemId);
      throw const RepartoConfirmationConflictException();
    }

    if (entry.state == RepartoOperationState.submitting) {
      entry = await _journal.recoverSubmittingForRetry(request.itemId);
    }

    final occurredAt = entry.occurredAt ?? _clock().toUtc();
    final idempotencyKey = entry.confirmationIdempotencyKey ?? _keyGenerator();
    entry = entry.copyWith(
      state: RepartoOperationState.ready,
      confirmationFingerprint: fingerprint,
      confirmationIdempotencyKey: idempotencyKey,
      occurredAt: occurredAt,
    );
    await _journal.writeEntry(entry);

    return RepartoPreparedConfirmation(
      request: RepartoConfirmationRequest(
        itemId: request.itemId,
        status: request.status,
        occurredAt: occurredAt,
        lineas: request.lineas,
        allowEmptyLineas: request.allowEmptyLineas,
        repartidorId: request.repartidorId,
        receiver: request.receiver,
        firma: request.firma,
        evidencias: request.evidencias,
        observaciones: request.observaciones,
        incidencia: request.incidencia,
        latitud: request.latitud,
        longitud: request.longitud,
        cobro: request.cobro,
      ),
      idempotencyKey: idempotencyKey,
      isRetry: storedFingerprint == fingerprint,
    );
  }

  Future<void> markSubmitting(String deliveryId) async {
    final entry = await _journal.loadOrCreate(deliveryId);
    await _journal.writeEntry(
      entry.copyWith(state: RepartoOperationState.submitting),
    );
  }

  Future<void> markManualReview(String deliveryId) =>
      _journal.markManualReview(deliveryId);

  Future<void> acknowledge(
    String deliveryId,
    RepartoPreparedConfirmation prepared, {
    required String confirmationId,
    String? cobroId,
  }) =>
      _journal.acknowledge(
        deliveryId,
        expectedFingerprint: prepared.fingerprint,
        expectedIdempotencyKey: prepared.idempotencyKey,
        confirmationId: confirmationId,
        cobroId: cobroId,
      );

  Future<void> acknowledgeResponse({
    required String deliveryId,
    required RepartoPreparedConfirmation prepared,
    required Map<String, dynamic> response,
  }) async {
    late final RepartoConfirmationAcknowledgement acknowledgement;
    try {
      acknowledgement =
          RepartoConfirmationAcknowledgement.fromResponse(response);
    } catch (_) {
      await _journal.markManualReview(deliveryId);
      rethrow;
    }
    await acknowledge(
      deliveryId,
      prepared,
      confirmationId: acknowledgement.confirmationId,
      cobroId: acknowledgement.cobroId,
    );
  }

  Future<bool> reconcileConflict({
    required String deliveryId,
    required int? statusCode,
    required String? code,
    required RepartoPreparedConfirmation prepared,
    String? confirmationId,
    String? cobroId,
  }) async {
    if (statusCode != 409 || code != 'DELIVERY_ALREADY_CONFIRMED') {
      await _journal.markManualReview(deliveryId);
      return false;
    }
    if (confirmationId != null && !isValidRepartoServerId(confirmationId)) {
      await _journal.markManualReview(deliveryId);
      return false;
    }
    final effectiveConfirmationId =
        confirmationId ?? await _journal.knownConfirmationId(deliveryId);
    if (effectiveConfirmationId == null) {
      await _journal.markManualReview(deliveryId);
      return false;
    }
    await acknowledge(
      deliveryId,
      prepared,
      confirmationId: effectiveConfirmationId,
      cobroId: cobroId,
    );
    return true;
  }
}
