import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';

/// Reconciles local confirmation journal after SyncQueue drains confirm_delivery.
Future<void> defaultConfirmDeliveryReconciler({
  required String deliveryId,
  required String confirmationId,
  required String fingerprint,
  required String idempotencyKey,
  String? cobroId,
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
  await RepartidorDataService.invalidateDeliveryReadCaches();
  OfflineSyncNotifier.deliverySynchronized();
}
