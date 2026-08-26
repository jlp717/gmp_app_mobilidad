// ignore_for_file: public_member_api_docs

import 'dart:convert';

import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';

class RepartoConfirmationAcknowledgement {
  const RepartoConfirmationAcknowledgement({
    required this.confirmationId,
    this.cobroId,
  });

  factory RepartoConfirmationAcknowledgement.fromResponse(
    Map<String, dynamic> response,
  ) {
    final confirmationId = normalizeRepartoServerId(response['confirmationId']);
    final cobroId = normalizeRepartoServerId(response['cobroId']);
    if (response['success'] != true ||
        confirmationId == null ||
        !isValidRepartoServerId(confirmationId) ||
        (cobroId != null && !isValidRepartoServerId(cobroId))) {
      throw const RepartoReceiptUnavailableException();
    }
    return RepartoConfirmationAcknowledgement(
      confirmationId: confirmationId,
      cobroId: cobroId,
    );
  }

  final String confirmationId;
  final String? cobroId;
}

bool isValidRepartoOwnerId(String value) {
  final owner = value.trim();
  return owner.toUpperCase() != 'ALL' &&
      !owner.contains(',') &&
      RegExp(r'^[A-Za-z0-9]{1,2}$').hasMatch(owner);
}

String? resolveRepartoDocumentOwner({
  String? documentOwner,
  String? selectedOwner,
}) {
  for (final candidate in [documentOwner, selectedOwner]) {
    if (candidate != null && isValidRepartoOwnerId(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}

/// GET-only receipt resource. It deliberately accepts no body or editable
/// delivery fields: the backend renders its persisted confirmation snapshot.
class RepartoCanonicalReceiptRequest {
  const RepartoCanonicalReceiptRequest(
    this.confirmationId, {
    this.repartidorId,
  }) : assert(confirmationId.length > 0);

  final String confirmationId;
  final String? repartidorId;

  String get endpoint {
    if (!isValidRepartoServerId(confirmationId)) {
      throw const RepartoReceiptUnavailableException();
    }
    final base = '/repartidor-finanzas/rutero/confirmations/'
        '${Uri.encodeComponent(confirmationId)}/receipt';
    final rawOwner = repartidorId;
    if (rawOwner == null) return base;
    if (!isValidRepartoOwnerId(rawOwner)) {
      throw const RepartoReceiptUnavailableException();
    }
    return '$base?repartidorId=${Uri.encodeComponent(rawOwner.trim())}';
  }
}

class RepartoReceiptPdf {
  const RepartoReceiptPdf(this.base64);

  factory RepartoReceiptPdf.fromResponse(Map<String, dynamic> response) {
    final pdf = response['pdfBase64'];
    if (response['success'] != true || pdf is! String || pdf.isEmpty) {
      throw const RepartoReceiptUnavailableException();
    }
    try {
      final bytes = base64Decode(pdf);
      if (!_hasSanePdfEnvelope(bytes)) {
        throw const FormatException('Invalid PDF payload');
      }
    } on FormatException {
      throw const RepartoReceiptUnavailableException();
    }
    return RepartoReceiptPdf(pdf);
  }

  final String base64;

  /// This checks only a lightweight transport envelope; rendering or fully
  /// parsing an untrusted PDF belongs to the platform viewer, not here.
  static bool _hasSanePdfEnvelope(List<int> bytes) {
    const header = <int>[0x25, 0x50, 0x44, 0x46, 0x2D]; // %PDF-
    const eof = <int>[0x25, 0x25, 0x45, 0x4F, 0x46]; // %%EOF
    if (bytes.length < 20 ||
        !_startsWith(bytes, header) ||
        !_hasPdfVersion(bytes)) {
      return false;
    }
    var last = bytes.length - 1;
    while (last >= 0 && _isPdfWhitespace(bytes[last])) {
      last--;
    }
    return last >= eof.length - 1 &&
        _startsWith(bytes, eof, last - eof.length + 1);
  }

  static bool _hasPdfVersion(List<int> bytes) =>
      bytes.length >= 8 &&
      bytes[5] >= 0x30 &&
      bytes[5] <= 0x39 &&
      bytes[6] == 0x2E &&
      bytes[7] >= 0x30 &&
      bytes[7] <= 0x39;

  static bool _startsWith(
    List<int> bytes,
    List<int> expected, [
    int offset = 0,
  ]) {
    if (offset < 0 || bytes.length - offset < expected.length) return false;
    for (var index = 0; index < expected.length; index++) {
      if (bytes[offset + index] != expected[index]) return false;
    }
    return true;
  }

  static bool _isPdfWhitespace(int value) =>
      value == 0x00 ||
      value == 0x09 ||
      value == 0x0A ||
      value == 0x0C ||
      value == 0x0D ||
      value == 0x20;
}
