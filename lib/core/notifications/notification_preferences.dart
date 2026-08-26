import 'dart:convert';

import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

class NotificationPreferences {
  const NotificationPreferences({
    required this.enabled,
    required this.categoryEnabled,
    required this.snoozedUntil,
    required this.orderReminderIntervalMinutes,
    required this.quietStartHour,
    required this.quietEndHour,
    required this.permissionPrompted,
  });

  factory NotificationPreferences.defaults() {
    return NotificationPreferences(
      enabled: true,
      categoryEnabled: {
        for (final category in AppNotificationCategory.values)
          category.key: true,
      },
      snoozedUntil: const <String, DateTime>{},
      orderReminderIntervalMinutes: 30,
      quietStartHour: 22,
      quietEndHour: 7,
      permissionPrompted: false,
    );
  }

  final bool enabled;
  final Map<String, bool> categoryEnabled;
  final Map<String, DateTime> snoozedUntil;
  final int orderReminderIntervalMinutes;
  final int quietStartHour;
  final int quietEndHour;
  final bool permissionPrompted;

  bool isCategoryAllowed(
    AppNotificationCategory category, {
    DateTime? now,
  }) {
    if (!enabled) return false;
    if (categoryEnabled[category.key] == false) return false;
    final effectiveNow = now ?? DateTime.now();
    final globalSnooze = snoozedUntil[_globalSnoozeKey];
    if (globalSnooze != null && effectiveNow.isBefore(globalSnooze)) {
      return false;
    }
    final categorySnooze = snoozedUntil[category.key];
    if (categorySnooze != null && effectiveNow.isBefore(categorySnooze)) {
      return false;
    }
    return true;
  }

  bool isInQuietHours(DateTime dateTime) {
    final start = quietStartHour.clamp(0, 23);
    final end = quietEndHour.clamp(0, 23);
    final hour = dateTime.hour;
    if (start == end) return false;
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end;
  }

  DateTime nextAllowedTime(DateTime dateTime) {
    if (!isInQuietHours(dateTime)) return dateTime;
    final end = quietEndHour.clamp(0, 23);
    var next = DateTime(
      dateTime.year,
      dateTime.month,
      dateTime.day,
      end,
      0,
    );
    if (!next.isAfter(dateTime)) {
      next = next.add(const Duration(days: 1));
    }
    return next;
  }

  NotificationPreferences copyWith({
    bool? enabled,
    Map<String, bool>? categoryEnabled,
    Map<String, DateTime>? snoozedUntil,
    int? orderReminderIntervalMinutes,
    int? quietStartHour,
    int? quietEndHour,
    bool? permissionPrompted,
  }) {
    return NotificationPreferences(
      enabled: enabled ?? this.enabled,
      categoryEnabled: categoryEnabled ?? this.categoryEnabled,
      snoozedUntil: snoozedUntil ?? this.snoozedUntil,
      orderReminderIntervalMinutes:
          orderReminderIntervalMinutes ?? this.orderReminderIntervalMinutes,
      quietStartHour: quietStartHour ?? this.quietStartHour,
      quietEndHour: quietEndHour ?? this.quietEndHour,
      permissionPrompted: permissionPrompted ?? this.permissionPrompted,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'enabled': enabled,
      'categoryEnabled': categoryEnabled,
      'snoozedUntil': snoozedUntil.map(
        (key, value) => MapEntry(key, value.toIso8601String()),
      ),
      'orderReminderIntervalMinutes': orderReminderIntervalMinutes,
      'quietStartHour': quietStartHour,
      'quietEndHour': quietEndHour,
      'permissionPrompted': permissionPrompted,
    };
  }

