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
      ..._clientNotifications(snapshot, effectiveNow),
      ..._glaciusNotifications(snapshot, effectiveNow),
      ..._bolsaNotifications(snapshot, effectiveNow),
      ..._invoiceNotifications(snapshot, effectiveNow),
      ..._commissionNotifications(snapshot, effectiveNow),
      ..._dailySummaryNotifications(snapshot, effectiveNow),
      ..._deliveryNotifications(snapshot, effectiveNow),
    ];
  }

  List<AppNotification> buildScheduledNotifications(
    NotificationSnapshot snapshot,
    NotificationPreferences settings, {
    DateTime? now,
  }) {
    final effectiveNow = now ?? DateTime.now();
    if (!settings.enabled) return const [];
    return [
      ..._scheduledRouteNotifications(snapshot, settings, effectiveNow),
      ..._scheduledDeliveryNotifications(snapshot, settings, effectiveNow),
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

    if (now.hour >= 12 &&
        now.hour <= 19 &&
        objectives.daysPassed > 0 &&
        objectives.paceObjective > 0) {
      final pace = objectives.pacePct;
      if (pace < 90 || pace >= 110) {
        final good = pace >= 110;
        notifications.add(
          AppNotification(
            id: AppNotificationCategory.dailyPace.baseNotificationId,
            category: AppNotificationCategory.dailyPace,
            title: good ? 'Vas por encima del ritmo' : 'Ritmo diario bajo',
            body: good
                ? 'Vas al ${pace.toStringAsFixed(0)}% del ritmo previsto. Margen para cerrar el mes.'
                : 'Vas al ${pace.toStringAsFixed(0)}% del ritmo previsto. Ritmo objetivo: ${_money(objectives.paceObjective)}.',
            dedupeKey: '${snapshot.scopeKey}:pace:${now.yMd}',
            kind: good ? 'daily_pace_good' : 'daily_pace_risk',
            deepLink: 'gmp://dashboard/objetivos',
          ),
        );
      }
    }

    final lastDay = DateTime(now.year, now.month + 1, 0).day;
    if (now.day == lastDay && now.hour >= 17 && objectives.progressPct >= 100) {
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
    if (now.hour < 7 || now.hour > 10) return const [];
    final clients = _clientList(
      rutero.priorityClientNames.isNotEmpty
          ? rutero.priorityClientNames
          : rutero.clientNames,
    );
    return [
      AppNotification(
        id: AppNotificationCategory.rutero.baseNotificationId,
        category: AppNotificationCategory.rutero,
        title: 'Rutero de hoy',
        body: [
          'Tienes ${rutero.clientCount} cliente(s) para ${rutero.dayName}.',
          if (clients.isNotEmpty) clients,
          if (rutero.inactiveClientCount > 0)
            '${rutero.inactiveClientCount} sin ventas recientes.',
        ].join(' '),
        dedupeKey: '${snapshot.scopeKey}:rutero:${now.yMd}',
        kind: 'rutero_today',
        deepLink: 'gmp://dashboard/ruta',
      ),
    ];
  }

  List<AppNotification> _clientNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final clients = snapshot.clients;
    final rutero = snapshot.rutero;
    if (clients == null || !clients.hasImportantAlerts) return const [];
    if (now.hour < 8 || now.hour > 14) return const [];
    final names = _clientList(
      clients.clientNames.isNotEmpty
          ? clients.clientNames
          : rutero?.clientNames ?? const <String>[],
    );
    return [
      AppNotification(
        id: AppNotificationCategory.clients.baseNotificationId,
        category: AppNotificationCategory.clients,
        title: 'Clientes que conviene revisar',
        body: [
          if (clients.criticalAlertCount > 0)
            '${clients.criticalAlertCount} alerta(s) critica(s)',
          if (clients.noPurchaseCount > 0)
            '${clients.noPurchaseCount} cliente(s) sin compra',
          if (clients.newClientCount > 0)
            '${clients.newClientCount} alta(s) o reincorporaciones',
          if (names.isNotEmpty) names,
        ].join('. '),
        dedupeKey: '${snapshot.scopeKey}:clients:${now.yMd}',
        kind: 'clients_attention',
        deepLink: 'gmp://dashboard/clientes',
      ),
    ];
  }

  List<AppNotification> _glaciusNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final glacius = snapshot.glacius;
    if (glacius == null || glacius.totalAlerts <= 0) return const [];
    if (now.hour < 8 || now.hour > 18) return const [];

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

  List<AppNotification> _bolsaNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final bolsa = snapshot.bolsa;
    if (bolsa == null || !bolsa.hasRisk) return const [];
    if (now.hour < 9 || now.hour > 18) return const [];
    final deficit = bolsa.deficitCount;
    final low = bolsa.lowCount;
    return [
      AppNotification(
        id: AppNotificationCategory.bolsa.baseNotificationId,
        category: AppNotificationCategory.bolsa,
        title: deficit > 0 ? 'Bolsa en deficit' : 'Bolsa casi agotada',
        body: [
          if (deficit > 0) '$deficit vendedor(es) en negativo',
          if (low > 0) '$low vendedor(es) con saldo bajo',
          'Disponible: ${_money(bolsa.available)}.',
          if (bolsa.vendorNames.isNotEmpty)
            'Codigos: ${bolsa.vendorNames.join(', ')}.',
        ].join(' '),
        dedupeKey: '${snapshot.scopeKey}:bolsa:${now.yMd}',
        kind: deficit > 0 ? 'bolsa_deficit' : 'bolsa_low',
        deepLink: 'gmp://dashboard/bolsa',
      ),
    ];
  }

  List<AppNotification> _invoiceNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final invoices = snapshot.invoices;
    if (invoices == null || invoices.todayDocuments <= 0) return const [];
    if (now.hour < 16 || now.hour > 20) return const [];
    if (invoices.todayDocuments < 3 && invoices.todayAmount < 500) {
      return const [];
    }
    return [
      AppNotification(
        id: AppNotificationCategory.invoices.baseNotificationId,
        category: AppNotificationCategory.invoices,
        title: 'Facturacion del dia',
        body:
            '${invoices.todayDocuments} documento(s), ${_money(invoices.todayAmount)} emitidos hoy.',
        dedupeKey: '${snapshot.scopeKey}:invoices:${now.yMd}',
        kind: 'invoices_today',
        deepLink: 'gmp://dashboard/facturas',
      ),
    ];
  }

  List<AppNotification> _commissionNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final commissions = snapshot.commissions;
    if (commissions == null || commissions.pendingCommission < 20) {
      return const [];
    }
    if (now.hour < 16 || now.hour > 20) return const [];
    if (commissions.progressPct < 100 && now.day < 25) return const [];
    return [
      AppNotification(
        id: AppNotificationCategory.commissions.baseNotificationId,
        category: AppNotificationCategory.commissions,
        title: 'Comision pendiente',
        body:
            'Este mes hay ${_money(commissions.pendingCommission)} pendientes de revisar. Ventas al ${commissions.progressPct.toStringAsFixed(0)}% del objetivo.',
        dedupeKey:
            '${snapshot.scopeKey}:commission:${now.year}-${commissions.month}',
        kind: 'commission_pending',
        deepLink: 'gmp://dashboard/comisiones',
      ),
    ];
  }

  List<AppNotification> _dailySummaryNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final sales = snapshot.salesDay;
    final rutero = snapshot.rutero;
    if (sales == null || sales.orders <= 0 || sales.sales <= 0) {
      return const [];
    }
    if (now.hour < 18 || now.hour > 21) return const [];
    return [
      AppNotification(
        id: AppNotificationCategory.dailySummary.baseNotificationId,
        category: AppNotificationCategory.dailySummary,
        title: 'Resumen comercial del dia',
        body: [
          '${sales.orders} pedido(s), ${_money(sales.sales)} vendidos.',
          if (rutero != null && rutero.clientCount > 0)
            'Ruta: ${rutero.clientCount} cliente(s).',
          if (sales.topClientNames.isNotEmpty)
            _clientList(sales.topClientNames),
        ].join(' '),
        dedupeKey: '${snapshot.scopeKey}:daily-summary:${now.yMd}',
        kind: 'daily_sales_summary',
        deepLink: 'gmp://dashboard/pedidos',
      ),
    ];
  }

  List<AppNotification> _deliveryNotifications(
    NotificationSnapshot snapshot,
    DateTime now,
  ) {
    final deliveries = snapshot.deliveries;
    if (deliveries == null || !deliveries.hasDeliveries) return const [];
    if (now.hour >= 7 && now.hour <= 10) {
      return [
        AppNotification(
          id: AppNotificationCategory.deliveries.baseNotificationId,
          category: AppNotificationCategory.deliveries,
          title: 'Reparto de hoy',
          body: [
            '${deliveries.deliveryCount} entrega(s).',
            if (deliveries.cashToCollect > 0)
              'A cobrar: ${_money(deliveries.cashToCollect)}.',
            _clientList(deliveries.clientNames),
          ].where((part) => part.isNotEmpty).join(' '),
          dedupeKey: '${snapshot.scopeKey}:deliveries:morning:${now.yMd}',
          kind: 'deliveries_morning',
          deepLink: 'gmp://dashboard/reparto',
        ),
      ];
    }
    if ((deliveries.isComplete || now.hour >= 18) &&
        now.hour >= 16 &&
        now.hour <= 21) {
      return [
        AppNotification(
          id: AppNotificationCategory.deliveries.baseNotificationId + 1,
          category: AppNotificationCategory.deliveries,
          title: 'Resumen de reparto',
          body:
              '${deliveries.completedCount}/${deliveries.deliveryCount} entrega(s), ${_money(deliveries.totalAmount)} gestionados.',
          dedupeKey: '${snapshot.scopeKey}:deliveries:summary:${now.yMd}',
          kind: 'deliveries_summary',
          deepLink: 'gmp://dashboard/reparto',
        ),
      ];
    }
    return const [];
  }

  List<AppNotification> _scheduledRouteNotifications(
    NotificationSnapshot snapshot,
    NotificationPreferences settings,
    DateTime now,
  ) {
    final todayAtSix = DateTime(now.year, now.month, now.day, 6);
    final scheduledAt = now.isBefore(todayAtSix)
        ? todayAtSix
        : todayAtSix.add(const Duration(days: 1));
    final route = _sameDay(snapshot.rutero?.date, scheduledAt)
        ? snapshot.rutero
        : _sameDay(snapshot.nextRutero?.date, scheduledAt)
            ? snapshot.nextRutero
            : null;
    if (route == null || route.clientCount <= 0) return const [];
    if (!settings.isCategoryAllowed(
      AppNotificationCategory.rutero,
      now: scheduledAt,
    )) {
      return const [];
    }
    final clients = route.priorityClientNames.isNotEmpty
        ? route.priorityClientNames
        : route.clientNames;
    return [
      AppNotification(
        id: AppNotificationCategory.rutero.baseNotificationId + 40,
        category: AppNotificationCategory.rutero,
        title: 'Ruta de ${route.dayName}',
        body: [
          '${route.clientCount} cliente(s) previstos.',
          if (clients.isNotEmpty) _clientList(clients),
          if (route.inactiveClientCount > 0)
            '${route.inactiveClientCount} requieren recuperar venta.',
        ].join(' '),
        dedupeKey: '${snapshot.scopeKey}:rutero:scheduled:${scheduledAt.yMd}',
        kind: 'rutero_0600',
        scheduledAt: scheduledAt,
        deepLink: 'gmp://dashboard/ruta',
      ),
    ];
  }

  List<AppNotification> _scheduledDeliveryNotifications(
    NotificationSnapshot snapshot,
    NotificationPreferences settings,
    DateTime now,
  ) {
    final deliveries = snapshot.deliveries;
    if (deliveries == null || !deliveries.hasDeliveries) return const [];
    final todayAtSixTen = DateTime(now.year, now.month, now.day, 6, 10);
    if (!now.isBefore(todayAtSixTen)) return const [];
    if (!settings.isCategoryAllowed(
      AppNotificationCategory.deliveries,
      now: todayAtSixTen,
    )) {
      return const [];
    }
    return [
      AppNotification(
        id: AppNotificationCategory.deliveries.baseNotificationId + 40,
        category: AppNotificationCategory.deliveries,
        title: 'Reparto programado',
        body: [
          '${deliveries.deliveryCount} entrega(s) para hoy.',
          if (deliveries.cashToCollect > 0)
            'A cobrar: ${_money(deliveries.cashToCollect)}.',
          _clientList(deliveries.clientNames),
        ].where((part) => part.isNotEmpty).join(' '),
        dedupeKey: '${snapshot.scopeKey}:deliveries:scheduled:${now.yMd}',
        kind: 'deliveries_0610',
        scheduledAt: todayAtSixTen,
        deepLink: 'gmp://dashboard/reparto',
      ),
    ];
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

  static bool _sameDay(DateTime? left, DateTime right) {
    return left != null &&
        left.year == right.year &&
        left.month == right.month &&
        left.day == right.day;
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
