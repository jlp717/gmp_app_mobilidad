import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

class LocalNotificationService {
  LocalNotificationService._();

  static final LocalNotificationService instance = LocalNotificationService._();

  static const _channelId = 'gmp_commercial_alerts';
  static const _channelName = 'Avisos comerciales';
  static const _actionCategoryId = 'gmp_commercial_alert_actions';

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    tzdata.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Europe/Madrid'));

    const android = AndroidInitializationSettings('@mipmap/launcher_icon');
    final darwin = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
      notificationCategories: [
        DarwinNotificationCategory(
          _actionCategoryId,
          actions: [
            DarwinNotificationAction.plain(
              NotificationActionIds.snoozeTwoHours,
              'Pausar 2 h',
              options: {DarwinNotificationActionOption.foreground},
            ),
            DarwinNotificationAction.plain(
              NotificationActionIds.snoozeToday,
              'Hoy no',
              options: {DarwinNotificationActionOption.foreground},
            ),
          ],
        ),
      ],
    );

    await _plugin.initialize(
      InitializationSettings(android: android, iOS: darwin, macOS: darwin),
      onDidReceiveNotificationResponse:
          AppNotificationActionHandler.handleResponse,
      onDidReceiveBackgroundNotificationResponse:
          notificationTapBackgroundHandler,
    );

    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        _channelId,
        _channelName,
        description: 'Recordatorios de pedidos, objetivos, rutero y Glacius',
        importance: Importance.high,
      ),
    );

    _initialized = true;
  }

  Future<bool> requestPermissionsIfNeeded() async {
    await initialize();
    if (kIsWeb) return false;

    var granted = true;
    if (defaultTargetPlatform == TargetPlatform.android) {
      final status = await Permission.notification.status;
      final effectiveStatus =
          status.isGranted ? status : await Permission.notification.request();
      granted = effectiveStatus.isGranted;
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final iosPlugin = _plugin.resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin>();
      granted = await iosPlugin?.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          ) ??
          granted;
    } else if (defaultTargetPlatform == TargetPlatform.macOS) {
      final macosPlugin = _plugin.resolvePlatformSpecificImplementation<
          MacOSFlutterLocalNotificationsPlugin>();
      granted = await macosPlugin?.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          ) ??
          granted;
    }

    await NotificationPreferencesService.instance.markPermissionPrompted();
    return granted;
  }

  Future<void> show(AppNotification notification) async {
    await initialize();
    await _plugin.show(
      notification.id,
      notification.title,
      notification.body,
      _detailsFor(notification),
      payload: notification.payloadJson,
    );
  }

  Future<void> schedule(AppNotification notification) async {
    await initialize();
    final scheduledAt = notification.scheduledAt;
    if (scheduledAt == null) return;
    var scheduled = tz.TZDateTime.from(scheduledAt, tz.local);
    if (!scheduled.isAfter(tz.TZDateTime.now(tz.local))) {
      scheduled = tz.TZDateTime.now(tz.local).add(const Duration(minutes: 1));
    }
    await _plugin.zonedSchedule(
      notification.id,
      notification.title,
      notification.body,
      scheduled,
      _detailsFor(notification),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      payload: notification.payloadJson,
    );
  }

  Future<void> cancel(int id) => _plugin.cancel(id);

  Future<void> cancelOrderReminderSeries() async {
    await initialize();
    final stored =
        await NotificationPreferencesService.instance.loadScheduledOrderIds();
    final ids = stored.isNotEmpty
        ? stored
        : List<int>.generate(
            64,
            (index) =>
                AppNotificationCategory.orders.baseNotificationId + 100 + index,
          );
    for (final id in ids) {
      await _plugin.cancel(id);
    }
    await NotificationPreferencesService.instance.clearScheduledOrderIds();
  }

  Future<void> cancelCategory(AppNotificationCategory category) async {
    await initialize();
    if (category == AppNotificationCategory.orders) {
      await cancelOrderReminderSeries();
    }
    final base = category.baseNotificationId;
    for (var i = 0; i < 100; i++) {
      await _plugin.cancel(base + i);
    }
  }

  Future<void> cancelAllGmpNotifications() async {
    await initialize();
    for (final category in AppNotificationCategory.values) {
      await cancelCategory(category);
    }
  }

  NotificationDetails _detailsFor(AppNotification notification) {
    final actions = notification.includeSnoozeActions
        ? const <AndroidNotificationAction>[
            AndroidNotificationAction(
              NotificationActionIds.snoozeTwoHours,
              'Pausar 2 h',
              showsUserInterface: false,
            ),
            AndroidNotificationAction(
              NotificationActionIds.snoozeToday,
              'Hoy no',
              showsUserInterface: false,
            ),
          ]
        : const <AndroidNotificationAction>[];

    return NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        _channelName,
        channelDescription:
            'Recordatorios de pedidos, objetivos, rutero y Glacius',
        importance: Importance.high,
        priority: Priority.high,
        category: AndroidNotificationCategory.reminder,
        color: const Color(0xFF2F80ED),
        actions: actions,
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentSound: true,
        presentBadge: true,
        categoryIdentifier:
            notification.includeSnoozeActions ? _actionCategoryId : null,
      ),
      macOS: DarwinNotificationDetails(
        presentAlert: true,
        presentSound: true,
        presentBadge: true,
        categoryIdentifier:
            notification.includeSnoozeActions ? _actionCategoryId : null,
      ),
    );
  }
}

class NotificationActionIds {
  const NotificationActionIds._();

  static const snoozeTwoHours = 'snooze_2h';
  static const snoozeToday = 'snooze_today';
}

class AppNotificationActionHandler {
  const AppNotificationActionHandler._();

  static Future<void> handleResponse(NotificationResponse response) async {
    final actionId = response.actionId;
    if (actionId == null || actionId.isEmpty) return;
    final category = _categoryFromPayload(response.payload);
    if (category == null) return;

    final now = DateTime.now();
    if (actionId == NotificationActionIds.snoozeTwoHours) {
      await NotificationPreferencesService.instance.snoozeCategoryUntil(
        category,
        now.add(const Duration(hours: 2)),
      );
      await LocalNotificationService.instance.cancelCategory(category);
      return;
    }

    if (actionId == NotificationActionIds.snoozeToday) {
      final tomorrow = DateTime(now.year, now.month, now.day + 1, 8);
      await NotificationPreferencesService.instance.snoozeCategoryUntil(
        category,
        tomorrow,
      );
      await LocalNotificationService.instance.cancelCategory(category);
    }
  }

  static AppNotificationCategory? _categoryFromPayload(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      return notificationCategoryFromKey(data['category']?.toString());
    } catch (_) {
      return null;
    }
  }
}

@pragma('vm:entry-point')
void notificationTapBackgroundHandler(NotificationResponse response) {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  unawaited(AppNotificationActionHandler.handleResponse(response));
}
