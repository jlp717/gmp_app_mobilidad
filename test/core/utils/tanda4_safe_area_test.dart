import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// REQ-20 tanda4: safe-area bottom.
/// viewPadding 34 → padding aplicado; 0 → base intacta.
void main() {
  Future<double> readInset(
    WidgetTester tester, {
    required double viewPaddingBottom,
    double base = 0,
  }) async {
    var captured = -1.0;
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            viewPadding: EdgeInsets.only(bottom: viewPaddingBottom),
          ),
          child: Builder(
            builder: (context) {
              captured = Responsive.bottomSafeInset(context, base: base);
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
    await tester.pump();
    return captured;
  }

  testWidgets('viewPadding 34 aplica inset', (tester) async {
    expect(await readInset(tester, viewPaddingBottom: 34), 34);
  });

  testWidgets('viewPadding 34 con base 16 aplica max', (tester) async {
    expect(await readInset(tester, viewPaddingBottom: 34, base: 16), 34);
  });

  testWidgets('viewPadding 0 deja base intacta', (tester) async {
    expect(await readInset(tester, viewPaddingBottom: 0), 0);
    expect(await readInset(tester, viewPaddingBottom: 0, base: 16), 16);
  });

  testWidgets('bottomSafePadding propaga inset', (tester) async {
    EdgeInsets? captured;
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            viewPadding: EdgeInsets.only(bottom: 34),
          ),
          child: Builder(
            builder: (context) {
              captured = Responsive.bottomSafePadding(context, base: 16);
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );
    await tester.pump();
    expect(captured, const EdgeInsets.only(bottom: 34));
  });
}
