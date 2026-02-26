/// WAREHOUSE DATA SERVICE
/// API client for warehouse/expedition endpoints (3D Load Planner)

import '../../../core/api/api_client.dart';
import '../../../core/cache/cache_service.dart';

// ═══════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════

/// Resumen de un camión en el dashboard
class TruckSummary {
  final String vehicleCode;
  final String description;
  final String matricula;
  final String driverCode;
  final String driverName;
  final int orderCount;
  final int lineCount;
  final double maxPayloadKg;
  final double containerVolume;
  final double tolerancePct;

  TruckSummary({
    required this.vehicleCode,
    required this.description,
    required this.matricula,
    required this.driverCode,
    required this.driverName,
    required this.orderCount,
    required this.lineCount,
    required this.maxPayloadKg,
    required this.containerVolume,
    required this.tolerancePct,
  });

  factory TruckSummary.fromJson(Map<String, dynamic> json) => TruckSummary(
    vehicleCode: (json['vehicleCode'] as String?) ?? '',
    description: (json['description'] as String?) ?? '',
    matricula: (json['matricula'] as String?) ?? '',
    driverCode: (json['driverCode'] as String?) ?? '',
    driverName: (json['driverName'] as String?) ?? '',
    orderCount: (json['orderCount'] as int?) ?? 0,
    lineCount: (json['lineCount'] as int?) ?? 0,
    maxPayloadKg: ((json['maxPayloadKg'] ?? 0) as num).toDouble(),
    containerVolume: ((json['containerVolume'] ?? 0) as num).toDouble(),
    tolerancePct: ((json['tolerancePct'] ?? 5) as num).toDouble(),
  );
}

/// Vehículo completo con configuración
class VehicleConfig {
  final String code;
  final String description;
  final String matricula;
  final double maxPayloadKg;
  final double tara;
  final double volumeM3;
  final double containerVolumeM3;
  final TruckInterior interior;
  final double tolerancePct;

  VehicleConfig({
    required this.code,
    required this.description,
    required this.matricula,
    required this.maxPayloadKg,
    required this.tara,
    required this.volumeM3,
    required this.containerVolumeM3,
    required this.interior,
    required this.tolerancePct,
  });

  factory VehicleConfig.fromJson(Map<String, dynamic> json) => VehicleConfig(
    code: (json['code'] as String?) ?? '',
    description: (json['description'] as String?) ?? '',
    matricula: (json['matricula'] as String?) ?? '',
    maxPayloadKg: ((json['maxPayloadKg'] ?? 0) as num).toDouble(),
    tara: ((json['tara'] ?? 0) as num).toDouble(),
    volumeM3: ((json['volumeM3'] ?? 0) as num).toDouble(),
    containerVolumeM3: ((json['containerVolumeM3'] ?? 0) as num).toDouble(),
    interior: TruckInterior.fromJson(
        (json['interior'] as Map<String, dynamic>?) ?? {}),
    tolerancePct: ((json['tolerancePct'] ?? 5) as num).toDouble(),
  );
}

class TruckInterior {
  final double lengthCm;
  final double widthCm;
  final double heightCm;

  TruckInterior({
    required this.lengthCm,
    required this.widthCm,
    required this.heightCm,
  });

  double get volumeM3 => (lengthCm * widthCm * heightCm) / 1e6;

  factory TruckInterior.fromJson(Map<String, dynamic> json) => TruckInterior(
    lengthCm: ((json['lengthCm'] ?? 0) as num).toDouble(),
    widthCm: ((json['widthCm'] ?? 0) as num).toDouble(),
    heightCm: ((json['heightCm'] ?? 0) as num).toDouble(),
  );
}

/// Caja colocada en el camión (resultado del bin packing)
class PlacedBox {
  final int id;
  final String label;
  final int orderNumber;
  final String clientCode;
  final String articleCode;
  final double weight;
  // Posición (esquina inferior-izquierda-frontal)
  final double x, y, z;
  // Dimensiones tal como fue colocada
  final double w, d, h;

  PlacedBox({
    required this.id,
    required this.label,
    required this.orderNumber,
    required this.clientCode,
    required this.articleCode,
    required this.weight,
    required this.x,
    required this.y,
    required this.z,
    required this.w,
    required this.d,
    required this.h,
  });

  double get volume => w * d * h;

