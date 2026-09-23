/// Catalog product sort modes for commercial pedidos search.
library;

import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

/// User-selectable order for the product catalog list.
enum CatalogProductSort {
  /// Historial de compras: más importe comprado primero (sales TY+PY).
  purchasesDesc,

  /// Historial de compras: menos importe comprado primero.
  purchasesAsc,

  /// Precio cliente/tarifa: mayor → menor.
  priceDesc,

  /// Precio cliente/tarifa: menor → mayor.
  priceAsc,

  /// Nombre A → Z.
  nameAsc,

  /// Nombre Z → A.
  nameDesc,

  /// Stock envases: más stock primero.
  stockDesc,

  /// Margen estimado (precio vs coste): mayor primero.
  marginDesc,
}

extension CatalogProductSortX on CatalogProductSort {
  String get storageKey {
    switch (this) {
      case CatalogProductSort.purchasesDesc:
        return 'purchases_desc';
      case CatalogProductSort.purchasesAsc:
        return 'purchases_asc';
      case CatalogProductSort.priceDesc:
        return 'price_desc';
      case CatalogProductSort.priceAsc:
        return 'price_asc';
      case CatalogProductSort.nameAsc:
        return 'name_asc';
      case CatalogProductSort.nameDesc:
        return 'name_desc';
      case CatalogProductSort.stockDesc:
        return 'stock_desc';
      case CatalogProductSort.marginDesc:
        return 'margin_desc';
    }
  }

  /// Short label for the sort dropdown.
  String get label {
    switch (this) {
      case CatalogProductSort.purchasesDesc:
        return 'Más compra';
      case CatalogProductSort.purchasesAsc:
        return 'Menos compra';
      case CatalogProductSort.priceDesc:
        return 'Mayor importe';
      case CatalogProductSort.priceAsc:
        return 'Menor importe';
      case CatalogProductSort.nameAsc:
        return 'Nombre A-Z';
      case CatalogProductSort.nameDesc:
        return 'Nombre Z-A';
      case CatalogProductSort.stockDesc:
        return 'Más stock';
      case CatalogProductSort.marginDesc:
        return 'Mayor margen';
    }
  }

  /// Whether pagination should ask the API to apply this order.
  bool get usesServerOrder {
    switch (this) {
      case CatalogProductSort.purchasesDesc:
      case CatalogProductSort.purchasesAsc:
      case CatalogProductSort.nameAsc:
      case CatalogProductSort.nameDesc:
        return true;
      case CatalogProductSort.priceDesc:
      case CatalogProductSort.priceAsc:
      case CatalogProductSort.stockDesc:
      case CatalogProductSort.marginDesc:
        return false;
    }
  }

  /// API `sortBy` value when [usesServerOrder] is true.
  String get apiSortBy {
    switch (this) {
      case CatalogProductSort.purchasesDesc:
      case CatalogProductSort.purchasesAsc:
        return 'purchases';
      case CatalogProductSort.nameAsc:
      case CatalogProductSort.nameDesc:
        return 'name';
      default:
        return 'purchases';
    }
  }

  /// API `sortOrder` value when [usesServerOrder] is true.
  String get apiSortOrder {
    switch (this) {
      case CatalogProductSort.purchasesDesc:
      case CatalogProductSort.nameDesc:
        return 'DESC';
      case CatalogProductSort.purchasesAsc:
      case CatalogProductSort.nameAsc:
        return 'ASC';
      default:
        return 'DESC';
    }
  }

  /// Purchase modes keep the "comprados | nuevos" partition in the UI.
  bool get partitionsPurchased {
    return this == CatalogProductSort.purchasesDesc ||
        this == CatalogProductSort.purchasesAsc;
  }

  static CatalogProductSort fromStorage(String? raw) {
    switch ((raw ?? '').trim().toLowerCase()) {
      case 'purchases_asc':
        return CatalogProductSort.purchasesAsc;
      case 'price_desc':
        return CatalogProductSort.priceDesc;
      case 'price_asc':
        return CatalogProductSort.priceAsc;
      case 'name_asc':
        return CatalogProductSort.nameAsc;
      case 'name_desc':
        return CatalogProductSort.nameDesc;
      case 'stock_desc':
        return CatalogProductSort.stockDesc;
      case 'margin_desc':
        return CatalogProductSort.marginDesc;
      case 'purchases_desc':
      default:
        return CatalogProductSort.purchasesDesc;
    }
  }

