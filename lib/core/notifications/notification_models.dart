import 'dart:convert';

enum AppNotificationCategory {
  orders,
  clients,
  invoices,
  commissions,
  objectives,
  dailyPace,
  monthlyGoals,
  glacius,
  rutero,
  bolsa,
  dailySummary,
  deliveries,
}

extension AppNotificationCategoryDetails on AppNotificationCategory {
  String get key {
    switch (this) {
      case AppNotificationCategory.orders:
        return 'orders';
      case AppNotificationCategory.clients:
        return 'clients';
      case AppNotificationCategory.invoices:
        return 'invoices';
      case AppNotificationCategory.commissions:
        return 'commissions';
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
      case AppNotificationCategory.bolsa:
        return 'bolsa';
      case AppNotificationCategory.dailySummary:
        return 'daily_summary';
      case AppNotificationCategory.deliveries:
        return 'deliveries';
    }
  }

  String get label {
    switch (this) {
      case AppNotificationCategory.orders:
        return 'Pedidos pendientes';
      case AppNotificationCategory.clients:
        return 'Clientes importantes';
      case AppNotificationCategory.invoices:
        return 'Facturas y albaranes';
      case AppNotificationCategory.commissions:
        return 'Comisiones';
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
      case AppNotificationCategory.bolsa:
        return 'Bolsa comercial';
      case AppNotificationCategory.dailySummary:
        return 'Resumen diario';
      case AppNotificationCategory.deliveries:
        return 'Reparto';
    }
  }

  int get baseNotificationId {
    switch (this) {
      case AppNotificationCategory.orders:
        return 11000;
      case AppNotificationCategory.clients:
        return 11500;
      case AppNotificationCategory.invoices:
        return 11800;
      case AppNotificationCategory.commissions:
        return 11900;
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
      case AppNotificationCategory.bolsa:
        return 17000;
      case AppNotificationCategory.dailySummary:
        return 18000;
      case AppNotificationCategory.deliveries:
        return 19000;
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
    this.conductorCodes = const <String>[],
    this.showCommissions = true,
  });

  final String userCode;
  final String role;
  final bool isJefeVentas;
  final List<String> vendorCodes;
  final String userName;
  final List<String> conductorCodes;
  final bool showCommissions;

  String get normalizedRole => role.trim().toUpperCase();
  bool get isRepartidor => normalizedRole == 'REPARTIDOR';
  bool get isWarehouse =>
      normalizedRole == 'ALMACEN' || normalizedRole == 'ALMACÉN';
  bool get isJefeRole =>
      isJefeVentas ||
      normalizedRole == 'JEFE' ||
      normalizedRole == 'JEFE_VENTAS' ||
      normalizedRole == 'GERENTE' ||
      normalizedRole == 'ADMIN';
  bool get isCommercial => !isRepartidor && !isWarehouse;

  bool get canReceiveCommercialAlerts => isJefeRole || isCommercial;
  bool get canReceiveDeliveryAlerts => isJefeRole || isRepartidor;
  bool get canReceiveWarehouseAlerts => isJefeRole || isWarehouse;

  String get vendorCodesCsv {
    final codes = vendorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toList(growable: false);
    if (codes.isEmpty) return userCode;
    return codes.join(',');
  }

  String get deliveryCodesCsv {
    final codes = conductorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toList(growable: false);
    if (codes.isNotEmpty) return codes.join(',');
    if (isRepartidor) return userCode;
    if (isJefeRole) return vendorCodesCsv;
    return '';
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
      'delivery=${deliveryCodesCsv}',
    ].join('|');
  }

  Map<String, dynamic> toJson() {
    return {
      'userCode': userCode,
      'role': role,
      'isJefeVentas': isJefeVentas,
      'vendorCodes': vendorCodes,
      'userName': userName,
      'conductorCodes': conductorCodes,
      'showCommissions': showCommissions,
    };
  }

  static NotificationUserProfile? fromJson(Map<String, dynamic> json) {
    final userCode = json['userCode']?.toString().trim() ?? '';
    final role = json['role']?.toString().trim() ?? '';
    if (userCode.isEmpty || role.isEmpty) return null;
    return NotificationUserProfile(
      userCode: userCode,
      role: role,
      isJefeVentas: json['isJefeVentas'] == true,
      vendorCodes: (json['vendorCodes'] as List? ?? const [])
          .map((code) => code.toString())
          .toList(growable: false),
      userName: json['userName']?.toString() ?? '',
      conductorCodes: (json['conductorCodes'] as List? ?? const [])
          .map((code) => code.toString())
          .toList(growable: false),
      showCommissions: json['showCommissions'] as bool? ?? true,
    );
  }
}

class NotificationDeviceSession {
  const NotificationDeviceSession({
    required this.profile,
    required this.lastSeenAt,
  });

  final NotificationUserProfile profile;
  final DateTime lastSeenAt;

  Map<String, dynamic> toJson() {
    return {
      'profile': profile.toJson(),
      'lastSeenAt': lastSeenAt.toIso8601String(),
    };
  }

