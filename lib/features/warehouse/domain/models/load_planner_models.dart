/// Domain models for Load Planner V2.
/// Immutable data classes with copyWith support.

// ═══════════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════════

enum ViewMode { perspective, top, front }

enum ColorMode { product, client, weight }

enum LoadStatus { seguro, optimo, exceso }

enum SaveState { saved, saving, unsaved, error }

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD BOX — A single box placed (or in overflow) in the truck
// ═══════════════════════════════════════════════════════════════════════════════

class LoadBox {
  final int id;
  final String label;
  final int orderNumber;
  final String clientCode;
  final String articleCode;
  final double weight;
  // Position (lower-left-front corner)
  final double x, y, z;
  // Dimensions as placed
  final double w, d, h;

  const LoadBox({
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

  LoadBox copyWith({
    int? id,
    String? label,
    int? orderNumber,
    String? clientCode,
    String? articleCode,
    double? weight,
    double? x,
    double? y,
    double? z,
    double? w,
    double? d,
    double? h,
  }) =>
      LoadBox(
        id: id ?? this.id,
        label: label ?? this.label,
        orderNumber: orderNumber ?? this.orderNumber,
        clientCode: clientCode ?? this.clientCode,
        articleCode: articleCode ?? this.articleCode,
        weight: weight ?? this.weight,
        x: x ?? this.x,
        y: y ?? this.y,
        z: z ?? this.z,
        w: w ?? this.w,
        d: d ?? this.d,
        h: h ?? this.h,
      );

  factory LoadBox.fromJson(Map<String, dynamic> json) => LoadBox(
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

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'orderNumber': orderNumber,
        'clientCode': clientCode,
        'articleCode': articleCode,
        'weight': weight,
        'x': x,
        'y': y,
        'z': z,
        'w': w,
        'd': d,
        'h': h,
      };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUCK DIMENSIONS
// ═══════════════════════════════════════════════════════════════════════════════

class TruckDimensions {
  final String code;
  final String description;
  final double lengthCm;
  final double widthCm;
  final double heightCm;
  final double maxPayloadKg;
  final double tolerancePct;

  const TruckDimensions({
    required this.code,
    required this.description,
    required this.lengthCm,
    required this.widthCm,
    required this.heightCm,
    required this.maxPayloadKg,
    this.tolerancePct = 5.0,
  });

  double get volumeCm3 => lengthCm * widthCm * heightCm;
  double get volumeM3 => volumeCm3 / 1e6;

  factory TruckDimensions.fromVehicleConfig(Map<String, dynamic> json) {
    final interior = (json['interior'] as Map<String, dynamic>?) ?? {};
    return TruckDimensions(
      code: (json['code'] as String?) ?? '',
      description: (json['description'] as String?) ?? '',
      lengthCm: ((interior['lengthCm'] ?? 600) as num).toDouble(),
      widthCm: ((interior['widthCm'] ?? 240) as num).toDouble(),
      heightCm: ((interior['heightCm'] ?? 220) as num).toDouble(),
      maxPayloadKg: ((json['maxPayloadKg'] ?? 6000) as num).toDouble(),
      tolerancePct: ((json['tolerancePct'] ?? 5) as num).toDouble(),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD METRICS — computed stats for current layout
// ═══════════════════════════════════════════════════════════════════════════════

class PlannerMetrics {
  final int totalBoxes;
  final int placedCount;
  final int overflowCount;
  final double containerVolumeCm3;
  final double usedVolumeCm3;
  final double volumePct;
  final double totalWeightKg;
  final double overflowWeightKg;
  final double maxPayloadKg;
  final double weightPct;
  final LoadStatus status;

  const PlannerMetrics({
    required this.totalBoxes,
    required this.placedCount,
    required this.overflowCount,
    required this.containerVolumeCm3,
    required this.usedVolumeCm3,
    required this.volumePct,
    required this.totalWeightKg,
    required this.overflowWeightKg,
    required this.maxPayloadKg,
    required this.weightPct,
    required this.status,
  });

  factory PlannerMetrics.fromBoxes({
    required List<LoadBox> placed,
    required List<LoadBox> overflow,
    required TruckDimensions truck,
  }) {
    double usedVol = 0;
    double totalWeight = 0;
    for (final b in placed) {
      usedVol += b.volume;
      totalWeight += b.weight;
    }
    double overflowWeight = 0;
    for (final b in overflow) {
      overflowWeight += b.weight;
    }

    final containerVol = truck.volumeCm3;
    final volPct =
        containerVol > 0 ? (usedVol / containerVol * 100).clamp(0, 100) : 0.0;
    final wPct = truck.maxPayloadKg > 0
        ? (totalWeight / truck.maxPayloadKg * 100).clamp(0, 999)
        : 0.0;

    LoadStatus status;
    if (overflow.isNotEmpty) {
      status = LoadStatus.exceso;
    } else if (volPct >= 90 || wPct >= 90) {
      status = LoadStatus.optimo;
    } else {
      status = LoadStatus.seguro;
    }

    return PlannerMetrics(
      totalBoxes: placed.length + overflow.length,
      placedCount: placed.length,
      overflowCount: overflow.length,
      containerVolumeCm3: containerVol,
      usedVolumeCm3: usedVol,
      volumePct: volPct.toDouble(),
      totalWeightKg: totalWeight,
      overflowWeightKg: overflowWeight,
      maxPayloadKg: truck.maxPayloadKg,
      weightPct: wPct.toDouble(),
      status: status,
    );
  }

  factory PlannerMetrics.fromJson(Map<String, dynamic> json) {
    final statusStr = ((json['status'] as String?) ?? 'SEGURO').toUpperCase();
    LoadStatus status;
    switch (statusStr) {
      case 'EXCESO':
        status = LoadStatus.exceso;
        break;
      case 'OPTIMO':
        status = LoadStatus.optimo;
        break;
      default:
        status = LoadStatus.seguro;
    }
    return PlannerMetrics(
      totalBoxes: (json['totalBoxes'] as int?) ?? 0,
      placedCount: (json['placedCount'] as int?) ?? 0,
      overflowCount: (json['overflowCount'] as int?) ?? 0,
      containerVolumeCm3:
          ((json['containerVolumeCm3'] ?? 0) as num).toDouble(),
      usedVolumeCm3: ((json['usedVolumeCm3'] ?? 0) as num).toDouble(),
      volumePct: ((json['volumeOccupancyPct'] ?? json['volumePct'] ?? 0) as num)
          .toDouble(),
      totalWeightKg: ((json['totalWeightKg'] ?? 0) as num).toDouble(),
      overflowWeightKg: ((json['overflowWeightKg'] ?? 0) as num).toDouble(),
      maxPayloadKg: ((json['maxPayloadKg'] ?? 0) as num).toDouble(),
      weightPct:
          ((json['weightOccupancyPct'] ?? json['weightPct'] ?? 0) as num)
              .toDouble(),
      status: status,
    );
  }

  Map<String, dynamic> toJson() => {
        'totalBoxes': totalBoxes,
        'placedCount': placedCount,
        'overflowCount': overflowCount,
        'containerVolumeCm3': containerVolumeCm3,
        'usedVolumeCm3': usedVolumeCm3,
        'volumePct': volumePct,
        'totalWeightKg': totalWeightKg,
        'overflowWeightKg': overflowWeightKg,
        'maxPayloadKg': maxPayloadKg,
        'weightPct': weightPct,
        'status': status.name.toUpperCase(),
      };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRAG STATE
// ═══════════════════════════════════════════════════════════════════════════════

class DragState {
  final int boxIndex;
  final double startX, startY, startZ; // original 3D position
  final bool hasCollision;

  const DragState({
    required this.boxIndex,
    required this.startX,
    required this.startY,
    required this.startZ,
    this.hasCollision = false,
  });

  DragState copyWith({bool? hasCollision}) => DragState(
        boxIndex: boxIndex,
        startX: startX,
        startY: startY,
        startZ: startZ,
        hasCollision: hasCollision ?? this.hasCollision,
      );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANUAL LAYOUT (persisted)
// ═══════════════════════════════════════════════════════════════════════════════

class ManualLayout {
  final int? id;
  final String vehicleCode;
  final String date;
  final List<LoadBox> boxes;
  final List<int> excludedOrders;
  final Map<String, dynamic> metrics;

  const ManualLayout({
    this.id,
    required this.vehicleCode,
    required this.date,
    required this.boxes,
    this.excludedOrders = const [],
    this.metrics = const {},
  });

  factory ManualLayout.fromJson(Map<String, dynamic> json) {
    final boxList = (json['boxes'] as List?)
            ?.map((b) => LoadBox.fromJson(b as Map<String, dynamic>))
            .toList() ??
        [];
    final excluded = (json['excludedOrders'] as List?)
            ?.map((e) => (e as num).toInt())
            .toList() ??
        [];
    return ManualLayout(
      id: json['id'] as int?,
      vehicleCode: (json['vehicleCode'] as String?) ?? '',
      date: (json['date'] as String?) ?? '',
      boxes: boxList,
      excludedOrders: excluded,
      metrics: (json['metrics'] as Map<String, dynamic>?) ?? {},
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT SUMMARY — aggregated stats per client
// ═══════════════════════════════════════════════════════════════════════════════

class ClientSummary {
  final String clientCode;
  final int boxCount;
  final double totalWeight;
  final double totalVolume;

  const ClientSummary({
    required this.clientCode,
    required this.boxCount,
    required this.totalWeight,
    required this.totalVolume,
  });
}
