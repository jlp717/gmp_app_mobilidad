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
        'metrics': {'todaySales': 99, 'todayOrders': 4, 'uniqueClients': 3},
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
    expect(snapshot.salesDay?.topClientNames, ['Top 1']);
  });
}
