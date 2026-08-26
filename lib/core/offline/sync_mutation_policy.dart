/// Pure decision helpers for offline SyncQueue processing.
///
/// Kept free of Flutter/Hive so unit tests can cover backoff,
/// acceptance, and manual-review transitions without I/O.
class SyncMutationPolicy {
  SyncMutationPolicy._();

  static const int defaultMaxAttempts = 5;
  static const Duration defaultBaseDelay = Duration(seconds: 2);
  static const int maxBackoffSeconds = 300;

  /// Exponential backoff: baseDelay * 2^attempts, capped.
  static Duration calculateBackoff(
    int attempts, {
    Duration baseDelay = defaultBaseDelay,
    int maxSeconds = maxBackoffSeconds,
  }) {
    final safeAttempts = attempts < 0 ? 0 : attempts;
    final seconds = baseDelay.inSeconds * (1 << safeAttempts.clamp(0, 8));
    return Duration(seconds: seconds.clamp(baseDelay.inSeconds, maxSeconds));
  }

  /// True when enough time has elapsed since [anchor] for the next retry.
  static bool isBackoffElapsed({
    required int attempts,
    required DateTime now,
    DateTime? anchor,
    Duration baseDelay = defaultBaseDelay,
  }) {
    if (attempts <= 0) return true;
    final start = anchor ?? now;
    final nextRetry =
        start.add(calculateBackoff(attempts, baseDelay: baseDelay));
    return !now.isBefore(nextRetry);
  }

  /// HTTP 2xx with expected success body. For confirm_delivery require
  /// `success: true` or HTTP 201. Other ops accept any 2xx map body.
  static bool isAcceptedSuccess({
    required String type,
    required Map<String, dynamic> body,
    int? httpStatus,
  }) {
    final statusOk =
        httpStatus == null || (httpStatus >= 200 && httpStatus < 300);
    if (!statusOk) return false;

    if (type == 'confirm_delivery') {
      if (body['success'] == true) return true;
      if (httpStatus == 201) return true;
      return false;
    }

    // Generic mutations: 2xx is enough; if body declares success=false, reject.
    if (body.containsKey('success') && body['success'] != true) {
      return false;
    }
    return true;
  }

  /// 409 already-confirmed delivery: treat as idempotent success when journal
  /// can reconcile (caller still must reconcile before dequeue).
  static bool isIdempotentConflict({
    required String type,
    required int? statusCode,
    String? code,
  }) {
    if (statusCode != 409) return false;
    if (type == 'confirm_delivery') {
      return code == 'DELIVERY_ALREADY_CONFIRMED';
    }
    final normalized = (code ?? '').toUpperCase();
    return normalized.contains('ALREADY') || normalized.contains('IDEMPOTENT');
  }

  /// Permanent conflict that cannot be auto-reconciled → manual review.
  static bool isHardConflict({
    required int? statusCode,
    required String type,
    String? code,
  }) {
    if (statusCode == 412) return true;
    if (statusCode == 409 &&
        !isIdempotentConflict(
          type: type,
          statusCode: statusCode,
          code: code,
        )) {
      return true;
    }
    return false;
  }

  /// After a failed attempt: should op leave the retry loop for manual review?
  static bool shouldMarkManualReview({
    required int attemptsAfterFailure,
    required int? statusCode,
    required String type,
    int maxAttempts = defaultMaxAttempts,
    String? code,
  }) {
    if (attemptsAfterFailure >= maxAttempts) return true;
    return isHardConflict(statusCode: statusCode, code: code, type: type);
  }

  /// Evaluate one attempt outcome for tests / callers without I/O.
  static SyncAttemptDecision decideAttempt({
    required String type,
    required int attemptsBefore,
    required DateTime now,
    DateTime? createdAt,
    DateTime? lastAttemptAt,
    Map<String, dynamic>? successBody,
    int? httpStatus,
    int? errorStatusCode,
    String? errorCode,
    int maxAttempts = defaultMaxAttempts,
  }) {
    if (!isBackoffElapsed(
      attempts: attemptsBefore,
      now: now,
      anchor: lastAttemptAt ?? createdAt,
    )) {
      return SyncAttemptDecision.skipBackoff;
    }

    if (successBody != null &&
        isAcceptedSuccess(
          type: type,
          body: successBody,
          httpStatus: httpStatus,
        )) {
      return SyncAttemptDecision.dequeueSuccess;
    }

    if (isIdempotentConflict(
      type: type,
      statusCode: errorStatusCode,
      code: errorCode,
    )) {
      return SyncAttemptDecision.idempotentSuccess;
    }

    final attemptsAfter = attemptsBefore + 1;
    if (shouldMarkManualReview(
      attemptsAfterFailure: attemptsAfter,
      maxAttempts: maxAttempts,
      statusCode: errorStatusCode,
      code: errorCode,
      type: type,
    )) {
      return SyncAttemptDecision.markManualReview;
    }
    return SyncAttemptDecision.retryLater;
  }
}

enum SyncAttemptDecision {
  skipBackoff,
  dequeueSuccess,
  idempotentSuccess,
  retryLater,
  markManualReview,
}
