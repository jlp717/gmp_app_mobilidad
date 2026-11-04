import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/data/comercial_liquidacion_service.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/presentation/pages/comercial_liquidacion_diaria_page.dart';

const _viewports = <String, Size>{
  'compact portrait': Size(390, 844),
  'tablet portrait': Size(800, 1280),
  'tablet landscape': Size(1280, 800),
};

const _summary = ComercialLiquidacionSummary(
  totalEfectivo: 1285,
  totalCheques: 150,
  totalTarjeta: 325.50,
  totalTransferencia: 640,
  totalPostdatados: 80,
  saldoActual: 29.15,
  totalAIngresar: 1314.15,
  porcentajeMinimoVendedor: 75,
);

const _returns = [
  ComercialDevolucionItem(
    documento: 'D-TEST-1',
    cliente: '4300040687',
    amount: -120,
    yaCobrada: true,
    formaPago: 'P1',
    formaPagoDias: 30,
    albaranOrigen: 'P-2-483',
  ),
];

Widget _page({
  required Size size,
  double textScale = 2,
  ComercialLiquidacionSummary summary = _summary,
  Future<List<Map<String, dynamic>>> Function()? pgCollectedLoader,
  Future<void> Function(ComercialLiquidacionDraft)? onSubmit,
  Future<ComercialDevolucionItem> Function({
    required String clientCode,
    required double amount,
    String? documentoOrigen,
    bool yaCobrada,
    String? formaPago,
    String? albaranOrigen,
    String? vencimiento,
  })? onRegisterReturn,
}) {
  return ProviderScope(
    child: MaterialApp(
      theme: AppTheme.darkTheme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          size: size,
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: ComercialLiquidacionDiariaPage(
        employeeCode: '57',
        initialSummary: summary,
        initialReturns: _returns,
        snapshotLoader: () async => ComercialLiquidacionDailySnapshot(
          summary: summary,
          returns: _returns,
        ),
        onSubmit: onSubmit ?? (_) async {},
        onRegisterReturn: onRegisterReturn ??
            ({
              required clientCode,
              required amount,
              documentoOrigen,
              yaCobrada = true,
              formaPago,
              albaranOrigen,
              vencimiento,
            }) async {
              return ComercialDevolucionItem(
                documento: documentoOrigen ?? 'D-TEST-2',
                cliente: clientCode,
                amount: -amount,
                yaCobrada: yaCobrada,
                formaPago: formaPago,
                albaranOrigen: albaranOrigen,
              );
            },
        pgCollectedLoader: pgCollectedLoader,
      ),
    ),
  );
}

double _fontSize(WidgetTester tester, Finder finder) {
  final text = tester.widget<Text>(finder);
  return text.style?.fontSize ?? 0;
}

double _contrastRatio(Color foreground, Color background) {
  final light = foreground.computeLuminance();
  final dark = background.computeLuminance();
  final brightest = light > dark ? light : dark;
  final darkest = light > dark ? dark : light;
  return (brightest + 0.05) / (darkest + 0.05);
}

void _expectReadableFeedback(WidgetTester tester, String message) {
  final feedback = find.text(message);
  expect(feedback, findsOneWidget);
  expect(_fontSize(tester, feedback), greaterThanOrEqualTo(18));
}

