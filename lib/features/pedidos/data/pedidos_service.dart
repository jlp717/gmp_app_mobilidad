/// Pedidos Data Service
/// ====================
/// API client for order operations (COMERCIAL + JEFE_VENTAS roles)
/// Includes product catalog, stock, pricing, and order CRUD

import 'package:flutter/foundation.dart';
import '../../../core/api/api_client.dart';
import '../../../core/cache/cache_service.dart';

// ─── MODELS ──────────────────────────────────────────────────

/// Product in catalog list
class Product {
  final String code;
  final String name;
  final String brand;
  final String family;
  final String ean;
  final double unitsPerBox;
  final double unitsFraction;
  final double unitsRetractil;
  final String unitMeasure;
  final double weight;
  final double stockEnvases;
  final double stockUnidades;
  final double precioTarifa1;
  final double precioMinimo;
  final double precioCliente;
  // Extended fields from ART table
  final String nameExt;
  final String familyName;
  final String prefamilia;
  final String subFamily;
  final String grupoGeneral;
  final String tipoProducto;
  final String claseArticulo;
  final String categoria;
  final String gama;
  final String codigoIva;
  final double pesoNeto;
  final double volumen;
  final String grados;
  final String calibre;
  final String observacion1;
  final String observacion2;
  final String presentacion;
  final String formato;
  final bool productoPesado;
  final bool trazable;
  final double unidadPale;
  final double unidadFilaPale;
  final String? fechaAlta;
  final int anoBaja;
  final int mesBaja;

  Product({
    required this.code,
    required this.name,
    this.brand = '',
    this.family = '',
    this.ean = '',
    this.unitsPerBox = 1,
    this.unitsFraction = 0,
    this.unitsRetractil = 0,
    this.unitMeasure = '',
    this.weight = 0,
    this.stockEnvases = 0,
    this.stockUnidades = 0,
    this.precioTarifa1 = 0,
    this.precioMinimo = 0,
    this.precioCliente = 0,
    this.nameExt = '',
    this.familyName = '',
    this.prefamilia = '',
    this.subFamily = '',
    this.grupoGeneral = '',
    this.tipoProducto = '',
    this.claseArticulo = '',
    this.categoria = '',
    this.gama = '',
    this.codigoIva = '0',
    this.pesoNeto = 0,
    this.volumen = 0,
    this.grados = '',
    this.calibre = '',
    this.observacion1 = '',
    this.observacion2 = '',
    this.presentacion = '',
    this.formato = '',
    this.productoPesado = false,
    this.trazable = false,
    this.unidadPale = 0,
    this.unidadFilaPale = 0,
    this.fechaAlta,
    this.anoBaja = 0,
    this.mesBaja = 0,
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      code: (json['code'] ?? '').toString().trim(),
      name: (json['name'] ?? '').toString().trim(),
      brand: (json['brand'] ?? '').toString().trim(),
      family: (json['family'] ?? '').toString().trim(),
      ean: (json['ean'] ?? '').toString().trim(),
      unitsPerBox: _toDouble(json['unitsPerBox']),
      unitsFraction: _toDouble(json['unitsFraction']),
      unitsRetractil: _toDouble(json['unitsRetractil']),
      unitMeasure: (json['unitMeasure'] ?? '').toString().trim(),
      weight: _toDouble(json['weight']),
      stockEnvases: _toDouble(json['stockEnvases']),
      stockUnidades: _toDouble(json['stockUnidades']),
      precioTarifa1: _toDouble(json['precioTarifa1']),
      precioMinimo: _toDouble(json['precioMinimo']),
      precioCliente: _toDouble(json['precioCliente']),
      nameExt: (json['nameExt'] ?? '').toString().trim(),
      familyName: (json['familyName'] ?? '').toString().trim(),
      prefamilia: (json['prefamilia'] ?? '').toString().trim(),
      subFamily: (json['subFamily'] ?? '').toString().trim(),
      grupoGeneral: (json['grupoGeneral'] ?? '').toString().trim(),
      tipoProducto: (json['tipoProducto'] ?? '').toString().trim(),
      claseArticulo: (json['claseArticulo'] ?? '').toString().trim(),
      categoria: (json['categoria'] ?? '').toString().trim(),
      gama: (json['gama'] ?? '').toString().trim(),
      codigoIva: (json['codigoIva'] ?? '0').toString().trim(),
      pesoNeto: _toDouble(json['pesoNeto']),
      volumen: _toDouble(json['volumen']),
      grados: (json['grados'] ?? '').toString().trim(),
      calibre: (json['calibre'] ?? '').toString().trim(),
      observacion1: (json['observacion1'] ?? '').toString().trim(),
      observacion2: (json['observacion2'] ?? '').toString().trim(),
      presentacion: (json['presentacion'] ?? '').toString().trim(),
      formato: (json['formato'] ?? '').toString().trim(),
      productoPesado: json['productoPesado'] == true,
      trazable: json['trazable'] == true,
      unidadPale: _toDouble(json['unidadPale']),
      unidadFilaPale: _toDouble(json['unidadFilaPale']),
      fechaAlta: json['fechaAlta']?.toString(),
      anoBaja: json['anoBaja'] is int
          ? json['anoBaja'] as int
          : int.tryParse(json['anoBaja']?.toString() ?? '0') ?? 0,
      mesBaja: json['mesBaja'] is int
          ? json['mesBaja'] as int
          : int.tryParse(json['mesBaja']?.toString() ?? '0') ?? 0,
    );
  }

