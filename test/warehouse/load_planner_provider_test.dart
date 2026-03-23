import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/warehouse/application/load_planner_provider.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

void main() {
  late LoadPlannerProvider provider;

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
      var notifyCount = 0;
      provider
        ..addListener(() => notifyCount++)
        ..selectBox(3);

      expect(provider.selectedBoxIndex, 3);
      expect(notifyCount, 1);
    });

    test('selectBox with null clears selection', () {
      provider
        ..selectBox(5)
        ..selectBox(null);

      expect(provider.selectedBoxIndex, isNull);
    });

    test('clearSelection clears selected index', () {
      provider
        ..selectBox(2)
        ..clearSelection();

      expect(provider.selectedBoxIndex, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW / COLOR MODE
  // ═══════════════════════════════════════════════════════════════════════════

  group('View mode', () {
    test('setViewMode changes mode and notifies', () {
      var notifyCount = 0;
      provider
        ..addListener(() => notifyCount++)
        ..setViewMode(ViewMode.top);

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
      var notifyCount = 0;
      provider
        ..addListener(() => notifyCount++)
        ..setColorMode(ColorMode.client);

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
      provider.updateDragPosition(10, 20);
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
      expect(p.dispose, returnsNormally);
    });
  });
}
