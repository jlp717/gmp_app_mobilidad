import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_preferences.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_rules_engine.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });

  group('NotificationRuleEngine', () {
    const engine = NotificationRuleEngine();

    test('creates repeated order reminder plan when pending orders exist', () {
      final now = DateTime(2026, 6, 26, 10);
      final snapshot = NotificationSnapshot(
        scopeKey: 'user=12',
        orders: OrderReminderSnapshot(
          localDraftCount: 1,
          localPendingCount: 1,
          oldestAt: now.subtract(const Duration(hours: 2)),
          clientNames: const ['Cliente A'],
        ),
      );

      final plan = engine.buildOrderReminderPlan(
        snapshot,
        NotificationPreferences.defaults(),
        now: now,
      );

      expect(plan, isNotNull);
      expect(plan!.interval, const Duration(minutes: 30));
      expect(plan.title, contains('2 pedidos'));
      expect(plan.body, contains('Cliente A'));
    });

    test('does not create order plan while orders category is snoozed', () {
      final now = DateTime(2026, 6, 26, 10);
      final settings = NotificationPreferences.defaults().copyWith(
        snoozedUntil: {
          AppNotificationCategory.orders.key: now.add(const Duration(hours: 1)),
        },
      );
      const snapshot = NotificationSnapshot(
        scopeKey: 'user=12',
        orders: OrderReminderSnapshot(localDraftCount: 1),
      );

      final plan = engine.buildOrderReminderPlan(
        snapshot,
        settings,
        now: now,
      );

      expect(plan, isNull);
    });

    test('creates objective, pace and Glacius notifications', () {
      final now = DateTime(2026, 6, 26, 12);
      final snapshot = NotificationSnapshot(
        scopeKey: 'user=12',
        orders: const OrderReminderSnapshot(),
        objectives: const ObjectivesNotificationSnapshot(
          year: 2026,
          month: 6,
          sales: 120000,
          objective: 100000,
          paceObjective: 150000,
          daysPassed: 20,
          workingDays: 25,
        ),
        rutero: RuteroNotificationSnapshot(
          date: now,
          dayName: 'viernes',
          clientCount: 8,
          clientNames: const ['Cliente Ruta'],
        ),
        glacius: const GlaciusNotificationSnapshot(
          totalAlerts: 3,
          criticalAlerts: 1,
          clientNames: ['Cliente Glacius'],
        ),
      );

      final notifications = engine.buildImmediateNotifications(
        snapshot,
        now: now,
      );

      expect(
        notifications.map((item) => item.category),
        containsAll([
          AppNotificationCategory.objectives,
          AppNotificationCategory.dailyPace,
          AppNotificationCategory.glacius,
        ]),
      );
      expect(
        notifications.map((item) => item.dedupeKey),
        everyElement(contains('user=12')),
      );
    });

    test('schedules morning route notification at 6', () {
      final now = DateTime(2026, 6, 26, 5, 30);
      final snapshot = NotificationSnapshot(
        scopeKey: 'user=12',
        orders: const OrderReminderSnapshot(),
        rutero: RuteroNotificationSnapshot(
          date: now,
          dayName: 'viernes',
          clientCount: 6,
          clientNames: const ['Cliente Ruta'],
          priorityClientNames: const ['Cliente A', 'Cliente B'],
        ),
      );

      final notifications = engine.buildScheduledNotifications(
        snapshot,
        NotificationPreferences.defaults(),
        now: now,
      );

      expect(notifications, hasLength(1));
      expect(notifications.single.kind, 'rutero_0600');
      expect(notifications.single.scheduledAt, DateTime(2026, 6, 26, 6));
    });

    test('creates daily summary only at end of day with sales', () {
      final now = DateTime(2026, 6, 26, 18, 30);
      final snapshot = NotificationSnapshot(
        scopeKey: 'user=12',
        orders: const OrderReminderSnapshot(),
        salesDay: const SalesDayNotificationSnapshot(
          sales: 1350,
          orders: 4,
          topClientNames: ['Cliente Top'],
        ),
        rutero: RuteroNotificationSnapshot(
          date: now,
          dayName: 'viernes',
          clientCount: 8,
        ),
      );

      final notifications = engine.buildImmediateNotifications(
        snapshot,
        now: now,
      );

      expect(
        notifications.map((item) => item.category),
        contains(AppNotificationCategory.dailySummary),
      );
      expect(
        notifications
            .firstWhere(
              (item) => item.category == AppNotificationCategory.dailySummary,
            )
            .body,
        contains('4 pedido'),
      );
    });

    test('does not notify low-value invoice activity', () {
      final now = DateTime(2026, 6, 26, 17);
      const snapshot = NotificationSnapshot(
        scopeKey: 'user=12',
        orders: OrderReminderSnapshot(),
        invoices: InvoicesNotificationSnapshot(
          todayDocuments: 1,
          todayAmount: 100,
        ),
      );

      final notifications = engine.buildImmediateNotifications(
        snapshot,
        now: now,
      );

      expect(
        notifications.map((item) => item.category),
        isNot(contains(AppNotificationCategory.invoices)),
      );
    });
  });
}