void main() {
  group('commercial daily settlement live layout at 200%', () {
    test('primary settlement text tokens meet WCAG AA in both themes', () {
      expect(
        _contrastRatio(AppColors.systemWhite, AppColors.darkPanel),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(AppColors.ink, AppColors.surface),
        greaterThanOrEqualTo(4.5),
      );
    });

    testWidgets('save success feedback is readable at 200%', (tester) async {
      const size = Size(390, 844);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_page(size: size));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), '120');
      await tester.enterText(find.byType(TextFormField).at(1), '80');
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      await tester.pumpAndSettle();

      _expectReadableFeedback(tester, 'Liquidación guardada.');
    });

    testWidgets('save error feedback is readable at 200%', (tester) async {
      const size = Size(390, 844);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        _page(
          size: size,
          onSubmit: (_) async => throw StateError('test failure'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), '120');
      await tester.enterText(find.byType(TextFormField).at(1), '80');
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      await tester.pump(const Duration(milliseconds: 400));

      _expectReadableFeedback(
        tester,
        'No se pudo guardar la liquidación. Inténtalo de nuevo.',
      );
    });

    testWidgets('return success feedback is readable at 200%', (tester) async {
      const size = Size(390, 844);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_page(size: size));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-devuelve-button')),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('comercial-devuelve-cliente')),
        '4300040687',
      );
      await tester.enterText(
        find.byKey(const ValueKey('comercial-devuelve-importe')),
        '120',
      );
      final confirm = find.byKey(const ValueKey('comercial-devuelve-confirm'));
      await tester.ensureVisible(confirm);
      await tester.tap(confirm);
      await tester.pumpAndSettle();

      _expectReadableFeedback(tester, 'Devolución registrada en TEST.');
    });

    for (final viewport in _viewports.entries) {
      testWidgets('${viewport.key} keeps hierarchy and actions usable',
          (tester) async {
        tester.view.physicalSize = viewport.value;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(_page(size: viewport.value));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(
          find.byKey(const ValueKey('comercial-liquidacion-hero')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('comercial-liquidacion-metrics')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('comercial-liquidacion-workspace')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('comercial-liquidacion-save-bar')),
          findsOneWidget,
        );

        expect(
          _fontSize(tester, find.text('Total efectivo')),
          greaterThanOrEqualTo(18),
        );
        expect(
          _fontSize(
            tester,
            find.textContaining('Resumen de caja para cuadrar banco'),
          ),
          greaterThanOrEqualTo(18),
        );
        expect(
          _fontSize(
            tester,
            find.textContaining('Mínimo cobro vendedor'),
          ),
          greaterThanOrEqualTo(18),
        );

        for (final key in const [
          'comercial-liquidacion-devuelve-button',
          'comercial-liquidacion-save-button',
        ]) {
          expect(
            tester.getSize(find.byKey(ValueKey(key))).height,
            greaterThanOrEqualTo(56),
          );
        }

        final appBarButtons = find.descendant(
          of: find.byType(AppBar),
          matching: find.byType(IconButton),
        );
        expect(appBarButtons, findsNWidgets(2));
        for (var index = 0; index < 2; index++) {
          expect(
            tester.getSize(appBarButtons.at(index)).shortestSide,
            greaterThanOrEqualTo(56),
          );
        }
      });
    }

    testWidgets(
        'tablet landscape gives scaled metric words their measured width',
        (tester) async {
      const size = Size(1280, 900);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_page(size: size));
      await tester.pumpAndSettle();

      final label = find.text('Transferencia (informativo)');
      final labelWidget = tester.widget<Text>(label);
      final wordPainter = TextPainter(
        text: TextSpan(
          text: 'Transferencia',
          style: labelWidget.style,
        ),
        maxLines: 1,
        textDirection: TextDirection.ltr,
        textScaler: const TextScaler.linear(2),
      )..layout();

      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(label).width,
        greaterThanOrEqualTo(wordPainter.width),
        reason: 'A word must wrap as a whole instead of splitting mid-word.',
      );
      expect(find.text('640,00\u00a0€'), findsOneWidget);
    });

    testWidgets('normal text preserves the dense landscape metric row',
        (tester) async {
      const size = Size(1280, 900);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_page(size: size, textScale: 1));
      await tester.pumpAndSettle();

      final labels = [
        find.text('Total efectivo'),
        find.text('Total cheques'),
        find.text('Tarjeta (informativo)'),
        find.text('Transferencia (informativo)'),
        find.text('Total postdatados'),
      ];
      Finder tileFor(Finder label) => find
          .ancestor(of: label, matching: find.byType(AnimatedContainer))
          .first;
      final firstTop = tester.getTopLeft(tileFor(labels.first)).dy;
      for (final label in labels.skip(1)) {
        expect(tester.getTopLeft(tileFor(label)).dy, firstTop);
      }
      expect(tester.takeException(), isNull);
    });

    testWidgets('narrow phone keeps a large amount fully visible at 200%',
        (tester) async {
      const size = Size(320, 720);
      const largeSummary = ComercialLiquidacionSummary(
        totalEfectivo: 1234567.89,
        totalCheques: 150,
        totalTarjeta: 325.50,
        totalTransferencia: 640,
        totalPostdatados: 80,
        saldoActual: 29.15,
        totalAIngresar: 1314.15,
        porcentajeMinimoVendedor: 75,
      );
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        _page(size: size, summary: largeSummary),
      );
      await tester.pumpAndSettle();

      final amount = find.text('1.234.567,89\u00a0€');
      expect(amount, findsOneWidget);
      expect(
          tester.widget<Text>(amount).overflow, isNot(TextOverflow.ellipsis));
      expect(tester.takeException(), isNull);
    });

    testWidgets('compact dialog keeps explanatory text and actions readable',
        (tester) async {
      const size = Size(390, 844);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        _page(
          size: size,
          pgCollectedLoader: () async => [
            {
              'cliente': '4300040687',
              'documento': 'M-88',
              'importe': 659.29,
              'formaPago': 'P1',
              'albaran': 'P-2-483',
              'factura': 'F-0-13427',
              'formaPagoDias': 30,
              'vencimiento': '2026-11-30',
            },
          ],
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-devuelve-button')),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(
        find.byKey(const ValueKey('comercial-liquidacion-return-dialog')),
        findsOneWidget,
      );
      expect(
        _fontSize(
          tester,
          find.textContaining('Ajusta caja ya cobrada (LIQ.Vd)'),
        ),
        greaterThanOrEqualTo(18),
      );
      expect(
        _fontSize(tester, find.textContaining('M-88 · P1')),
        greaterThanOrEqualTo(18),
      );

      final cancel = find.widgetWithText(TextButton, 'Cancelar');
      final confirm = find.byKey(const ValueKey('comercial-devuelve-confirm'));
      expect(tester.getSize(cancel).height, greaterThanOrEqualTo(56));
      expect(tester.getSize(confirm).height, greaterThanOrEqualTo(56));
    });
  });
}
