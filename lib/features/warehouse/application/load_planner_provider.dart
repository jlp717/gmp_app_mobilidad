import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/warehouse_data_service.dart';
import '../domain/models/load_planner_models.dart';

/// Central state manager for Load Planner V2.
///
/// Handles: loading plans, drag-and-drop of boxes, collision detection,
/// exclude/include orders, undo/redo, auto-save of manual layouts.
class LoadPlannerProvider extends ChangeNotifier {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  List<LoadBox> _placedBoxes = [];
  List<LoadBox> _overflowBoxes = [];
  PlannerMetrics? _metrics;
  TruckDimensions? _truck;

  // View state
  ViewMode _viewMode = ViewMode.perspective;
  ColorMode _colorMode = ColorMode.product;
  int? _selectedBoxIndex;
  DragState? _dragState;

  // Loading / error
  bool _isLoading = false;
  String? _error;

  // Persistence
  SaveState _saveState = SaveState.saved;
  bool _hasManualChanges = false;
  Timer? _autoSaveTimer;
  String? _vehicleCode;
  DateTime? _date;

  // Undo / Redo
  final List<_Snapshot> _undoStack = [];
  final List<_Snapshot> _redoStack = [];
  static const int _maxUndoSteps = 30;

  // Excluded order numbers
  final Set<int> _excludedOrders = {};

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  List<LoadBox> get placedBoxes => _placedBoxes;
  List<LoadBox> get overflowBoxes => _overflowBoxes;
  PlannerMetrics? get metrics => _metrics;
  TruckDimensions? get truck => _truck;
  ViewMode get viewMode => _viewMode;
  ColorMode get colorMode => _colorMode;
  int? get selectedBoxIndex => _selectedBoxIndex;
  DragState? get dragState => _dragState;
  bool get isLoading => _isLoading;
  String? get error => _error;
  SaveState get saveState => _saveState;
  bool get hasManualChanges => _hasManualChanges;
  Set<int> get excludedOrders => _excludedOrders;
  bool get canUndo => _undoStack.isNotEmpty;
  bool get canRedo => _redoStack.isNotEmpty;

