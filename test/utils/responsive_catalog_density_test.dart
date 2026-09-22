import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

void main() {
  group('Responsive catalog density', () {
    testWidgets('landscape tablet panel targets 3–4 columns', (tester) async {
      late int cols720;
      late int cols1100;
      late double extent;

      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(1280, 800),
              devicePixelRatio: 1,
            ),
            child: Builder(
              builder: (context) {
                cols720 = Responsive.catalogCrossAxisCountForWidth(
                  720,
                  landscape: true,
                );
                cols1100 = Responsive.catalogCrossAxisCountForWidth(
                  1100,
                  landscape: true,
                );
                extent = Responsive.catalogTileExtent(context);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(cols720, 3);
      expect(cols1100, 4);
      expect(extent, 82);
      // 3 cols × ~3 rows of 82px ≈ 9+ visible in ~700px catalog height.
      expect((700 / extent).floor() * cols720, greaterThanOrEqualTo(9));
    });

    testWidgets('portrait keeps single column on phone width', (tester) async {
      late int cols;

      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(390, 844),
              devicePixelRatio: 1,
            ),
            child: Builder(
              builder: (context) {
                cols = Responsive.catalogCrossAxisCountForWidth(
                  390,
                  landscape: false,
                );
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(cols, 1);
    });

    testWidgets('dense lists use 2+ cols in landscape tablet', (tester) async {
      late int listCols;

      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(1280, 800),
              devicePixelRatio: 1,
            ),
            child: Builder(
              builder: (context) {
                listCols = Responsive.denseListCrossAxisCount(context);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(listCols, greaterThanOrEqualTo(2));
    });
  });
}
