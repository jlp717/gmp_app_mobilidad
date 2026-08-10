import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/repartidor_evolution_page.dart';

void main() {
  RepartidorEvolutionData evolutionData({
    double january = 100,
    double february = 120,
    String productName = 'Producto A',
  }) {
    return RepartidorEvolutionData(
      evolution: [
        RepartidorEvolutionPoint(
          period: '2026-01',
          totalSales: january,
          numCobros: 2,
        ),
        RepartidorEvolutionPoint(
          period: '2026-02',
          totalSales: february,
          numCobros: 3,
        ),
      ],
      topProducts: [
        RepartidorTopProduct(
          code: 'A1',
          name: productName,
          totalUnits: 4,
          totalSales: february,
        ),
      ],
    );
  }

  testWidgets('RepartidorEvolutionPage shows loading indicator initially', (
    tester,
  ) async {
    final evolutionCompleter = Completer<RepartidorEvolutionData>();

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          repartidorId: '10',
          loadEvolution: (_, {required forceRefresh}) =>
              evolutionCompleter.future,
        ),
      ),
    );

    // Should show the composed loading widget while data is being fetched.
    expect(find.byType(ModernLoading), findsOneWidget);
    expect(find.text('Analizando evolución...'), findsOneWidget);

    evolutionCompleter.complete(
      RepartidorEvolutionData(evolution: const [], topProducts: const []),
    );
    await tester.pumpAndSettle();
  });

  testWidgets('renders evolution aggregates and top products', (tester) async {
    final requestedOwners = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          repartidorId: '94,95',
          loadEvolution: (owner, {required forceRefresh}) async {
            requestedOwners.add(owner);
            return evolutionData(
              february: 200,
              productName: 'Agregado GMP',
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Evoluci\u00f3n de cobros'), findsOneWidget);
    expect(find.text('Cobros del periodo'), findsOneWidget);
    expect(find.text('Tendencia'), findsOneWidget);
    expect(find.text('100.0%'), findsOneWidget);
    expect(find.text('Productos Top (Ventas)'), findsOneWidget);
    expect(find.text('Agregado GMP'), findsOneWidget);
    expect(requestedOwners, equals(['94,95']));
  });

  testWidgets('renders the explicit empty state', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          repartidorId: '10',
          loadEvolution: (_, {required forceRefresh}) async =>
              RepartidorEvolutionData(
            evolution: const [],
            topProducts: const [],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Todav\u00eda no hay cobros ni productos para mostrar'),
      findsOneWidget,
    );
  });

  testWidgets('retries an initial error with a forced refresh', (tester) async {
    var calls = 0;
    final refreshes = <bool>[];
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          repartidorId: '10',
          loadEvolution: (_, {required forceRefresh}) async {
            refreshes.add(forceRefresh);
            if (calls++ == 0) throw StateError('offline');
            return evolutionData(productName: 'Recuperado');
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Reintentar'), findsOneWidget);
    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();

    expect(find.text('Recuperado'), findsOneWidget);
    expect(refreshes, equals([false, true]));
  });

  testWidgets('manual refresh preserves data and requests fresh evolution', (
    tester,
  ) async {
    final first = Completer<RepartidorEvolutionData>();
    final second = Completer<RepartidorEvolutionData>();
    var calls = 0;
    final refreshes = <bool>[];
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          repartidorId: '10',
          loadEvolution: (_, {required forceRefresh}) {
            refreshes.add(forceRefresh);
            return calls++ == 0 ? first.future : second.future;
          },
        ),
      ),
    );
    first.complete(evolutionData(productName: 'Antes'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Actualizar'));
    await tester.pump();
    expect(find.text('Antes'), findsOneWidget);
    second.complete(evolutionData(productName: 'Despues'));
    await tester.pumpAndSettle();

    expect(find.text('Despues'), findsOneWidget);
    expect(refreshes, equals([false, true]));
  });

  testWidgets('owner change clears old data and ignores an older late response',
      (
    tester,
  ) async {
    final firstDriverA = Completer<RepartidorEvolutionData>();
    final lateDriverA = Completer<RepartidorEvolutionData>();
    final driverB = Completer<RepartidorEvolutionData>();
    final requests = <String>[];
    var driverARequests = 0;
    Future<RepartidorEvolutionData> loader(
      String repartidorId, {
      required bool forceRefresh,
    }) {
      requests.add(repartidorId);
      if (repartidorId == '10') {
        return driverARequests++ == 0
            ? firstDriverA.future
            : lateDriverA.future;
      }
      return driverB.future;
    }

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          key: const ValueKey('evolution'),
          repartidorId: '10',
          loadEvolution: loader,
        ),
      ),
    );
    await tester.pump();
    firstDriverA.complete(evolutionData(productName: 'Conductor A inicial'));
    await tester.pumpAndSettle();
    expect(find.text('Conductor A inicial'), findsOneWidget);

    await tester.tap(find.byTooltip('Actualizar'));
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          key: const ValueKey('evolution'),
          repartidorId: '11',
          loadEvolution: loader,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Conductor A inicial'), findsNothing);
    expect(find.byType(ModernLoading), findsOneWidget);

    driverB.complete(evolutionData(productName: 'Conductor B'));
    await tester.pumpAndSettle();
    lateDriverA.complete(evolutionData(productName: 'Conductor A tardio'));
    await tester.pumpAndSettle();

    expect(requests, equals(['10', '10', '11']));
    expect(find.text('Conductor B'), findsOneWidget);
    expect(find.text('Conductor A tardio'), findsNothing);
  });
}
