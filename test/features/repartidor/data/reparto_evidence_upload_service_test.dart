import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_upload_service.dart';
import 'package:image_picker/image_picker.dart';

const evidenceKey = 'evidence-key-1';
const evidenceFingerprint =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const signatureId =
    'ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const photoId =
    'ev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

void main() {
  test('uploads signature as JSON data URI and returns only its opaque ID',
      () async {
    final adapter = _EvidenceAdapter(<String>[signatureId]);
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final service = RepartoEvidenceUploadService(dio: dio);

    final result = await service.uploadSignature(
      entregaId: 'delivery-1',
      pngBytes: Uint8List.fromList(<int>[137, 80, 78, 71, 13, 10, 26, 10]),
      idempotencyKey: evidenceKey,
    );

    expect(result, signatureId);
    expect(adapter.requests.single.headers['Idempotency-Key'], evidenceKey);
    expect(
      adapter.requests.single.path,
      '/repartidor-finanzas/rutero/evidence/signature',
    );
    final body = adapter.requests.single.data as Map<String, dynamic>;
    expect(body['documentId'], 'delivery-1');
    expect(body['signature'], startsWith('data:image/png;base64,'));
    expect(body.containsKey('firma'), isFalse);
  });

  test('uploads a JPEG photo as multipart with canonical field and MIME',
      () async {
    final adapter = _EvidenceAdapter(<String>[photoId]);
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final service = RepartoEvidenceUploadService(dio: dio);
    final photo = XFile.fromData(
      Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 0x00]),
      name: 'proof.jpg',
      mimeType: 'image/jpeg',
    );

    final result = await service.uploadPhoto(
      entregaId: 'delivery-1',
      photo: photo,
      idempotencyKey: evidenceKey,
    );

    expect(result, photoId);
    final form = adapter.requests.single.data as FormData;
    expect(form.fields.single.key, 'documentId');
    expect(form.fields.single.value, 'delivery-1');
    expect(form.files.single.key, 'photo');
    expect(form.files.single.value.contentType.toString(), 'image/jpeg');
  });

  test('rejects invalid photo magic bytes before any request', () async {
    final adapter = _EvidenceAdapter(<String>[photoId]);
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final service = RepartoEvidenceUploadService(dio: dio);

    await expectLater(
      service.uploadPhoto(
        entregaId: 'delivery-1',
        photo: XFile.fromData(
          Uint8List.fromList(<int>[1, 2, 3, 4]),
          name: 'fake.jpg',
        ),
        idempotencyKey: evidenceKey,
      ),
      throwsA(isA<RepartoEvidenceUploadException>()),
    );
    expect(adapter.requests, isEmpty);
  });

  test('accepts 4 MiB photo and rejects the first byte above it', () async {
    expect(RepartoEvidenceUploadService.maxPhotoBytes, 4 * 1024 * 1024);
    final adapter = _EvidenceAdapter(<String>[photoId]);
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final service = RepartoEvidenceUploadService(dio: dio);
    final atLimit = Uint8List(RepartoEvidenceUploadService.maxPhotoBytes)
      ..setAll(0, <int>[0xff, 0xd8, 0xff]);

    expect(
      await service.uploadPhoto(
        entregaId: 'delivery-1',
        photo: XFile.fromData(atLimit, name: 'at-limit.jpg'),
        idempotencyKey: evidenceKey,
      ),
      photoId,
    );
    expect(adapter.requests, hasLength(1));

    final aboveLimit = Uint8List(
      RepartoEvidenceUploadService.maxPhotoBytes + 1,
    )..setAll(0, <int>[0xff, 0xd8, 0xff]);
    await expectLater(
      service.uploadPhoto(
        entregaId: 'delivery-1',
        photo: XFile.fromData(aboveLimit, name: 'above-limit.jpg'),
        idempotencyKey: evidenceKey,
      ),
      throwsA(
        isA<RepartoEvidenceUploadException>()
            .having((error) => error.statusCode, 'statusCode', 413)
            .having(
              repartoEvidenceErrorMessage,
              'safe message',
              contains('4 MiB'),
            ),
      ),
    );
    expect(adapter.requests, hasLength(1));
  });

  test('rejects an oversized signature before any request', () async {
    final adapter = _EvidenceAdapter(<String>[signatureId]);
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final service = RepartoEvidenceUploadService(dio: dio);
    final oversized = Uint8List(
      RepartoEvidenceUploadService.maxSignatureBytes + 1,
    )..setAll(0, <int>[137, 80, 78, 71, 13, 10, 26, 10]);

    await expectLater(
      service.uploadSignature(
        entregaId: 'delivery-1',
        pngBytes: oversized,
        idempotencyKey: evidenceKey,
      ),
      throwsA(isA<RepartoEvidenceUploadException>()),
    );
    expect(adapter.requests, isEmpty);
  });

  final errorCases = <({int status, String code, String message})>[
    (
      status: 401,
      code: 'AUTHENTICATED_ACTOR_REQUIRED',
      message: 'La sesión ha caducado. Inicia sesión de nuevo.',
    ),
    (
      status: 403,
      code: 'EVIDENCE_OWNERSHIP_REQUIRED',
      message: 'No tienes permiso para adjuntar esta evidencia.',
    ),
    (
      status: 413,
      code: 'EVIDENCE_TOO_LARGE',
      message: 'La evidencia supera el límite permitido (foto: 4 MiB).',
    ),
    (
      status: 422,
      code: 'INVALID_EVIDENCE_REQUEST',
      message: 'La evidencia no es válida. Revisa la foto o la firma.',
    ),
    (
      status: 503,
      code: 'REPARTO_EVIDENCE_RUNTIME_UNAVAILABLE',
      message: 'El servicio de evidencias no está disponible. Reinténtalo.',
    ),
  ];
  for (final errorCase in errorCases) {
    test('preserves safe ${errorCase.status} evidence error metadata',
        () async {
      final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
        ..httpClientAdapter = _StatusAdapter(
          status: errorCase.status,
          code: errorCase.code,
        );
      final service = RepartoEvidenceUploadService(dio: dio);

      try {
        await service.uploadSignature(
          entregaId: 'delivery-1',
          pngBytes: Uint8List.fromList(<int>[137, 80, 78, 71, 13, 10, 26, 10]),
          idempotencyKey: evidenceKey,
        );
        fail('Expected an evidence upload exception');
      } on RepartoEvidenceUploadException catch (error) {
        expect(error.statusCode, errorCase.status);
        expect(error.code, errorCase.code);
        expect(repartoEvidenceErrorMessage(error), errorCase.message);
        expect(error.toString(), isNot(contains('12345678Z')));
        expect(error.toString(), isNot(contains('private server body')));
      }
    });
  }

  test('an upload failure prevents canonical confirmation', () async {
    final uploader = _FakeUploader(failPhoto: true);
    final coordinator = RepartoEvidenceConfirmationCoordinator(
      uploader,
      RepartoConfirmationJournal(
        _MemoryJournalStore(),
        keyGenerator: () => evidenceKey,
      ),
    );
    var confirmCalls = 0;

    expect(
      () => coordinator.uploadThenConfirm<bool>(
        entregaId: 'delivery-1',
        signaturePngBytes:
            Uint8List.fromList(<int>[137, 80, 78, 71, 13, 10, 26, 10]),
        photos: <XFile>[
          XFile.fromData(
            Uint8List.fromList(<int>[0xff, 0xd8, 0xff]),
            name: 'proof.jpg',
          ),
        ],
        confirm: (_) async {
          confirmCalls++;
          return true;
        },
      ),
      throwsA(isA<RepartoEvidenceUploadException>()),
    );
    expect(confirmCalls, 0);
  });

  test('restart reuses uploaded evidence without another network call',
      () async {
    final store = _MemoryJournalStore();
    final uploader = _FakeUploader();
    final signature =
        Uint8List.fromList(<int>[137, 80, 78, 71, 13, 10, 26, 10]);
    final first = RepartoEvidenceConfirmationCoordinator(
      uploader,
      RepartoConfirmationJournal(
        store,
        keyGenerator: () => evidenceKey,
      ),
    );

    await expectLater(
      first.uploadThenConfirm<void>(
        entregaId: 'delivery-1',
        signaturePngBytes: signature,
        photos: const <XFile>[],
        confirm: (_) async => throw StateError('ambiguous confirmation'),
      ),
      throwsStateError,
    );
    expect(uploader.calls, 1);

    final restarted = RepartoEvidenceConfirmationCoordinator(
      uploader,
      RepartoConfirmationJournal(
        store,
        keyGenerator: () => 'unused-key-after-restart',
      ),
    );
    final replay = await restarted.uploadThenConfirm<RepartoUploadedEvidence>(
      entregaId: 'delivery-1',
      signaturePngBytes: null,
      photos: const <XFile>[],
      confirm: (evidence) async => evidence,
    );

    expect(replay.signatureId, signatureId);
    expect(uploader.calls, 1);
  });

  test('reserved evidence without local bytes fails closed after restart',
      () async {
    final store = _MemoryJournalStore();
    final journal = RepartoConfirmationJournal(
      store,
      keyGenerator: () => evidenceKey,
    );
    await journal.reserveEvidence(
      deliveryId: 'delivery-1',
      slot: 'signature',
      fingerprint: evidenceFingerprint,
    );
    final uploader = _FakeUploader();
    final restarted = RepartoEvidenceConfirmationCoordinator(
      uploader,
      RepartoConfirmationJournal(store),
    );
    var confirmCalls = 0;

    await expectLater(
      restarted.uploadThenConfirm<void>(
        entregaId: 'delivery-1',
        signaturePngBytes: null,
        photos: const <XFile>[],
        confirm: (_) async {
          confirmCalls++;
        },
      ),
      throwsA(
        isA<RepartoEvidenceUploadException>()
            .having((error) => error.statusCode, 'statusCode', 409)
            .having(
              (error) => error.code,
              'code',
              'EVIDENCE_REQUIRES_MANUAL_REVIEW',
            ),
      ),
    );
    expect(uploader.calls, 0);
    expect(confirmCalls, 0);
    expect(
      store.entries['delivery-1']?.state,
      RepartoOperationState.manualReview,
    );
  });

  test('rejects more than three photos before starting any upload', () async {
    final uploader = _FakeUploader();
    final coordinator = RepartoEvidenceConfirmationCoordinator(
      uploader,
      RepartoConfirmationJournal(
        _MemoryJournalStore(),
        keyGenerator: () => evidenceKey,
      ),
    );
    final photos = List<XFile>.generate(
      4,
      (index) => XFile.fromData(
        Uint8List.fromList(<int>[0xff, 0xd8, 0xff]),
        name: 'proof-$index.jpg',
      ),
    );

    await expectLater(
      coordinator.uploadThenConfirm<void>(
        entregaId: 'delivery-1',
        signaturePngBytes: null,
        photos: photos,
        confirm: (_) async {},
      ),
      throwsA(isA<RepartoEvidenceUploadException>()),
    );
    expect(uploader.calls, 0);
  });
}

class _EvidenceAdapter implements HttpClientAdapter {
  _EvidenceAdapter(this._ids);

  final List<String> _ids;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': true,
        'evidenceId': _ids[requests.length - 1],
      }),
      201,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _StatusAdapter implements HttpClientAdapter {
  _StatusAdapter({required this.status, required this.code});

  final int status;
  final String code;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': false,
        'code': code,
        'error': 'private server body 12345678Z',
      }),
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _FakeUploader implements RepartoEvidenceUploader {
  _FakeUploader({this.failPhoto = false});

  final bool failPhoto;
  int calls = 0;

  @override
  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
  }) async {
    calls++;
    if (failPhoto) {
      throw const RepartoEvidenceUploadException('photo failed');
    }
    return photoId;
  }

  @override
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
  }) async {
    calls++;
    return signatureId;
  }
}

class _MemoryJournalStore implements RepartoConfirmationJournalStore {
  final Map<String, RepartoConfirmationJournalEntry> entries =
      <String, RepartoConfirmationJournalEntry>{};

  @override
  Future<void> delete(String deliveryId) async {
    entries.remove(deliveryId);
  }

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entries[deliveryId];

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    entries[entry.deliveryId] = entry;
  }
}
