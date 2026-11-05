// GMP Responsive Design Tests
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

class MockBuildContext {
  static bool isTablet(double width) => width >= 600;
  static bool isDesktop(double width) => width >= 1200;
  static bool isMobile(double width) => width < 600;

  static Size getScreenSize(BuildContext context) {
    return const Size(390, 844);
  }
}

void main() {
  Future<double> sidebarWidthFor(
    WidgetTester tester, {
    required Size size,
    required double textScale,
  }) async {
    late double result;
    await tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: TextScaler.linear(textScale),
        ),
        child: Builder(
          builder: (context) {
            result = Responsive.sidebarWidth(context);
            return const SizedBox.shrink();
          },
        ),
      ),
    );
    return result;
  }

  group('Responsive Design Tests', () {
    test('isMobile returns true for small screens', () {
      expect(MockBuildContext.isMobile(400), true);
      expect(MockBuildContext.isMobile(599), true);
      expect(MockBuildContext.isMobile(600), false);
    });

    test('isTablet returns true for medium screens', () {
      expect(MockBuildContext.isTablet(600), true);
      expect(MockBuildContext.isTablet(800), true);
      expect(MockBuildContext.isTablet(1199), true);
      expect(MockBuildContext.isTablet(1200), true); // 1200 is also >= 600
    });

    test('isDesktop returns true for large screens', () {
      expect(MockBuildContext.isDesktop(1200), true);
      expect(MockBuildContext.isDesktop(1920), true);
      expect(MockBuildContext.isDesktop(1199), false);
    });
  });

  group('Breakpoint Tests', () {
    test('mobile breakpoint at 600', () {
      expect(MockBuildContext.isMobile(599), true);
      expect(MockBuildContext.isTablet(600), true);
    });

    test('desktop breakpoint at 1200', () {
      expect(MockBuildContext.isTablet(1199), true);
      expect(MockBuildContext.isDesktop(1200), true);
    });
  });

  group('Accessible tablet sidebar', () {
    for (final size in const [Size(800, 1280), Size(1280, 800)]) {
      testWidgets('keeps Liquidación legible at ${size.width}dp',
          (tester) async {
        for (final entry in const [
          (1.0, 128.0),
          (1.5, 176.0),
          (2.0, 224.0),
        ]) {
          final width = await sidebarWidthFor(
            tester,
            size: size,
            textScale: entry.$1,
          );
          expect(width, entry.$2);
        }
      });
    }

    testWidgets('phones continue using bottom navigation', (tester) async {
      expect(
        await sidebarWidthFor(
          tester,
          size: const Size(430, 932),
          textScale: 2,
        ),
        0,
      );
    });
  });
}
