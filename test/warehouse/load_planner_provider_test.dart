import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/warehouse/application/load_planner_provider.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

void main() {
  late ProviderContainer container;
  late LoadPlannerProvider notifier;

  // Getter local no permitido dentro de main(): funcion de lectura fresca.
  // (API real: NotifierProvider<LoadPlannerProvider, LoadPlannerState>.)
  LoadPlannerState readState() => container.read(loadPlannerProvider);

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
      expect(readState().placedBoxes, isEmpty);
      expect(readState().overflowBoxes, isEmpty);
      expect(readState().metrics, isNull);
      expect(readState().truck, isNull);
      expect(readState().viewMode, ViewMode.perspective);
      expect(readState().colorMode, ColorMode.product);
      expect(readState().selectedBoxIndex, isNull);
      expect(readState().dragState, isNull);
      expect(readState().isLoading, false);
      expect(readState().error, isNull);
      expect(readState().saveState, SaveState.saved);
      expect(readState().hasManualChanges, false);
      expect(readState().canUndo, false);
      expect(readState().canRedo, false);
      expect(readState().excludedOrders, isEmpty);
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

      expect(readState().selectedBoxIndex, 3);
      expect(notifyCount, 1);
    });

    test('selectBox with null clears selection', () {
      notifier
        ..selectBox(5)
        ..selectBox(null);

      expect(readState().selectedBoxIndex, isNull);
    });

    test('clearSelection clears selected index', () {
      notifier
        ..selectBox(2)
        ..clearSelection();

      expect(readState().selectedBoxIndex, isNull);
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

      expect(readState().viewMode, ViewMode.top);
      expect(notifyCount, 1);
    });

    test('setViewMode to front', () {
      notifier.setViewMode(ViewMode.front);
      expect(readState().viewMode, ViewMode.front);
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

      expect(readState().colorMode, ColorMode.client);
      expect(notifyCount, 1);
    });

    test('all color modes can be set', () {
      for (final mode in ColorMode.values) {
        notifier.setColorMode(mode);
        expect(readState().colorMode, mode);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG — edge cases on empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Drag on empty state', () {
    test('startDrag with invalid index does nothing', () {
      notifier.startDrag(-1);
      expect(readState().dragState, isNull);

      notifier.startDrag(0); // no boxes
      expect(readState().dragState, isNull);

      notifier.startDrag(100);
      expect(readState().dragState, isNull);
    });

    test('updateDragPosition does nothing without active drag', () {
      // Should not throw
      notifier.updateDragPosition(10, 20);
      expect(readState().dragState, isNull);
    });

    test('endDrag does nothing without active drag', () {
      notifier.endDrag();
      expect(readState().dragState, isNull);
    });

    test('cancelDrag does nothing without active drag', () {
      notifier.cancelDrag();
      expect(readState().dragState, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT SUMMARIES — empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Client summaries', () {
    test('returns empty list when no boxes', () {
      expect(readState().clientSummaries, isEmpty);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO — empty state
  // ═══════════════════════════════════════════════════════════════════════════

  group('Undo/Redo on empty state', () {
    test('undo does nothing when stack is empty', () {
      expect(readState().canUndo, false);
      notifier.undo(); // should not throw
      expect(readState().canUndo, false);
    });

    test('redo does nothing when stack is empty', () {
      expect(readState().canRedo, false);
      notifier.redo(); // should not throw
      expect(readState().canRedo, false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET — needs vehicleCode/date
  // ═══════════════════════════════════════════════════════════════════════════

  group('Reset without loaded plan', () {
    test('resetToAlgorithm does nothing if no vehicle loaded', () async {
      await notifier.resetToAlgorithm();
      expect(readState().isLoading, false);
      expect(readState().error, isNull);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE — needs vehicleCode/date
  // ═══════════════════════════════════════════════════════════════════════════

  group('Save without loaded plan', () {
    test('saveLayout does nothing if no vehicle loaded', () async {
      await notifier.saveLayout();
      expect(readState().saveState, SaveState.saved);
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
