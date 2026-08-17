import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_tab_bar.dart';

void main() {
  testWidgets('validation banner stays visible above the fold', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(useMaterial3: true),
        home: Scaffold(
          backgroundColor: AppTheme.darkBase,
          body: Column(
            children: [
              RuteroValidationBanner(
                issues: const [
                  RuteroFieldIssue(
                    tab: RuteroDeliveryTab.finalize,
                    field: 'dni',
                    message: 'El DNI/NIF es obligatorio.',
                  ),
                ],
                onIssueTap: (_) {},
              ),
              const Expanded(child: SizedBox()),
            ],
          ),
        ),
      ),
    );

    expect(find.text('Revisa este dato para confirmar'), findsOneWidget);
    expect(find.textContaining('DNI/NIF'), findsOneWidget);
  });
}
