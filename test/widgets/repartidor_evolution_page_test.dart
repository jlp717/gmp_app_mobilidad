import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/repartidor_evolution_page.dart';

void main() {
  testWidgets('RepartidorEvolutionPage shows loading indicator initially',
      (tester) async {
    final evolutionCompleter = Completer<RepartidorEvolutionData>();

    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorEvolutionPage(
          repartidorId: '10',
          loadEvolution: (_, {required bool forceRefresh}) =>
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
}
