# Flutter Bug Pattern Detection Report

**Generated**: 2026-04-02  
**Agent**: #12 (Flutter Bug Pattern Detector)  
**Repository**: gmp_app_mobilidad  
**Scope**: `lib/` directory  

---

## Section 1: Common Flutter Anti-Patterns

### 1. setState() Called After dispose()
- **Severity**: Critical
- **Problem**: Calling `setState()` on a disposed widget throws a `StateError` and crashes the UI.
- **How to detect**: Search for `setState(` in async methods that don't check `mounted` before calling it.
- **Solution**: Always check `mounted` before `setState()` in async callbacks.

```dart
// BAD
Future<void> loadData() async {
  final data = await api.fetch();
  setState(() { _data = data; }); // May crash if widget disposed
}

// GOOD
Future<void> loadData() async {
  final data = await api.fetch();
  if (!mounted) return;
  setState(() { _data = data; });
}
```

### 2. Using BuildContext Across Async Gaps
- **Severity**: Critical
- **Problem**: `BuildContext` can become invalid across `await` boundaries. Using it after an `await` without checking `mounted` can cause crashes or navigate to wrong routes.
- **How to detect**: Search for `await` followed by usage of `context` (Navigator.of(context), ScaffoldMessenger.of(context), etc.) without a `mounted` guard.
- **Solution**: Check `if (!mounted) return;` after every `await` before using `context`.

```dart
// BAD
Future<void> submit() async {
  await api.save(data);
  Navigator.of(context).pop(); // context may be dead
}

// GOOD
Future<void> submit() async {
  await api.save(data);
  if (!mounted) return;
  Navigator.of(context).pop();
}
```

### 3. Not Cancelling Streams/Subscriptions
- **Severity**: Critical
- **Problem**: Stream subscriptions that aren't cancelled in `dispose()` cause memory leaks and can call `setState()` on disposed widgets.
- **How to detect**: Search for `.listen(` and verify a corresponding `.cancel()` exists in `dispose()`. Check for `StreamSubscription` fields that aren't cleaned up.
- **Solution**: Store subscription references and cancel them in `dispose()`.

```dart
// BAD
class MyWidget extends StatefulWidget {
  State<MyWidget> createState() => _MyWidgetState();
}
class _MyWidgetState extends State<MyWidget> {
  @override void initState() {
    super.initState();
    stream.listen((data) => setState(() => _data = data)); // Never cancelled
  }
}

// GOOD
class _MyWidgetState extends State<MyWidget> {
  StreamSubscription? _sub;
  @override void initState() {
    super.initState();
    _sub = stream.listen((data) {
      if (mounted) setState(() => _data = data);
    });
  }
  @override void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
```

### 4. Rebuilding Entire Widget Tree with setState
- **Severity**: Warning
- **Problem**: Calling `setState()` on a large widget rebuilds the entire `build()` method, causing unnecessary renders and jank.
- **How to detect**: Search for `setState(() {})` in widgets with large `build()` methods (>100 lines). Look for `setState(() {});` with empty body (full rebuild).
- **Solution**: Extract stateful parts into smaller widgets, use `ValueListenableBuilder`, `StreamBuilder`, or state management (Riverpod/Provider) for granular updates.

```dart
// BAD — rebuilds entire page for a counter change
setState(() { _counter++; });

// GOOD — isolate the counter in its own widget
class CounterWidget extends StatefulWidget { ... }
```

### 5. Using == on Lists Instead of ListEquality
- **Severity**: Warning
- **Problem**: `==` on lists compares identity, not content. `[1,2] == [1,2]` is `false`, causing missed updates or unnecessary rebuilds.
- **How to detect**: Search for `==` or `!=` operators applied to `List` or `Iterable` types.
- **Solution**: Use `ListEquality` from `package:collection` or `.join(',')` for simple comparisons.

```dart
// BAD
if (oldList == newList) return; // Always false for different instances

// GOOD
import 'package:collection/collection.dart';
if (const ListEquality().equals(oldList, newList)) return;
```

