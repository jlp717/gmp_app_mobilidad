import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

/// Build-time TLS pinning configuration for the GMP backend.
///
/// Pins are injected at build time so no certificate material lives in the
/// repository:
///
///   flutter build apk --release \
///     --dart-define=GMP_TLS_PINS=sha256/BASE64_SHA256_OF_DER,sha256/BACKUP_PIN
///
/// Compute a pin with: scripts/security/get-tls-pin.ps1 -HostName api.mari-pepa.com
///
/// Configure at least two pins (leaf + backup) so a scheduled certificate
/// rotation does not brick installed clients.
class TlsPinningConfig {
  const TlsPinningConfig._();

  static const String _pinsRaw = String.fromEnvironment('GMP_TLS_PINS');

  /// Configured pins (`sha256/<base64>` entries). Empty by default.
  static List<String> get pins => _pinsRaw
      .split(',')
      .map((pin) => pin.trim())
      .where((pin) => pin.isNotEmpty)
      .toList(growable: false);

  static bool get isEnabled => pins.isNotEmpty;
}

/// SHA-256 certificate matching used by ApiClient badCertificateCallback.
class TlsPinning {
  const TlsPinning._();

  /// Returns true when [cert] matches any of [pins].
  ///
  /// Accepted pin formats:
  ///  - `sha256/<base64(SHA-256(DER))>` (recommended)
  ///  - `<base64(SHA-256(DER))>` without prefix
  ///  - `<hex(SHA-256(DER))>` lowercase hex
  static bool certificateMatchesPin(
    X509Certificate cert,
    Iterable<String> pins,
  ) {
    final digest = sha256.convert(cert.der);
    final base64Hash = base64Encode(digest.bytes);
    final hexHash = digest.toString();
    for (final rawPin in pins) {
      final pin = rawPin.trim();
      if (pin.isEmpty) continue;
      final normalized =
          pin.startsWith('sha256/') ? pin.substring(7).trim() : pin;
      if (normalized == base64Hash || normalized.toLowerCase() == hexHash) {
        return true;
      }
    }
    return false;
  }
}
