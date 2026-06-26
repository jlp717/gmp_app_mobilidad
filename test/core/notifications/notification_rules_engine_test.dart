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
      final snapshot = const NotificationSnapshot(
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

    test('creates objective, pace, rutero and Glacius notifications', () {
      final now = DateTime(2026, 6, 26, 9);
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
          AppNotificationCategory.rutero,
          AppNotificationCategory.glacius,
        ]),
      );
      expect(
        notifications.map((item) => item.dedupeKey),
        everyElement(contains('user=12')),
      );
    });
  });
}
