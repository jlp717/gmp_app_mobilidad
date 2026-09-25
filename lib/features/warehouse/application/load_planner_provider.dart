import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:gmp_app_mobilidad/features/warehouse/data/warehouse_data_service.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

/// Riverpod provider for LoadPlanner (Notifier v2 — single source of truth).
final loadPlannerProvider =
    NotifierProvider<LoadPlannerProvider, LoadPlannerState>(
  LoadPlannerProvider.new,
);

/// Immutable UI state for Load Planner V2.
///
/// The notifier owns the undo/redo stacks, the autosave [Timer] and the
/// current vehicle/date context (not part of the rebuildable state).
class LoadPlannerState {
  const LoadPlannerState({
    this.placedBoxes = const [],
    this.overflowBoxes = const [],
    this.metrics,
    this.truck,
    this.viewMode = ViewMode.perspective,
    this.colorMode = ColorMode.product,
    this.selectedBoxIndex,
    this.dragState,
    this.isLoading = false,
    this.error,
    this.saveState = SaveState.saved,
    this.hasManualChanges = false,
    this.excludedOrders = const {},
    this.isOptimizing = false,
    this.canUndo = false,
    this.canRedo = false,
  });

  final List<LoadBox> placedBoxes;
  final List<LoadBox> overflowBoxes;
  final PlannerMetrics? metrics;
  final TruckDimensions? truck;

  final ViewMode viewMode;
  final ColorMode colorMode;
  final int? selectedBoxIndex;
  final DragState? dragState;

  final bool isLoading;
  final String? error;

  final SaveState saveState;
  final bool hasManualChanges;
  final Set<int> excludedOrders;
  final bool isOptimizing;
  final bool canUndo;
  final bool canRedo;

  LoadPlannerState copyWith({
    List<LoadBox>? placedBoxes,
    List<LoadBox>? overflowBoxes,
    PlannerMetrics? metrics,
    TruckDimensions? truck,
    ViewMode? viewMode,
    ColorMode? colorMode,
    int? selectedBoxIndex,
    bool clearSelectedBox = false,
    DragState? dragState,
    bool clearDragState = false,
    bool? isLoading,
    String? error,
    bool clearError = false,
    SaveState? saveState,
    bool? hasManualChanges,
    Set<int>? excludedOrders,
    bool? isOptimizing,
    bool? canUndo,
    bool? canRedo,
  }) {
    return LoadPlannerState(
      placedBoxes: placedBoxes ?? this.placedBoxes,
      overflowBoxes: overflowBoxes ?? this.overflowBoxes,
      metrics: metrics ?? this.metrics,
      truck: truck ?? this.truck,
      viewMode: viewMode ?? this.viewMode,
      colorMode: colorMode ?? this.colorMode,
      selectedBoxIndex:
          clearSelectedBox ? null : (selectedBoxIndex ?? this.selectedBoxIndex),
      dragState: clearDragState ? null : (dragState ?? this.dragState),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      saveState: saveState ?? this.saveState,
      hasManualChanges: hasManualChanges ?? this.hasManualChanges,
      excludedOrders: excludedOrders ?? this.excludedOrders,
      isOptimizing: isOptimizing ?? this.isOptimizing,
      canUndo: canUndo ?? this.canUndo,
      canRedo: canRedo ?? this.canRedo,
    );
  }

  bool isOrderExcluded(int orderNumber) =>
      excludedOrders.contains(orderNumber);

  /// Unique client codes from placed boxes
  List<ClientSummary> get clientSummaries {
    final map = <String, _ClientAcc>{};
    for (final b in placedBoxes) {
      final acc = map.putIfAbsent(b.clientCode, _ClientAcc.new);
      acc.count++;
      acc.weight += b.weight;
      acc.volume += b.volume;
    }
    return map.entries
        .map(
          (e) => ClientSummary(
            clientCode: e.key,
            boxCount: e.value.count,
            totalWeight: e.value.weight,
            totalVolume: e.value.volume,
          ),
        )
        .toList()
      ..sort((a, b) => b.totalWeight.compareTo(a.totalWeight));
  }
}

