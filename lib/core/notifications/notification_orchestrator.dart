import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/notifications/local_notification_service.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_background.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_data_repository.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_preferences.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_rules_engine.dart';
import 'package:gmp_app_mobilidad/core/services/session_scope.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';

class NotificationOrchestrator {
  NotificationOrchestrator._({
    NotificationDataRepository? repository,
    NotificationRuleEngine? rules,
  })  : _repository = repository ?? const NotificationDataRepository(),
        _rules = rules ?? const NotificationRuleEngine();

  static final NotificationOrchestrator instance = NotificationOrchestrator._();

  final NotificationDataRepository _repository;
  final NotificationRuleEngine _rules;
  final LocalNotificationService _local = LocalNotificationService.instance;
  final NotificationPreferencesService _preferences =
      NotificationPreferencesService.instance;

  NotificationUserProfile? _activeProfile;
  bool _initialized = false;
  bool _refreshing = false;

  Future<void> initialize({bool registerBackground = true}) async {
    if (_initialized) return;
    await _local.initialize();
    PedidosOfflineService.onChanged =
        () => refreshOrderReminders(reason: 'pedidos_changed');
    if (registerBackground) {
      await NotificationBackgroundScheduler.initializeAndRegister();
    }
    _initialized = true;
  }

  Future<void> syncForUser({
    required UserModel? user,
    required List<String> vendedorCodes,
    String reason = 'auth',
  }) async {
    await initialize();
    if (user == null) {
      await clearForLogout();
      return;
    }

    SessionScope.apply(user, vendedorCodes);
    _activeProfile = NotificationSessionStore.fromUser(user, vendedorCodes);
    await NotificationSessionStore.rememberUserSession(user, vendedorCodes);

    final settings = await _preferences.load();
    if (settings.enabled && !settings.permissionPrompted) {
      await _local.requestPermissionsIfNeeded();
    }
    await refreshAll(reason: reason);
  }

  Future<void> clearForLogout() async {
    _activeProfile = null;
    await _local.cancelAllGmpNotifications();
  }

  Future<void> refreshAll({
    String reason = 'manual',
    DateTime? now,
  }) async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      await initialize(registerBackground: false);
      final profile =
          _activeProfile ?? await NotificationSessionStore.loadStoredProfile();
      final snapshot = await _repository.loadSnapshot(
        profile: profile,
        now: now,
      );
      final settings = await _preferences.load();
      await _scheduleOrderReminders(snapshot, settings, now: now);
      await _scheduleSmartNotifications(snapshot, settings, now: now);
      await _showImmediateNotifications(snapshot, settings, now: now);
    } catch (e, stack) {
      debugPrint('[Notifications] refreshAll failed ($reason): $e\n$stack');
    } finally {
      _refreshing = false;
    }
  }

  Future<void> refreshOrderReminders({
    String reason = 'orders',
    DateTime? now,
  }) async {
    try {
      await initialize(registerBackground: false);
      final profile =
          _activeProfile ?? await NotificationSessionStore.loadStoredProfile();
      final snapshot = await _repository.loadSnapshot(
        profile: profile,
        now: now,
      );
      final settings = await _preferences.load();
      await _scheduleOrderReminders(snapshot, settings, now: now);
    } catch (e) {
      debugPrint('[Notifications] refreshOrderReminders failed ($reason): $e');
    }
  }

  Future<void> _showImmediateNotifications(
    NotificationSnapshot snapshot,
    NotificationPreferences settings, {
    DateTime? now,
  }) async {
    final effectiveNow = now ?? DateTime.now();
    if (!settings.enabled || settings.isInQuietHours(effectiveNow)) return;
    final notifications = _rules.buildImmediateNotifications(
      snapshot,
      now: effectiveNow,
    );
    var shown = 0;
    for (final notification in notifications) {
      if (!settings.isCategoryAllowed(notification.category,
          now: effectiveNow)) {
        continue;
      }
      if (await _preferences.hasSent(notification.dedupeKey)) continue;
      await _local.show(notification);
      await _preferences.markSent(notification.dedupeKey, sentAt: effectiveNow);
      shown++;
      if (shown >= 5) return;
    }
  }

  Future<void> _scheduleOrderReminders(
    NotificationSnapshot snapshot,
    NotificationPreferences settings, {
    DateTime? now,
  }) async {
    await _local.cancelOrderReminderSeries();
    final effectiveNow = now ?? DateTime.now();
    final plan = _rules.buildOrderReminderPlan(
      snapshot,
      settings,
      now: effectiveNow,
    );
    if (plan == null) return;

    final scheduledIds = <int>[];
    var scheduledAt = effectiveNow.add(plan.interval);
    for (var i = 0; i < 48; i++) {
      scheduledAt = settings.nextAllowedTime(scheduledAt);
      final notification = plan.notificationAt(scheduledAt, i);
      await _local.schedule(notification);
      scheduledIds.add(notification.id);
      scheduledAt = scheduledAt.add(plan.interval);
    }
    await _preferences.saveScheduledOrderIds(scheduledIds);
  }

  Future<void> _scheduleSmartNotifications(
    NotificationSnapshot snapshot,
    NotificationPreferences settings, {
    DateTime? now,
  }) async {
    await _local.cancelScheduledSmartNotifications();
    final effectiveNow = now ?? DateTime.now();
    final notifications = _rules.buildScheduledNotifications(
      snapshot,
      settings,
      now: effectiveNow,
    );
    final scheduledIds = <int>[];
    for (final notification in notifications) {
      if (notification.scheduledAt == null) continue;
      if (!settings.isCategoryAllowed(
        notification.category,
        now: notification.scheduledAt,
      )) {
        continue;
      }
      await _local.schedule(notification);
      scheduledIds.add(notification.id);
    }
    await _preferences.saveScheduledSmartIds(scheduledIds);
  }
}
