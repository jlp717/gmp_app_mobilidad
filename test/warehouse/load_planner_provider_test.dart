import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/warehouse/application/load_planner_provider.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

void main() {
  late ProviderContainer container;
  late LoadPlannerProvider notifier;

  LoadPlannerState get state => container.read(loadPlannerProvider);

  setUp(() {
    container = ProviderContainer();
    notifier = container.read(loadPlannerProvider.notifier);
  });

  tearDown(() {
    container.dispose();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIAL STATE
  // ═══════════════════════════════════════════════════════════════════════════

  group('Initial state', () {
    test('has empty collections and defaults', () {
      expect(state.placedBoxes, isEmpty);
      expect(state.overflowBoxes, isEmpty);
      expect(state.metrics, isNull);
      expect(state.truck, isNull);
      expect(state.viewMode, ViewMode.perspective);
      expect(state.colorMode, ColorMode.product);
      expect(state.selectedBoxIndex, isNull);
      expect(state.dragState, isNull);
      expect(state.isLoading, false);
      expect(state.error, isNull);
      expect(state.saveState, SaveState.saved);
      expect(state.hasManualChanges, false);
      expect(state.canUndo, false);
      expect(state.canRedo, false);
      expect(state.excludedOrders, isEmpty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BOX SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  group('Box selection', () {
    test('selectBox sets index and notifies', () {
      var notifyCount = 0;
      container.listen(
        loadPlannerProvider,
        (_, __) => notifyCount++,
      );
      notifier.selectBox(3);

      expect(state.selectedBoxIndex, 3);
      expect(notifyCount, 1);
    });

    test('selectBox with null clears selection', () {
      notifier
        ..selectBox(5)
        ..selectBox(null);

      expect(state.selectedBoxIndex, isNull);
    });

    test('clearSelection clears selected index', () {
      notifier
        ..selectBox(2)
        ..clearSelection();

      expect(state.selectedBoxIndex, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW / COLOR MODE
  // ═══════════════════════════════════════════════════════════════════════════

  group('View mode', () {
    test('setViewMode changes mode and notifies', () {
      var notifyCount = 0;
      container.listen(
        loadPlannerProvider,
        (_, __) => notifyCount++,
      );
      notifier.setViewMode(ViewMode.top);

      expect(state.viewMode, ViewMode.top);
      expect(notifyCount, 1);
    });

    test('setViewMode to front', () {
      notifier.setViewMode(ViewMode.front);
      expect(state.viewMode, ViewMode.front);
    });
  });

  group('Color mode', () {
    test('setColorMode changes mode and notifies', () {
      var notifyCount = 0;
      container.listen(
        loadPlannerProvider,
        (_, __) => notifyCount++,
      );
      notifier.setColorMode(ColorMode.client);

      expect(state.colorMode, ColorMode.client);
      expect(notifyCount, 1);
    });

    test('all color modes can be set', () {
      for (final mode in ColorMode.values) {
        notifier.setColorMode(mode);
        expect(state.colorMode, mode);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG — edge cases on empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Drag on empty state', () {
    test('startDrag with invalid index does nothing', () {
      notifier.startDrag(-1);
      expect(state.dragState, isNull);

      notifier.startDrag(0); // no boxes
      expect(state.dragState, isNull);

      notifier.startDrag(100);
      expect(state.dragState, isNull);
    });

    test('updateDragPosition does nothing without active drag', () {
      // Should not throw
      notifier.updateDragPosition(10, 20);
      expect(state.dragState, isNull);
    });

    test('endDrag does nothing without active drag', () {
      notifier.endDrag();
      expect(state.dragState, isNull);
    });

    test('cancelDrag does nothing without active drag', () {
      notifier.cancelDrag();
      expect(state.dragState, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT SUMMARIES — empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Client summaries', () {
    test('returns empty list when no boxes', () {
      expect(state.clientSummaries, isEmpty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO — empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Undo/Redo on empty state', () {
    test('undo does nothing when stack is empty', () {
      expect(state.canUndo, false);
      notifier.undo(); // should not throw
      expect(state.canUndo, false);
    });

    test('redo does nothing when stack is empty', () {
      expect(state.canRedo, false);
      notifier.redo(); // should not throw
      expect(state.canRedo, false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET — needs vehicleCode/date
  // ═══════════════════════════════════════════════════════════════════════════

  group('Reset without loaded plan', () {
    test('resetToAlgorithm does nothing if no vehicle loaded', () async {
      await notifier.resetToAlgorithm();
      expect(state.isLoading, false);
      expect(state.error, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE — needs vehicleCode/date
  // ═══════════════════════════════════════════════════════════════════════════

  group('Save without loaded plan', () {
    test('saveLayout does nothing if no vehicle loaded', () async {
      await notifier.saveLayout();
      expect(state.saveState, SaveState.saved);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPOSE
  // ═══════════════════════════════════════════════════════════════════════════

  group('Dispose', () {
    test('dispose does not throw', () {
      final c = ProviderContainer();
      expect(c.dispose, returnsNormally);
    });
  });
}
