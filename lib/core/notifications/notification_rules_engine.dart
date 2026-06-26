import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_preferences.dart';
import 'package:intl/intl.dart';

class NotificationRuleEngine {
  const NotificationRuleEngine();

  OrderReminderPlan? buildOrderReminderPlan(
    NotificationSnapshot snapshot,
    NotificationPreferences settings, {
    DateTime? now,
  }) {
    final effectiveNow = now ?? DateTime.now();
    if (!snapshot.orders.hasPendingWork) return null;
    if (!settings.isCategoryAllowed(
      AppNotificationCategory.orders,
      now: effectiveNow,
    )) {
      return null;
    }

    final count = snapshot.orders.total;
    final title = count == 1
        ? 'Tienes un pedido pendiente'
        : 'Tienes $count pedidos pendientes';
    final clientText = _clientList(snapshot.orders.clientNames);
    final oldestText = _ageText(snapshot.orders.oldestAt, effectiveNow);
    final bodyParts = [
      if (snapshot.orders.localDraftCount > 0)
        '${snapshot.orders.localDraftCount} borrador(es) local(es)',
      if (snapshot.orders.localPendingCount > 0)
        '${snapshot.orders.localPendingCount} pendiente(s) de enviar',
      if (snapshot.orders.localFailedCount > 0)
        '${snapshot.orders.localFailedCount} requieren revision',
      if (snapshot.orders.serverDraftCount > 0)
        '${snapshot.orders.serverDraftCount} borrador(es) en servidor',
      if (snapshot.orders.serverPendingCount > 0)
        '${snapshot.orders.serverPendingCount} pendiente(s) en servidor',
    ];
    final body = [
      bodyParts.join(' - '),
      if (clientText.isNotEmpty) clientText,
      if (oldestText.isNotEmpty) oldestText,
    ].where((part) => part.isNotEmpty).join('. ');

    return OrderReminderPlan(
      title: title,
      body: body,
      interval: Duration(minutes: settings.orderReminderIntervalMinutes),
      dedupePrefix: '${snapshot.scopeKey}:orders:${effectiveNow.yMd}',
    );
  }

  List<AppNotification> buildImmediateNotifications(
    NotificationSnapshot snapshot, {
    DateTime? now,
  }) {
    final effectiveNow = now ?? DateTime.now();
    return [
      ..._objectiveNotifications(snapshot, effectiveNow),
      ..._ruteroNotifications(snapshot, effectiveNow),
      ..._glaciusNotifications(snapshot, effectiveNow),
    ];
  }

  List<AppNotification> _objectiveNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final objectives = snapshot.objectives;
    if (objectives == null || objectives.objective <= 0) return const [];

    final notifications = <AppNotification>[];
    final monthKey =
        '${snapshot.scopeKey}:objective:${objectives.year}-${objectives.month}';

    if (objectives.progressPct >= 100) {
      notifications.add(
        AppNotification(
          id: AppNotificationCategory.objectives.baseNotificationId,
          category: AppNotificationCategory.objectives,
          title: 'Objetivo conseguido',
          body:
              'Llevas ${_money(objectives.sales)} frente a un objetivo de ${_money(objectives.objective)}.',
          dedupeKey: '$monthKey:achieved',
          kind: 'objective_achieved',
          deepLink: 'gmp://dashboard/objetivos',
        ),
      );
    }

    if (objectives.daysPassed > 0 && objectives.paceObjective > 0) {
      final pace = objectives.pacePct;
      if (pace < 90 || pace >= 105) {
        final good = pace >= 105;
        notifications.add(
          AppNotification(
            id: AppNotificationCategory.dailyPace.baseNotificationId,
            category: AppNotificationCategory.dailyPace,
            title: good ? 'Vas por encima del ritmo' : 'Ritmo diario bajo',
            body: good
                ? 'Vas al ${pace.toStringAsFixed(0)}% del ritmo previsto. Buen margen para cerrar el mes.'
                : 'Vas al ${pace.toStringAsFixed(0)}% del ritmo previsto. Objetivo de ritmo: ${_money(objectives.paceObjective)}.',
            dedupeKey: '${snapshot.scopeKey}:pace:${now.yMd}',
            kind: good ? 'daily_pace_good' : 'daily_pace_risk',
            deepLink: 'gmp://dashboard/objetivos',
          ),
        );
      }
    }

