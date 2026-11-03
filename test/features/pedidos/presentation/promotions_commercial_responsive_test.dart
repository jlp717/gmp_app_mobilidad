import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/promotion_detail_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/promotions_list_page.dart';

class _FailingPromotionsAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'controlled promotions failure',
    );
  }
}

const _viewports = <Size>[
  Size(390, 844),
  Size(800, 1280),
  Size(1280, 800),
];

final _promotion = PromotionItem(
  code: '2974',
  name: 'PIZZA JAMON Y QUESO 10UX340/380G',
  promoDesc: 'Campaña especial de regalo para clientes comerciales',
  promoType: 'GIFT',
  promoCode: 'PROMO-2026-11',
  dateFrom: '01/11/2026',
  dateTo: '30/11/2026',
  stockEnvases: 24,
  stockUnidades: 240,
  minQty: 3,
  giftQty: 1,
  cumulative: true,
);

Widget _app(Widget home, {Brightness brightness = Brightness.light}) {
  AppColors.setBrightness(brightness);
  return MaterialApp(
    theme: brightness == Brightness.dark
        ? AppTheme.darkTheme
        : AppTheme.lightTheme,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: const TextScaler.linear(2),
      ),
      child: child!,
    ),
    home: home,
  );
}

Future<void> _setViewport(WidgetTester tester, Size size) async {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  await tester.pump();
}

double _contrast(Color foreground, Color background) {
  final lighter = foreground.computeLuminance() > background.computeLuminance()
      ? foreground
      : background;
  final darker = identical(lighter, foreground) ? background : foreground;
  return (lighter.computeLuminance() + 0.05) /
      (darker.computeLuminance() + 0.05);
}

Text _text(WidgetTester tester, String value) =>
    tester.widget<Text>(find.text(value).first);

void _expectAtLeast18(WidgetTester tester, String value) {
  final widget = _text(tester, value);
  expect(widget.style?.fontSize, greaterThanOrEqualTo(18), reason: value);
}

