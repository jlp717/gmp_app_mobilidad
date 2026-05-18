import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/repartidor_evolution_page.dart';

void main() {
  testWidgets('RepartidorEvolutionPage shows loading indicator initially',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: RepartidorEvolutionPage(repartidorId: '10'),
      ),
    );

    // Should show a loading indicator while data is being fetched
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
