import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:test/test.dart';

Map<String, dynamic> _totals(double sales, double cost, double units) => {
      'sales': sales,
      'cost': cost,
      'units': units,
      'margin': sales == 0 ? 0 : (sales - cost) / sales * 100,
    };

Map<String, dynamic> _client(String code, double sales, {String? name}) => {
      'code': code,
      'name': name ?? 'Cliente $code',
      'totalSales': sales,
      'totalCost': sales / 2,
      'totalUnits': sales / 10,
      'productCount': 1,
      'margin': 50,
      'families': [
        {
          'code': 'F1',
          'name': 'Familia',
          'totalSales': sales,
          'totalCost': sales / 2,
          'totalUnits': sales / 10,
          'children': [
            {
              'code': 'F2',
              'name': 'Subfamilia',
              'totalSales': sales,
              'totalCost': sales / 2,
              'totalUnits': sales / 10,
              'children': [
                {
                  'code': '',
                  'name': 'General',
                  'totalSales': sales,
                  'totalCost': sales / 2,
                  'totalUnits': sales / 10,
                  'children': [
                    {
                      'code': '',
                      'name': 'General',
                      'totalSales': sales,
                      'totalCost': sales / 2,
                      'totalUnits': sales / 10,
                      'products': [
                        {
                          'code': 'P1',
                          'name': 'Producto',
                          'unitType': 'UDS',
                          'totalSales': sales,
                          'totalCost': sales / 2,
                          'totalUnits': sales / 10,
                          'monthlyData': {'1': sales / 2, '2': sales / 2},
                        }
                      ],
                    }
                  ],
                }
              ],
            }
          ],
        }
      ],
    };

Map<String, dynamic> _page({
  required List<Map<String, dynamic>> clients,
  required int offset,
  required bool hasMore,
  required int total,
  int? nextOffset,
}) {
  final sales = clients.fold<double>(
    0,
    (sum, client) => sum + (client['totalSales'] as num).toDouble(),
  );
  final totals = _totals(sales, sales / 2, sales / 10);
  final complete = offset == 0 && !hasMore;
  return {
    'success': true,
    'year': 2026,
    'pageTotal': totals,
    'grandTotal': complete ? totals : null,
    'scopeTotalAvailability': complete ? 'COMPLETE' : 'PAGED',
    'clients': clients,
    'pagination': {
      'limit': 2,
      'offset': offset,
      'total': total,
      'hasMore': hasMore,
      'nextOffset': nextOffset,
    },
  };
}

void main() {
  test('parses real hierarchy and monthly product data', () {
    final detail = RepartidorObjectivesDetail.fromJson(
      _page(clients: [_client('A', 100)], offset: 0, hasMore: false, total: 1),
    );

    final product = detail.clients.single.families.single.children.single
        .children.single.children.single.products.single;
    expect(product.monthlyData, {1: 50, 2: 50});
    expect(detail.pageTotal.sales, 100);
    expect(detail.grandTotal?.sales, 100);
    expect(detail.hasCompleteScopeTotal, isTrue);
  });

  test('partial first page stays explicitly paged with null grand total', () {
    final detail = RepartidorObjectivesDetail.fromJson(
      _page(
        clients: [_client('A', 100), _client('B', 200)],
        offset: 0,
        hasMore: true,
        total: 3,
        nextOffset: 2,
      ),
    );

    expect(detail.clients, hasLength(2));
    expect(detail.grandTotal, isNull);
    expect(detail.scopeTotalAvailability,
        RepartidorObjectivesScopeTotalAvailability.paged);
    expect(detail.nextOffset, 2);
  });

  test('merge is ordered, deduplicated and complete only after final page', () {
    final first = RepartidorObjectivesDetail.fromJson(
      _page(
        clients: [_client('A', 100), _client('B', 200, name: 'B original')],
        offset: 0,
        hasMore: true,
        total: 3,
        nextOffset: 2,
      ),
    );
    final second = RepartidorObjectivesDetail.fromJson({
      ..._page(
        clients: [_client('B', 999, name: 'B repetido'), _client('C', 300)],
        offset: 2,
        hasMore: false,
        total: 3,
      ),
      'scopeTotalAvailability': 'PAGED',
      'grandTotal': null,
    });

    final merged = first.mergePage(second);

    expect(merged.clients.map((client) => client.code), ['A', 'B', 'C']);
    expect(merged.clients[1].name, 'B original');
    expect(merged.grandTotal?.sales, 600);
    expect(merged.hasCompleteScopeTotal, isTrue);
    expect(merged.hasMore, isFalse);
  });
}