  /// Best available price (client > tariff)
  double get bestPrice => precioCliente > 0 ? precioCliente : precioTarifa1;

  /// Whether stock is available
  bool get hasStock => stockEnvases > 0 || stockUnidades > 0;

  /// Whether the product is discontinued
  bool get isDiscontinued => anoBaja > 0;

  /// Total pieces in stock (envases * unitsPerBox + loose unidades)
  double get totalPieces => stockEnvases * unitsPerBox + stockUnidades;

  /// Normalized primary sale unit from DB UNIDADMEDIDA + FORMATO fields.
  /// Most products have UM="" in DB; FORMATO='K' and productoPesado='S'
  /// distinguish weight-sold (kg) products.
  String get _normalizedUnit {
    final um = unitMeasure.toUpperCase().trim();
    // Explicit UM in DB
    if (um == 'KILO' || um == 'KILOGRAMOS' || um == 'KG' || um == 'KILOS') {
      return 'KILOGRAMOS';
    }
    if (um == 'LITRO' || um == 'LITROS' || um == 'LT') return 'LITROS';
    if (um == 'UNIDAD' || um == 'UNIDADES' || um == 'UDS') return 'UNIDADES';
    if (um == 'PIEZA' || um == 'PIEZAS') return 'PIEZAS';
    if (um == 'BOLSA' || um == 'BOLSAS') return 'BOLSAS';
    if (um == 'ESTUCHE' || um == 'ESTUCHES') return 'ESTUCHES';
    if (um == 'BANDEJA' || um == 'BANDEJAS') return 'BANDEJAS';
    if (um == 'BOTELLA' || um == 'BOTELLAS') return 'BOTELLAS';
    if (um == 'PAQUETE' || um == 'PAQUETES') return 'PAQUETES';
    if (um == 'BOTE' || um == 'BOTES') return 'BOTES';
    if (um == 'LATA' || um == 'LATAS') return 'LATAS';
    if (um == 'GARRAFA' || um == 'GARRAFAS') return 'GARRAFAS';
    if (um == 'SACO' || um == 'SACOS') return 'SACOS';
    if (um == 'ROLLO' || um == 'ROLLOS') return 'ROLLOS';
    if (um == 'CAJA' || um == 'CAJAS') return 'CAJAS';
    // UM empty → detect via FORMATO='K' or productoPesado
    if (um.isEmpty) {
      if (formato.toUpperCase().trim() == 'K' || productoPesado) {
        return 'KILOGRAMOS';
      }
      return 'CAJAS';
    }
    return um; // fallback: use as-is
  }

  /// True if this is a weight-sold product (KILOGRAMOS/LITROS)
  /// These show the CANTIDAD button with unit selector in the legacy app.
  bool get isWeightProduct {
    final norm = _normalizedUnit;
    return norm == 'KILOGRAMOS' || norm == 'LITROS';
  }

  /// True if this product should show dual-field entry (cajas + unidades linked).
  /// Standard products with U/C > 1 that are NOT weight products.
  bool get isDualFieldProduct {
    if (isWeightProduct) return false;
    return unitsPerBox > 1;
  }

  /// Kg per box for weight products. For KILO products UC = kg per box.
  double get kgPerBox {
    if (_normalizedUnit == 'KILOGRAMOS') {
      // UC is the kg-per-box for KILO products
      return unitsPerBox > 0 ? unitsPerBox : 1;
    }
    if (_normalizedUnit == 'LITROS') {
      return unitsPerBox > 0 ? unitsPerBox : 1;
    }
    return unitsPerBox > 0 ? unitsPerBox : 1;
  }

  /// Convert boxes to the primary unit quantity
  double unidadesFromEnvases(double envases) => envases * unitsPerBox;

  /// Convert primary unit quantity to boxes (can be fractional)
  double envasesFromUnidades(double unidades) =>
      unitsPerBox > 0 ? unidades / unitsPerBox : unidades;

  /// Content description: what each caja contains (e.g., "10 uds", "6 kg")
  String get boxContentDesc {
    final norm = _normalizedUnit;
    if (norm == 'KILOGRAMOS') {
      final kpb = kgPerBox;
      if (kpb > 0) {
        return '${_fmtNum(kpb)} kg';
      }
      return '';
    }
    if (norm == 'LITROS') {
      if (unitsPerBox > 0) return '${_fmtNum(unitsPerBox)} L';
      return '';
    }
    if (norm == 'CAJAS') {
      if (unitsPerBox > 1) return '${_fmtNum(unitsPerBox)} uds';
      return '';
    }
    // For ESTUCHES, BANDEJAS, etc.
    if (unitsPerBox > 1) {
      return '${_fmtNum(unitsPerBox)} ${unitLabel(norm).toLowerCase()}';
    }
    return '';
  }