### 6. Hardcoded Dimensions Instead of Responsive
- **Severity**: Warning
- **Problem**: Hardcoded pixel values break on different screen sizes, tablets, and foldables.
- **How to detect**: Search for `width: 300`, `height: 500`, `fontSize: 16` (literal numbers) in layout widgets.
- **Solution**: Use `MediaQuery`, `LayoutBuilder`, or a responsive utility like `Responsive.fontSize()`.

```dart
// BAD
Container(width: 300, height: 200, child: ...)

// GOOD
LayoutBuilder(builder: (ctx, constraints) =>
  Container(width: constraints.maxWidth * 0.8, ...))
```

### 7. Not Using const Constructors
- **Severity**: Info
- **Problem**: Widgets without `const` are recreated on every parent rebuild, wasting CPU and memory.
- **How to detect**: Search for widget instantiations without `const` keyword where all arguments are compile-time constants.
- **Solution**: Add `const` to all widget constructors with constant arguments.

```dart
// BAD
SizedBox(height: 16)

// GOOD
const SizedBox(height: 16)
```

### 8. Large Widget Build Methods (>100 Lines)
- **Severity**: Info
- **Problem**: Large `build()` methods are hard to maintain, test, and cause full rebuilds. Flutter's framework encourages small, composable widgets.
- **How to detect**: Count lines in `Widget build(BuildContext context)` methods. Files over 1000 lines are a red flag.
- **Solution**: Extract sections into private methods or separate widget classes.

```dart
// BAD
@override Widget build(BuildContext context) {
  return Column(children: [
    // ... 200 lines of inline widgets
  ]);
}

// GOOD
@override Widget build(BuildContext context) {
  return Column(children: [
    _buildHeader(),
    _buildContent(),
    _buildFooter(),
  ]);
}
```

### 9. Mixing Provider and Riverpod
- **Severity**: Warning
- **Problem**: Using both `provider` and `riverpod` in the same codebase increases bundle size, cognitive load, and creates inconsistent state management patterns.
- **How to detect**: Search for both `Provider.of`/`ChangeNotifierProvider` and `ref.watch`/`ConsumerWidget` in the same project.
- **Solution**: Migrate to a single state management solution. Riverpod is recommended for new code.

### 10. Not Handling Loading/Error States in AsyncValue
- **Severity**: Warning
- **Problem**: Async operations without loading/error UI leave users staring at blank screens or crashed widgets.
- **How to detect**: Search for `FutureBuilder` or async methods that don't show loading indicators or error messages.
- **Solution**: Always handle all three states: loading, data, error.

```dart
// BAD
FutureBuilder(
  future: fetchData(),
  builder: (ctx, snap) => Text(snap.data!), // Crashes on error
)

// GOOD
FutureBuilder(
  future: fetchData(),
  builder: (ctx, snap) {
    if (snap.connectionState == ConnectionState.waiting)
      return CircularProgressIndicator();
    if (snap.hasError) return Text('Error: ${snap.error}');
    return Text(snap.data!);
  },
)
```

---

## Section 2: Codebase Scan Results

### 2.1 setState() Occurrences

**Total occurrences**: 480+ across 30+ files