  /// Unique client codes from placed boxes
  List<ClientSummary> get clientSummaries {
    final map = <String, _ClientAcc>{};
    for (final b in _placedBoxes) {
      final acc = map.putIfAbsent(b.clientCode, () => _ClientAcc());
      acc.count++;
      acc.weight += b.weight;
      acc.volume += b.volume;
    }
    return map.entries
        .map((e) => ClientSummary(
              clientCode: e.key,
              boxCount: e.value.count,
              totalWeight: e.value.weight,
              totalVolume: e.value.volume,
            ))
        .toList()
      ..sort((a, b) => b.totalWeight.compareTo(a.totalWeight));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD PLAN
  // ═══════════════════════════════════════════════════════════════════════════

  /// Load plan for vehicle + date. Checks for saved manual layout first.
  Future<void> loadPlan({
    required String vehicleCode,
    required DateTime date,
  }) async {
    _vehicleCode = vehicleCode;
    _date = date;
    _isLoading = true;
    _error = null;
    _excludedOrders.clear();
    _undoStack.clear();
    _redoStack.clear();
    notifyListeners();

    try {
      // 1. Check for saved manual layout (non-fatal — if it fails, treat as null)
      final dateStr =
          '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
      Map<String, dynamic>? savedLayout;
      try {
        savedLayout = await WarehouseDataService.getManualLayout(
          vehicleCode: vehicleCode,
          date: dateStr,
        );
      } catch (e) {
        debugPrint('Manual layout fetch failed (non-fatal): $e');
        savedLayout = null;
      }

      if (savedLayout != null) {
        // Restore from saved layout
        final layout = ManualLayout.fromJson(savedLayout);
        _placedBoxes = layout.boxes;
        _excludedOrders.addAll(layout.excludedOrders);

        // Still need truck dimensions from API
        final result = await WarehouseDataService.planLoad(
          vehicleCode: vehicleCode,
          year: date.year,
          month: date.month,
          day: date.day,
        );
        _truck = TruckDimensions.fromVehicleConfig(
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
        final freshBoxIds =
            result.placed.map((b) => b.id).toSet()
              ..addAll(result.overflow.map((b) => b.id));
        _placedBoxes =
            _placedBoxes.where((b) => freshBoxIds.contains(b.id)).toList();

        // Add any NEW boxes from fresh plan that aren't in the saved layout
        final savedIds = _placedBoxes.map((b) => b.id).toSet();
        for (final freshBox in result.placed) {
          if (!savedIds.contains(freshBox.id)) {
            _placedBoxes.add(LoadBox.fromJson({
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
            }));
          }
        }

        _overflowBoxes = result.overflow
            .map((b) => LoadBox.fromJson({
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
                }))
            .toList();

        _recalculateMetrics();
        _saveState = SaveState.saved;
        _hasManualChanges = true;
      } else {
        // Fresh plan from algorithm
        await _loadFreshPlan(vehicleCode, date);
        _saveState = SaveState.saved;
        _hasManualChanges = false;
      }
    } catch (e, stack) {
      debugPrint('[LoadPlanner] ERROR loading plan: $e');
      debugPrint('[LoadPlanner] Stack: $stack');
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _loadFreshPlan(String vehicleCode, DateTime date) async {
    final result = await WarehouseDataService.planLoad(
      vehicleCode: vehicleCode,
      year: date.year,
      month: date.month,
      day: date.day,
    );

    _truck = TruckDimensions.fromVehicleConfig(
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

    _placedBoxes = result.placed
        .map((b) => LoadBox(
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
            ))
        .toList();

    _overflowBoxes = result.overflow
        .map((b) => LoadBox(
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
            ))
        .toList();

    _metrics = PlannerMetrics.fromJson({
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
    });
  }

  /// Reset to algorithm-computed layout, discarding manual changes
  Future<void> resetToAlgorithm() async {
    if (_vehicleCode == null || _date == null) return;
    _pushUndo();
    _excludedOrders.clear();
    _hasManualChanges = false;
    _isLoading = true;
    notifyListeners();

    try {
      await _loadFreshPlan(_vehicleCode!, _date!);
      _saveState = SaveState.saved;
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFIT OPTIMIZER
  // ═══════════════════════════════════════════════════════════════════════════

  bool _isOptimizing = false;
  bool get isOptimizing => _isOptimizing;

  /// Run profit optimizer: exclude orders the algorithm says to exclude,
  /// include ones it says to include.
  Future<void> runProfitOptimizer() async {
    if (_vehicleCode == null || _date == null) return;
    _isOptimizing = true;
    notifyListeners();

    try {
      final result = await WarehouseDataService.optimizeLoad(
        vehicleCode: _vehicleCode!,
        year: _date!.year,
        month: _date!.month,
        day: _date!.day,
      );

      final excludedSet =
          (result['excluded'] as List?)?.cast<int>().toSet() ?? {};
      final includedSet =
          (result['included'] as List?)?.cast<int>().toSet() ?? {};

      if (excludedSet.isEmpty && includedSet.isEmpty) {
        _isOptimizing = false;
        notifyListeners();
        return;
      }

      _pushUndo();

      // Move excluded orders from placed to overflow
      final toExclude = <LoadBox>[];
      _placedBoxes.removeWhere((b) {
        if (excludedSet.contains(b.orderNumber)) {
          toExclude.add(b);
          return true;
        }
        return false;
      });
      _overflowBoxes.addAll(toExclude);
      _excludedOrders.addAll(excludedSet);

      // Move included orders from overflow to placed
      final toInclude = <LoadBox>[];
      _overflowBoxes.removeWhere((b) {
        if (includedSet.contains(b.orderNumber)) {
          toInclude.add(b);
          return true;
        }
        return false;
      });
      _placedBoxes.addAll(toInclude);
      _excludedOrders.removeAll(includedSet);

      _hasManualChanges = true;
      _recalculateMetrics();
      _scheduleAutoSave();
    } catch (e) {
      debugPrint('[LoadPlanner] Optimizer error: $e');
      _error = 'Error al optimizar: $e';
    } finally {
      _isOptimizing = false;
      notifyListeners();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOX SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  void selectBox(int? index) {
    _selectedBoxIndex = index;
    notifyListeners();
  }

  void clearSelection() {
    _selectedBoxIndex = null;
    notifyListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW / COLOR MODE
  // ═══════════════════════════════════════════════════════════════════════════

  void setViewMode(ViewMode mode) {
    _viewMode = mode;
    notifyListeners();
  }

  void setColorMode(ColorMode mode) {
    _colorMode = mode;
    notifyListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG AND DROP — Move boxes within the 3D space
  // ═══════════════════════════════════════════════════════════════════════════

  void startDrag(int boxIndex) {
    if (boxIndex < 0 || boxIndex >= _placedBoxes.length) return;
    final box = _placedBoxes[boxIndex];
    _dragState = DragState(
      boxIndex: boxIndex,
      startX: box.x,
      startY: box.y,
      startZ: box.z,
    );
    _selectedBoxIndex = boxIndex;
    notifyListeners();
  }

  /// Update dragged box position (in truck 3D coordinates)
  void updateDragPosition(double newX, double newY) {
    if (_dragState == null || _truck == null) return;
    final idx = _dragState!.boxIndex;
    final box = _placedBoxes[idx];

    // Clamp to truck interior bounds
    final clampedX = newX.clamp(0.0, _truck!.lengthCm - box.w);
    final clampedY = newY.clamp(0.0, _truck!.widthCm - box.d);

    _placedBoxes[idx] = box.copyWith(x: clampedX, y: clampedY);

    // Check collisions
    final collision = _hasCollision(idx);
    if (collision != _dragState!.hasCollision) {
      _dragState = _dragState!.copyWith(hasCollision: collision);
    }

    notifyListeners();
  }

  /// Finalize drag: if valid position, keep; if collision, revert.
  void endDrag() {
    if (_dragState == null) return;
    final idx = _dragState!.boxIndex;

    if (_dragState!.hasCollision) {
      // Revert to original position
      _placedBoxes[idx] = _placedBoxes[idx].copyWith(
        x: _dragState!.startX,
        y: _dragState!.startY,
        z: _dragState!.startZ,
      );
    } else {
      // Keep new position — push undo and mark dirty
      _pushUndo();
      _hasManualChanges = true;
      _recalculateMetrics();
      _scheduleAutoSave();
    }

    _dragState = null;
    notifyListeners();
  }

  /// Cancel drag without applying
  void cancelDrag() {
    if (_dragState == null) return;
    final idx = _dragState!.boxIndex;
    _placedBoxes[idx] = _placedBoxes[idx].copyWith(
      x: _dragState!.startX,
      y: _dragState!.startY,
      z: _dragState!.startZ,
    );
    _dragState = null;
    notifyListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXCLUDE / INCLUDE ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  void excludeOrder(int orderNumber) {
    _pushUndo();
    _excludedOrders.add(orderNumber);

    // Move matching boxes from placed to overflow
    final toMove = <LoadBox>[];
    _placedBoxes.removeWhere((b) {
      if (b.orderNumber == orderNumber) {
        toMove.add(b);
        return true;
      }
      return false;
    });
    _overflowBoxes.addAll(toMove);

    _hasManualChanges = true;
    _recalculateMetrics();
    _scheduleAutoSave();
    notifyListeners();
  }

  void includeOrder(int orderNumber) {
    _pushUndo();
    _excludedOrders.remove(orderNumber);

    // Move matching boxes from overflow back to placed
    final toRestore = <LoadBox>[];
    _overflowBoxes.removeWhere((b) {
      if (b.orderNumber == orderNumber) {
        toRestore.add(b);
        return true;
      }
      return false;
    });
    _placedBoxes.addAll(toRestore);

    _hasManualChanges = true;
    _recalculateMetrics();
    _scheduleAutoSave();
    notifyListeners();
  }

  bool isOrderExcluded(int orderNumber) =>
      _excludedOrders.contains(orderNumber);

  /// Exclude ALL currently placed orders (move everything to overflow)
  void excludeAllOrders() {
    if (_placedBoxes.isEmpty) return;
    _pushUndo();
    final allOrderNumbers =
        _placedBoxes.map((b) => b.orderNumber).toSet();
    _excludedOrders.addAll(allOrderNumbers);
    _overflowBoxes.addAll(_placedBoxes);
    _placedBoxes = [];
    _hasManualChanges = true;
    _recalculateMetrics();
    _scheduleAutoSave();
    notifyListeners();
  }

  /// Include ALL overflow orders (move everything back to placed)
  void includeAllOrders() {
    if (_overflowBoxes.isEmpty) return;
    _pushUndo();
    _excludedOrders.clear();
    _placedBoxes.addAll(_overflowBoxes);
    _overflowBoxes = [];
    _hasManualChanges = true;
    _recalculateMetrics();
    _scheduleAutoSave();
    notifyListeners();
  }

  /// Exclude all orders for a specific client
  void excludeByClient(String clientCode) {
    _pushUndo();
    final toMove = <LoadBox>[];
    _placedBoxes.removeWhere((b) {
      if (b.clientCode == clientCode) {
        _excludedOrders.add(b.orderNumber);
        toMove.add(b);
        return true;
      }
      return false;
    });
    _overflowBoxes.addAll(toMove);
    _hasManualChanges = true;
    _recalculateMetrics();
    _scheduleAutoSave();
    notifyListeners();
  }

  /// Include all orders for a specific client
  void includeByClient(String clientCode) {
    _pushUndo();
    final toRestore = <LoadBox>[];
    _overflowBoxes.removeWhere((b) {
      if (b.clientCode == clientCode) {
        _excludedOrders.remove(b.orderNumber);
        toRestore.add(b);
        return true;
      }
      return false;
    });
    _placedBoxes.addAll(toRestore);
    _hasManualChanges = true;
    _recalculateMetrics();
    _scheduleAutoSave();
    notifyListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO
  // ═══════════════════════════════════════════════════════════════════════════

  void undo() {
    if (_undoStack.isEmpty) return;
    _redoStack.add(_currentSnapshot());
    _restoreSnapshot(_undoStack.removeLast());
    _hasManualChanges = true;
    _scheduleAutoSave();
    notifyListeners();
  }

  void redo() {
    if (_redoStack.isEmpty) return;
    _undoStack.add(_currentSnapshot());
    _restoreSnapshot(_redoStack.removeLast());
    _hasManualChanges = true;
    _scheduleAutoSave();
    notifyListeners();
  }

  void _pushUndo() {
    _undoStack.add(_currentSnapshot());
    if (_undoStack.length > _maxUndoSteps) {
      _undoStack.removeAt(0);
    }
    _redoStack.clear();
  }

  _Snapshot _currentSnapshot() => _Snapshot(
        placed: _placedBoxes.map((b) => b.copyWith()).toList(),
        overflow: _overflowBoxes.map((b) => b.copyWith()).toList(),
        excluded: Set.from(_excludedOrders),
      );

  void _restoreSnapshot(_Snapshot snap) {
    _placedBoxes = snap.placed;
    _overflowBoxes = snap.overflow;
    _excludedOrders
      ..clear()
      ..addAll(snap.excluded);
    _selectedBoxIndex = null;
    _dragState = null;
    _recalculateMetrics();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLISION DETECTION (AABB)
  // ═══════════════════════════════════════════════════════════════════════════

  bool _hasCollision(int boxIndex) {
    final box = _placedBoxes[boxIndex];
    for (int i = 0; i < _placedBoxes.length; i++) {
      if (i == boxIndex) continue;
      if (_boxesOverlap(box, _placedBoxes[i])) return true;
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

  void _recalculateMetrics() {
    if (_truck == null) return;
    _metrics = PlannerMetrics.fromBoxes(
      placed: _placedBoxes,
      overflow: _overflowBoxes,
      truck: _truck!,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-SAVE
  // ═══════════════════════════════════════════════════════════════════════════

  void _scheduleAutoSave() {
    _autoSaveTimer?.cancel();
    _saveState = SaveState.unsaved;
    _autoSaveTimer = Timer(const Duration(seconds: 2), () => saveLayout());
  }

  Future<void> saveLayout() async {
    if (_vehicleCode == null || _date == null) return;
    if (!_hasManualChanges) return;

    _saveState = SaveState.saving;
    notifyListeners();

    try {
      final dateStr =
          '${_date!.year}-${_date!.month.toString().padLeft(2, '0')}-${_date!.day.toString().padLeft(2, '0')}';
      await WarehouseDataService.saveManualLayout(
        vehicleCode: _vehicleCode!,
        date: dateStr,
        layoutJson: {
          'boxes': _placedBoxes.map((b) => b.toJson()).toList(),
          'excludedOrders': _excludedOrders.toList(),
        },
        metricsJson: _metrics?.toJson(),
      );
      _saveState = SaveState.saved;
    } catch (e) {
      _saveState = SaveState.error;
      debugPrint('Auto-save failed: $e');
    }
    notifyListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  @override
  void dispose() {
    _autoSaveTimer?.cancel();
    super.dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

class _Snapshot {
  final List<LoadBox> placed;
  final List<LoadBox> overflow;
  final Set<int> excluded;
  _Snapshot({
    required this.placed,
    required this.overflow,
    required this.excluded,
  });
}

class _ClientAcc {
  int count = 0;
  double weight = 0;
  double volume = 0;
}
