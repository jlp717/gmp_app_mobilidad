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

    testWidgets(
      '1280×800 split-cart catalog still exposes ≥9 products',
      (tester) async {
        // Real chrome: sidebar 90 + content split 3:2 at width≥1000.
        const screenW = 1280.0;
        const screenH = 800.0;
        const sidebar = 90.0;
        const chromeH = 120.0; // app bar + filters
        final contentW = screenW - sidebar;
        expect(contentW >= 1000, isTrue); // usePedidosSplitCart
        final catalogW = contentW * 3 / 5; // flex 3 vs cart flex 2 ≈ 714
        final catalogH = screenH - chromeH;

        late int cols;
        late int cols680;
        late double extent;
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(
                size: Size(screenW, screenH),
                devicePixelRatio: 1,
              ),
              child: Builder(
                builder: (context) {
                  cols = Responsive.catalogCrossAxisCountForWidth(
                    catalogW,
                    landscape: true,
                  );
                  cols680 = Responsive.catalogCrossAxisCountForWidth(
                    680,
                    landscape: true,
                  );
                  extent = Responsive.catalogTileExtent(context);
                  return const SizedBox.shrink();
                },
              ),
            ),
          ),
        );

        final visible = cols * (catalogH / extent).floor();
        expect(catalogW, closeTo(714, 1));
        expect(cols680, 3);
        expect(cols, 3);
        expect(extent, lessThanOrEqualTo(82));
        expect(visible, greaterThanOrEqualTo(9));
      },
    );

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