| File | Count | Assessment |
|------|-------|------------|
| `lib/features/pedidos/presentation/widgets/order_summary_widget.dart` | 2 | Acceptable — simple toggle, no async gap |
| `lib/features/dashboard/presentation/pages/main_shell.dart` | 14 | Mixed — line 302 has `if (mounted)` guard, but lines 230, 243, 559, 695, 787, 813, 934, 942, 1157, 1235, 1312 are synchronous taps (acceptable) |
| `lib/features/cobros/presentation/pages/cobros_page.dart` | 3 | Acceptable — line 64 has `if (mounted)` guard |
| `lib/features/repartidor/presentation/pages/repartidor_rutero_page.dart` | 5 | Acceptable — lines 110, 124 have `if (mounted)` guards |
| `lib/features/auth/presentation/pages/login_page.dart` | 4 | Acceptable — lines 99, 120, 124 have `if (mounted)` guards |
| `lib/features/pedidos/presentation/pages/pedidos_page.dart` | 10+ | Mixed — lines 108, 177, 2799 have guards; filter bar setState calls (2474-2489) are synchronous (acceptable) |
| `lib/features/pedidos/presentation/pages/promotion_detail_page.dart` | 6 | **ISSUE**: Line 88 `setState(() {})` — empty setState causes full rebuild (Pattern #4) |
| `lib/features/pedidos/presentation/widgets/promotions_banner.dart` | 4 | Acceptable — lines 60, 79 have `if (mounted)` guards |
| `lib/features/pedidos/presentation/widgets/stock_alternatives_sheet.dart` | 10 | **ISSUE**: Lines 88, 93, 99, 121, 128, 133, 136, 141 — `_loadAlternatives()` at line 81 calls setState after await WITHOUT mounted check (lines 88, 93, 99) |
| `lib/features/pedidos/presentation/widgets/order_preview_sheet.dart` | 3 | **ISSUE**: Lines 612, 615 — `_handleConfirm()` calls setState after await WITHOUT mounted check |
| `lib/features/pedidos/presentation/widgets/product_history_sheet.dart` | 5 | **ISSUE**: Lines 93, 126, 135 — setState after await without mounted check |
| `lib/features/rutero/presentation/pages/rutero_page.dart` | 15+ | Acceptable — most are synchronous; line 234, 242 have mounted guards |
| `lib/features/pedidos/presentation/widgets/order_detail_sheet.dart` | 4 | Acceptable — lines 128, 183 have mounted guards |
| `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart` | 0 | Uses setState internally but with mounted guards (lines 733, 742, 2722, 2741, 2852, 3182) |

### 2.2 BuildContext After Async Gaps

**Pattern searched**: `await` followed by `context` usage without `if (!mounted) return;`

| File:Line | Pattern | Assessment |
|-----------|---------|------------|
| `stock_alternatives_sheet.dart:81-99` | `await ApiClient.get()` → `setState()` without mounted | **REAL ISSUE** — will crash if widget disposed during API call |
| `order_preview_sheet.dart:607-615` | `await widget.onConfirm()` → `setState()` without mounted | **REAL ISSUE** — same risk |
| `product_history_sheet.dart:93-135` | `await` → `setState()` without mounted | **REAL ISSUE** |
| `order_summary_widget.dart:223,968,1001,1046,1053,1063,1078,1108` | `ScaffoldMessenger.of(context)` after async | **POTENTIAL ISSUE** — context may be invalid; most are inside callbacks with mounted checks at lines 2799 |
| `rutero_detail_modal.dart:2743` | `ScaffoldMessenger.of(context)` captured BEFORE pop | **ACCEPTABLE** — good pattern, captures reference before context dies |
| `promotion_detail_page.dart:104-110` | `await` → `if (!mounted) return;` → `ScaffoldMessenger` | **ACCEPTABLE** — proper pattern |

### 2.3 Stream Subscriptions Without Cancel

**Pattern searched**: `.listen(` without corresponding `.cancel()` in `dispose()`

| File:Line | Pattern | Assessment |
|-----------|---------|------------|
| `core/utils/stream_chain.dart:203` | `StreamChain.listen()` delegates to underlying stream | **ACCEPTABLE** — utility class, caller manages lifecycle |
| `core/services/isolate_pool_service.dart:139` | `receivePort.listen()` in isolate entry point | **ACCEPTABLE** — runs in isolate, port lifecycle managed by isolate |
| `ReplayCache` (stream_chain.dart:216) | `StreamController.broadcast()` created but never closed in all paths | **MINOR ISSUE** — `dispose()` closes controller (line 272), but `ReplayCache` instances may leak if not explicitly disposed |

**No StreamSubscription fields found** in the codebase — the app uses Timer-based debounce patterns instead of stream subscriptions, which are properly cancelled in dispose.

### 2.4 Provider.of Usage (Legacy Pattern)

**Total occurrences**: 29 across 10 files

| File:Line | Pattern | Assessment |
|-----------|---------|------------|
| `main_shell.dart:309,1246` | `Provider.of<AuthProvider>(context, listen: false)` | **LEGACY** — should migrate to Riverpod `ref.read` |
| `repartidor_rutero_page.dart:81-83,134,151-153,770,815,1011` | `Provider.of<AuthProvider/FilterProvider/EntregasProvider>` | **LEGACY** — 9 occurrences, should use Riverpod |
| `main.dart:143` | `Provider.of<AuthProvider>(context, listen: false)` | **LEGACY** |
| `promotions_banner.dart:57` | `Provider.of<PedidosProvider>(context, listen: false)` | **LEGACY** |
| `product_history_page.dart:37-38,67,98,108,116` | `Provider.of<AuthProvider/SalesHistoryProvider>` | **LEGACY** — 6 occurrences |
| `rutero_detail_modal.dart:362,2682` | `Provider.of<EntregasProvider>(context, listen: false)` | **LEGACY** |
| `order_detail_sheet.dart:124,178` | `Provider.of<PedidosProvider>(context, listen: false)` | **LEGACY** |
| `facturas_page.dart:99,105` | `Provider.of<AuthProvider/FilterProvider>` | **LEGACY** |
| `dashboard_content.dart:246,426` | `Provider.of<DashboardProvider>` | **LEGACY** — line 426 uses `listen: true` (rebuilds on every change) |
| `chatbot_page.dart:80` | `Provider.of<AuthProvider>(context, listen: false)` | **LEGACY** |

### 2.5 ChangeNotifier Usage (Legacy State Management)

**Total ChangeNotifier classes**: 12

| Class | File | Assessment |
|-------|------|------------|
| `AuthProvider` | `core/providers/auth_provider.dart:15` | **LEGACY** — core auth, high migration priority |
| `FilterProvider` | `core/providers/filter_provider.dart:5` | **LEGACY** |
| `DashboardProvider` | `core/providers/dashboard_provider.dart:7` | **LEGACY** |
| `DashboardProviderV3` | `core/providers/dashboard_provider_v3.dart:23` | **LEGACY** |
| `ThemeProvider` | `core/theme/theme_provider.dart:6` | **LEGACY** |
| `PedidosProvider` | `features/pedidos/providers/pedidos_provider.dart:11` | **LEGACY** |
| `PedidosProviderV3` | `features/pedidos/providers/pedidos_provider_v3.dart:26` | **LEGACY** |
| `CobrosProvider` | `features/cobros/providers/cobros_provider.dart:9` | **LEGACY** |
| `EntregasProvider` | `features/entregas/providers/entregas_provider.dart:234` | **LEGACY** |
| `SalesHistoryProvider` | `features/sales_history/providers/sales_history_provider.dart:5` | **LEGACY** |
| `ChatbotProvider` | `features/chatbot/providers/chatbot_provider.dart:23` | **LEGACY** |
| `LoadPlannerProvider` | `features/warehouse/application/load_planner_provider.dart:12` | **LEGACY** |

**No Riverpod usage found** — the codebase exclusively uses Provider + ChangeNotifier. Pattern #9 (mixing) does not apply, but the entire state management layer is legacy.

### 2.6 ListView Without itemBuilder (Inefficient Lists)

| File:Line | Pattern | Assessment |
|-----------|---------|------------|
| `product_search_widget.dart:118` | `ListView(scrollDirection: horizontal, children: [...])` | **ACCEPTABLE** — horizontal chip list with few items |
| `order_preview_sheet.dart:92` | `ListView(children: [...])` with spread operator | **WARNING** — uses `children` list; if order has many lines, should use `ListView.builder` |
| `product_history_sheet.dart:209` | `ListView(children: [...])` | **WARNING** — depends on data size |
| `product_detail_sheet.dart:219` | `ListView(children: [...])` | **WARNING** |
| `load_planner_panel.dart:372,669` | `ListView(padding: ..., children: [...])` | **ACCEPTABLE** — panel with limited items |
| `load_history_page.dart:299` | `ListView(children: [...])` | **WARNING** |
| `kpi_dashboard_page.dart:167` | `ListView(children: [...])` | **WARNING** |
| `repartidor_panel_page.dart:110` | `ListView(children: [...])` | **WARNING** |
| `repartidor_clientes_page.dart:132` | `ListView(children: [...])` | **ACCEPTABLE** — has fallback to `OptimizedListView` at line 140 |
| `objectives/enhanced_client_matrix_page.dart:466` | `ListView(children: [...])` | **WARNING** |

**Positive note**: The codebase has `OptimizedListView` widget (`core/widgets/optimized_list.dart`) with `cacheExtent`, `RepaintBoundary`, and `addAutomaticKeepAlives`. It's used in `entregas_page.dart:177`, `facturas_page.dart:859`, `personnel_page.dart:242`, `vehicles_page.dart:55`, `repartidor_clientes_page.dart:140`.

### 2.7 Container With Only One Child (Useless Wrappers)

No direct `Container(child:` single-child pattern found via regex. However, many `Container` widgets are used with only `color` or `decoration` properties wrapping a single child — these are acceptable as they provide visual styling.

### 2.8 Missing mounted Checks (Critical Findings)

| File:Line | Method | Issue |
|-----------|--------|-------|
| `stock_alternatives_sheet.dart:88` | `_loadAlternatives()` | `setState()` after `await` without `if (!mounted)` |
| `stock_alternatives_sheet.dart:93` | `_loadAlternatives()` | Same |
| `stock_alternatives_sheet.dart:99` | `_loadAlternatives()` | Same |
| `order_preview_sheet.dart:612` | `_handleConfirm()` | `setState()` after `await` without `if (!mounted)` |
| `order_preview_sheet.dart:615` | `_handleConfirm()` | Same (catch block) |
| `product_history_sheet.dart:93` | `_loadHistory()` | `setState()` after `await` without `if (!mounted)` |
| `product_history_sheet.dart:126` | `_loadHistory()` | Same |
| `product_history_sheet.dart:135` | `_loadHistory()` | Same |
| `promotion_detail_page.dart:88` | `_updateGiftQty()` | `setState(() {})` — empty setState, full rebuild |

---

## Section 3: Safe Widget Base Pattern

The following file provides a reusable base class and mixin for safe stateful widget operations:

### File: `lib/core/widgets/safe_stateful_widget.dart`

```dart
import 'dart:async';
import 'package:flutter/material.dart';

/// SafeStatefulWidget — Base class that prevents common Flutter bugs.
///
/// Provides:
/// - [safeSetState] — checks [mounted] before calling setState
/// - [safeContext] — safely access context across async gaps
/// - Auto-cancellable stream subscriptions via [SafeSubscriptionMixin]
///
/// Usage:
/// ```dart
/// class MyWidget extends SafeStatefulWidget {
///   const MyWidget({super.key});
///   @override
///   State<MyWidget> createState() => _MyWidgetState();
/// }
///
/// class _MyWidgetState extends SafeState<MyWidget> {
///   @override
///   Widget build(BuildContext context) { ... }
///
///   Future<void> loadData() async {
///     final data = await api.fetch();
///     safeSetState(() => _data = data); // No crash if disposed
///
///     final ctx = safeContext;
///     if (ctx != null) Navigator.of(ctx).pop(); // Safe navigation
///   }
/// }
/// ```
abstract class SafeStatefulWidget extends StatefulWidget {
  const SafeStatefulWidget({super.key});
}

abstract class SafeState<T extends SafeStatefulWidget> extends State<T> {
  /// Calls setState only if the widget is still mounted.
  /// Returns true if setState was called, false if widget was disposed.
  bool safeSetState(VoidCallback fn) {
    if (!mounted) return false;
    setState(fn);
    return true;
  }

  /// Returns the current BuildContext if mounted, null otherwise.
  /// Use this across async gaps to safely access context.
  BuildContext? get safeContext => mounted ? context : null;

  /// Safely navigate after an async operation.
  /// Returns true if navigation was performed, false if widget was disposed.
  bool safePop([Object? result]) {
    if (!mounted) return false;
    Navigator.of(context).pop(result);
    return true;
  }

  /// Safely show a SnackBar after an async operation.
  void safeShowSnackBar(String message, {Color? backgroundColor}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: backgroundColor,
      ),
    );
  }

  /// Safely show a dialog after an async operation.
  Future<T?> safeShowDialog<T>(WidgetBuilder builder) async {
    if (!mounted) return null;
    return showDialog<T>(context: context, builder: builder);
  }
}

