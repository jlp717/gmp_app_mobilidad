import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_mutation_policy.dart';

void main() {
  group('SyncMutationPolicy backoff', () {
    test('grows exponentially and caps', () {
      expect(
        SyncMutationPolicy.calculateBackoff(0),
        const Duration(seconds: 2),
      );
      expect(
        SyncMutationPolicy.calculateBackoff(1),
        const Duration(seconds: 4),
      );
      expect(
        SyncMutationPolicy.calculateBackoff(2),
        const Duration(seconds: 8),
      );
      expect(
        SyncMutationPolicy.calculateBackoff(10).inSeconds,
        SyncMutationPolicy.maxBackoffSeconds,
      );
    });

    test('skip while backoff window active', () {
      final created = DateTime(2026, 8, 12, 12, 0, 0);
      final now = created.add(const Duration(seconds: 1));
      expect(
        SyncMutationPolicy.isBackoffElapsed(
          attempts: 1,
          now: now,
          anchor: created,
        ),
        isFalse,
      );
      expect(
        SyncMutationPolicy.isBackoffElapsed(
          attempts: 1,
          now: created.add(const Duration(seconds: 5)),
          anchor: created,
        ),
        isTrue,
      );
    });
  });

  group('SyncMutationPolicy acceptance', () {
    test('confirm_delivery requires success true or HTTP 201', () {
      expect(
        SyncMutationPolicy.isAcceptedSuccess(
          type: 'confirm_delivery',
          body: {'success': true, 'confirmationId': '81'},
          httpStatus: 200,
        ),
        isTrue,
      );
      expect(
        SyncMutationPolicy.isAcceptedSuccess(
          type: 'confirm_delivery',
          body: {'confirmationId': '81'},
          httpStatus: 201,
        ),
        isTrue,
      );
      expect(
        SyncMutationPolicy.isAcceptedSuccess(
          type: 'confirm_delivery',
          body: {'confirmationId': '81'},
          httpStatus: 200,
        ),
        isFalse,
      );
    });

    test('generic mutation rejects explicit success false', () {
      expect(
        SyncMutationPolicy.isAcceptedSuccess(
          type: 'create_cobro',
          body: {'success': false},
          httpStatus: 200,
        ),
        isFalse,
      );
      expect(
        SyncMutationPolicy.isAcceptedSuccess(
          type: 'create_cobro',
          body: {'id': 'x'},
          httpStatus: 200,
        ),
        isTrue,
      );
    });
  });

  group('SyncMutationPolicy manual review', () {
    test('409 DELIVERY_ALREADY_CONFIRMED is idempotent success', () {
      expect(
        SyncMutationPolicy.isIdempotentConflict(
          type: 'confirm_delivery',
          statusCode: 409,
          code: 'DELIVERY_ALREADY_CONFIRMED',
        ),
        isTrue,
      );
      expect(
        SyncMutationPolicy.decideAttempt(
          type: 'confirm_delivery',
          attemptsBefore: 0,
          now: DateTime(2026, 8, 12),
          errorStatusCode: 409,
          errorCode: 'DELIVERY_ALREADY_CONFIRMED',
        ),
        SyncAttemptDecision.idempotentSuccess,
      );
    });

    test('hard 409 / 412 / max attempts mark manual review', () {
      expect(
        SyncMutationPolicy.shouldMarkManualReview(
          attemptsAfterFailure: 1,
          statusCode: 409,
          code: 'OTHER_CONFLICT',
          type: 'confirm_delivery',
        ),
        isTrue,
      );
      expect(
        SyncMutationPolicy.shouldMarkManualReview(
          attemptsAfterFailure: 1,
          statusCode: 412,
          type: 'confirm_delivery',
        ),
        isTrue,
      );
      expect(
        SyncMutationPolicy.shouldMarkManualReview(
          attemptsAfterFailure: 5,
          statusCode: 500,
          type: 'confirm_delivery',
        ),
        isTrue,
      );
      expect(
        SyncMutationPolicy.shouldMarkManualReview(
          attemptsAfterFailure: 2,
          statusCode: 500,
          type: 'confirm_delivery',
        ),
        isFalse,
      );
    });

    test('decideAttempt returns retryLater under max attempts', () {
      expect(
        SyncMutationPolicy.decideAttempt(
          type: 'create_cobro',
          attemptsBefore: 1,
          now: DateTime(2026, 8, 12, 12, 0, 10),
          lastAttemptAt: DateTime(2026, 8, 12, 12, 0, 0),
          errorStatusCode: 500,
        ),
        SyncAttemptDecision.retryLater,
      );
    });
  });
}
