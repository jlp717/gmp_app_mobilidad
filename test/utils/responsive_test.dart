// GMP Responsive Design Tests
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class MockBuildContext {
  static bool isTablet(double width) => width >= 600;
  static bool isDesktop(double width) => width >= 1200;
  static bool isMobile(double width) => width < 600;

  static Size getScreenSize(BuildContext context) {
    return const Size(390, 844);
  }
}

void main() {
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
}