/// Mixin that auto-cancels stream subscriptions on dispose.
///
/// Usage:
/// ```dart
/// class _MyState extends SafeState<MyWidget> with AutoCancelSubscriptions {
///   @override
///   void initState() {
///     super.initState();
///     subscribe(stream.listen((data) => safeSetState(() => _data = data)));
///   }
/// }
/// ```
mixin AutoCancelSubscriptions<T extends StatefulWidget> on State<T> {
  final List<StreamSubscription<dynamic>> _subscriptions = [];
  final List<Timer> _timers = [];

  /// Register a stream subscription for automatic cancellation on dispose.
  S subscribe<S extends StreamSubscription<dynamic>>(S subscription) {
    _subscriptions.add(subscription);
    return subscription;
  }

  /// Register a Timer for automatic cancellation on dispose.
  Tm registerTimer<Tm extends Timer>(Tm timer) {
    _timers.add(timer);
    return timer;
  }

  @override
  void dispose() {
    for (final sub in _subscriptions) {
      sub.cancel();
    }
    for (final timer in _timers) {
      timer.cancel();
    }
    _subscriptions.clear();
    _timers.clear();
    super.dispose();
  }
}

/// Combined mixin: SafeState + AutoCancelSubscriptions
/// Use this for the most common case.
///
/// ```dart
/// class _MyState extends SafeState<MyWidget> with SafeWidgetState {
///   // safeSetState, safeContext, subscribe, registerTimer all available
/// }
/// ```
mixin SafeWidgetState<T extends SafeStatefulWidget>
    on SafeState<T>, AutoCancelSubscriptions<T> {}
