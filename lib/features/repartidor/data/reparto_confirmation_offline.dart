import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';

/// Reconciles local confirmation journal after SyncQueue drains confirm_delivery.
Future<void> defaultConfirmDeliveryReconciler({
  required String deliveryId,
  required String confirmationId,
  String? cobroId,
  required String fingerprint,
  required String idempotencyKey,
}) async {
  final journal = RepartoConfirmationJournal(
    HiveRepartoConfirmationJournalStore(),
  );
  await journal.acknowledge(
    deliveryId,
    expectedFingerprint: fingerprint,
    expectedIdempotencyKey: idempotencyKey,
    confirmationId: confirmationId,
    cobroId: cobroId,
  );
}