  factory PlacedBox.fromJson(Map<String, dynamic> json) => PlacedBox(
    id: (json['id'] as int?) ?? 0,
    label: (json['label'] as String?) ?? '',
    orderNumber: (json['orderNumber'] as int?) ?? 0,
    clientCode: (json['clientCode'] as String?) ?? '',
    articleCode: (json['articleCode'] as String?) ?? '',
    weight: ((json['weight'] ?? 0) as num).toDouble(),
    x: ((json['x'] ?? 0) as num).toDouble(),
    y: ((json['y'] ?? 0) as num).toDouble(),
    z: ((json['z'] ?? 0) as num).toDouble(),
    w: ((json['w'] ?? 0) as num).toDouble(),
    d: ((json['d'] ?? 0) as num).toDouble(),
    h: ((json['h'] ?? 0) as num).toDouble(),
  );
}

/// Métricas del resultado del load plan
class LoadMetrics {
  final int totalBoxes;
  final int placedCount;
  final int overflowCount;
  final double containerVolumeCm3;
  final double usedVolumeCm3;
  final double volumeOccupancyPct;
  final double totalWeightKg;
  final double overflowWeightKg;
  final double maxPayloadKg;
  final double weightOccupancyPct;
  final double totalDemandVolumeCm3;
  final double totalDemandWeightKg;
  final double demandVsCapacityPct;
  final String status; // SEGURO, OPTIMO, EXCESO

  LoadMetrics({
    required this.totalBoxes,
    required this.placedCount,
    required this.overflowCount,
    required this.containerVolumeCm3,
    required this.usedVolumeCm3,
    required this.volumeOccupancyPct,
    required this.totalWeightKg,
    required this.overflowWeightKg,
    required this.maxPayloadKg,
    required this.weightOccupancyPct,
    required this.totalDemandVolumeCm3,
    required this.totalDemandWeightKg,
    required this.demandVsCapacityPct,
    required this.status,
  });

  factory LoadMetrics.fromJson(Map<String, dynamic> json) => LoadMetrics(
    totalBoxes: (json['totalBoxes'] as int?) ?? 0,
    placedCount: (json['placedCount'] as int?) ?? 0,
    overflowCount: (json['overflowCount'] as int?) ?? 0,
    containerVolumeCm3: ((json['containerVolumeCm3'] ?? 0) as num).toDouble(),
    usedVolumeCm3: ((json['usedVolumeCm3'] ?? 0) as num).toDouble(),
    volumeOccupancyPct: ((json['volumeOccupancyPct'] ?? 0) as num).toDouble(),
    totalWeightKg: ((json['totalWeightKg'] ?? 0) as num).toDouble(),
    overflowWeightKg: ((json['overflowWeightKg'] ?? 0) as num).toDouble(),
    maxPayloadKg: ((json['maxPayloadKg'] ?? 0) as num).toDouble(),
    weightOccupancyPct: ((json['weightOccupancyPct'] ?? 0) as num).toDouble(),
    totalDemandVolumeCm3: ((json['totalDemandVolumeCm3'] ?? 0) as num).toDouble(),
    totalDemandWeightKg: ((json['totalDemandWeightKg'] ?? 0) as num).toDouble(),
    demandVsCapacityPct: ((json['demandVsCapacityPct'] ?? 0) as num).toDouble(),
    status: (json['status'] as String?) ?? 'SEGURO',
  );
}

/// Resultado completo del planificador de carga
class LoadPlanResult {
  final VehicleConfig? truck;
  final List<PlacedBox> placed;
  final List<PlacedBox> overflow;
  final LoadMetrics metrics;
  final double tolerancePct;

  LoadPlanResult({
    this.truck,
    required this.placed,
    required this.overflow,
    required this.metrics,
    required this.tolerancePct,
  });

  factory LoadPlanResult.fromJson(Map<String, dynamic> json) {
    final truckJson = json['truck'] as Map<String, dynamic>?;
    return LoadPlanResult(
      truck: truckJson != null ? VehicleConfig.fromJson(truckJson) : null,
      placed: ((json['placed'] as List?) ?? [])
          .map((b) => PlacedBox.fromJson(b as Map<String, dynamic>))
          .toList(),
      overflow: ((json['overflow'] as List?) ?? [])
          .map((b) => PlacedBox.fromJson(b as Map<String, dynamic>))
          .toList(),
      metrics: LoadMetrics.fromJson(
          (json['metrics'] as Map<String, dynamic>?) ?? {}),
      tolerancePct: ((json['tolerancePct'] ?? 5) as num).toDouble(),
    );
  }
}