    final lastDay = DateTime(now.year, now.month + 1, 0).day;
    if (now.day == lastDay && objectives.progressPct >= 100) {
      notifications.add(
        AppNotification(
          id: AppNotificationCategory.monthlyGoals.baseNotificationId,
          category: AppNotificationCategory.monthlyGoals,
          title: 'Mes cerrado con objetivo cumplido',
          body:
              'Cierre mensual al ${objectives.progressPct.toStringAsFixed(0)}% con ${_money(objectives.sales)} vendidos.',
          dedupeKey: '$monthKey:monthly_close',
          kind: 'monthly_goal_close',
          deepLink: 'gmp://dashboard/objetivos',
        ),
      );
    }

    return notifications;
  }

  List<AppNotification> _ruteroNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final rutero = snapshot.rutero;
    if (rutero == null || rutero.clientCount <= 0) return const [];
    if (now.hour < 7 || now.hour > 13) return const [];
    final clients = _clientList(rutero.clientNames);
    return [
      AppNotification(
        id: AppNotificationCategory.rutero.baseNotificationId,
        category: AppNotificationCategory.rutero,
        title: 'Rutero de hoy',
        body: [
          'Tienes ${rutero.clientCount} cliente(s) para ${rutero.dayName}.',
          if (clients.isNotEmpty) clients,
        ].join(' '),
        dedupeKey: '${snapshot.scopeKey}:rutero:${now.yMd}',
        kind: 'rutero_today',
        deepLink: 'gmp://dashboard/ruta',
      ),
    ];
  }

  List<AppNotification> _glaciusNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final glacius = snapshot.glacius;
    if (glacius == null || glacius.totalAlerts <= 0) return const [];

    final notifications = <AppNotification>[];
    if (glacius.reincorporationAlerts > 0) {
      notifications.add(
        AppNotification(
          id: AppNotificationCategory.glacius.baseNotificationId,
          category: AppNotificationCategory.glacius,
          title: 'Glacius: reincorporaciones',
          body:
              '${glacius.reincorporationAlerts} cliente(s) aparecen como alta o reincorporacion. ${_clientList(glacius.clientNames)}',
          dedupeKey: '${snapshot.scopeKey}:glacius:reincorporation:${now.yMd}',
          kind: 'glacius_reincorporation',
          deepLink: 'gmp://dashboard/alertas',
        ),
      );
    } else if (glacius.criticalAlerts > 0) {
      notifications.add(
        AppNotification(
          id: AppNotificationCategory.glacius.baseNotificationId + 1,
          category: AppNotificationCategory.glacius,
          title: 'Glacius: alertas criticas',
          body:
              '${glacius.criticalAlerts} alerta(s) critica(s) activas. ${_clientList(glacius.clientNames)}',
          dedupeKey: '${snapshot.scopeKey}:glacius:critical:${now.yMd}',
          kind: 'glacius_critical',
          deepLink: 'gmp://dashboard/alertas',
        ),
      );
    }
    return notifications;
  }

  static String _clientList(List<String> names) {
    final clean = names
        .map((name) => name.trim())
        .where((name) => name.isNotEmpty)
        .take(3)
        .toList(growable: false);
    if (clean.isEmpty) return '';
    return 'Clientes: ${clean.join(', ')}';
  }

  static String _ageText(DateTime? oldestAt, DateTime now) {
    if (oldestAt == null) return '';
    final diff = now.difference(oldestAt);
    if (diff.inDays > 0) return 'El mas antiguo tiene ${diff.inDays} dia(s)';
    if (diff.inHours > 0) return 'El mas antiguo tiene ${diff.inHours} h';
    return '';
  }

  static String _money(double value) {
    return NumberFormat.currency(
      locale: 'es_ES',
      symbol: 'EUR',
      decimalDigits: 0,
    ).format(value);
  }
}

class OrderReminderPlan {
  const OrderReminderPlan({
    required this.title,
    required this.body,
    required this.interval,
    required this.dedupePrefix,
  });

  final String title;
  final String body;
  final Duration interval;
  final String dedupePrefix;

  AppNotification notificationAt(DateTime scheduledAt, int index) {
    return AppNotification(
      id: AppNotificationCategory.orders.baseNotificationId + 100 + index,
      category: AppNotificationCategory.orders,
      title: title,
      body: body,
      dedupeKey: '$dedupePrefix:$index',
      kind: 'order_reminder',
      scheduledAt: scheduledAt,
      deepLink: 'gmp://dashboard/pedidos',
    );
  }
}

extension _DateKeys on DateTime {
  String get yMd {
    final monthText = month.toString().padLeft(2, '0');
    final dayText = day.toString().padLeft(2, '0');
    return '$year-$monthText-$dayText';
  }
}