  static NotificationPreferences fromJson(Map<String, dynamic> json) {
    final defaults = NotificationPreferences.defaults();
    final rawCategories = json['categoryEnabled'];
    final categories = {
      ...defaults.categoryEnabled,
      if (rawCategories is Map)
        ...rawCategories.map(
          (key, value) => MapEntry(key.toString(), value == true),
        ),
    };
    final rawSnoozed = json['snoozedUntil'];
    final snoozed = <String, DateTime>{};
    if (rawSnoozed is Map) {
      for (final entry in rawSnoozed.entries) {
        final parsed = DateTime.tryParse(entry.value?.toString() ?? '');
        if (parsed != null) snoozed[entry.key.toString()] = parsed;
      }
    }
    return NotificationPreferences(
      enabled: json['enabled'] as bool? ?? defaults.enabled,
      categoryEnabled: categories,
      snoozedUntil: snoozed,
      orderReminderIntervalMinutes:
          (json['orderReminderIntervalMinutes'] as num?)?.toInt() ??
              defaults.orderReminderIntervalMinutes,
      quietStartHour:
          (json['quietStartHour'] as num?)?.toInt() ?? defaults.quietStartHour,
      quietEndHour:
          (json['quietEndHour'] as num?)?.toInt() ?? defaults.quietEndHour,
      permissionPrompted:
          json['permissionPrompted'] as bool? ?? defaults.permissionPrompted,
    );
  }
}

class NotificationPreferencesService {
  NotificationPreferencesService._();

  static final NotificationPreferencesService instance =
      NotificationPreferencesService._();

  static const _preferencesKey = 'gmp_notifications_preferences_v1';
  static const _sentHistoryKey = 'gmp_notifications_sent_history_v1';
  static const _scheduledOrderIdsKey =
      'gmp_notifications_scheduled_order_ids_v1';
  static const _scheduledSmartIdsKey =
      'gmp_notifications_scheduled_smart_ids_v1';
  static const _sessionHistoryKey = 'gmp_notifications_session_history_v1';