/// Orden de un camión
class TruckOrder {
  final String articleCode;
  final String articleName;
  final String clientCode;
  final String clientName;
  final int orderNumber;
  final double units;
  final double boxes;
  final double weightPerUnit;
  final bool hasDimensions;
  final double largoCm;
  final double anchoCm;
  final double altoCm;

  TruckOrder({
    required this.articleCode,
    required this.articleName,
    required this.clientCode,
    required this.clientName,
    required this.orderNumber,
    required this.units,
    required this.boxes,
    required this.weightPerUnit,
    required this.hasDimensions,
    required this.largoCm,
    required this.anchoCm,
    required this.altoCm,
  });

  /// Display quantity: boxes if available, otherwise units
  double get quantity => boxes > 0 ? boxes : units;

  factory TruckOrder.fromJson(Map<String, dynamic> json) {
    final dims = (json['dimensions'] as Map<String, dynamic>?) ?? {};
    return TruckOrder(
      articleCode: (json['articleCode'] as String?) ?? '',
      articleName: (json['articleName'] as String?) ?? '',
      clientCode: (json['clientCode'] as String?) ?? '',
      clientName: (json['clientName'] as String?) ?? '',
      orderNumber: (json['orderNumber'] as int?) ?? 0,
      units: ((json['units'] ?? json['quantity'] ?? 0) as num).toDouble(),
      boxes: ((json['boxes'] ?? 0) as num).toDouble(),
      weightPerUnit: ((json['weightPerUnit'] ?? 0) as num).toDouble(),
      hasDimensions: (json['hasDimensions'] as bool?) ?? false,
      largoCm: ((dims['largoCm'] ?? 30) as num).toDouble(),
      anchoCm: ((dims['anchoCm'] ?? 20) as num).toDouble(),
      altoCm: ((dims['altoCm'] ?? 15) as num).toDouble(),
    );
  }
}

/// Personal de almacén
class WarehousePerson {
  final String id;
  final String name;
  final String vendorCode;
  final String role;
  final bool active;
  final String phone;
  final String email;
  final String source; // 'custom' or 'vdd'

  WarehousePerson({
    required this.id,
    required this.name,
    required this.vendorCode,
    required this.role,
    required this.active,
    required this.phone,
    required this.email,
    this.source = 'custom',
  });

  factory WarehousePerson.fromJson(Map<String, dynamic> json) =>
      WarehousePerson(
        id: json['id']?.toString() ?? '0',
        name: (json['name'] as String?) ?? '',
        vendorCode: (json['vendorCode'] as String?) ?? '',
        role: (json['role'] as String?) ?? 'PREPARADOR',
        active: (json['active'] as bool?) ?? true,
        phone: (json['phone'] as String?) ?? '',
        email: (json['email'] as String?) ?? '',
        source: (json['source'] as String?) ?? 'custom',
      );
}

/// Artículo con dimensiones (reales o estimadas)
class ArticleDimension {
  final String code;
  final String name;
  final double weight;
  final int unitsPerBox;
  final bool hasRealDimensions;
  final double? largoCm, anchoCm, altoCm;
  final double? pesoOverrideKg;
  final String notas;

  ArticleDimension({
    required this.code,
    required this.name,
    required this.weight,
    required this.unitsPerBox,
    required this.hasRealDimensions,
    this.largoCm,
    this.anchoCm,
    this.altoCm,
    this.pesoOverrideKg,
    this.notas = '',
  });

  factory ArticleDimension.fromJson(Map<String, dynamic> json) =>
      ArticleDimension(
        code: (json['code'] as String?) ?? '',
        name: (json['name'] as String?) ?? '',
        weight: ((json['weight'] ?? 0) as num).toDouble(),
        unitsPerBox: (json['unitsPerBox'] as int?) ?? 1,
        hasRealDimensions: (json['hasRealDimensions'] as bool?) ?? false,
        largoCm: (json['largoCm'] as num?)?.toDouble(),
        anchoCm: (json['anchoCm'] as num?)?.toDouble(),
        altoCm: (json['altoCm'] as num?)?.toDouble(),
        pesoOverrideKg: (json['pesoOverrideKg'] as num?)?.toDouble(),
        notas: (json['notas'] as String?) ?? '',
      );
}

