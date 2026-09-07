import 'dart:math';

import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';

/// Document-scoped ceiling for rutero cobro (never above this albarán).
double effectiveDocumentCollectable(AlbaranEntrega albaran) {
  final saldo = albaran.importeDisponibleCobro ?? 0;
  return capSaldoCobrableAlDocumento(
    documentAmount: albaran.importeTotal,
    collectableAmount: saldo,
  );
}

/// Document identity required by POST /repartidor-finanzas/cobros.
class RuteroStandaloneCobroKeys {
  const RuteroStandaloneCobroKeys({
    required this.tipoDocumento,
    required this.origenDocumento,
    required this.subempresaDocumento,
    required this.ejercicioDocumento,
    required this.serieDocumento,
    required this.terminalDocumento,
    required this.numeroDocumento,
    required this.xdeDocumento,
    required this.dexDocumento,
  });

  final String tipoDocumento;
  final String origenDocumento;
  final String subempresaDocumento;
  final int ejercicioDocumento;
  final String serieDocumento;
  final int terminalDocumento;
  final int numeroDocumento;
  final int xdeDocumento;
  final int dexDocumento;
}

/// True when the rutero COBRO tab may register a real payment.
/// Optional/credit documents stay eligible: cobro opcional is not a lock.
bool canRegisterRuteroStandaloneCobro(AlbaranEntrega albaran) {
  if (albaran.isPendingPrice) return false;
  if (!albaran.tieneSaldoCobrable) return false;
  switch (albaran.estado) {
    case EstadoEntrega.noEntregado:
    case EstadoEntrega.rechazado:
      return false;
    case EstadoEntrega.pendiente:
    case EstadoEntrega.enRuta:
    case EstadoEntrega.entregado:
    case EstadoEntrega.parcial:
      break;
  }
  return albaran.codigoCliente.trim().isNotEmpty &&
      albaran.numeroAlbaran > 0 &&
      albaran.ejercicio >= 2000 &&
      albaran.ejercicio <= 2100 &&
      albaran.serie.trim().isNotEmpty;
}

/// Builds CVC keys from the albarán already loaded in the rutero sheet.
/// Defaults match cobroSchema (origen B, xde/dex 1) and CAC for route notes.
RuteroStandaloneCobroKeys? cobroKeysFromAlbaran(AlbaranEntrega albaran) {
  if (!canRegisterRuteroStandaloneCobro(albaran)) return null;
  final tipo = albaran.cobroTipoDocumento.trim().isNotEmpty
      ? albaran.cobroTipoDocumento.trim().toUpperCase()
      : 'CAC';
  final origen = albaran.cobroOrigenDocumento.trim().isNotEmpty
      ? albaran.cobroOrigenDocumento.trim().toUpperCase()
      : 'B';
  final subempresa =
      albaran.subempresa.trim().isNotEmpty ? albaran.subempresa.trim() : 'GMP';
  final xde =
      (albaran.cobroXdeDocumento ?? 0) > 0 ? albaran.cobroXdeDocumento! : 1;
  final dex =
      (albaran.cobroDexDocumento ?? 0) > 0 ? albaran.cobroDexDocumento! : 1;
  return RuteroStandaloneCobroKeys(
    tipoDocumento: tipo,
    origenDocumento: origen,
    subempresaDocumento: subempresa,
    ejercicioDocumento: albaran.ejercicio,
    serieDocumento: albaran.serie.trim(),
    terminalDocumento: albaran.terminal,
    numeroDocumento: albaran.numeroAlbaran,
    xdeDocumento: xde,
    dexDocumento: dex,
  );
}

String? validateRuteroStandaloneCobroAmount({
  required double? amount,
  required double maxCollectable,
}) {
  if (amount == null || amount <= 0) {
    return 'Indica el importe cobrado.';
  }
  final amountCents = (amount * 100).round();
  final maxCents = (maxCollectable * 100).round();
  if (amountCents > maxCents) {
    return 'El cobro no puede superar el saldo cobrable de este documento.';
  }
  return null;
}

double remainingCollectableAfter({
  required double currentAvailable,
  required double collected,
}) {
  final remaining = ((currentAvailable - collected) * 100).round() / 100;
  return remaining < 0.005 ? 0 : remaining;
}

String createRuteroStandaloneCobroIdempotencyToken(
  String repartidorId,
  String documentId, {
  List<int>? entropy,
}) {
  String safePart(String value) => value
      .trim()
      .replaceAll(RegExp('[^A-Za-z0-9_-]'), '_')
      .replaceAll(RegExp('_+'), '_');

  final rep = safePart(repartidorId);
  final document = safePart(documentId);
  if (rep.isEmpty || document.isEmpty) {
    throw ArgumentError('Repartidor y documento son obligatorios');
  }
  final random = Random.secure();
  final bytes = entropy ?? List<int>.generate(16, (_) => random.nextInt(256));
  if (bytes.length != 16 || bytes.any((byte) => byte < 0 || byte > 255)) {
    throw ArgumentError.value(entropy, 'entropy', 'Debe contener 16 bytes');
  }
  final intentId =
      bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  final prefix = 'rut_${rep}_';
  final suffix = '_$intentId';
  final maxDocumentLength =
      (128 - prefix.length - suffix.length).clamp(1, document.length);
  return '$prefix${document.substring(0, maxDocumentLength)}$suffix';
}

Map<String, dynamic> buildRuteroStandaloneCobroPayload({
  required AlbaranEntrega albaran,
  required String repartidorId,
  required double importeCobrado,
  required String formaPago,
  required String idempotencyToken,
  String? notas,
}) {
  final keys = cobroKeysFromAlbaran(albaran);
  if (keys == null) {
    throw StateError('El albarán no admite cobro desde el rutero');
  }
  // importePendiente is advisory: backend overwrites it with the document-capped
  // remainder. Send the same ceiling GET already exposed so old APIs stay aligned.
  final pending = remainingCollectableAfter(
    currentAvailable: effectiveDocumentCollectable(albaran),
    collected: importeCobrado,
  );
  final trimmedNotes = notas?.trim() ?? '';
  return <String, dynamic>{
    'entregaId': albaran.id,
    'codigoCliente': albaran.codigoCliente.trim(),
    'nombreCliente': albaran.nombreCliente.trim(),
    'codigoRepartidor': repartidorId.trim(),
    'tipoDocumento': keys.tipoDocumento,
    'origenDocumento': keys.origenDocumento,
    'subempresaDocumento': keys.subempresaDocumento,
    'ejercicioDocumento': keys.ejercicioDocumento,
    'serieDocumento': keys.serieDocumento,
    'terminalDocumento': keys.terminalDocumento,
    'numeroDocumento': keys.numeroDocumento,
    'xdeDocumento': keys.xdeDocumento,
    'dexDocumento': keys.dexDocumento,
    'importeCobrado': importeCobrado,
    'importePendiente': pending,
    'formaPago': formaPago.trim().toUpperCase(),
    'pantallaOrigen': 'RUTERO',
    'idempotencyToken': idempotencyToken,
    if (trimmedNotes.isNotEmpty) 'notas': trimmedNotes,
  };
}

double? parseStandaloneCobroMoney(String value) => parseRuteroMoney(value);
