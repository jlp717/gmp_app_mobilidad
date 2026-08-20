import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(ApiClient.resetForTesting);

  test('canonical receipt carries one concrete owner', () {
    expect(
      const RepartoCanonicalReceiptRequest(
        'confirmation-1',
        repartidorId: '08',
      ).endpoint,
      endsWith('/receipt?repartidorId=08'),
    );
    expect(
      const RepartoCanonicalReceiptRequest('confirmation-1').endpoint,
      endsWith('/receipt'),
    );
    for (final owner in ['', 'ALL', '08,09', 'BOLA']) {
      expect(
        () => RepartoCanonicalReceiptRequest(
          'confirmation-1',
          repartidorId: owner,
        ).endpoint,
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
    }
  });

  test('document owner prefers row owner and never falls back to ALL', () {
    expect(
      resolveRepartoDocumentOwner(
        documentOwner: '08',
        selectedOwner: 'ALL',
      ),
      '08',
    );
    expect(
      resolveRepartoDocumentOwner(selectedOwner: '08'),
      '08',
    );
    expect(
      resolveRepartoDocumentOwner(selectedOwner: 'ALL'),
      isNull,
    );
    expect(
      resolveRepartoDocumentOwner(selectedOwner: '08,09'),
      isNull,
    );
  });

  test('confirmed deliveries invalidate document and owner cache prefixes',
      () async {
    final prefixes = <String>[];

    await invalidateRepartoDeliveryReadCachesWith((prefix) async {
      prefixes.add(prefix);
    });

    expect(
        prefixes,
        containsAll(<String>[
          'repartidor_docs_',
          'repartidor_clients_',
          'repartidor_signature_',
        ]));
  });

  test('historical email sends owner and requires messageId plus TEST ledger',
      () async {
    Map<String, dynamic>? capturedBody;
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        capturedBody = Map<String, dynamic>.from(options.data as Map);
        handler.resolve(
          Response<Map<String, dynamic>>(
            requestOptions: options,
            statusCode: 200,
            data: const {
              'success': true,
              'messageId': 'provider-1',
              'ledgerWritten': true,
            },
          ),
        );
      },
    );
    ApiClient.dio.interceptors.add(interceptor);

    final result = await RepartidorDataService.sendEmail(
      year: 2026,
      serie: 'A',
      number: 1,
      type: 'albaran',
      terminal: 0,
      destinatario: 'cliente@example.test',
      repartidorId: '08',
      canEmailDocuments: true,
    );

    expect(result['messageId'], 'provider-1');
    expect(capturedBody, containsPair('repartidorId', '08'));
    expect(capturedBody, containsPair('destinatario', 'cliente@example.test'));
  });

  test('historical email refuses a false 200 without ledger', () async {
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(
          Response<Map<String, dynamic>>(
            requestOptions: options,
            statusCode: 200,
            data: const {
              'success': true,
              'messageId': 'provider-1',
              'ledgerWritten': false,
            },
          ),
        );
      },
    );
    ApiClient.dio.interceptors.add(interceptor);

    await expectLater(
      RepartidorDataService.sendEmail(
        year: 2026,
        serie: 'A',
        number: 1,
        type: 'albaran',
        destinatario: 'cliente@example.test',
        repartidorId: '08',
        canEmailDocuments: true,
      ),
      throwsA(
        isA<RepartidorDataException>().having(
          (error) => error.code,
          'code',
          'EMAIL_DELIVERY_LEDGER_REQUIRED',
        ),
      ),
    );
  });

  test('local WhatsApp contract carries the concrete owner', () async {
    Map<String, dynamic>? capturedBody;
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        capturedBody = Map<String, dynamic>.from(options.data as Map);
        handler.resolve(
          Response<Map<String, dynamic>>(
            requestOptions: options,
            statusCode: 200,
            data: const {
              'success': true,
              'localShare': true,
              'sent': false,
              'whatsappUrl': 'https://wa.me/34600000000',
            },
          ),
        );
      },
    );
    ApiClient.dio.interceptors.add(interceptor);

    final result = await RepartidorDataService.shareWhatsApp(
      year: 2026,
      serie: 'A',
      number: 1,
      type: 'albaran',
      telefono: '600000000',
      repartidorId: '08',
    );

    expect(result.localShare, isTrue);
    expect(result.sent, isFalse);
    expect(result.whatsappUrl, 'https://wa.me/34600000000');
    expect(capturedBody, containsPair('repartidorId', '08'));
  });

  test('cloud WhatsApp contract marks bot delivery without local share',
      () async {
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(
          Response<Map<String, dynamic>>(
            requestOptions: options,
            statusCode: 200,
            data: const {
              'success': true,
              'localShare': false,
              'sent': true,
              'shareMode': 'BOT_GATEWAY',
              'messageId': 'wamid.ABC',
            },
          ),
        );
      },
    );
    ApiClient.dio.interceptors.add(interceptor);

    final result = await RepartidorDataService.shareWhatsApp(
      year: 2026,
      serie: 'A',
      number: 1,
      type: 'albaran',
      telefono: '600000000',
      repartidorId: '08',
      mensaje: 'Albarán listo',
    );

    expect(result.deliveredByBot, isTrue);
    expect(result.messageId, 'wamid.ABC');
  });

  test('history and signature carry owner in URL and isolate cache keys',
      () async {
    final requests = <RequestOptions>[];
    ApiClient.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          final data = options.path.endsWith('/history/signature')
              ? const <String, dynamic>{'success': true, 'signature': null}
              : const <String, dynamic>{
                  'success': true,
                  'documents': <dynamic>[],
                };
          handler.resolve(
            Response<Map<String, dynamic>>(
              requestOptions: options,
              statusCode: 200,
              data: data,
            ),
          );
        },
      ),
    );

    await RepartidorDataService.getClientDocuments(
      clientId: 'C1',
      repartidorId: '08',
    );
    await RepartidorDataService.getSignature(
      ejercicio: 2026,
      serie: 'A',
      terminal: 1,
      numero: 2,
      repartidorId: '08',
    );

    expect(requests[0].queryParameters['repartidorId'], '08');
    expect(requests[1].queryParameters['repartidorId'], '08');
    expect(
      repartoSignatureCacheKey(
        repartidorId: '08',
        ejercicio: 2026,
        serie: 'A',
        terminal: 1,
        numero: 2,
      ),
      isNot(
        repartoSignatureCacheKey(
          repartidorId: '09',
          ejercicio: 2026,
          serie: 'A',
          terminal: 1,
          numero: 2,
        ),
      ),
    );
  });

  test('ALL or CSV owner is rejected locally without HTTP', () async {
    var requests = 0;
    ApiClient.dio.interceptors.add(
      InterceptorsWrapper(onRequest: (options, handler) {
        requests++;
        handler.reject(
          DioException(requestOptions: options),
        );
      }),
    );

    await expectLater(
      RepartidorDataService.getClientDocuments(
        clientId: 'C1',
        repartidorId: 'ALL',
      ),
      throwsA(isA<RepartidorDataException>()),
    );
    await expectLater(
      RepartidorDataService.getSignature(
        ejercicio: 2026,
        serie: 'A',
        terminal: 1,
        numero: 2,
        repartidorId: '08,09',
      ),
      throwsA(isA<RepartidorDataException>()),
    );
    await expectLater(
      RepartidorDataService.shareWhatsApp(
        year: 2026,
        serie: 'A',
        number: 2,
        type: 'albaran',
        telefono: '+34600000000',
        repartidorId: 'ALL',
      ),
      throwsA(isA<RepartidorDataException>()),
    );
    expect(requests, 0);
  });

  test('delivery detail sends its concrete owner and blocks ALL locally',
      () async {
    var requests = 0;
    Map<String, dynamic>? query;
    ApiClient.dio.interceptors.add(
      InterceptorsWrapper(onRequest: (options, handler) {
        requests++;
        query = Map<String, dynamic>.from(options.queryParameters);
        handler.resolve(
          Response<Map<String, dynamic>>(
            requestOptions: options,
            statusCode: 200,
            data: const <String, dynamic>{
              'success': true,
              'albaran': <String, dynamic>{
                'id': '2026-A-1-2-C1',
                'numeroAlbaran': 2,
                'ejercicio': 2026,
                'codigoCliente': 'C1',
                'nombreCliente': 'Cliente',
                'importeTotal': 10,
              },
            },
          ),
        );
      }),
    );
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(entregasProvider.notifier);

    final detail = await notifier.obtenerDetalleAlbaran(
      2,
      2026,
      'A',
      1,
      'C1',
      repartidorId: '08',
    );
    expect(detail, isNotNull);
    expect(query?['repartidorId'], '08');

    final blocked = await notifier.obtenerDetalleAlbaran(
      2,
      2026,
      'A',
      1,
      'C1',
      repartidorId: 'ALL',
    );
    expect(blocked, isNull);
    expect(requests, 1);
  });
}