  /// Price for given unit type.
  /// bestPrice is always per CAJA (box).
  double priceForUnit(String unit) {
    final base = bestPrice;
    if (unit == 'CAJAS') return base;
    final norm = _normalizedUnit;

    // Weight products: UC = kg per box
    if (norm == 'KILOGRAMOS' && (unit == 'KILOGRAMOS' || unit == norm)) {
      return kgPerBox > 0 ? base / kgPerBox : base;
    }
    if (norm == 'LITROS' && (unit == 'LITROS' || unit == norm)) {
      return unitsPerBox > 0 ? base / unitsPerBox : base;
    }
    // Standard products: UC = units per box
    if (unit == 'UNIDADES' || unit == norm) {
      return unitsPerBox > 0 ? base / unitsPerBox : base;
    }
    return base;
  }

  /// Stock available expressed in the given unit type
  double stockForUnit(String unit) {
    if (unit == 'CAJAS') return stockEnvases;
    final norm = _normalizedUnit;
    if (norm == 'KILOGRAMOS' && (unit == 'KILOGRAMOS' || unit == norm)) {
      return stockEnvases * kgPerBox + stockUnidades;
    }
    // For all other units: total = envases * unitsPerBox + loose unidades
    return stockEnvases * unitsPerBox + stockUnidades;
  }

  /// Quantity of the selected unit contained in one box
  double quantityPerBoxForUnit(String unit) {
    if (unit == 'CAJAS') return 1;
    final norm = _normalizedUnit;
    if (norm == 'KILOGRAMOS' && (unit == 'KILOGRAMOS' || unit == norm)) {
      return kgPerBox;
    }
    // For LITROS, UNIDADES, etc.: unitsPerBox
    return unitsPerBox > 0 ? unitsPerBox : 1;
  }

  /// Unit price description for display.
  /// E.g., "3,456 €/kg", "0,540 €/ud", "11,621 €/cj"
  String unitPriceDesc({int decimals = 3}) {
    final norm = _normalizedUnit;
    if (norm == 'KILOGRAMOS') {
      return '${priceForUnit('KILOGRAMOS').toStringAsFixed(decimals)} €/kg';
    }
    if (norm == 'LITROS') {
      return '${priceForUnit('LITROS').toStringAsFixed(decimals)} €/L';
    }
    if (unitsPerBox > 1) {
      return '${priceForUnit('UNIDADES').toStringAsFixed(decimals)} €/ud';
    }
    return '${bestPrice.toStringAsFixed(decimals)} €/cj';
  }

  /// Unit label abbreviation for display
  static String unitLabel(String unit) {
    switch (unit) {
      case 'UNIDADES':
        return 'uds';
      case 'PIEZAS':
        return 'uds';
      case 'KILOGRAMOS':
        return 'kg';
      case 'LITROS':
        return 'L';
      case 'BOLSAS':
        return 'bolsas';
      case 'ESTUCHES':
        return 'est.';
      case 'BANDEJAS':
        return 'band.';
      case 'BOTELLAS':
        return 'bot.';
      case 'PAQUETES':
        return 'paq.';
      case 'BOTES':
        return 'botes';
      case 'LATAS':
        return 'latas';
      case 'GARRAFAS':
        return 'garr.';
      case 'SACOS':
        return 'sacos';
      case 'ROLLOS':
        return 'rollos';
      case 'CAJAS':
      default:
        return 'cajas';
    }
  }

  /// Available unit types for this product.
  /// Weight products: CAJAS + KILOGRAMOS (with CANTIDAD selector)
  /// Standard with U/C>1: CAJAS + UNIDADES (dual-field)
  /// Simple boxes: CAJAS only
  List<String> get availableUnits {
    final norm = _normalizedUnit;
    if (norm == 'KILOGRAMOS') {
      return ['CAJAS', 'KILOGRAMOS'];
    }
    if (norm == 'LITROS') {
      return ['CAJAS', 'LITROS'];
    }
    if (norm == 'CAJAS') {
      final units = <String>['CAJAS'];
      if (unitsPerBox > 1) units.add('UNIDADES');
      return units;
    }
    // Other specialized units (ESTUCHES, BANDEJAS, etc.)
    return ['CAJAS', norm];
  }

  /// Format a numeric value for display (remove trailing zeros)
  static String _fmtNum(double v) {
    if (v == v.truncateToDouble()) return v.toStringAsFixed(0);
    final s = v.toStringAsFixed(2);
    // Remove trailing zeros: 2.50 → 2.5, 2.00 → 2
    if (s.endsWith('0')) return s.substring(0, s.length - 1);
    return s;
  }
}

