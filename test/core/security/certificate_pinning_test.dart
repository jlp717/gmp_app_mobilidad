import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/security/certificate_pinning.dart';

class _FakeCertificate implements X509Certificate {
  _FakeCertificate(this.der);

  @override
  final Uint8List der;

  @override
  String get issuer => 'CN=fake';

  @override
  String get pem => '';

  @override
  Uint8List get sha1 => Uint8List(0);

  @override
  DateTime get startValidity => DateTime(2024);

  @override
  String get subject => 'CN=fake';

  @override
  DateTime get endValidity => DateTime(2040);
}

Uint8List _derOf(int seed) =>
    Uint8List.fromList(List<int>.generate(48, (i) => (i * 7 + seed) % 256));

void main() {
  group('TlsPinning.certificateMatchesPin', () {
    test('accepts a base64 sha256 pin computed from the same DER', () {
      final cert = _FakeCertificate(_derOf(1));
      final pin = 'sha256/${base64Encode(sha256.convert(cert.der).bytes)}';
      expect(TlsPinning.certificateMatchesPin(cert, [pin]), isTrue);
    });

    test('rejects a pin from a different certificate', () {
      final cert = _FakeCertificate(_derOf(1));
      final otherCert = _FakeCertificate(_derOf(2));
      final wrongPin =
          'sha256/${base64Encode(sha256.convert(otherCert.der).bytes)}';
      expect(TlsPinning.certificateMatchesPin(cert, [wrongPin]), isFalse);
    });

    test('accepts hex pins and bare base64 pins', () {
      final cert = _FakeCertificate(_derOf(3));
      final hexPin = sha256.convert(cert.der).toString();
      final bareBase64 = base64Encode(sha256.convert(cert.der).bytes);
      expect(TlsPinning.certificateMatchesPin(cert, [hexPin]), isTrue);
      expect(TlsPinning.certificateMatchesPin(cert, [bareBase64]), isTrue);
    });

    test('matches when any pin in the backup set matches', () {
      final cert = _FakeCertificate(_derOf(4));
      final goodPin = 'sha256/${base64Encode(sha256.convert(cert.der).bytes)}';
      final stalePin =
          'sha256/${base64Encode(sha256.convert(_derOf(5)).bytes)}';
      expect(
        TlsPinning.certificateMatchesPin(cert, [stalePin, goodPin]),
        isTrue,
      );
    });

    test('fails closed with no pins configured', () {
      final cert = _FakeCertificate(_derOf(6));
      expect(TlsPinning.certificateMatchesPin(cert, const <String>[]), isFalse);
    });
  });

  group('TlsPinningConfig', () {
    test('is disabled when GMP_TLS_PINS is not injected', () {
      // Tests run without --dart-define=GMP_TLS_PINS.
      expect(TlsPinningConfig.pins, isEmpty);
      expect(TlsPinningConfig.isEnabled, isFalse);
    });
  });
}