void main() {
  final originalAdapter = ApiClient.dio.httpClientAdapter;
  final originalBrightness = AppColors.brightness;

  tearDown(() {
    ApiClient.dio.httpClientAdapter = originalAdapter;
    AppColors.setBrightness(originalBrightness);
  });

  testWidgets('lista comercial escala al 200% sin recortes y conserva acciones',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var selectedProducts = 0;
    for (final viewport in _viewports) {
      await _setViewport(tester, viewport);
      await tester.pumpWidget(
        _app(
          PromotionsListPage(
            promotions: [_promotion],
            onProductTap: (_, __) async {
              selectedProducts++;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: '$viewport');
      expect(
        tester.getSize(find.byTooltip('Ocultar filtros')).height,
        greaterThanOrEqualTo(56),
      );
      expect(
        tester.getSize(find.widgetWithText(FilterChip, 'Vigentes')).height,
        greaterThanOrEqualTo(56),
      );
      _expectAtLeast18(tester, 'Vigente');
      _expectAtLeast18(tester, 'Ver detalle');

      final status = _text(tester, 'Vigente');
      final badge = tester.widget<Container>(
        find.byKey(const ValueKey('promotion-status-PROMO-2026-11')),
      );
      final decoration = badge.decoration! as BoxDecoration;
      expect(
        _contrast(status.style!.color!, decoration.color!),
        greaterThanOrEqualTo(4.5),
      );
      final productAction = find.widgetWithText(
        OutlinedButton,
        'Con stock · ${_promotion.code} · ${_promotion.name}',
      );
      await tester.drag(
        find.byType(CustomScrollView),
        const Offset(0, -1800),
      );
      await tester.pumpAndSettle();
      await tester.tap(productAction);
      await tester.pump();
      expect(selectedProducts, greaterThan(0));
    }
  });

  testWidgets('detalle vivo mantiene datos, filtros y acciones accesibles',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var selectedProducts = 0;
    for (final viewport in _viewports) {
      await _setViewport(tester, viewport);
      await tester.pumpWidget(
        _app(
          PromotionDetailPage(
            promoType: 'GIFT',
            promoCode: _promotion.promoCode,
            promoDesc: _promotion.promoDesc,
            dateFrom: _promotion.dateFrom,
            dateTo: _promotion.dateTo,
            minQty: _promotion.minQty,
            giftQty: _promotion.giftQty,
            cumulative: _promotion.cumulative,
            items: [_promotion],
            onProductTap: (_, __) async {
              selectedProducts++;
            },
            onAddGift: (_, __, ___) async => null,
            qtyInOrderResolver: (_) => 3,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: '$viewport');
      expect(find.text(_promotion.name), findsOneWidget);
      _expectAtLeast18(tester, _promotion.name);
      _expectAtLeast18(tester, 'Seleccionar');
      expect(
        tester
            .getSize(find.widgetWithText(ElevatedButton, 'Seleccionar'))
            .height,
        greaterThanOrEqualTo(56),
      );
      expect(
        tester.getSize(find.byTooltip('Solo con stock')).height,
        greaterThanOrEqualTo(56),
      );
      final select = find.widgetWithText(ElevatedButton, 'Seleccionar');
      await tester.ensureVisible(select);
      await tester.tap(select);
      await tester.pump();
      expect(selectedProducts, greaterThan(0));
    }
  });

  testWidgets('contraste efectivo es suficiente en claro y oscuro',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await _setViewport(tester, _viewports[1]);

    for (final brightness in Brightness.values) {
      await tester.pumpWidget(
        _app(
          PromotionsListPage(
            promotions: [_promotion],
            onProductTap: (_, __) async {},
          ),
          brightness: brightness,
        ),
      );
      await tester.pumpAndSettle();
      final code = _text(tester, _promotion.promoCode);
      final card = tester.widget<Card>(
        find
            .ancestor(
              of: find.text(_promotion.promoCode),
              matching: find.byType(Card),
            )
            .first,
      );
      expect(
        _contrast(code.style!.color!, card.color!),
        greaterThanOrEqualTo(4.5),
        reason: '$brightness promo metadata',
      );

      await tester.pumpWidget(
        _app(
          PromotionDetailPage(
            promoType: 'GIFT',
            promoCode: _promotion.promoCode,
            promoDesc: _promotion.promoDesc,
            dateFrom: _promotion.dateFrom,
            dateTo: _promotion.dateTo,
            minQty: _promotion.minQty,
            giftQty: _promotion.giftQty,
            cumulative: _promotion.cumulative,
            items: [_promotion],
            onProductTap: (_, __) async {},
          ),
          brightness: brightness,
        ),
      );
      await tester.pumpAndSettle();
      final select = tester.widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Seleccionar'),
      );
      final background = select.style!.backgroundColor!.resolve({})!;
      final foreground = select.style!.foregroundColor!.resolve({})!;
      expect(
        _contrast(foreground, background),
        greaterThanOrEqualTo(4.5),
        reason: '$brightness select action',
      );
    }
  });

  testWidgets('selector de regalo conserva cantidad y callback comercial',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await _setViewport(tester, _viewports[1]);
    String? giftCode;
    double? giftQty;

    await tester.pumpWidget(
      _app(
        PromotionDetailPage(
          promoType: 'GIFT',
          promoCode: _promotion.promoCode,
          promoDesc: _promotion.promoDesc,
          dateFrom: _promotion.dateFrom,
          dateTo: _promotion.dateTo,
          minQty: _promotion.minQty,
          giftQty: _promotion.giftQty,
          cumulative: _promotion.cumulative,
          items: [_promotion],
          onProductTap: (_, __) async {},
          onAddGift: (code, _, qty) async {
            giftCode = code;
            giftQty = qty;
            return null;
          },
          qtyInOrderResolver: (_) => 3,
        ),
      ),
    );
    await tester.pumpAndSettle();
    final add = find.byTooltip('Añadir una unidad de regalo');
    await tester.scrollUntilVisible(
      add,
      400,
      scrollable: find
          .descendant(
            of: find.byType(SingleChildScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.tap(add);
    await tester.pump();
    final submit = find.bySemanticsLabel('Añadir regalos seleccionados').first;
    await tester.scrollUntilVisible(
      submit,
      500,
      scrollable: find
          .descendant(
            of: find.byType(SingleChildScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(giftCode, _promotion.code);
    expect(giftQty, 1);
  });

  testWidgets('vacío y error explican el siguiente paso con texto legible',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await _setViewport(tester, _viewports.first);

    await tester.pumpWidget(
      _app(
        PromotionsListPage(
          promotions: const [],
          onProductTap: (_, __) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    _expectAtLeast18(
      tester,
      'Sin promociones vigentes ni antiguas para este cliente',
    );

    ApiClient.dio.httpClientAdapter = _FailingPromotionsAdapter();
    await tester.pumpWidget(
      _app(
        PromotionsListPage(
          key: const ValueKey('history-error'),
          promotions: const [],
          clientCode: '4300040687',
          onProductTap: (_, __) async {},
        ),
      ),
    );
    await tester.pump();
    await tester.pumpAndSettle(const Duration(seconds: 1));

    expect(
      find.text('No se pudieron cargar las promociones antiguas'),
      findsOneWidget,
    );
    _expectAtLeast18(
      tester,
      'No se pudieron cargar las promociones antiguas',
    );
    expect(
      tester.getSize(find.widgetWithText(TextButton, 'Reintentar')).height,
      greaterThanOrEqualTo(56),
    );
  });
}
