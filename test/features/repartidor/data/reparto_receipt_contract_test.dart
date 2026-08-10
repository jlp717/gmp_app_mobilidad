import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

void main() {
  group('canonical reparto receipt contract', () {
    test('uses the confirmation ID in a GET-only canonical path', () {
      final request = RepartoCanonicalReceiptRequest('81');

      expect(
        request.endpoint,
        '/repartidor-finanzas/rutero/confirmations/81/receipt',
      );
      expect(request.endpoint, isNot(contains('dni')));
      expect(request.endpoint, isNot(contains('signature')));
      expect(request.endpoint, isNot(contains('cantidad')));
      expect(request.endpoint, isNot(contains('total')));
    });

    test('only accepts a successful response with server confirmation ID', () {
      final acknowledgement =
          RepartoConfirmationAcknowledgement.fromResponse(<String, dynamic>{
        'success': true,
        'confirmationId': '81',
        'cobroId': '91',
      });

      expect(acknowledgement.confirmationId, '81');
      expect(acknowledgement.cobroId, '91');
      expect(
        () => RepartoConfirmationAcknowledgement.fromResponse(
          <String, dynamic>{'success': true},
        ),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
      expect(
        () => RepartoConfirmationAcknowledgement.fromResponse(
          <String, dynamic>{
            'success': true,
            'confirmationId': '81',
            'cobroId': <String>['not-an-id'],
          },
        ),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
    });

    test('PDF response requires a sane, complete PDF envelope', () {
      final pdf = base64Encode(
        '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'.codeUnits,
      );

      expect(
        RepartoReceiptPdf.fromResponse(
          <String, dynamic>{'success': true, 'pdfBase64': pdf},
        ).base64,
        pdf,
      );
      expect(
        () => RepartoReceiptPdf.fromResponse(
          <String, dynamic>{'success': true, 'pdfBase64': 'not-pdf'},
        ),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
      expect(
        () => RepartoReceiptPdf.fromResponse(
          <String, dynamic>{
            'success': true,
            'pdfBase64': base64Encode('%PDF-'.codeUnits),
          },
        ),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
      expect(
        () => RepartoReceiptPdf.fromResponse(
          <String, dynamic>{
            'success': true,
            'pdfBase64': base64Encode('%PDF-1.7\n1 0 obj\n'.codeUnits),
          },
        ),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
    });

    test('tombstone retains only acknowledged server IDs across restart',
        () async {
      final store = _MemoryJournalStore();
      final journal = RepartoConfirmationJournal(store);
      final entry = RepartoConfirmationJournalEntry(
        deliveryId: 'delivery-1',
        state: RepartoOperationState.acknowledged,
        evidences: const <String, RepartoEvidenceJournalRecord>{},
        confirmationFingerprint:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        confirmationIdempotencyKey: 'confirmation-key-1',
        confirmationId: '81',
        cobroId: '91',
        occurredAt: DateTime.utc(2026, 8, 9),
      );
      await store.write(entry);

      final restarted = RepartoConfirmationJournal(store);
      expect(await restarted.receiptConfirmationId('delivery-1'), '81');
      final encoded = jsonEncode((await store.read('delivery-1'))!.toJson());
      expect(encoded, isNot(contains('12345678Z')));
      expect(encoded, isNot(contains('base64')));
    });

    test('legacy v1 tombstone remains readable but cannot fabricate a receipt',
        () async {
      final entry = RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'acknowledged',
        'evidences': <String, dynamic>{},
        'confirmationFingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'confirmationIdempotencyKey': 'confirmation-key-1',
        'occurredAt': '2026-08-09T00:00:00.000Z',
      });
      final store = _MemoryJournalStore()..entries['delivery-1'] = entry;

      await expectLater(
        RepartoConfirmationJournal(store).receiptConfirmationId('delivery-1'),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
    });

    test('modal and legacy provider have no receipt POST path or local payload',
        () {
      final modal = File(
        'lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart',
      ).readAsStringSync();
      final receiptMethod = modal.substring(
        modal.indexOf('Future<String?> _generateReceiptPdf()'),
      );
      final provider = File(
        'lib/features/entregas/providers/entregas_provider.dart',
      ).readAsStringSync();

      expect(receiptMethod, contains('ApiClient.get('));
      expect(receiptMethod, contains('RepartoCanonicalReceiptRequest'));
      expect(receiptMethod, isNot(contains('ApiClient.post(')));
      expect(receiptMethod, isNot(contains('/entregas/receipt')));
      expect(receiptMethod, isNot(contains('firmanteDni')));
      expect(receiptMethod, isNot(contains("'items'")));
      expect(provider, isNot(contains('/entregas/receipt')));
      expect(provider, contains('RepartoCanonicalReceiptRequest'));
      expect(provider, contains('ApiClient.get('));
    });
  });
}

class _MemoryJournalStore implements RepartoConfirmationJournalStore {
  final Map<String, RepartoConfirmationJournalEntry> entries =
      <String, RepartoConfirmationJournalEntry>{};

  @override
  Future<void> delete(String deliveryId) async => entries.remove(deliveryId);

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entries[deliveryId];

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    entries[entry.deliveryId] = entry;
  }
}
