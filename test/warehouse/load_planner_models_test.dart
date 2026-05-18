import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

void main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD BOX
  // ═══════════════════════════════════════════════════════════════════════════

  group('LoadBox', () {
    test('should parse from JSON correctly', () {
      final json = {
        'id': 42,
        'label': 'HUEVOS M 12',
        'orderNumber': 1001,
        'clientCode': 'CLI001',
        'articleCode': 'ART999',
        'weight': 12.5,
        'x': 10.0,
        'y': 20.0,
        'z': 0.0,
        'w': 40.0,
        'd': 30.0,
        'h': 25.0,
      };

      final box = LoadBox.fromJson(json);

      expect(box.id, 42);
      expect(box.label, 'HUEVOS M 12');
      expect(box.orderNumber, 1001);
      expect(box.clientCode, 'CLI001');
      expect(box.articleCode, 'ART999');
      expect(box.weight, 12.5);
      expect(box.x, 10.0);
      expect(box.y, 20.0);
      expect(box.z, 0.0);
      expect(box.w, 40.0);
      expect(box.d, 30.0);
      expect(box.h, 25.0);
    });

    test('should handle missing fields with defaults', () {
      final box = LoadBox.fromJson(<String, dynamic>{});

      expect(box.id, 0);
      expect(box.label, '');
      expect(box.orderNumber, 0);
      expect(box.clientCode, '');
      expect(box.weight, 0.0);
      expect(box.x, 0.0);
      expect(box.y, 0.0);
      expect(box.z, 0.0);
    });

    test('volume should be w * d * h', () {
      const box = LoadBox(
        id: 1,
        label: 'Test',
        orderNumber: 1,
        clientCode: 'C',
        articleCode: 'A',
        weight: 5,
        x: 0,
        y: 0,
        z: 0,
        w: 40,
        d: 30,
        h: 25,
      );

      expect(box.volume, 30000.0); // 40 * 30 * 25
    });

    test('copyWith should update specified fields', () {
      const box = LoadBox(
        id: 1,
        label: 'Test',
        orderNumber: 1,
        clientCode: 'C',
        articleCode: 'A',
        weight: 5,
        x: 0,
        y: 0,
        z: 0,
        w: 40,
        d: 30,
        h: 25,
      );

      final moved = box.copyWith(x: 100, y: 50);

      expect(moved.id, 1); // unchanged
      expect(moved.x, 100.0);
      expect(moved.y, 50.0);
      expect(moved.z, 0.0); // unchanged
      expect(moved.w, 40); // unchanged
    });

    test('toJson should produce serializable map', () {
      const box = LoadBox(
        id: 5,
        label: 'Box5',
        orderNumber: 200,
        clientCode: 'CC',
        articleCode: 'AA',
        weight: 3.5,
        x: 10,
        y: 20,
        z: 30,
        w: 40,
        d: 50,
        h: 60,
      );

      final json = box.toJson();

      expect(json['id'], 5);
      expect(json['label'], 'Box5');
      expect(json['weight'], 3.5);
      expect(json['x'], 10);
    });

    test('fromJson → toJson roundtrip should preserve data', () {
      final original = {
        'id': 99,
        'label': 'Round',
        'orderNumber': 500,
        'clientCode': 'RT',
        'articleCode': 'AR',
        'weight': 7.7,
        'x': 1.1,
        'y': 2.2,
        'z': 3.3,
        'w': 4.4,
        'd': 5.5,
        'h': 6.6,
      };

      final box = LoadBox.fromJson(original);
      final roundtripped = box.toJson();

      expect(roundtripped['id'], original['id']);
      expect(roundtripped['label'], original['label']);
      expect(roundtripped['weight'], original['weight']);
      expect(roundtripped['x'], closeTo(original['x']! as double, 0.001));
    });

    test('fromJson handles int values for double fields', () {
      final json = {
        'id': 1,
        'label': 'T',
        'orderNumber': 1,
        'clientCode': 'C',
        'articleCode': 'A',
        'weight': 5, // int, not double
        'x': 10,
        'y': 20,
        'z': 0,
        'w': 40,
        'd': 30,
        'h': 25,
      };

      final box = LoadBox.fromJson(json);
      expect(box.weight, 5.0);
      expect(box.x, 10.0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TRUCK DIMENSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  group('TruckDimensions', () {
    test('should parse from vehicle config JSON', () {
      final json = {
        'code': 'V001',
        'description': 'Camión grande',
        'interior': {
          'lengthCm': 700.0,
          'widthCm': 250.0,
          'heightCm': 240.0,
        },
        'maxPayloadKg': 8000.0,
        'tolerancePct': 10.0,
      };

      final truck = TruckDimensions.fromVehicleConfig(json);

      expect(truck.code, 'V001');
      expect(truck.description, 'Camión grande');
      expect(truck.lengthCm, 700.0);
      expect(truck.widthCm, 250.0);
      expect(truck.heightCm, 240.0);
      expect(truck.maxPayloadKg, 8000.0);
      expect(truck.tolerancePct, 10.0);
    });

    test('should use defaults for empty JSON', () {
      final truck = TruckDimensions.fromVehicleConfig(<String, dynamic>{});

      expect(truck.code, '');
      expect(truck.lengthCm, 600.0);
      expect(truck.widthCm, 240.0);
      expect(truck.heightCm, 220.0);
      expect(truck.maxPayloadKg, 6000.0);
      expect(truck.tolerancePct, 5.0);
    });

    test('volumeCm3 should be L * W * H', () {
      const truck = TruckDimensions(
        code: 'T1',
        description: 'Test',
        lengthCm: 600,
        widthCm: 240,
        heightCm: 220,
        maxPayloadKg: 5000,
      );

      expect(truck.volumeCm3, 600 * 240 * 220);
    });

    test('volumeM3 should convert from cm3', () {
      const truck = TruckDimensions(
        code: 'T2',
        description: 'Test',
        lengthCm: 100,
        widthCm: 100,
        heightCm: 100,
        maxPayloadKg: 1000,
      );

      expect(truck.volumeM3, 1.0); // 100*100*100 / 1e6
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANNER METRICS
  // ═══════════════════════════════════════════════════════════════════════════

  group('PlannerMetrics', () {
    const truck = TruckDimensions(
      code: 'T',
      description: 'Test',
      lengthCm: 600,
      widthCm: 240,
      heightCm: 220,
      maxPayloadKg: 6000,
    );

    LoadBox makeBox({
      int id = 1,
      double weight = 10,
      double w = 40,
      double d = 30,
      double h = 25,
    }) =>
        LoadBox(
          id: id,
          label: 'B$id',
          orderNumber: 1,
          clientCode: 'C',
          articleCode: 'A',
          weight: weight,
          x: 0,
          y: 0,
          z: 0,
          w: w,
          d: d,
          h: h,
        );

    test('fromBoxes computes volume and weight correctly', () {
      final placed = [
        makeBox(weight: 100, w: 100, d: 100, h: 100),
        makeBox(id: 2, weight: 50, w: 50, d: 50, h: 50),
      ];

      final metrics = PlannerMetrics.fromBoxes(
        placed: placed,
        overflow: [],
        truck: truck,
      );

      expect(metrics.placedCount, 2);
      expect(metrics.overflowCount, 0);
      expect(metrics.totalBoxes, 2);
      expect(metrics.totalWeightKg, 150.0);
      expect(metrics.usedVolumeCm3, 1000000 + 125000);
    });

    test('status is EXCESO when there is overflow', () {
      final metrics = PlannerMetrics.fromBoxes(
        placed: [makeBox()],
        overflow: [makeBox(id: 2, weight: 20)],
        truck: truck,
      );

      expect(metrics.status, LoadStatus.exceso);
      expect(metrics.overflowCount, 1);
      expect(metrics.overflowWeightKg, 20.0);
    });

    test('status is OPTIMO when volume >= 90%', () {
      // Truck vol = 600*240*220 = 31,680,000 cm3
      // Need a box that's >= 90% of that
      final bigBox = makeBox(
        w: 600,
        d: 240,
        h: 200, // 28,800,000 → 90.9%
      );

      final metrics = PlannerMetrics.fromBoxes(
        placed: [bigBox],
        overflow: [],
        truck: truck,
      );

      expect(metrics.status, LoadStatus.optimo);
    });

    test('status is OPTIMO when weight >= 90%', () {
      final heavyBox = makeBox(weight: 5500); // 91.7% of 6000

      final metrics = PlannerMetrics.fromBoxes(
        placed: [heavyBox],
        overflow: [],
        truck: truck,
      );

      expect(metrics.status, LoadStatus.optimo);
    });

    test('status is SEGURO when below 90%', () {
      final smallBox = makeBox(weight: 100);

      final metrics = PlannerMetrics.fromBoxes(
        placed: [smallBox],
        overflow: [],
        truck: truck,
      );

      expect(metrics.status, LoadStatus.seguro);
    });

    test('fromJson parses status string correctly', () {
      final m1 = PlannerMetrics.fromJson({'status': 'EXCESO'});
      expect(m1.status, LoadStatus.exceso);

      final m2 = PlannerMetrics.fromJson({'status': 'OPTIMO'});
      expect(m2.status, LoadStatus.optimo);

      final m3 = PlannerMetrics.fromJson({'status': 'SEGURO'});
      expect(m3.status, LoadStatus.seguro);

      final m4 = PlannerMetrics.fromJson({'status': 'unknown'});
      expect(m4.status, LoadStatus.seguro); // default
    });

    test('fromJson accepts both volumeOccupancyPct and volumePct', () {
      final m1 =
          PlannerMetrics.fromJson({'volumeOccupancyPct': 85.5});
      expect(m1.volumePct, 85.5);

      final m2 = PlannerMetrics.fromJson({'volumePct': 75.0});
      expect(m2.volumePct, 75.0);
    });

    test('toJson produces correct output', () {
      final metrics = PlannerMetrics.fromBoxes(
        placed: [makeBox(weight: 100)],
        overflow: [],
        truck: truck,
      );

      final json = metrics.toJson();

      expect(json['placedCount'], 1);
      expect(json['totalWeightKg'], 100.0);
      expect(json['status'], 'SEGURO');
    });

    test('handles zero-volume truck without division error', () {
      const zeroTruck = TruckDimensions(
        code: 'Z',
        description: 'Zero',
        lengthCm: 0,
        widthCm: 0,
        heightCm: 0,
        maxPayloadKg: 0,
      );

      final metrics = PlannerMetrics.fromBoxes(
        placed: [makeBox()],
        overflow: [],
        truck: zeroTruck,
      );

      expect(metrics.volumePct, 0.0);
      expect(metrics.weightPct, 0.0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG STATE
  // ═══════════════════════════════════════════════════════════════════════════

  group('DragState', () {
    test('copyWith updates hasCollision', () {
      const state = DragState(
        boxIndex: 0,
        startX: 10,
        startY: 20,
        startZ: 0,
      );

      final updated = state.copyWith(hasCollision: true);

      expect(updated.hasCollision, true);
      expect(updated.boxIndex, 0);
      expect(updated.startX, 10);
    });

    test('default hasCollision is false', () {
      const state = DragState(
        boxIndex: 5,
        startX: 0,
        startY: 0,
        startZ: 0,
      );

      expect(state.hasCollision, false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUAL LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════

  group('ManualLayout', () {
    test('fromJson parses complete layout', () {
      final json = {
        'id': 7,
        'vehicleCode': 'V001',
        'date': '2026-03-02',
        'boxes': [
          {
            'id': 1,
            'label': 'B1',
            'orderNumber': 100,
            'clientCode': 'C1',
            'articleCode': 'A1',
            'weight': 10.0,
            'x': 0,
            'y': 0,
            'z': 0,
            'w': 40,
            'd': 30,
            'h': 25,
          },
        ],
        'excludedOrders': [200, 300],
        'metrics': {'totalBoxes': 1},
      };

      final layout = ManualLayout.fromJson(json);

      expect(layout.id, 7);
      expect(layout.vehicleCode, 'V001');
      expect(layout.date, '2026-03-02');
      expect(layout.boxes.length, 1);
      expect(layout.boxes[0].id, 1);
      expect(layout.excludedOrders, [200, 300]);
      expect(layout.metrics['totalBoxes'], 1);
    });

    test('fromJson handles empty JSON', () {
      final layout = ManualLayout.fromJson(<String, dynamic>{});

      expect(layout.id, isNull);
      expect(layout.vehicleCode, '');
      expect(layout.boxes, isEmpty);
      expect(layout.excludedOrders, isEmpty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  group('ClientSummary', () {
    test('stores aggregated values', () {
      const summary = ClientSummary(
        clientCode: 'C001',
        boxCount: 5,
        totalWeight: 150,
        totalVolume: 75000,
      );

      expect(summary.clientCode, 'C001');
      expect(summary.boxCount, 5);
      expect(summary.totalWeight, 150.0);
      expect(summary.totalVolume, 75000.0);
    });
  });
}