/// Tariff entry for product detail
class TariffEntry {
  final int code;
  final String description;
  final double price;

  TariffEntry(
      {required this.code, required this.description, required this.price});

  factory TariffEntry.fromJson(Map<String, dynamic> json) {
    return TariffEntry(
      code: json['code'] is int
          ? json['code'] as int
          : int.tryParse(json['code']?.toString() ?? '0') ?? 0,
      description: (json['description'] ?? '').toString().trim(),
      price: _toDouble(json['price']),
    );
  }
}

/// Stock entry per warehouse
class StockEntry {
  final int almacenCode;
  final String almacenName;
  final double envases;
  final double unidades;

  StockEntry(
      {required this.almacenCode,
      required this.almacenName,
      required this.envases,
      required this.unidades});

  factory StockEntry.fromJson(Map<String, dynamic> json) {
    final code = json['almacenCode'] ?? json['almacen'];
    final name = json['almacenName'] ?? json['almacenDesc'] ?? '';
    return StockEntry(
      almacenCode:
          code is int ? code : int.tryParse(code?.toString() ?? '0') ?? 0,
      almacenName: name.toString().trim(),
      envases: _toDouble(json['envases']),
      unidades: _toDouble(json['unidades']),
    );
  }
}

/// Promotion item from backend
class PromotionItem {
  final String code;
  final String name;
  final String promoDesc;
  final String promoType;
  final double promoPrice;
  final double regularPrice;
  final String dateFrom;
  final String dateTo;
  final double stockEnvases;
  final double stockUnidades;

  PromotionItem({
    required this.code,
    required this.name,
    required this.promoDesc,
    this.promoType = '',
    this.promoPrice = 0,
    this.regularPrice = 0,
    this.dateFrom = '',
    this.dateTo = '',
    this.stockEnvases = 0,
    this.stockUnidades = 0,
  });

  bool get hasSaving => regularPrice > 0 && promoPrice < regularPrice;
  double get savingPct =>
      regularPrice > 0 ? ((regularPrice - promoPrice) / regularPrice * 100) : 0;
  bool get hasStock => stockEnvases > 0 || stockUnidades > 0;

  factory PromotionItem.fromJson(Map<String, dynamic> json) {
    String dateFrom = (json['dateFrom'] ?? '').toString().trim();
    String dateTo = (json['dateTo'] ?? '').toString().trim();

    if (dateFrom.isEmpty && json['dayFrom'] != null) {
      final d = (json['dayFrom'] ?? '').toString().trim().padLeft(2, '0');
      final m = (json['monthFrom'] ?? '').toString().trim().padLeft(2, '0');
      final y = (json['yearFrom'] ?? '').toString().trim();
      if (y.isNotEmpty) {
        dateFrom = '$d/$m/$y';
      }
    }
    if (dateTo.isEmpty && json['dayTo'] != null) {
      final d = (json['dayTo'] ?? '').toString().trim().padLeft(2, '0');
      final m = (json['monthTo'] ?? '').toString().trim().padLeft(2, '0');
      final y = (json['yearTo'] ?? '').toString().trim();
      if (y.isNotEmpty) {
        dateTo = '$d/$m/$y';
      }
    }

    return PromotionItem(
      code: (json['code'] ?? '').toString().trim(),
      name: (json['name'] ?? '').toString().trim(),
      promoDesc:
          (json['promoDesc'] ?? json['description'] ?? '').toString().trim(),
      promoType: (json['promoType'] ?? '').toString().trim(),
      promoPrice: _toDouble(json['promoPrice'] ?? json['price']),
      regularPrice: _toDouble(json['regularPrice']),
      dateFrom: dateFrom,
      dateTo: dateTo,
      stockEnvases: _toDouble(json['stockEnvases']),
      stockUnidades: _toDouble(json['stockUnidades']),
    );
  }
}

/// Full product detail
class ProductDetail {
  final Product product;
  final List<TariffEntry> tariffs;
  final List<StockEntry> stockByWarehouse;
  final double clientPrice;

  ProductDetail({
    required this.product,
    required this.tariffs,
    required this.stockByWarehouse,
    this.clientPrice = 0,
  });

  factory ProductDetail.fromJson(Map<String, dynamic> json) {
    // Backend nests tariffs/stock inside 'product', so look in both places
    final inner = json['product'] as Map<String, dynamic>? ?? json;
    final tariffsList =
        json['tariffs'] as List? ?? inner['tariffs'] as List? ?? [];
    final stockList = json['stockByWarehouse'] as List? ??
        json['stock'] as List? ??
        inner['stockByWarehouse'] as List? ??
        inner['stock'] as List? ??
        [];
    final cPrice = json['clientPrice'] ??
        json['precioCliente'] ??
        inner['clientPrice'] ??
        inner['precioCliente'];
    return ProductDetail(
      product: Product.fromJson(inner),
      tariffs: tariffsList
          .map((t) => TariffEntry.fromJson(t as Map<String, dynamic>))
          .toList(),
      stockByWarehouse: stockList
          .map((s) => StockEntry.fromJson(s as Map<String, dynamic>))
          .toList(),
      clientPrice: _toDouble(cPrice),
    );
  }
}

