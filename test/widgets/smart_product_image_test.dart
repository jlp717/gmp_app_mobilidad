import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';

void main() {
  group('SmartProductImage Widget Tests', () {
    Widget buildTestWidget({
      String imageUrl = '',
      String productCode = 'ABC123',
      String? productName,
      double width = 100,
      double height = 100,
      bool showCodeOnFallback = true,
      BorderRadius? borderRadius,
    }) {
      return MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: width,
            height: height,
            child: SmartProductImage(
              imageUrl: imageUrl,
              productCode: productCode,
              productName: productName,
              width: width,
              height: height,
              showCodeOnFallback: showCodeOnFallback,
              borderRadius: borderRadius,
            ),
          ),
        ),
      );
    }

    group('Empty URL handling', () {
      testWidgets('shows fallback for empty imageUrl', (tester) async {
        await tester.pumpWidget(buildTestWidget());

        expect(find.byIcon(Icons.image_not_supported_rounded), findsOneWidget);
      });

      testWidgets(
          'shows product code in fallback when showCodeOnFallback is true',
          (tester) async {
        await tester.pumpWidget(buildTestWidget(productCode: 'XYZ789'));

        expect(find.text('XYZ789'), findsOneWidget);
      });

      testWidgets(
          'shows product name initials in fallback when name is provided',
          (tester) async {
        await tester.pumpWidget(buildTestWidget(
          productCode: 'ABC123',
          productName: 'Test Product',
        ));

        expect(find.text('TE'), findsOneWidget);
      });

      testWidgets('hides code when showCodeOnFallback is false',
          (tester) async {
        await tester.pumpWidget(buildTestWidget(showCodeOnFallback: false));

        expect(find.text('ABC123'), findsNothing);
        expect(find.text('TE'), findsNothing);
      });
    });

    group('Fallback icon', () {
      testWidgets('shows image_not_supported_rounded icon in fallback',
          (tester) async {
        await tester.pumpWidget(buildTestWidget());

        expect(find.byIcon(Icons.image_not_supported_rounded), findsOneWidget);
      });
    });

    group('Dimension handling', () {
      testWidgets('respects custom width and height', (tester) async {
        await tester.pumpWidget(buildTestWidget(width: 150, height: 200));

        final sizedBox = tester.widget<SizedBox>(
          find
              .descendant(
                of: find.byType(SmartProductImage),
                matching: find.byType(SizedBox),
              )
              .first,
        );

        expect(sizedBox.width, 150);
        expect(sizedBox.height, 200);
      });

      testWidgets('defaults to bounded width and height when provided',
          (tester) async {
        await tester.pumpWidget(buildTestWidget(width: 100, height: 100));

        final sizedBox = tester.widget<SizedBox>(
          find
              .descendant(
                of: find.byType(SmartProductImage),
                matching: find.byType(SizedBox),
              )
              .first,
        );

        expect(sizedBox.width, 100);
        expect(sizedBox.height, 100);
      });
    });

    group('Border radius', () {
      testWidgets('applies default border radius of 8', (tester) async {
        await tester.pumpWidget(buildTestWidget());

        final clipRRect = tester.widget<ClipRRect>(
          find
              .descendant(
                of: find.byType(SmartProductImage),
                matching: find.byType(ClipRRect),
              )
              .first,
        );

        expect(clipRRect.borderRadius, BorderRadius.circular(8));
      });

      testWidgets('applies custom border radius', (tester) async {
        await tester.pumpWidget(
            buildTestWidget(borderRadius: BorderRadius.circular(16)));

        final clipRRect = tester.widget<ClipRRect>(
          find
              .descendant(
                of: find.byType(SmartProductImage),
                matching: find.byType(ClipRRect),
              )
              .first,
        );

        expect(clipRRect.borderRadius, BorderRadius.circular(16));
      });
    });

    group('Product code edge cases', () {
      testWidgets('shows code when productName is null', (tester) async {
        await tester.pumpWidget(buildTestWidget(productName: null));

        expect(find.text('ABC123'), findsOneWidget);
      });

      testWidgets('shows code when productName is empty', (tester) async {
        await tester.pumpWidget(buildTestWidget(productName: ''));

        expect(find.text('ABC123'), findsOneWidget);
      });

      testWidgets('shows code when productName is 2 chars or less',
          (tester) async {
        await tester.pumpWidget(buildTestWidget(productName: 'AB'));

        expect(find.text('ABC123'), findsOneWidget);
      });

      testWidgets('shows initials when productName is longer than 2',
          (tester) async {
        await tester.pumpWidget(buildTestWidget(productName: 'Widget Product'));

        expect(find.text('WI'), findsOneWidget);
      });
    });
  });
}