  Future<NotificationPreferences> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_preferencesKey);
    if (raw == null || raw.isEmpty) return NotificationPreferences.defaults();
    try {
      return NotificationPreferences.fromJson(
        jsonDecode(raw) as Map<String, dynamic>,
      );
    } catch (_) {
      return NotificationPreferences.defaults();
    }
  }

  Future<void> save(NotificationPreferences settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_preferencesKey, jsonEncode(settings.toJson()));
  }

  Future<NotificationPreferences> setEnabled(bool enabled) async {
    final settings = (await load()).copyWith(enabled: enabled);
    await save(settings);
    return settings;
  }

  Future<NotificationPreferences> setCategoryEnabled(
    AppNotificationCategory category,
    bool enabled,
  ) async {
    final current = await load();
    final nextCategories = Map<String, bool>.from(current.categoryEnabled)
      ..[category.key] = enabled;
    final next = current.copyWith(categoryEnabled: nextCategories);
    await save(next);
    return next;
  }

  Future<NotificationPreferences> setOrderReminderInterval(
    int minutes,
  ) async {
    final current = await load();
    final next = current.copyWith(
      orderReminderIntervalMinutes: minutes.clamp(15, 240),
    );
    await save(next);
    return next;
  }

  Future<NotificationPreferences> markPermissionPrompted() async {
    final current = await load();
    final next = current.copyWith(permissionPrompted: true);
    await save(next);
    return next;
  }

  Future<NotificationPreferences> snoozeAllUntil(DateTime until) async {
    final current = await load();
    final nextSnoozed = Map<String, DateTime>.from(current.snoozedUntil)
      ..[_globalSnoozeKey] = until;
    final next = current.copyWith(snoozedUntil: nextSnoozed);
    await save(next);
    return next;
  }

  Future<NotificationPreferences> snoozeCategoryUntil(
    AppNotificationCategory category,
    DateTime until,
  ) async {
    final current = await load();
    final nextSnoozed = Map<String, DateTime>.from(current.snoozedUntil)
      ..[category.key] = until;
    final next = current.copyWith(snoozedUntil: nextSnoozed);
    await save(next);
    return next;
  }

  Future<NotificationPreferences> clearSnooze([
    AppNotificationCategory? category,
  ]) async {
    final current = await load();
    final nextSnoozed = Map<String, DateTime>.from(current.snoozedUntil);
    if (category == null) {
      nextSnoozed.remove(_globalSnoozeKey);
    } else {
      nextSnoozed.remove(category.key);
    }
    final next = current.copyWith(snoozedUntil: nextSnoozed);
    await save(next);
    return next;
  }

  Future<bool> hasSent(String dedupeKey) async {
    final history = await _loadSentHistory();
    return history.containsKey(dedupeKey);
  }

  Future<void> markSent(String dedupeKey, {DateTime? sentAt}) async {
    final prefs = await SharedPreferences.getInstance();
    final now = sentAt ?? DateTime.now();
    final history = await _loadSentHistory(now: now);
    history[dedupeKey] = now.millisecondsSinceEpoch;
    await prefs.setString(_sentHistoryKey, jsonEncode(history));
  }

  Future<void> saveScheduledOrderIds(List<int> ids) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _scheduledOrderIdsKey,
      ids.map((id) => id.toString()).toList(growable: false),
    );
  }

  Future<List<int>> loadScheduledOrderIds() async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_scheduledOrderIdsKey) ?? const <String>[])
        .map(int.tryParse)
        .whereType<int>()
        .toList(growable: false);
  }

  Future<void> clearScheduledOrderIds() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_scheduledOrderIdsKey);
  }

  Future<void> saveScheduledSmartIds(List<int> ids) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _scheduledSmartIdsKey,
      ids.map((id) => id.toString()).toList(growable: false),
    );
  }

  Future<List<int>> loadScheduledSmartIds() async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_scheduledSmartIdsKey) ?? const <String>[])
        .map(int.tryParse)
        .whereType<int>()
        .toList(growable: false);
  }

  Future<void> clearScheduledSmartIds() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_scheduledSmartIdsKey);
  }

  Future<void> rememberSession(NotificationUserProfile profile) async {
    final prefs = await SharedPreferences.getInstance();
    final sessions = await loadSessionHistory();
    final next = [
      NotificationDeviceSession(
        profile: profile,
        lastSeenAt: DateTime.now(),
      ),
      ...sessions
          .where((session) => session.profile.scopeKey != profile.scopeKey),
    ].take(8).toList(growable: false);
    await prefs.setString(
      _sessionHistoryKey,
      jsonEncode(next.map((session) => session.toJson()).toList()),
    );
  }

  Future<List<NotificationDeviceSession>> loadSessionHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_sessionHistoryKey);
    if (raw == null || raw.isEmpty) return const <NotificationDeviceSession>[];
    try {
      final decoded = jsonDecode(raw) as List;
      final sessions = decoded
          .whereType<Map>()
          .map(
            (item) => NotificationDeviceSession.fromJson(
              Map<String, dynamic>.from(item),
            ),
          )
          .whereType<NotificationDeviceSession>()
          .toList()
        ..sort((a, b) => b.lastSeenAt.compareTo(a.lastSeenAt));
      final cutoff = DateTime.now().subtract(const Duration(days: 45));
      return sessions
          .where((session) => session.lastSeenAt.isAfter(cutoff))
          .toList(growable: false);
    } catch (_) {
      return const <NotificationDeviceSession>[];
    }
  }

  Future<Map<String, int>> _loadSentHistory({DateTime? now}) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_sentHistoryKey);
    final cutoff = (now ?? DateTime.now()).subtract(const Duration(days: 75));
    if (raw == null || raw.isEmpty) return <String, int>{};
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return decoded.map((key, value) {
        return MapEntry(key, (value as num?)?.toInt() ?? 0);
      })
        ..removeWhere((_, value) {
          return DateTime.fromMillisecondsSinceEpoch(value).isBefore(cutoff);
        });
    } catch (_) {
      return <String, int>{};
    }
  }
}

const _globalSnoozeKey = 'all';