/// Entrada del historial de cargas
class LoadHistoryEntry {
  final int id;
  final String vehicleCode;
  final String date;
  final double weightKg;
  final double volumeCm3;
  final double volumePct;
  final double weightPct;
  final int orderCount;
  final int boxCount;
  final String status;
  final String createdBy;
  final String createdAt;

  LoadHistoryEntry({
    required this.id,
    required this.vehicleCode,
    required this.date,
    required this.weightKg,
    required this.volumeCm3,
    required this.volumePct,
    required this.weightPct,
    required this.orderCount,
    required this.boxCount,
    required this.status,
    required this.createdBy,
    required this.createdAt,
  });

  factory LoadHistoryEntry.fromJson(Map<String, dynamic> json) =>
      LoadHistoryEntry(
        id: (json['id'] as int?) ?? 0,
        vehicleCode: (json['vehicleCode'] as String?) ?? '',
        date: (json['date'] as String?) ?? '',
        weightKg: ((json['weightKg'] ?? 0) as num).toDouble(),
        volumeCm3: ((json['volumeCm3'] ?? 0) as num).toDouble(),
        volumePct: ((json['volumePct'] ?? 0) as num).toDouble(),
        weightPct: ((json['weightPct'] ?? 0) as num).toDouble(),
        orderCount: (json['orderCount'] as int?) ?? 0,
        boxCount: (json['boxCount'] as int?) ?? 0,
        status: (json['status'] as String?) ?? '',
        createdBy: (json['createdBy'] as String?) ?? '',
        createdAt: (json['createdAt'] as String?) ?? '',
      );
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class WarehouseDataService {
  /// Dashboard — camiones del día con KPIs
  static Future<List<TruckSummary>> getDashboard({
    int? year,
    int? month,
    int? day,
  }) async {
    final qp = <String, String>{};
    if (year != null) qp['year'] = year.toString();
    if (month != null) qp['month'] = month.toString();
    if (day != null) qp['day'] = day.toString();

    final response = await ApiClient.get(
      '/warehouse/dashboard',
      queryParameters: qp,
      cacheKey:
          'warehouse_dashboard_${year ?? 'now'}_${month ?? 'now'}_${day ?? 'now'}',
      cacheTTL: CacheService.shortTTL,
    );

    return ((response['trucks'] as List?) ?? [])
        .map((t) => TruckSummary.fromJson(t as Map<String, dynamic>))
        .toList();
  }

  /// Lista todos los vehículos
  static Future<List<VehicleConfig>> getVehicles() async {
    final response = await ApiClient.get(
      '/warehouse/vehicles',
      cacheKey: 'warehouse_vehicles',
      cacheTTL: CacheService.defaultTTL,
    );

    return ((response['vehicles'] as List?) ?? [])
        .map((v) => VehicleConfig.fromJson(v as Map<String, dynamic>))
        .toList();
  }

  /// Ejecutar 3D bin packing para un camión y fecha
  static Future<LoadPlanResult> planLoad({
    required String vehicleCode,
    int? year,
    int? month,
    int? day,
    double? tolerance,
  }) async {
    final now = DateTime.now();
    final response = await ApiClient.post('/warehouse/load-plan', {
      'vehicleCode': vehicleCode,
      'year': year ?? now.year,
      'month': month ?? (now.month),
      'day': day ?? now.day,
      if (tolerance != null) 'tolerance': tolerance,
    });

    return LoadPlanResult.fromJson(response);
  }

  /// Simulación what-if con lista manual de items
  static Future<LoadPlanResult> planLoadManual({
    required String vehicleCode,
    required List<Map<String, dynamic>> items,
    double? tolerance,
  }) async {
    final response = await ApiClient.post('/warehouse/load-plan-manual', {
      'vehicleCode': vehicleCode,
      'items': items,
      if (tolerance != null) 'tolerance': tolerance,
    });
    return LoadPlanResult.fromJson(response);
  }

  /// Órdenes asignadas a un camión
  static Future<List<TruckOrder>> getTruckOrders({
    required String vehicleCode,
    int? year,
    int? month,
    int? day,
  }) async {
    final qp = <String, String>{};
    if (year != null) qp['year'] = year.toString();
    if (month != null) qp['month'] = month.toString();
    if (day != null) qp['day'] = day.toString();

    final response = await ApiClient.get(
      '/warehouse/truck/$vehicleCode/orders',
      queryParameters: qp,
      cacheKey:
          'warehouse_orders_${vehicleCode}_${year ?? ''}_${month ?? ''}_${day ?? ''}',
      cacheTTL: CacheService.shortTTL,
    );

    return ((response['orders'] as List?) ?? [])
        .map((o) => TruckOrder.fromJson(o as Map<String, dynamic>))
        .toList();
  }

  /// Personal de almacén
  static Future<List<WarehousePerson>> getPersonnel() async {
    final response = await ApiClient.get(
      '/warehouse/personnel',
      cacheKey: 'warehouse_personnel',
      cacheTTL: CacheService.defaultTTL,
    );

    return ((response['personnel'] as List?) ?? [])
        .map((p) => WarehousePerson.fromJson(p as Map<String, dynamic>))
        .toList();
  }

  /// Añadir operario
  static Future<void> addPerson({
    required String nombre,
    String? codigoVendedor,
    String? rol,
    String? telefono,
    String? email,
  }) async {
    await ApiClient.post('/warehouse/personnel', {
      'nombre': nombre,
      if (codigoVendedor != null) 'codigoVendedor': codigoVendedor,
      if (rol != null) 'rol': rol,
      if (telefono != null) 'telefono': telefono,
      if (email != null) 'email': email,
    });
  }

  /// Actualizar operario
  static Future<void> updatePerson({
    required String id,
    String? nombre,
    String? rol,
    String? telefono,
    String? email,
    bool? activo,
  }) async {
    await ApiClient.put('/warehouse/personnel/$id', data: {
      if (nombre != null) 'nombre': nombre,
      if (rol != null) 'rol': rol,
      if (telefono != null) 'telefono': telefono,
      if (email != null) 'email': email,
      if (activo != null) 'activo': activo,
    });
  }

  /// Eliminar operario (soft delete)
  static Future<void> deletePerson(String id) async {
    await ApiClient.post('/warehouse/personnel/$id/delete', {});
  }

  /// Artículos con dimensiones (búsqueda)
  static Future<List<ArticleDimension>> getArticles({
    String? search,
    bool? onlyWithDimensions,
    int limit = 50,
  }) async {
    final qp = <String, String>{'limit': limit.toString()};
    if (search != null && search.isNotEmpty) qp['search'] = search;
    if (onlyWithDimensions == true) qp['onlyWithDimensions'] = 'true';

    final response = await ApiClient.get(
      '/warehouse/articles',
      queryParameters: qp,
    );

    return ((response['articles'] as List?) ?? [])
        .map((a) => ArticleDimension.fromJson(a as Map<String, dynamic>))
        .toList();
  }

  /// Actualizar dimensiones de artículo
  static Future<void> updateArticleDimensions({
    required String code,
    required double largoCm,
    required double anchoCm,
    required double altoCm,
    double? pesoCajaKg,
    String? notas,
  }) async {
    await ApiClient.put('/warehouse/article-dimensions/$code', data: {
      'largoCm': largoCm,
      'anchoCm': anchoCm,
      'altoCm': altoCm,
      if (pesoCajaKg != null) 'pesoCajaKg': pesoCajaKg,
      if (notas != null) 'notas': notas,
    });
  }

  /// Historial de cargas
  static Future<List<LoadHistoryEntry>> getLoadHistory({
    String? vehicleCode,
    int limit = 30,
  }) async {
    final qp = <String, String>{'limit': limit.toString()};
    if (vehicleCode != null) qp['vehicleCode'] = vehicleCode;

    final response = await ApiClient.get(
      '/warehouse/load-history',
      queryParameters: qp,
    );

    return ((response['history'] as List?) ?? [])
        .map((h) => LoadHistoryEntry.fromJson(h as Map<String, dynamic>))
        .toList();
  }

  /// Actualizar config camión
  static Future<void> updateTruckConfig({
    required String vehicleCode,
    double? largoInteriorCm,
    double? anchoInteriorCm,
    double? altoInteriorCm,
    double? toleranciaExceso,
    String? notas,
  }) async {
    await ApiClient.put('/warehouse/truck-config/$vehicleCode', data: {
      if (largoInteriorCm != null) 'largoInteriorCm': largoInteriorCm,
      if (anchoInteriorCm != null) 'anchoInteriorCm': anchoInteriorCm,
      if (altoInteriorCm != null) 'altoInteriorCm': altoInteriorCm,
      if (toleranciaExceso != null) 'toleranciaExceso': toleranciaExceso,
      if (notas != null) 'notas': notas,
    });
  }
}
