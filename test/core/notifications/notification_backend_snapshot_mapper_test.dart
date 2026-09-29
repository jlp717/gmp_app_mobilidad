import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_data_repository.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';

void main() {
  test('maps BE-10 snapshot payload onto notification models', () {
    const profile = NotificationUserProfile(
      userCode: '80',
      role: 'COMERCIAL',
      isJefeVentas: false,
      vendorCodes: ['80'],
    );
    const local = OrderReminderSnapshot(
      localDraftCount: 1,
      localPendingCount: 0,
      localFailedCount: 0,
    );
    final now = DateTime(2026, 9, 14);
    final snapshot = NotificationBackendSnapshotMapper.map(
      body: {
        'success': true,
        'orders': {'borrador': 2, 'pendiente': 3},
        'kpi': {
          'totals': {'alerts': 4, 'critical': 1, 'warning': 2},
          'byType': [
            {'type': 'SIN_COMPRA', 'count': 5},
          ],
          'clients': [
            {'name': 'Bar Pepe'},
          ],
        },
        'ruteroHoy': {
          'count': 6,
          'day': 'lunes',
          'clients': [
            {'name': 'Cliente A'},
          ],
        },
        'ruteroManana': {'count': 1, 'day': 'martes', 'clients': []},
        'facturas': {
          'hoy': {'totalDocumentos': 2, 'totalImporte': 10.5},
          'mes': {'totalDocumentos': 8, 'totalImporte': 40},
        },
        'bolsa': {'saldoDisponible': 120, 'consumido': 10, 'acumulado': 130},
        'metrics': {
          'todaySales': 80,
          'todaySalesGross': 99,
          'todaySalesFiltered': 80,
          'todaySalesGap': 19,
          'todayOrders': 3,
          'todayDocumentsGross': 4,
          'todayDocumentsFiltered': 3,
          'todayClients': 2,
          'uniqueClients': 3,
          'totalMargin': 30,
        },
        'topClients': [
          {'name': 'Top 1'},
        ],
        'stats': {'totalAmount': 1, 'totalOrders': 1},
      },
      profile: profile,
      localOrders: local,
      now: now,
    );

    expect(snapshot.orders.localDraftCount, 1);
    expect(snapshot.orders.serverDraftCount, 2);
    expect(snapshot.orders.serverPendingCount, 3);
    expect(snapshot.rutero?.clientCount, 6);
    expect(snapshot.nextRutero?.clientCount, 1);
    expect(snapshot.glacius?.totalAlerts, 4);
    expect(snapshot.clients?.noPurchaseCount, 5);
    expect(snapshot.invoices?.todayAmount, 10.5);
    expect(snapshot.bolsa?.available, 120);
    expect(snapshot.salesDay?.sales, 99);
    expect(snapshot.salesDay?.filteredSales, 80);
    expect(snapshot.salesDay?.salesGap, 19);
    expect(snapshot.salesDay?.orders, 4);
    expect(snapshot.salesDay?.filteredOrders, 3);
    expect(snapshot.salesDay?.clients, 2);
    expect(snapshot.salesDay?.margin, 0);
    expect(snapshot.salesDay?.topClientNames, ['Top 1']);
  });

  test('preserves valid zero daily values instead of monthly fallbacks', () {
    final snapshot = NotificationBackendSnapshotMapper.map(
      body: {
        'orders': <String, dynamic>{},
        'metrics': {'todaySales': 0, 'todayOrders': 0},
        'stats': {'totalAmount': 240, 'totalOrders': 6},
      },
      profile: const NotificationUserProfile(
        userCode: '80',
        role: 'COMERCIAL',
        isJefeVentas: false,
        vendorCodes: ['80'],
      ),
      localOrders: const OrderReminderSnapshot(),
      now: DateTime(2026, 9, 14),
    );

    expect(snapshot.salesDay?.sales, 0);
    expect(snapshot.salesDay?.orders, 0);
  });
}
