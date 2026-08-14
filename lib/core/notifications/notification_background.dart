import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/notifications/local_notification_service.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_orchestrator.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:workmanager/workmanager.dart';

class NotificationBackgroundTaskNames {
  const NotificationBackgroundTaskNames._();

  static const periodicRefresh =
      'com.maripepa.gmp_movilidad.notifications.refresh';
  static const uniquePeriodicRefresh = 'gmp_notifications_periodic_refresh';
}

class NotificationBackgroundScheduler {
  const NotificationBackgroundScheduler._();

  static bool _initialized = false;

  static Future<void> initializeAndRegister() async {
    if (_initialized) return;
    try {
      await Workmanager().initialize(
        notificationCallbackDispatcher,
        isInDebugMode: kDebugMode,
      );
      await Workmanager().registerPeriodicTask(
        NotificationBackgroundTaskNames.uniquePeriodicRefresh,
        NotificationBackgroundTaskNames.periodicRefresh,
        frequency: const Duration(minutes: 30),
        constraints: Constraints(networkType: NetworkType.notRequired),
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
        backoffPolicy: BackoffPolicy.linear,
        backoffPolicyDelay: const Duration(minutes: 15),
      );
      _initialized = true;
    } catch (e) {
      debugPrint('[Notifications] Workmanager registration skipped: $e');
    }
  }
}

class NotificationBackgroundRunner {
  const NotificationBackgroundRunner._();

  static Future<bool> run(String taskName) async {
    try {
      WidgetsFlutterBinding.ensureInitialized();
      DartPluginRegistrant.ensureInitialized();
      await CacheService.init();
      await ApiClient.initialize();
      await ConnectivityService.instance.initialize();
      await SyncQueueService.instance.initialize();
      await PedidosOfflineService.init();
      await LocalNotificationService.instance.initialize();
      await NotificationOrchestrator.instance.initialize(
        registerBackground: false,
      );
      await NotificationOrchestrator.instance.refreshAll(
        reason: 'background:$taskName',
      );
      return true;
    } catch (e, stack) {
      debugPrint('[Notifications] Background refresh failed: $e\n$stack');
      return false;
    }
  }
}

@pragma('vm:entry-point')
void notificationCallbackDispatcher() {
  Workmanager().executeTask((taskName, inputData) async {
    return NotificationBackgroundRunner.run(taskName);
  });
}