/// Order line (for cart and saved orders)
class OrderLine {
  int? id;
  final String codigoArticulo;
  final String descripcion;
  double cantidadEnvases;
  double cantidadUnidades;
  String unidadMedida;
  double unidadesCaja;
  double precioVenta;
  double precioCosto;
  double precioTarifa;
  double precioTarifaCliente;
  double precioMinimo;
  double importeVenta;
  double importeCosto;
  double importeMargen;
  double porcentajeMargen;
  double ivaRate; // e.g. 0.21, 0.10, 0.04, 0.0

  OrderLine({
    this.id,
    required this.codigoArticulo,
    required this.descripcion,
    this.cantidadEnvases = 0,
    this.cantidadUnidades = 0,
    this.unidadMedida = 'CAJAS',
    this.unidadesCaja = 1,
    this.precioVenta = 0,
    this.precioCosto = 0,
    this.precioTarifa = 0,
    this.precioTarifaCliente = 0,
    this.precioMinimo = 0,
    this.importeVenta = 0,
    this.importeCosto = 0,
    this.importeMargen = 0,
    this.porcentajeMargen = 0,
    this.ivaRate = 0.21,
  });

  factory OrderLine.fromJson(Map<String, dynamic> json) {
    return OrderLine(
      id: json['id'] is int
          ? json['id'] as int
          : int.tryParse(json['id']?.toString() ?? ''),
      codigoArticulo: (json['codigoArticulo'] ?? json['CODIGOARTICULO'] ?? '')
          .toString()
          .trim(),
      descripcion:
          (json['descripcion'] ?? json['DESCRIPCION'] ?? '').toString().trim(),
      cantidadEnvases:
          _toDouble(json['cantidadEnvases'] ?? json['CANTIDADENVASES']),
      cantidadUnidades:
          _toDouble(json['cantidadUnidades'] ?? json['CANTIDADUNIDADES']),
      unidadMedida:
          (json['unidadMedida'] ?? json['UNIDADMEDIDA'] ?? 'CAJAS').toString(),
      unidadesCaja:
          _toDouble(json['unidadesCaja'] ?? json['UNIDADESCAJA'], fallback: 1),
      precioVenta: _toDouble(json['precioVenta'] ?? json['PRECIOVENTA']),
      precioCosto: _toDouble(json['precioCosto'] ?? json['PRECIOCOSTO']),
      precioTarifa: _toDouble(json['precioTarifa'] ?? json['PRECIOTARIFA']),
      precioTarifaCliente:
          _toDouble(json['precioTarifaCliente'] ?? json['PRECIOTARIFACLIENTE']),
      precioMinimo: _toDouble(json['precioMinimo'] ?? json['PRECIOMINIMO']),
      importeVenta: _toDouble(json['importeVenta'] ?? json['IMPORTEVENTA']),
      importeCosto: _toDouble(json['importeCosto'] ?? json['IMPORTECOSTO']),
      importeMargen: _toDouble(json['importeMargen'] ?? json['IMPORTEMARGEN']),
      porcentajeMargen:
          _toDouble(json['porcentajeMargen'] ?? json['PORCENTAJEMARGEN']),
      ivaRate: _toDouble(json['ivaRate'] ?? json['IVARATE'] ?? json['TIPOIVA'],
          fallback: 0.21),
    );
  }

  Map<String, dynamic> toJson() => {
        'codigoArticulo': codigoArticulo,
        'descripcion': descripcion,
        'cantidadEnvases': cantidadEnvases,
        'cantidadUnidades': cantidadUnidades,
        'unidadMedida': unidadMedida,
        'unidadesCaja': unidadesCaja,
        'precioVenta': precioVenta,
        'precioCosto': precioCosto,
        'precioTarifa': precioTarifa,
        'precioTarifaCliente': precioTarifaCliente,
        'precioMinimo': precioMinimo,
        'ivaRate': ivaRate,
      };