```

### Usage Examples

```dart
// Example 1: Basic safe async operation
class _MyState extends SafeState<MyWidget> {
  String? _data;

  Future<void> fetchData() async {
    final result = await api.getData();
    // No need for if (!mounted) return; — safeSetState handles it
    safeSetState(() => _data = result);

    // Safe context access across async gap
    final ctx = safeContext;
    if (ctx != null) {
      ScaffoldMessenger.of(ctx).showSnackBar(
        const SnackBar(content: Text('Loaded!')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Text(_data ?? 'Loading...');
}

// Example 2: Stream with auto-cancellation
class _StreamState extends SafeState<StreamWidget> with AutoCancelSubscriptions {
  int _count = 0;

  @override
  void initState() {
    super.initState();
    // Subscription auto-cancelled in dispose
    subscribe(
      Stream.periodic(const Duration(seconds: 1), (i) => i).listen(
        (count) => safeSetState(() => _count = count),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Text('Count: $_count');
}

// Example 3: Combined — safe state + auto-cancel
class _CombinedState extends SafeState<CombinedWidget> with SafeWidgetState {
  Timer? _debounce;
  String? _searchResult;

  void onSearchChanged(String query) {
    _debounce?.cancel();
    _debounce = registerTimer(
      Timer(const Duration(milliseconds: 300), () async {
        final result = await api.search(query);
        safeSetState(() => _searchResult = result);
        safeShowSnackBar('Search complete');
      }),
    );
  }

  @override
  void dispose() {
    _debounce?.cancel(); // Also handled by mixin, but explicit is fine
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Text(_searchResult ?? 'Search...');
}
```

---

## Summary of Findings

| Category | Count | Severity |
|----------|-------|----------|
| setState after async without mounted guard | 9 instances | **Critical** |
| Provider.of (legacy, should be Riverpod) | 29 instances | **Warning** |
| ChangeNotifier classes (legacy state management) | 12 classes | **Warning** |
| ListView with children (not builder) | 10 instances | **Warning** |
| Empty setState(() {}) full rebuild | 1 instance | **Warning** |
| Stream subscriptions (properly managed) | 2 instances | **Info** |
| Files with mounted guards (good practice) | 15+ files | **Positive** |
| OptimizedListView usage (good practice) | 5 instances | **Positive** |

### Top Priority Fixes

1. **`stock_alternatives_sheet.dart:81-103`** — Add `if (!mounted) return;` before all `setState()` calls in `_loadAlternatives()` and `_searchProducts()`
2. **`order_preview_sheet.dart:602-625`** — Add `if (!mounted) return;` before `setState()` in `_handleConfirm()` catch block
3. **`product_history_sheet.dart:93-135`** — Add `if (!mounted) return;` before all `setState()` calls in `_loadHistory()`
4. **`promotion_detail_page.dart:88`** — Replace `setState(() {})` with targeted state update