  /// Modes shown in the dropdown. [includeMargin] hides margen for roles
  /// that no ven coste (COMERCIAL raso).
  static List<CatalogProductSort> visibleOptions({
    required bool includeMargin,
  }) {
    final options = List<CatalogProductSort>.from(CatalogProductSort.values);
    if (!includeMargin) {
      options.remove(CatalogProductSort.marginDesc);
    }
    return options;
  }
}

/// Estimated margin % used for [CatalogProductSort.marginDesc].
double catalogEstimatedMarginPct(Product product) {
  final price = product.bestPrice;
  if (price <= 0) return 0;
  final cost = product.precioCosto > 0
      ? product.precioCosto
      : (product.precioMinimo > 0
          ? product.precioMinimo * 0.7
          : product.precioTarifa1 * 0.7);
  return ((price - cost) / price) * 100;
}

double catalogPurchaseAmount(Product product) =>
    product.salesThisYear + product.salesPrevYear;

int _compareNameThenCode(Product a, Product b) {
  final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
  if (byName != 0) return byName;
  return a.code.compareTo(b.code);
}

int _favoriteBoost(
  Product a,
  Product b,
  bool Function(String code) isFavorite,
) {
  final aFav = isFavorite(a.code) ? 1 : 0;
  final bFav = isFavorite(b.code) ? 1 : 0;
  return bFav.compareTo(aFav);
}

/// Sorts [products] according to [sort]. Favorites win ties when provided.
List<Product> sortCatalogProducts(
  Iterable<Product> products,
  CatalogProductSort sort, {
  bool Function(String code)? isFavorite,
}) {
  final fav = isFavorite ?? (_) => false;
  final list = List<Product>.from(products);

  int compare(Product a, Product b) {
    final favCmp = _favoriteBoost(a, b, fav);
    switch (sort) {
      case CatalogProductSort.purchasesDesc:
        final salesCmp =
            catalogPurchaseAmount(b).compareTo(catalogPurchaseAmount(a));
        if (salesCmp != 0) return salesCmp;
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
      case CatalogProductSort.purchasesAsc:
        final salesCmp =
            catalogPurchaseAmount(a).compareTo(catalogPurchaseAmount(b));
        if (salesCmp != 0) return salesCmp;
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
      case CatalogProductSort.priceDesc:
        final priceCmp = b.bestPrice.compareTo(a.bestPrice);
        if (priceCmp != 0) return priceCmp;
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
      case CatalogProductSort.priceAsc:
        final priceCmp = a.bestPrice.compareTo(b.bestPrice);
        if (priceCmp != 0) return priceCmp;
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
      case CatalogProductSort.nameAsc:
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
      case CatalogProductSort.nameDesc:
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(b, a);
      case CatalogProductSort.stockDesc:
        final stockCmp = b.stockEnvases.compareTo(a.stockEnvases);
        if (stockCmp != 0) return stockCmp;
        final unitsCmp = b.stockUnidades.compareTo(a.stockUnidades);
        if (unitsCmp != 0) return unitsCmp;
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
      case CatalogProductSort.marginDesc:
        final marginCmp = catalogEstimatedMarginPct(b)
            .compareTo(catalogEstimatedMarginPct(a));
        if (marginCmp != 0) return marginCmp;
        if (favCmp != 0) return favCmp;
        return _compareNameThenCode(a, b);
    }
  }

  list.sort(compare);
  return list;
}

/// Builds the display list for the catalog (optional purchased/nuevos split).
List<Object> buildCatalogDisplayList(
  Iterable<Product> products,
  CatalogProductSort sort, {
  bool Function(String code)? isFavorite,
}) {
  if (!sort.partitionsPurchased) {
    return List<Object>.from(
      sortCatalogProducts(products, sort, isFavorite: isFavorite),
    );
  }

  final purchased = <Product>[];
  final nuevos = <Product>[];
  for (final p in products) {
    if (p.hasPurchased) {
      purchased.add(p);
    } else {
      nuevos.add(p);
    }
  }

  final sortedPurchased =
      sortCatalogProducts(purchased, sort, isFavorite: isFavorite);
  final sortedNuevos = sortCatalogProducts(
    nuevos,
    CatalogProductSort.nameAsc,
    isFavorite: isFavorite,
  );

  final display = <Object>[];
  display.addAll(sortedPurchased);
  if (sortedPurchased.isNotEmpty && sortedNuevos.isNotEmpty) {
    display.add('__SEPARATOR__');
  }
  display.addAll(sortedNuevos);
  return display;
}
