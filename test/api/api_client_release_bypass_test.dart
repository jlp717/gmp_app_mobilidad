import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

String _ip(List<String> parts) => parts.join('.');

void main() {
  group('ApiClient release TLS bypass is impossible', () {
    test('debugMode=false never bypasses, even for dev hosts', () {
      final devHosts = <String>[
        _ip(['127', '0', '0', '1']),
        _ip(['10', '0', '2', '2']),
        _ip(['192', '168', '1', '52']),
        _ip(['172', '31', '192', '1']),
        'localhost',
      ];
      final prodHosts = <String>[
        _ip(['192', '168', '1', '230']),
        'api.mari-pepa.com',
        'api.granjamaripepa.com',
      ];
      for (final host in [...devHosts, ...prodHosts]) {
        expect(
          ApiClient.shouldBypassInvalidCertificateForHost(
            host,
            debugMode: false,
          ),
          isFalse,
          reason: 'host $host must not bypass in release',
        );
      }
    });

    test('prod hosts never bypass, even in debug', () {
      final prodHosts = <String>[
        _ip(['192', '168', '1', '230']),
        'api.mari-pepa.com',
        'api.granjamaripepa.com',
      ];
      for (final host in prodHosts) {
        expect(
          ApiClient.shouldBypassInvalidCertificateForHost(
            host,
            debugMode: true,
          ),
          isFalse,
          reason: 'prod host must never bypass',
        );
      }
    });

    test('dev hosts bypass only when debugMode=true', () {
      final devHosts = <String>[
        _ip(['127', '0', '0', '1']),
        _ip(['10', '0', '2', '2']),
        'localhost',
      ];
      for (final host in devHosts) {
        expect(
          ApiClient.shouldBypassInvalidCertificateForHost(
            host,
            debugMode: true,
          ),
          isTrue,
          reason: 'dev host should bypass in debug',
        );
      }
    });
  });
}
