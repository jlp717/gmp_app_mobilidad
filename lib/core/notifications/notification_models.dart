import 'dart:convert';

enum AppNotificationCategory {
  orders,
  objectives,
  dailyPace,
  monthlyGoals,
  glacius,
  rutero,
}

extension AppNotificationCategoryDetails on AppNotificationCategory {
  String get key {
    switch (this) {
      case AppNotificationCategory.orders:
        return 'orders';
      case AppNotificationCategory.objectives:
        return 'objectives';
      case AppNotificationCategory.dailyPace:
        return 'daily_pace';
      case AppNotificationCategory.monthlyGoals:
        return 'monthly_goals';
      case AppNotificationCategory.glacius:
        return 'glacius';
      case AppNotificationCategory.rutero:
        return 'rutero';
    }
  }

  String get label {
    switch (this) {
      case AppNotificationCategory.orders:
        return 'Pedidos pendientes';
      case AppNotificationCategory.objectives:
        return 'Objetivos';
      case AppNotificationCategory.dailyPace:
        return 'Ritmo diario';
      case AppNotificationCategory.monthlyGoals:
        return 'Cierre mensual';
      case AppNotificationCategory.glacius:
        return 'Alertas Glacius';
      case AppNotificationCategory.rutero:
        return 'Rutero diario';
    }
  }

  int get baseNotificationId {
    switch (this) {
      case AppNotificationCategory.orders:
        return 11000;
      case AppNotificationCategory.objectives:
        return 12000;
      case AppNotificationCategory.dailyPace:
        return 13000;
      case AppNotificationCategory.monthlyGoals:
        return 14000;
      case AppNotificationCategory.glacius:
        return 15000;
      case AppNotificationCategory.rutero:
        return 16000;
    }
  }
}

AppNotificationCategory? notificationCategoryFromKey(String? key) {
  if (key == null) return null;
  for (final category in AppNotificationCategory.values) {
    if (category.key == key) return category;
  }
  return null;
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.category,
    required this.title,
    required this.body,
    required this.dedupeKey,
    this.kind = 'general',
    this.scheduledAt,
    this.deepLink,
    this.extra = const <String, dynamic>{},
    this.includeSnoozeActions = true,
  });

  final int id;
  final AppNotificationCategory category;
  final String title;
  final String body;
  final String dedupeKey;
  final String kind;
  final DateTime? scheduledAt;
  final String? deepLink;
  final Map<String, dynamic> extra;
  final bool includeSnoozeActions;

  String get payloadJson {
    return jsonEncode({
      'category': category.key,
      'kind': kind,
      'dedupeKey': dedupeKey,
      if (deepLink != null) 'deepLink': deepLink,
      if (extra.isNotEmpty) 'extra': extra,
    });
  }

  AppNotification copyWith({
    int? id,
    DateTime? scheduledAt,
    String? dedupeKey,
  }) {
    return AppNotification(
      id: id ?? this.id,
      category: category,
      title: title,
      body: body,
      dedupeKey: dedupeKey ?? this.dedupeKey,
      kind: kind,
      scheduledAt: scheduledAt ?? this.scheduledAt,
      deepLink: deepLink,
      extra: extra,
      includeSnoozeActions: includeSnoozeActions,
    );
  }
}

class NotificationUserProfile {
  const NotificationUserProfile({
    required this.userCode,
    required this.role,
    required this.isJefeVentas,
    required this.vendorCodes,
    this.userName = '',
  });

  final String userCode;
  final String role;
  final bool isJefeVentas;
  final List<String> vendorCodes;
  final String userName;

  bool get isRepartidor => role.toUpperCase() == 'REPARTIDOR';

  String get vendorCodesCsv {
    final codes = vendorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toList(growable: false);
    if (codes.isEmpty) return userCode;
    return codes.join(',');
  }

  String get scopeKey {
    final normalizedCodes = vendorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
    return [
      'user=${userCode.trim()}',
      'role=${role.trim().toUpperCase()}',
      'jefe=$isJefeVentas',
      'vendors=${normalizedCodes.join(',')}',
    ].join('|');
  }
}

class OrderReminderSnapshot {
  const OrderReminderSnapshot({
    this.localDraftCount = 0,
    this.localPendingCount = 0,
    this.localFailedCount = 0,
    this.serverDraftCount = 0,
    this.serverPendingCount = 0,
    this.oldestAt,
    this.clientNames = const <String>[],
  });

  final int localDraftCount;
  final int localPendingCount;
  final int localFailedCount;
  final int serverDraftCount;
  final int serverPendingCount;
  final DateTime? oldestAt;
  final List<String> clientNames;

  int get total =>
      localDraftCount +
      localPendingCount +
      localFailedCount +
      serverDraftCount +
      serverPendingCount;

  bool get hasPendingWork => total > 0;
}

class ObjectivesNotificationSnapshot {
  const ObjectivesNotificationSnapshot({
    required this.year,
    required this.month,
    this.sales = 0,
    this.objective = 0,
    this.paceObjective = 0,
    this.daysPassed = 0,
    this.workingDays = 0,
  });

  final int year;
  final int month;
  final double sales;
  final double objective;
  final double paceObjective;
  final int daysPassed;
  final int workingDays;

  double get progressPct => objective > 0 ? sales / objective * 100 : 0;
  double get pacePct => paceObjective > 0 ? sales / paceObjective * 100 : 0;
}

class RuteroNotificationSnapshot {
  const RuteroNotificationSnapshot({
    required this.date,
    required this.dayName,
    this.clientCount = 0,
    this.clientNames = const <String>[],
  });

  final DateTime date;
  final String dayName;
  final int clientCount;
  final List<String> clientNames;
}

class GlaciusNotificationSnapshot {
  const GlaciusNotificationSnapshot({
    this.totalAlerts = 0,
    this.criticalAlerts = 0,
    this.reincorporationAlerts = 0,
    this.clientNames = const <String>[],
  });

  final int totalAlerts;
  final int criticalAlerts;
  final int reincorporationAlerts;
  final List<String> clientNames;
}

class NotificationSnapshot {
  const NotificationSnapshot({
    required this.scopeKey,
    required this.orders,
    this.objectives,
    this.rutero,
    this.glacius,
  });

  final String scopeKey;
  final OrderReminderSnapshot orders;
  final ObjectivesNotificationSnapshot? objectives;
  final RuteroNotificationSnapshot? rutero;
  final GlaciusNotificationSnapshot? glacius;
}
