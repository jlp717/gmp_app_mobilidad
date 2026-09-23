import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/catalog_product_sort.dart';

Product _p({
  required String code,
  required String name,
  bool hasPurchased = false,
  double salesThisYear = 0,
  double salesPrevYear = 0,
  double precioCliente = 0,
  double precioTarifa1 = 0,
  double precioCosto = 0,
  double stockEnvases = 0,
  double stockUnidades = 0,
}) {
  return Product(
    code: code,
    name: name,
    hasPurchased: hasPurchased,
    salesThisYear: salesThisYear,
    salesPrevYear: salesPrevYear,
    precioCliente: precioCliente,
    precioTarifa1: precioTarifa1,
    precioCosto: precioCosto,
    stockEnvases: stockEnvases,
    stockUnidades: stockUnidades,
  );
}

void main() {
  group('CatalogProductSort', () {
    test('fromStorage defaults to purchasesDesc', () {
      expect(
        CatalogProductSortX.fromStorage(null),
        CatalogProductSort.purchasesDesc,
      );
      expect(
        CatalogProductSortX.fromStorage('unknown'),
        CatalogProductSort.purchasesDesc,
      );
    });

    test('round-trips storage keys', () {
      for (final mode in CatalogProductSort.values) {
        expect(
          CatalogProductSortX.fromStorage(mode.storageKey),
          mode,
        );
      }
    });

    test('visibleOptions hides margin when not allowed', () {
      final withMargin =
          CatalogProductSortX.visibleOptions(includeMargin: true);
      final without = CatalogProductSortX.visibleOptions(includeMargin: false);
      expect(withMargin, contains(CatalogProductSort.marginDesc));
      expect(without, isNot(contains(CatalogProductSort.marginDesc)));
    });
  });

  group('sortCatalogProducts', () {
    final products = [
      _p(
        code: 'B',
        name: 'Beta',
        hasPurchased: true,
        salesThisYear: 10,
        precioCliente: 5,
        precioCosto: 4,
        stockEnvases: 2,
      ),
      _p(
        code: 'A',
        name: 'Alpha',
        hasPurchased: true,
        salesThisYear: 50,
        precioCliente: 20,
        precioCosto: 10,
        stockEnvases: 8,
      ),
      _p(
        code: 'C',
        name: 'Charlie',
        hasPurchased: false,
        precioCliente: 8,
        precioCosto: 2,
        stockEnvases: 20,
      ),
    ];

    test('purchasesDesc orders by purchase amount', () {
      final sorted = sortCatalogProducts(
        products,
        CatalogProductSort.purchasesDesc,
      );
      expect(sorted.map((p) => p.code).toList(), ['A', 'B', 'C']);
    });

    test('purchasesAsc orders least purchase first', () {
      final sorted = sortCatalogProducts(
        products.where((p) => p.hasPurchased),
        CatalogProductSort.purchasesAsc,
      );
      expect(sorted.map((p) => p.code).toList(), ['B', 'A']);
    });

    test('priceDesc orders by bestPrice', () {
      final sorted =
          sortCatalogProducts(products, CatalogProductSort.priceDesc);
      expect(sorted.map((p) => p.code).toList(), ['A', 'C', 'B']);
    });

    test('nameAsc is alphabetical', () {
      final sorted = sortCatalogProducts(products, CatalogProductSort.nameAsc);
      expect(sorted.map((p) => p.code).toList(), ['A', 'B', 'C']);
    });

    test('nameDesc is reverse alphabetical', () {
      final sorted = sortCatalogProducts(products, CatalogProductSort.nameDesc);
      expect(sorted.map((p) => p.code).toList(), ['C', 'B', 'A']);
    });

    test('stockDesc orders by stockEnvases', () {
      final sorted =
          sortCatalogProducts(products, CatalogProductSort.stockDesc);
      expect(sorted.map((p) => p.code).toList(), ['C', 'A', 'B']);
    });

    test('marginDesc orders by estimated margin', () {
      final sorted =
          sortCatalogProducts(products, CatalogProductSort.marginDesc);
      // C: (8-2)/8=75%, A: (20-10)/20=50%, B: (5-4)/5=20%
      expect(sorted.map((p) => p.code).toList(), ['C', 'A', 'B']);
    });

    test('favorites win ties on nameAsc', () {
      final sorted = sortCatalogProducts(
        products,
        CatalogProductSort.nameAsc,
        isFavorite: (code) => code == 'C',
      );
      expect(sorted.first.code, 'C');
    });
  });

  group('buildCatalogDisplayList', () {
    final products = [
      _p(code: 'A', name: 'Alpha', hasPurchased: true, salesThisYear: 10),
      _p(code: 'N', name: 'Nuevo', hasPurchased: false),
      _p(code: 'B', name: 'Beta', hasPurchased: true, salesThisYear: 30),
    ];

    test('purchase modes keep separator between purchased and new', () {
      final display = buildCatalogDisplayList(
        products,
        CatalogProductSort.purchasesDesc,
      );
      expect(display.whereType<String>().toList(), ['__SEPARATOR__']);
      final codes = display
          .whereType<Product>()
          .map((p) => p.code)
          .toList(growable: false);
      expect(codes, ['B', 'A', 'N']);
    });

    test('flat modes do not insert separator', () {
      final display = buildCatalogDisplayList(
        products,
        CatalogProductSort.nameAsc,
      );
      expect(display.whereType<String>(), isEmpty);
      expect(
        display.whereType<Product>().map((p) => p.code).toList(),
        ['A', 'B', 'N'],
      );
    });
  });
}