  /// Recalculate amounts based on current qty and price.
  /// Also auto-computes the complementary quantity field:
  /// - CAJAS: cantidadUnidades = cantidadEnvases * unidadesCaja
  /// - KILOGRAMOS/other: cantidadEnvases = cantidadUnidades / unidadesCaja
  void recalculate() {
    final unit = unidadMedida.trim().toUpperCase();
    // Auto-compute complementary field
    if (unit == 'CAJAS' || unit.isEmpty) {
      // Selling by boxes → compute total units
      if (cantidadEnvases > 0 && unidadesCaja > 0) {
        cantidadUnidades = double.parse(
            (cantidadEnvases * unidadesCaja).toStringAsFixed(5));
      }
    } else {
      // Selling by kg/litros/units → compute box equivalent
      if (cantidadUnidades > 0 && unidadesCaja > 0) {
        cantidadEnvases = double.parse(
            (cantidadUnidades / unidadesCaja).toStringAsFixed(2));
      }
    }

    // The billing qty is always the primary field for the selected unit
    final billingQty =
        (unit == 'CAJAS' || unit.isEmpty) ? cantidadEnvases : cantidadUnidades;
    importeVenta = double.parse((precioVenta * billingQty).toStringAsFixed(2));
    importeCosto = double.parse((precioCosto * billingQty).toStringAsFixed(2));
    importeMargen =
        double.parse((importeVenta - importeCosto).toStringAsFixed(2));
    porcentajeMargen = importeVenta > 0
        ? double.parse(
            ((importeMargen / importeVenta) * 100).toStringAsFixed(2))
        : 0;
  }
}

/// Order summary (list item)
class OrderSummary {
  final int id;
  final int numeroPedido;
  final String clienteCode;
  final String clienteName;
  final String vendedorCode;
  final String fecha;
  final String estado;
  final String tipoVenta;
  final double total;
  final double margen;
  final int lineCount;

  OrderSummary({
    required this.id,
    required this.numeroPedido,
    required this.clienteCode,
    required this.clienteName,
    required this.vendedorCode,
    required this.fecha,
    required this.estado,
    required this.tipoVenta,
    required this.total,
    this.margen = 0,
    this.lineCount = 0,
  });

  factory OrderSummary.fromJson(Map<String, dynamic> json) {
    return OrderSummary(
      id: json['id'] is int
          ? json['id'] as int
          : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      numeroPedido: json['numeroPedido'] is int
          ? json['numeroPedido'] as int
          : int.tryParse(json['numeroPedido']?.toString() ?? '0') ?? 0,
      clienteCode: (json['clienteCode'] ?? '').toString().trim(),
      clienteName: (json['clienteName'] ?? '').toString().trim(),
      vendedorCode: (json['vendedorCode'] ?? '').toString().trim(),
      fecha: (json['fecha'] ?? '').toString(),
      estado: (json['estado'] ?? '').toString().trim(),
      tipoVenta: (json['tipoVenta'] ?? 'CC').toString().trim(),
      total: _toDouble(json['total']),
      margen: _toDouble(json['margen']),
      lineCount: json['lineCount'] is int
          ? json['lineCount'] as int
          : int.tryParse(json['lineCount']?.toString() ?? '0') ?? 0,
    );
  }
}

/// Order detail (header + lines)
class OrderDetail {
  final OrderSummary header;
  final List<OrderLine> lines;

  OrderDetail({required this.header, required this.lines});

