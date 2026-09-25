import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/widgets/commission_surface.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/widgets/commission_tier_chip.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/widgets/team_table_text.dart';

/// F3-02: extracted widgets keep identical visuals/behaviour.
void main() {
  testWidgets('CommissionTierChip renders tier, range and rate',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: CommissionTierChip(tier: 'F1', range: '0-10k', rate: '2%'),
        ),
      ),
    );

    expect(find.text('F1'), findsOneWidget);
    expect(find.text('0-10k → 2%'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp('F1 0-10k 2%')),
      findsOneWidget,
    );
  });

  test('commissionSurfaceDecoration keeps radius and border', () {
    final decoration = commissionSurfaceDecoration()
        as BoxDecoration;
    expect(decoration.borderRadius, BorderRadius.circular(8));
    expect(decoration.border, isA<Border>());
  });

  test('teamTableText/teamTableMoney return styled Text', () {
    final text = teamTableText('Enero') as Text;
    expect(text.data, 'Enero');
    expect(text.style?.fontSize, 11);

    final money = teamTableMoney(1234.5) as Text;
    expect(money.data, isNotEmpty);
  });
}