  static NotificationDeviceSession? fromJson(Map<String, dynamic> json) {
    final rawProfile = json['profile'];
    if (rawProfile is! Map) return null;
    final profile = NotificationUserProfile.fromJson(
      Map<String, dynamic>.from(rawProfile),
    );
    final lastSeenAt = DateTime.tryParse(
      json['lastSeenAt']?.toString() ?? '',
    );
    if (profile == null || lastSeenAt == null) return null;
    return NotificationDeviceSession(
      profile: profile,
      lastSeenAt: lastSeenAt,
    );
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
    this.priorityClientNames = const <String>[],
    this.inactiveClientCount = 0,
    this.newClientCount = 0,
    this.totalSales = 0,
  });

  final DateTime date;
  final String dayName;
  final int clientCount;
  final List<String> clientNames;
  final List<String> priorityClientNames;
  final int inactiveClientCount;
  final int newClientCount;
  final double totalSales;
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

class ClientsNotificationSnapshot {
  const ClientsNotificationSnapshot({
    this.criticalAlertCount = 0,
    this.warningAlertCount = 0,
    this.noPurchaseCount = 0,
    this.newClientCount = 0,
    this.clientNames = const <String>[],
  });

  final int criticalAlertCount;
  final int warningAlertCount;
  final int noPurchaseCount;
  final int newClientCount;
  final List<String> clientNames;

  bool get hasImportantAlerts =>
      criticalAlertCount > 0 || noPurchaseCount > 0 || newClientCount > 0;
}

class InvoicesNotificationSnapshot {
  const InvoicesNotificationSnapshot({
    this.todayDocuments = 0,
    this.todayInvoices = 0,
    this.todayDeliveryNotes = 0,
    this.todayAmount = 0,
    this.monthDocuments = 0,
    this.monthAmount = 0,
  });

  final int todayDocuments;
  final int todayInvoices;
  final int todayDeliveryNotes;
  final double todayAmount;
  final int monthDocuments;
  final double monthAmount;
}

class CommissionsNotificationSnapshot {
  const CommissionsNotificationSnapshot({
    this.month = 0,
    this.currentSales = 0,
    this.monthTarget = 0,
    this.monthCommission = 0,
    this.paidThisMonth = 0,
  });

  final int month;
  final double currentSales;
  final double monthTarget;
  final double monthCommission;
  final double paidThisMonth;

  double get progressPct =>
      monthTarget > 0 ? currentSales / monthTarget * 100 : 0;
  double get pendingCommission =>
      (monthCommission - paidThisMonth).clamp(0, double.infinity).toDouble();
}

class BolsaNotificationSnapshot {
  const BolsaNotificationSnapshot({
    this.vendorCount = 1,
    this.deficitCount = 0,
    this.lowCount = 0,
    this.available = 0,
    this.consumed = 0,
    this.accumulated = 0,
    this.vendorNames = const <String>[],
  });

  final int vendorCount;
  final int deficitCount;
  final int lowCount;
  final double available;
  final double consumed;
  final double accumulated;
  final List<String> vendorNames;

  bool get hasRisk => deficitCount > 0 || lowCount > 0;
}

class SalesDayNotificationSnapshot {
  const SalesDayNotificationSnapshot({
    this.sales = 0,
    this.orders = 0,
    this.clients = 0,
    this.margin = 0,
    this.topClientNames = const <String>[],
  });

  final double sales;
  final int orders;
  final int clients;
  final double margin;
  final List<String> topClientNames;
}

class DeliveryNotificationSnapshot {
  const DeliveryNotificationSnapshot({
    required this.date,
    this.deliveryCount = 0,
    this.completedCount = 0,
    this.totalAmount = 0,
    this.cashToCollect = 0,
    this.clientNames = const <String>[],
  });

  final DateTime date;
  final int deliveryCount;
  final int completedCount;
  final double totalAmount;
  final double cashToCollect;
  final List<String> clientNames;

  bool get hasDeliveries => deliveryCount > 0;
  bool get isComplete => deliveryCount > 0 && completedCount >= deliveryCount;
}

class NotificationSnapshot {
  const NotificationSnapshot({
    required this.scopeKey,
    required this.orders,
    this.profile,
    this.objectives,
    this.rutero,
    this.nextRutero,
    this.glacius,
    this.clients,
    this.invoices,
    this.commissions,
    this.bolsa,
    this.salesDay,
    this.deliveries,
  });

  final String scopeKey;
  final OrderReminderSnapshot orders;
  final NotificationUserProfile? profile;
  final ObjectivesNotificationSnapshot? objectives;
  final RuteroNotificationSnapshot? rutero;
  final RuteroNotificationSnapshot? nextRutero;
  final GlaciusNotificationSnapshot? glacius;
  final ClientsNotificationSnapshot? clients;
  final InvoicesNotificationSnapshot? invoices;
  final CommissionsNotificationSnapshot? commissions;
  final BolsaNotificationSnapshot? bolsa;
  final SalesDayNotificationSnapshot? salesDay;
  final DeliveryNotificationSnapshot? deliveries;
}