  factory OrderDetail.fromJson(Map<String, dynamic> json) {
    final linesJson = json['lines'] as List? ?? [];
    return OrderDetail(
      header: OrderSummary.fromJson(json),
      lines: linesJson
          .map((l) => OrderLine.fromJson(l as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Recommendation item
class Recommendation {
  final String code;
  final String name;
  final int frequency;
  final double totalUnits;
  final int clientCount;

  Recommendation({
    required this.code,
    required this.name,
    this.frequency = 0,
    this.totalUnits = 0,
    this.clientCount = 0,
  });

  factory Recommendation.fromJson(Map<String, dynamic> json) {
    return Recommendation(
      code: (json['code'] ?? '').toString().trim(),
      name: (json['name'] ?? '').toString().trim(),
      frequency: json['frequency'] is int
          ? json['frequency'] as int
          : int.tryParse(json['frequency']?.toString() ?? '0') ?? 0,
      totalUnits: _toDouble(json['totalUnits']),
      clientCount: json['clientCount'] is int
          ? json['clientCount'] as int
          : int.tryParse(json['clientCount']?.toString() ?? '0') ?? 0,
    );
  }
}

// ─── SERVICE ──────────────────────────────────────────────────

class PedidosService {
  static const _base = '/pedidos';

  // ── Product Catalog ──

  static Future<List<Product>> getProducts({
    required String vendedorCodes,
    String? search,
    String? clientCode,
    String? family,
    String? marca,
    int limit = 50,
    int offset = 0,
    bool forceRefresh = false,
  }) async {
    final params = <String, dynamic>{
      'vendedorCodes': vendedorCodes,
      'limit': limit.toString(),
      'offset': offset.toString(),
    };
    if (search != null && search.isNotEmpty) params['search'] = search;
    if (clientCode != null && clientCode.isNotEmpty)
      params['clientCode'] = clientCode;
    if (family != null && family.isNotEmpty) params['family'] = family;
    if (marca != null && marca.isNotEmpty) params['marca'] = marca;

    final cacheKey =
        'pedidos:products:${search ?? ''}:${family ?? ''}:${marca ?? ''}:$offset';
    try {
      final response = await ApiClient.get(
        '$_base/products',
        queryParameters: params,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 5),
        forceRefresh: forceRefresh,
      );
      final list = response['products'] as List? ?? [];
      return list
          .map((p) => Product.fromJson(p as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('[PedidosService] Error getProducts: $e');
      rethrow;
    }
  }

  static Future<ProductDetail> getProductDetail(String code,
      {String? clientCode}) async {
    final params = <String, dynamic>{};
    if (clientCode != null) params['clientCode'] = clientCode;

    try {
      final response = await ApiClient.get(
        '$_base/products/$code',
        queryParameters: params,
        cacheKey: 'pedidos:detail:$code:${clientCode ?? ''}',
        cacheTTL: const Duration(minutes: 10),
      );
      return ProductDetail.fromJson(response);
    } catch (e) {
      debugPrint('[PedidosService] Error getProductDetail: $e');
      rethrow;
    }
  }

  static Future<Map<String, double>> getStock(String code) async {
    try {
      final response = await ApiClient.get(
        '$_base/products/$code/stock',
        cacheKey: 'pedidos:stock:$code',
        cacheTTL: CacheService.realtimeTTL,
      );
      final stock = response['stock'] as Map<String, dynamic>? ?? {};
      return {
        'envases': _toDouble(stock['envases']),
        'unidades': _toDouble(stock['unidades']),
      };
    } catch (e) {
      debugPrint('[PedidosService] Error getStock: $e');
      rethrow;
    }
  }

  // ── Filters ──

  static Future<List<String>> getFamilies() async {
    try {
      final response = await ApiClient.get(
        '$_base/families',
        cacheKey: 'pedidos:families',
        cacheTTL: const Duration(hours: 1),
      );
      return (response['families'] as List? ?? [])
          .map((f) => f.toString())
          .toList();
    } catch (e) {
      debugPrint('[PedidosService] Error getFamilies: $e');
      return [];
    }
  }

  static Future<List<String>> getBrands() async {
    try {
      final response = await ApiClient.get(
        '$_base/brands',
        cacheKey: 'pedidos:brands',
        cacheTTL: const Duration(hours: 1),
      );
      return (response['brands'] as List? ?? [])
          .map((b) => b.toString())
          .toList();
    } catch (e) {
      debugPrint('[PedidosService] Error getBrands: $e');
      return [];
    }
  }

  // ── Orders CRUD ──

  static Future<Map<String, dynamic>> createOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    String tipoVenta = 'CC',
    int almacen = 1,
    int tarifa = 1,
    String observaciones = '',
    required List<OrderLine> lines,
  }) async {
    try {
      final response = await ApiClient.post('$_base/create', {
        'clientCode': clientCode,
        'clientName': clientName,
        'vendedorCode': vendedorCode,
        'tipoventa': tipoVenta,
        'almacen': almacen,
        'tarifa': tarifa,
        'observaciones': observaciones,
        'lines': lines.map((l) => l.toJson()).toList(),
      });
      // Invalidate orders cache
      CacheService.invalidateByPrefix('pedidos:orders:');
      return response;
    } catch (e) {
      debugPrint('[PedidosService] Error createOrder: $e');
      rethrow;
    }
  }

  static Future<List<OrderSummary>> getOrders({
    required String vendedorCodes,
    String? status,
    int? year,
    int? month,
    int limit = 50,
    int offset = 0,
    bool forceRefresh = false,
  }) async {
    final params = <String, dynamic>{
      'vendedorCodes': vendedorCodes,
      'limit': limit.toString(),
      'offset': offset.toString(),
    };
    if (status != null) params['status'] = status;
    if (year != null) params['year'] = year.toString();
    if (month != null) params['month'] = month.toString();

    try {
      final response = await ApiClient.get(
        _base,
        queryParameters: params,
        cacheKey:
            'pedidos:orders:$vendedorCodes:${status ?? ''}:${year ?? ''}:$offset',
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: forceRefresh,
      );
      final list = response['orders'] as List? ?? [];
      return list
          .map((o) => OrderSummary.fromJson(o as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('[PedidosService] Error getOrders: $e');
      rethrow;
    }
  }

  static Future<OrderDetail> getOrderDetail(int orderId) async {
    try {
      final response = await ApiClient.get(
        '$_base/$orderId',
        cacheKey: 'pedidos:order:$orderId',
        cacheTTL: const Duration(minutes: 1),
      );
      return OrderDetail.fromJson(response['order'] as Map<String, dynamic>);
    } catch (e) {
      debugPrint('[PedidosService] Error getOrderDetail: $e');
      rethrow;
    }
  }

  static Future<void> addLine(int orderId, OrderLine line) async {
    try {
      await ApiClient.put('$_base/$orderId/lines', data: line.toJson());
      CacheService.invalidate('pedidos:order:$orderId');
      CacheService.invalidateByPrefix('pedidos:orders:');
    } catch (e) {
      debugPrint('[PedidosService] Error addLine: $e');
      rethrow;
    }
  }

  static Future<void> updateLine(
      int orderId, int lineId, Map<String, dynamic> data) async {
    try {
      await ApiClient.put('$_base/$orderId/lines/$lineId', data: data);
      CacheService.invalidate('pedidos:order:$orderId');
      CacheService.invalidateByPrefix('pedidos:orders:');
    } catch (e) {
      debugPrint('[PedidosService] Error updateLine: $e');
      rethrow;
    }
  }

  static Future<void> deleteLine(int orderId, int lineId) async {
    try {
      await ApiClient.put('$_base/$orderId/lines/$lineId/delete');
      CacheService.invalidate('pedidos:order:$orderId');
      CacheService.invalidateByPrefix('pedidos:orders:');
    } catch (e) {
      debugPrint('[PedidosService] Error deleteLine: $e');
      rethrow;
    }
  }

  static Future<Map<String, dynamic>> confirmOrder(
      int orderId, String saleType) async {
    try {
      final response = await ApiClient.put('$_base/$orderId/confirm',
          data: {'saleType': saleType});
      CacheService.invalidate('pedidos:order:$orderId');
      CacheService.invalidateByPrefix('pedidos:orders:');
      return response;
    } catch (e) {
      debugPrint('[PedidosService] Error confirmOrder: $e');
      rethrow;
    }
  }

  static Future<void> cancelOrder(int orderId) async {
    try {
      await ApiClient.put('$_base/$orderId/cancel');
      CacheService.invalidate('pedidos:order:$orderId');
      CacheService.invalidateByPrefix('pedidos:orders:');
    } catch (e) {
      debugPrint('[PedidosService] Error cancelOrder: $e');
      rethrow;
    }
  }

  // ── Recommendations ──

  static Future<Map<String, List<Recommendation>>> getRecommendations({
    required String clientCode,
    required String vendedorCode,
  }) async {
    try {
      final response = await ApiClient.get(
        '$_base/recommendations/$clientCode',
        queryParameters: {'vendedorCode': vendedorCode},
        cacheKey: 'pedidos:reco:$clientCode:$vendedorCode',
        cacheTTL: const Duration(minutes: 15),
      );
      final clientHistory = (response['clientHistory'] as List? ?? [])
          .map((r) => Recommendation.fromJson(r as Map<String, dynamic>))
          .toList();
      final similarClients = (response['similarClients'] as List? ?? [])
          .map((r) => Recommendation.fromJson(r as Map<String, dynamic>))
          .toList();
      return {
        'clientHistory': clientHistory,
        'similarClients': similarClients,
      };
    } catch (e) {
      debugPrint('[PedidosService] Error getRecommendations: $e');
      return {'clientHistory': [], 'similarClients': []};
    }
  }

  // ── Client Balance ──
  static Future<Map<String, dynamic>> getClientBalance(
      String clientCode) async {
    try {
      final response = await ApiClient.get(
        '$_base/client-balance/$clientCode',
        cacheKey: 'pedidos:balance:$clientCode',
        cacheTTL: const Duration(minutes: 5),
      );
      return response['balance'] as Map<String, dynamic>? ?? {};
    } catch (e) {
      debugPrint('[PedidosService] Error getClientBalance: $e');
      return {};
    }
  }

  // ── Clone Order ──
  static Future<Map<String, dynamic>> cloneOrder(int orderId) async {
    try {
      final response = await ApiClient.get(
        '$_base/$orderId/clone',
        cacheKey: 'pedidos:clone:$orderId',
        cacheTTL: const Duration(seconds: 30),
      );
      return response['order'] as Map<String, dynamic>? ?? {};
    } catch (e) {
      debugPrint('[PedidosService] Error cloneOrder: $e');
      rethrow;
    }
  }

  // ── Complementary Products ──
  static Future<List<Map<String, dynamic>>> getComplementaryProducts(
      List<String> productCodes,
      {String? clientCode}) async {
    try {
      final response = await ApiClient.post('$_base/complementary', {
        'productCodes': productCodes,
        if (clientCode != null) 'clientCode': clientCode,
      });
      return (response['products'] as List? ?? []).cast<Map<String, dynamic>>();
    } catch (e) {
      debugPrint('[PedidosService] Error getComplementaryProducts: $e');
      return [];
    }
  }

  // ── Analytics ──
  static Future<Map<String, dynamic>> getAnalytics(String vendedorCodes) async {
    try {
      final response = await ApiClient.get(
        '$_base/analytics',
        queryParameters: {'vendedorCodes': vendedorCodes},
        cacheKey: 'pedidos:analytics:$vendedorCodes',
        cacheTTL: const Duration(minutes: 10),
      );
      return response['analytics'] as Map<String, dynamic>? ?? {};
    } catch (e) {
      debugPrint('[PedidosService] Error getAnalytics: $e');
      return {};
    }
  }
}

// ─── HELPERS ──────────────────────────────────────────────────

double _toDouble(dynamic value, {double fallback = 0}) {
  if (value == null) return fallback;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString()) ?? fallback;
}
