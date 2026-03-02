import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/warehouse/application/load_planner_provider.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

/// Helper to inject state into provider without calling the API.
/// We use the public methods to manipulate state after manually
/// injecting boxes through the test helper extension.
extension _TestHelper on LoadPlannerProvider {
  /// Inject test state directly (bypassing API load).
  void injectTestState({
    required List<LoadBox> placed,
    List<LoadBox> overflow = const [],
    TruckDimensions? truck,
  }) {
    // Use the provider's public interface indirectly through reflection-like
    // approach. Since Dart doesn't have that, we test only through public API.
    // For unit testing the provider logic, we'll test the methods that
    // DON'T require API: selectBox, viewMode, colorMode, exclude/include,
    // undo/redo, drag operations.
    //
    // We rely on the fact that exclude/include/drag operate on internal lists
    // that we can populate by testing the flow end-to-end with mock.
    //
    // For now, test what we can through public API.
  }
}

void main() {
  late LoadPlannerProvider provider;

  LoadBox makeBox({
    int id = 1,
    int orderNumber = 100,
    String clientCode = 'C001',
    double weight = 10,
    double x = 0,
    double y = 0,
    double z = 0,
    double w = 40,
    double d = 30,
    double h = 25,
  }) =>
      LoadBox(
        id: id,
        label: 'Box$id',
        orderNumber: orderNumber,
        clientCode: clientCode,
        articleCode: 'ART',
        weight: weight,
        x: x,
        y: y,
        z: z,
        w: w,
        d: d,
        h: h,
      );

  setUp(() {
    provider = LoadPlannerProvider();
  });

  tearDown(() {
    provider.dispose();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIAL STATE
  // ═══════════════════════════════════════════════════════════════════════════

  group('Initial state', () {
    test('has empty collections and defaults', () {
      expect(provider.placedBoxes, isEmpty);
      expect(provider.overflowBoxes, isEmpty);
      expect(provider.metrics, isNull);
      expect(provider.truck, isNull);
      expect(provider.viewMode, ViewMode.perspective);
      expect(provider.colorMode, ColorMode.product);
      expect(provider.selectedBoxIndex, isNull);
      expect(provider.dragState, isNull);
      expect(provider.isLoading, false);
      expect(provider.error, isNull);
      expect(provider.saveState, SaveState.saved);
      expect(provider.hasManualChanges, false);
      expect(provider.canUndo, false);
      expect(provider.canRedo, false);
      expect(provider.excludedOrders, isEmpty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BOX SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  group('Box selection', () {
    test('selectBox sets index and notifies', () {
      int notifyCount = 0;
      provider.addListener(() => notifyCount++);

      provider.selectBox(3);

      expect(provider.selectedBoxIndex, 3);
      expect(notifyCount, 1);
    });

    test('selectBox with null clears selection', () {
      provider.selectBox(5);
      provider.selectBox(null);

      expect(provider.selectedBoxIndex, isNull);
    });

    test('clearSelection clears selected index', () {
      provider.selectBox(2);
      provider.clearSelection();

      expect(provider.selectedBoxIndex, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW / COLOR MODE
  // ═══════════════════════════════════════════════════════════════════════════

  group('View mode', () {
    test('setViewMode changes mode and notifies', () {
      int notifyCount = 0;
      provider.addListener(() => notifyCount++);

      provider.setViewMode(ViewMode.top);

      expect(provider.viewMode, ViewMode.top);
      expect(notifyCount, 1);
    });

    test('setViewMode to front', () {
      provider.setViewMode(ViewMode.front);
      expect(provider.viewMode, ViewMode.front);
    });
  });

  group('Color mode', () {
    test('setColorMode changes mode and notifies', () {
      int notifyCount = 0;
      provider.addListener(() => notifyCount++);

      provider.setColorMode(ColorMode.client);

      expect(provider.colorMode, ColorMode.client);
      expect(notifyCount, 1);
    });

    test('all color modes can be set', () {
      for (final mode in ColorMode.values) {
        provider.setColorMode(mode);
        expect(provider.colorMode, mode);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG — edge cases on empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Drag on empty state', () {
    test('startDrag with invalid index does nothing', () {
      provider.startDrag(-1);
      expect(provider.dragState, isNull);

      provider.startDrag(0); // no boxes
      expect(provider.dragState, isNull);

      provider.startDrag(100);
      expect(provider.dragState, isNull);
    });

    test('updateDragPosition does nothing without active drag', () {
      // Should not throw
      provider.updateDragPosition(10.0, 20.0);
      expect(provider.dragState, isNull);
    });

    test('endDrag does nothing without active drag', () {
      provider.endDrag();
      expect(provider.dragState, isNull);
    });

    test('cancelDrag does nothing without active drag', () {
      provider.cancelDrag();
      expect(provider.dragState, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT SUMMARIES — empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Client summaries', () {
    test('returns empty list when no boxes', () {
      expect(provider.clientSummaries, isEmpty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO — empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Undo/Redo on empty state', () {
    test('undo does nothing when stack is empty', () {
      expect(provider.canUndo, false);
      provider.undo(); // should not throw
      expect(provider.canUndo, false);
    });

    test('redo does nothing when stack is empty', () {
      expect(provider.canRedo, false);
      provider.redo(); // should not throw
      expect(provider.canRedo, false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET — needs vehicleCode/date
  // ═══════════════════════════════════════════════════════════════════════════

  group('Reset without loaded plan', () {
    test('resetToAlgorithm does nothing if no vehicle loaded', () async {
      await provider.resetToAlgorithm();
      expect(provider.isLoading, false);
      expect(provider.error, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE — needs vehicleCode/date
  // ═══════════════════════════════════════════════════════════════════════════

  group('Save without loaded plan', () {
    test('saveLayout does nothing if no vehicle loaded', () async {
      await provider.saveLayout();
      expect(provider.saveState, SaveState.saved);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPOSE
  // ═══════════════════════════════════════════════════════════════════════════

  group('Dispose', () {
    test('dispose does not throw', () {
      final p = LoadPlannerProvider();
      expect(() => p.dispose(), returnsNormally);
    });
  });
}