/// Central state manager for Load Planner V2.
///
/// Handles: loading plans, drag-and-drop of boxes, collision detection,
/// exclude/include orders, undo/redo, auto-save of manual layouts.
class LoadPlannerProvider extends Notifier<LoadPlannerState> {
  // Undo / Redo (owned by the notifier, mirrored as flags in state)
  final List<_Snapshot> _undoStack = [];
  final List<_Snapshot> _redoStack = [];
  static const int _maxUndoSteps = 30;

  // Non-rebuildable context
  Timer? _autoSaveTimer;
  String? _vehicleCode;
  DateTime? _date;

  @override
  LoadPlannerState build() {
    ref.onDispose(() => _autoSaveTimer?.cancel());
    return const LoadPlannerState();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD PLAN
  // ═══════════════════════════════════════════════════════════════════════════

  /// Load plan for vehicle + date. Checks for saved manual layout first.
  Future<void> loadPlan({
    required String vehicleCode,
    required DateTime date,
    bool forceRefresh = false,
  }) async {
    _vehicleCode = vehicleCode;
    _date = date;
    _undoStack.clear();
    _redoStack.clear();
    state = state.copyWith(
      isLoading: true,
      clearError: true,
      excludedOrders: {},
      canUndo: false,
      canRedo: false,
    );

    try {
      // 1. Check for saved manual layout (non-fatal — if it fails, treat as null)
      final dateStr =
          '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
      Map<String, dynamic>? savedLayout;
      try {
        savedLayout = await WarehouseDataService.getManualLayout(
          vehicleCode: vehicleCode,
          date: dateStr,
          forceRefresh: forceRefresh,
        );
      } catch (e) {
        debugPrint('Manual layout fetch failed (non-fatal): $e');
        savedLayout = null;
      }

      if (savedLayout != null) {
        // Restore from saved layout
        final layout = ManualLayout.fromJson(savedLayout);
        var placedBoxes = layout.boxes;
        final excludedOrders = Set<int>.from(layout.excludedOrders);

        // Still need truck dimensions from API
        final result = await WarehouseDataService.planLoad(
          vehicleCode: vehicleCode,
          year: date.year,
          month: date.month,
          day: date.day,
        );
        final truck = TruckDimensions.fromVehicleConfig(
          result.truck != null
              ? {
                  'code': result.truck!.code,
                  'description': result.truck!.description,
                  'interior': {
                    'lengthCm': result.truck!.interior.lengthCm,
                    'widthCm': result.truck!.interior.widthCm,
                    'heightCm': result.truck!.interior.heightCm,
                  },
                  'maxPayloadKg': result.truck!.maxPayloadKg,
                  'tolerancePct': result.truck!.tolerancePct,
                }
              : {},
        );

        // Reconcile: check if saved boxes still match current orders
        final freshBoxIds = result.placed.map((b) => b.id).toSet()
          ..addAll(result.overflow.map((b) => b.id));
        placedBoxes =
            placedBoxes.where((b) => freshBoxIds.contains(b.id)).toList();

        // Add any NEW boxes from fresh plan that aren't in the saved layout
        final savedIds = placedBoxes.map((b) => b.id).toSet();
        for (final freshBox in result.placed) {
          if (!savedIds.contains(freshBox.id)) {
            placedBoxes.add(
              LoadBox.fromJson({
                'id': freshBox.id,
                'label': freshBox.label,
                'orderNumber': freshBox.orderNumber,
                'clientCode': freshBox.clientCode,
                'articleCode': freshBox.articleCode,
                'weight': freshBox.weight,
                'x': freshBox.x,
                'y': freshBox.y,
                'z': freshBox.z,
                'w': freshBox.w,
                'd': freshBox.d,
                'h': freshBox.h,
              }),
            );
          }
        }

        final overflowBoxes = result.overflow
            .map(
              (b) => LoadBox.fromJson({
                'id': b.id,
                'label': b.label,
                'orderNumber': b.orderNumber,
                'clientCode': b.clientCode,
                'articleCode': b.articleCode,
                'weight': b.weight,
                'x': b.x,
                'y': b.y,
                'z': b.z,
                'w': b.w,
                'd': b.d,
                'h': b.h,
              }),
            )
            .toList();

        state = state.copyWith(
          placedBoxes: placedBoxes,
          overflowBoxes: overflowBoxes,
          excludedOrders: excludedOrders,
          truck: truck,
          metrics: _metricsFor(placedBoxes, overflowBoxes, truck),
          saveState: SaveState.saved,
          hasManualChanges: true,
        );
      } else {
        // Fresh plan from algorithm
        _applyFreshPlan(await _fetchFreshPlan(vehicleCode, date));
        state = state.copyWith(
          saveState: SaveState.saved,
          hasManualChanges: false,
        );
      }
    } catch (e, stack) {
      debugPrint('[LoadPlanner] ERROR loading plan: $e');
      debugPrint('[LoadPlanner] Stack: $stack');
      state = state.copyWith(error: e.toString());
    } finally {
      state = state.copyWith(isLoading: false);
    }
  }

  Future<LoadPlanResult> _fetchFreshPlan(
    String vehicleCode,
    DateTime date,
  ) {
    return WarehouseDataService.planLoad(
      vehicleCode: vehicleCode,
      year: date.year,
      month: date.month,
      day: date.day,
    );
  }

  void _applyFreshPlan(LoadPlanResult result) {
    final truck = TruckDimensions.fromVehicleConfig(
      result.truck != null
          ? {
              'code': result.truck!.code,
              'description': result.truck!.description,
              'interior': {
                'lengthCm': result.truck!.interior.lengthCm,
                'widthCm': result.truck!.interior.widthCm,
                'heightCm': result.truck!.interior.heightCm,
              },
              'maxPayloadKg': result.truck!.maxPayloadKg,
              'tolerancePct': result.truck!.tolerancePct,
            }
          : {},
    );

    final placedBoxes = result.placed
        .map(
          (b) => LoadBox(
            id: b.id,
            label: b.label,
            orderNumber: b.orderNumber,
            clientCode: b.clientCode,
            articleCode: b.articleCode,
            weight: b.weight,
            x: b.x,
            y: b.y,
            z: b.z,
            w: b.w,
            d: b.d,
            h: b.h,
          ),
        )
        .toList();

    final overflowBoxes = result.overflow
        .map(
          (b) => LoadBox(
            id: b.id,
            label: b.label,
            orderNumber: b.orderNumber,
            clientCode: b.clientCode,
            articleCode: b.articleCode,
            weight: b.weight,
            x: b.x,
            y: b.y,
            z: b.z,
            w: b.w,
            d: b.d,
            h: b.h,
          ),
        )
        .toList();

    state = state.copyWith(
      truck: truck,
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      metrics: PlannerMetrics.fromJson({
        'totalBoxes': result.metrics.totalBoxes,
        'placedCount': result.metrics.placedCount,
        'overflowCount': result.metrics.overflowCount,
        'containerVolumeCm3': result.metrics.containerVolumeCm3,
        'usedVolumeCm3': result.metrics.usedVolumeCm3,
        'volumeOccupancyPct': result.metrics.volumeOccupancyPct,
        'totalWeightKg': result.metrics.totalWeightKg,
        'overflowWeightKg': result.metrics.overflowWeightKg,
        'maxPayloadKg': result.metrics.maxPayloadKg,
        'weightOccupancyPct': result.metrics.weightOccupancyPct,
        'status': result.metrics.status,
      }),
    );
  }

  /// Reset to algorithm-computed layout, discarding manual changes
  Future<void> resetToAlgorithm() async {
    final vehicleCode = _vehicleCode;
    final date = _date;
    if (vehicleCode == null || date == null) return;
    _pushUndo();
    state = state.copyWith(
      excludedOrders: {},
      hasManualChanges: false,
      isLoading: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );

    try {
      _applyFreshPlan(await _fetchFreshPlan(vehicleCode, date));
      state = state.copyWith(saveState: SaveState.saved);
    } catch (e) {
      state = state.copyWith(error: e.toString());
    } finally {
      state = state.copyWith(isLoading: false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFIT OPTIMIZER
  // ═══════════════════════════════════════════════════════════════════════════

  /// Run profit optimizer: exclude orders the algorithm says to exclude,
  /// include ones it says to include.
  Future<void> runProfitOptimizer() async {
    final vehicleCode = _vehicleCode;
    final date = _date;
    if (vehicleCode == null || date == null) return;
    state = state.copyWith(isOptimizing: true);

    try {
      final result = await WarehouseDataService.optimizeLoad(
        vehicleCode: vehicleCode,
        year: date.year,
        month: date.month,
        day: date.day,
      );

      final excludedSet =
          (result['excluded'] as List?)?.cast<int>().toSet() ?? {};
      final includedSet =
          (result['included'] as List?)?.cast<int>().toSet() ?? {};

      if (excludedSet.isEmpty && includedSet.isEmpty) {
        state = state.copyWith(isOptimizing: false);
        return;
      }

      _pushUndo();

      final placedBoxes = List<LoadBox>.from(state.placedBoxes);
      final overflowBoxes = List<LoadBox>.from(state.overflowBoxes);
      final excludedOrders = Set<int>.from(state.excludedOrders);

      // Move excluded orders from placed to overflow
      final toExclude = <LoadBox>[];
      placedBoxes.removeWhere((b) {
        if (excludedSet.contains(b.orderNumber)) {
          toExclude.add(b);
          return true;
        }
        return false;
      });
      overflowBoxes.addAll(toExclude);
      excludedOrders.addAll(excludedSet);

      // Move included orders from overflow to placed
      final toInclude = <LoadBox>[];
      overflowBoxes.removeWhere((b) {
        if (includedSet.contains(b.orderNumber)) {
          toInclude.add(b);
          return true;
        }
        return false;
      });
      placedBoxes.addAll(toInclude);
      excludedOrders.removeAll(includedSet);

      state = state.copyWith(
        placedBoxes: placedBoxes,
        overflowBoxes: overflowBoxes,
        excludedOrders: excludedOrders,
        hasManualChanges: true,
        canUndo: _undoStack.isNotEmpty,
        canRedo: false,
      );
      _recalculateMetrics();
      _scheduleAutoSave();
    } catch (e) {
      debugPrint('[LoadPlanner] Optimizer error: $e');
      state = state.copyWith(error: 'Error al optimizar: $e');
    } finally {
      state = state.copyWith(isOptimizing: false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOX SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  void selectBox(int? index) {
    state = state.copyWith(
      selectedBoxIndex: index,
      clearSelectedBox: index == null,
    );
  }

  void clearSelection() {
    state = state.copyWith(clearSelectedBox: true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW / COLOR MODE
  // ═══════════════════════════════════════════════════════════════════════════

  void setViewMode(ViewMode mode) {
    state = state.copyWith(viewMode: mode);
  }

  void setColorMode(ColorMode mode) {
    state = state.copyWith(colorMode: mode);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG AND DROP — Move boxes within the 3D space
  // ═══════════════════════════════════════════════════════════════════════════

  void startDrag(int boxIndex) {
    if (boxIndex < 0 || boxIndex >= state.placedBoxes.length) return;
    final box = state.placedBoxes[boxIndex];
    state = state.copyWith(
      dragState: DragState(
        boxIndex: boxIndex,
        startX: box.x,
        startY: box.y,
        startZ: box.z,
      ),
      selectedBoxIndex: boxIndex,
    );
  }

  /// Update dragged box position (in truck 3D coordinates)
  void updateDragPosition(double newX, double newY) {
    final dragState = state.dragState;
    final truck = state.truck;
    if (dragState == null || truck == null) return;
    final idx = dragState.boxIndex;
    final box = state.placedBoxes[idx];

    // Clamp to truck interior bounds
    final clampedX = newX.clamp(0.0, truck.lengthCm - box.w);
    final clampedY = newY.clamp(0.0, truck.widthCm - box.d);

    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    placedBoxes[idx] = box.copyWith(x: clampedX, y: clampedY);

    // Check collisions
    final collision = _hasCollision(placedBoxes, idx);
    state = state.copyWith(
      placedBoxes: placedBoxes,
      dragState: collision != dragState.hasCollision
          ? dragState.copyWith(hasCollision: collision)
          : dragState,
    );
  }

  /// Finalize drag: if valid position, keep; if collision, revert.
  void endDrag() {
    final dragState = state.dragState;
    if (dragState == null) return;
    final idx = dragState.boxIndex;

    if (dragState.hasCollision) {
      // Revert to original position
      final placedBoxes = List<LoadBox>.from(state.placedBoxes);
      placedBoxes[idx] = placedBoxes[idx].copyWith(
        x: dragState.startX,
        y: dragState.startY,
        z: dragState.startZ,
      );
      state = state.copyWith(
        placedBoxes: placedBoxes,
        clearDragState: true,
      );
    } else {
      // Keep new position — push undo and mark dirty
      _pushUndo();
      state = state.copyWith(
        clearDragState: true,
        hasManualChanges: true,
        canUndo: _undoStack.isNotEmpty,
        canRedo: false,
      );
      _recalculateMetrics();
      _scheduleAutoSave();
    }
  }

  /// Cancel drag without applying
  void cancelDrag() {
    final dragState = state.dragState;
    if (dragState == null) return;
    final idx = dragState.boxIndex;
    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    placedBoxes[idx] = placedBoxes[idx].copyWith(
      x: dragState.startX,
      y: dragState.startY,
      z: dragState.startZ,
    );
    state = state.copyWith(
      placedBoxes: placedBoxes,
      clearDragState: true,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JS ENGINE UPDATES — gravity settle & repack results
  // ═══════════════════════════════════════════════════════════════════════════

  /// Apply positions settled by the JS gravity engine.
  /// Matches boxes by ID and updates their z position silently
  /// (cosmetic only: no undo push, no auto-save).
  void applySettledPositions(List<Map<String, dynamic>> settledBoxes) {
    if (settledBoxes.isEmpty) return;
    final idToPos = <int, Map<String, dynamic>>{};
    for (final s in settledBoxes) {
      final id = (s['id'] as num?)?.toInt();
      if (id != null) idToPos[id] = s;
    }
    var changed = false;
    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    for (var i = 0; i < placedBoxes.length; i++) {
      final pos = idToPos[placedBoxes[i].id];
      if (pos == null) continue;
      final newZ = (pos['z'] as num?)?.toDouble();
      if (newZ != null && (newZ - placedBoxes[i].z).abs() > 0.01) {
        placedBoxes[i] = placedBoxes[i].copyWith(z: newZ);
        changed = true;
      }
    }
    if (changed) {
      final truck = state.truck;
      state = state.copyWith(
        placedBoxes: placedBoxes,
        metrics: truck == null
            ? state.metrics
            : _metricsFor(placedBoxes, state.overflowBoxes, truck),
      );
      // Don't schedule auto-save for gravity settle (cosmetic only)
    }
  }

  /// Apply the result of JS client-side bin packing.
  void applyRepackResult(
    List<Map<String, dynamic>> placedJson,
    List<Map<String, dynamic>> overflowJson,
  ) {
    _pushUndo();

    // Build ID → new position map
    final idToNew = <int, Map<String, dynamic>>{};
    for (final p in placedJson) {
      final id = (p['id'] as num?)?.toInt();
      if (id != null) idToNew[id] = p;
    }
    final overflowIds = <int>{};
    for (final o in overflowJson) {
      final id = (o['id'] as num?)?.toInt();
      if (id != null) overflowIds.add(id);
    }

    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    final overflowBoxes = List<LoadBox>.from(state.overflowBoxes);
    final excludedOrders = Set<int>.from(state.excludedOrders);

    // Update placed box positions
    for (var i = 0; i < placedBoxes.length; i++) {
      final pos = idToNew[placedBoxes[i].id];
      if (pos != null) {
        placedBoxes[i] = placedBoxes[i].copyWith(
          x: (pos['x'] as num?)?.toDouble() ?? placedBoxes[i].x,
          y: (pos['y'] as num?)?.toDouble() ?? placedBoxes[i].y,
          z: (pos['z'] as num?)?.toDouble() ?? placedBoxes[i].z,
          w: (pos['w'] as num?)?.toDouble() ?? placedBoxes[i].w,
          d: (pos['d'] as num?)?.toDouble() ?? placedBoxes[i].d,
          h: (pos['h'] as num?)?.toDouble() ?? placedBoxes[i].h,
        );
      }
    }

    // Move overflow boxes
    if (overflowIds.isNotEmpty) {
      final toMove = <LoadBox>[];
      placedBoxes.removeWhere((b) {
        if (overflowIds.contains(b.id)) {
          toMove.add(b);
          excludedOrders.add(b.orderNumber);
          return true;
        }
        return false;
      });
      overflowBoxes.addAll(toMove);
    }

    state = state.copyWith(
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      excludedOrders: excludedOrders,
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXCLUDE / INCLUDE ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  void excludeOrder(int orderNumber) {
    _pushUndo();
    final excludedOrders = Set<int>.from(state.excludedOrders)
      ..add(orderNumber);

    // Move matching boxes from placed to overflow
    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    final overflowBoxes = List<LoadBox>.from(state.overflowBoxes);
    final toMove = <LoadBox>[];
    placedBoxes.removeWhere((b) {
      if (b.orderNumber == orderNumber) {
        toMove.add(b);
        return true;
      }
      return false;
    });
    overflowBoxes.addAll(toMove);

    state = state.copyWith(
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      excludedOrders: excludedOrders,
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  void includeOrder(int orderNumber) {
    _pushUndo();
    final excludedOrders = Set<int>.from(state.excludedOrders)
      ..remove(orderNumber);

    // Move matching boxes from overflow back to placed
    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    final overflowBoxes = List<LoadBox>.from(state.overflowBoxes);
    final toRestore = <LoadBox>[];
    overflowBoxes.removeWhere((b) {
      if (b.orderNumber == orderNumber) {
        toRestore.add(b);
        return true;
      }
      return false;
    });
    placedBoxes.addAll(toRestore);

    state = state.copyWith(
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      excludedOrders: excludedOrders,
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  /// Exclude ALL currently placed orders (move everything to overflow)
  void excludeAllOrders() {
    if (state.placedBoxes.isEmpty) return;
    _pushUndo();
    final excludedOrders = Set<int>.from(state.excludedOrders)
      ..addAll(state.placedBoxes.map((b) => b.orderNumber));
    final overflowBoxes = List<LoadBox>.from(state.overflowBoxes)
      ..addAll(state.placedBoxes);
    state = state.copyWith(
      placedBoxes: const [],
      overflowBoxes: overflowBoxes,
      excludedOrders: excludedOrders,
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  /// Include ALL overflow orders (move everything back to placed)
  void includeAllOrders() {
    if (state.overflowBoxes.isEmpty) return;
    _pushUndo();
    final placedBoxes = List<LoadBox>.from(state.placedBoxes)
      ..addAll(state.overflowBoxes);
    state = state.copyWith(
      placedBoxes: placedBoxes,
      overflowBoxes: const [],
      excludedOrders: <int>{},
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  /// Exclude all orders for a specific client
  void excludeByClient(String clientCode) {
    _pushUndo();
    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    final overflowBoxes = List<LoadBox>.from(state.overflowBoxes);
    final excludedOrders = Set<int>.from(state.excludedOrders);
    final toMove = <LoadBox>[];
    placedBoxes.removeWhere((b) {
      if (b.clientCode == clientCode) {
        excludedOrders.add(b.orderNumber);
        toMove.add(b);
        return true;
      }
      return false;
    });
    overflowBoxes.addAll(toMove);
    state = state.copyWith(
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      excludedOrders: excludedOrders,
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  /// Include all orders for a specific client
  void includeByClient(String clientCode) {
    _pushUndo();
    final placedBoxes = List<LoadBox>.from(state.placedBoxes);
    final overflowBoxes = List<LoadBox>.from(state.overflowBoxes);
    final excludedOrders = Set<int>.from(state.excludedOrders);
    final toRestore = <LoadBox>[];
    overflowBoxes.removeWhere((b) {
      if (b.clientCode == clientCode) {
        excludedOrders.remove(b.orderNumber);
        toRestore.add(b);
        return true;
      }
      return false;
    });
    placedBoxes.addAll(toRestore);
    state = state.copyWith(
      placedBoxes: placedBoxes,
      overflowBoxes: overflowBoxes,
      excludedOrders: excludedOrders,
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: false,
    );
    _recalculateMetrics();
    _scheduleAutoSave();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO
  // ═══════════════════════════════════════════════════════════════════════════

  void undo() {
    if (_undoStack.isEmpty) return;
    _redoStack.add(_currentSnapshot());
    final snap = _undoStack.removeLast();
    _restoreSnapshot(snap);
    state = state.copyWith(
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: _redoStack.isNotEmpty,
    );
    _scheduleAutoSave();
  }

  void redo() {
    if (_redoStack.isEmpty) return;
    _undoStack.add(_currentSnapshot());
    final snap = _redoStack.removeLast();
    _restoreSnapshot(snap);
    state = state.copyWith(
      hasManualChanges: true,
      canUndo: _undoStack.isNotEmpty,
      canRedo: _redoStack.isNotEmpty,
    );
    _scheduleAutoSave();
  }

  void _pushUndo() {
    _undoStack.add(_currentSnapshot());
    if (_undoStack.length > _maxUndoSteps) {
      _undoStack.removeAt(0);
    }
    _redoStack.clear();
  }

  _Snapshot _currentSnapshot() => _Snapshot(
        placed: state.placedBoxes.map((b) => b.copyWith()).toList(),
        overflow: state.overflowBoxes.map((b) => b.copyWith()).toList(),
        excluded: Set.from(state.excludedOrders),
      );

  void _restoreSnapshot(_Snapshot snap) {
    final truck = state.truck;
    state = state.copyWith(
      placedBoxes: snap.placed,
      overflowBoxes: snap.overflow,
      excludedOrders: snap.excluded,
      clearSelectedBox: true,
      clearDragState: true,
      metrics: truck == null
          ? state.metrics
          : _metricsFor(snap.placed, snap.overflow, truck),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLISION DETECTION (AABB)
  // ═══════════════════════════════════════════════════════════════════════════

  bool _hasCollision(List<LoadBox> boxes, int boxIndex) {
    final box = boxes[boxIndex];
    for (var i = 0; i < boxes.length; i++) {
      if (i == boxIndex) continue;
      if (_boxesOverlap(box, boxes[i])) return true;
    }
    return false;
  }

  /// AABB overlap test with 1cm tolerance
  static bool _boxesOverlap(LoadBox a, LoadBox b) {
    const t = 1.0; // tolerance cm
    return a.x < b.x + b.w - t &&
        a.x + a.w > b.x + t &&
        a.y < b.y + b.d - t &&
        a.y + a.d > b.y + t &&
        a.z < b.z + b.h - t &&
        a.z + a.h > b.z + t;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS RECALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  PlannerMetrics? _metricsFor(
    List<LoadBox> placed,
    List<LoadBox> overflow,
    TruckDimensions truck,
  ) {
    return PlannerMetrics.fromBoxes(
      placed: placed,
      overflow: overflow,
      truck: truck,
    );
  }

  void _recalculateMetrics() {
    final truck = state.truck;
    if (truck == null) return;
    state = state.copyWith(
      metrics: _metricsFor(state.placedBoxes, state.overflowBoxes, truck),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-SAVE
  // ═══════════════════════════════════════════════════════════════════════════

  void _scheduleAutoSave() {
    _autoSaveTimer?.cancel();
    state = state.copyWith(saveState: SaveState.unsaved);
    _autoSaveTimer = Timer(const Duration(seconds: 2), saveLayout);
  }

  Future<void> saveLayout() async {
    final vehicleCode = _vehicleCode;
    final date = _date;
    if (vehicleCode == null || date == null) return;
    if (!state.hasManualChanges) return;

    state = state.copyWith(saveState: SaveState.saving);

    try {
      final dateStr =
          '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
      await WarehouseDataService.saveManualLayout(
        vehicleCode: vehicleCode,
        date: dateStr,
        layoutJson: {
          'boxes': state.placedBoxes.map((b) => b.toJson()).toList(),
          'excludedOrders': state.excludedOrders.toList(),
        },
        metricsJson: state.metrics?.toJson(),
      );
      state = state.copyWith(saveState: SaveState.saved);
    } catch (e) {
      state = state.copyWith(saveState: SaveState.error);
      debugPrint('Auto-save failed: $e');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

class _Snapshot {
  _Snapshot({
    required this.placed,
    required this.overflow,
    required this.excluded,
  });
  final List<LoadBox> placed;
  final List<LoadBox> overflow;
  final Set<int> excluded;
}

class _ClientAcc {
  int count = 0;
  double weight = 0;
  double volume = 0;
}
