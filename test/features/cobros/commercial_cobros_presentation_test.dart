import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/pages/cobro_detail_screen.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/pages/cobros_page.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';

const _viewports = <String, Size>{
  'compact portrait': Size(390, 844),
  'tablet portrait': Size(800, 1280),
  'tablet landscape': Size(1280, 800),
};

Widget _surface({
  required Widget child,
  required Size size,
  double textScale = 2,
}) {
  return MaterialApp(
    theme: AppTheme.darkTheme,
    home: MediaQuery(
      data: MediaQueryData(
        size: size,
        textScaler: TextScaler.linear(textScale),
      ),
      child: Scaffold(
        body: SafeArea(child: SingleChildScrollView(child: child)),
      ),
    ),
  );
}

class _FixtureCobrosNotifier extends CobrosNotifier {
  _FixtureCobrosNotifier(this.fixture);

  final CobrosState fixture;

  @override
  CobrosState build(CobrosParams arg) {
    return fixture.copyWith(employeeCode: arg.employeeCode);
  }

  @override
  Future<void> cargarCobrosPendientes(
    String codigoCliente, {
    String? tipoDocumento,
    String? fechaDesde,
    String? fechaHasta,
    String? vendedorCodes,
    bool forceRefresh = false,
  }) async {}

  @override
  Future<void> cargarHistoricoCobros(
    String codigoCliente, {
    String? vendedorCodes,
    bool forceRefresh = false,
  }) async {}

  @override
  Future<void> cargarPendingSummary(
    String? vendedorCode, {
    List<String>? vendedorCodes,
    int limit = 2000,
    int page = 1,
    int offset = 0,
    bool forceRefresh = false,
    String? tipoDocumento,
    String? fechaDesde,
    String? fechaHasta,
  }) async {}
}

CobroPendiente _payableFixture() {
  return CobroPendiente(
    id: 'doc-4300040687',
    referencia: 'F-0-13427',
    tipo: TipoCobro.factura,
    fecha: DateTime(2026, 11, 2),
    fechaVencimiento: DateTime(2026, 10, 15),
    importeTotal: 738.46,
    importePendiente: 738.46,
    estado: EstadoCobro.vencido,
    descripcion: 'Factura comercial F-0-13427',
    tipoDocumento: 'COB',
  );
}

Widget _liveDetail({required CobrosState state, required Size size}) {
  return ProviderScope(
    overrides: [
      cobrosProvider.overrideWith(() => _FixtureCobrosNotifier(state)),
    ],
    child: MaterialApp(
      theme: AppTheme.darkTheme,
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: const TextScaler.linear(2),
        ),
        child: const CobroDetailScreen(
          codigoCliente: '4300040687',
          nombreCliente: 'CLIENTE DE PRUEBA CON NOMBRE COMPLETO',
          employeeCode: '35',
          vendedorCodes: '35',
        ),
      ),
    ),
  );
}

Widget _liveCobrosPage({required Size size}) {
  const fixture = CobrosState(
    employeeCode: '35',
    pendingSummary: {
      '4300040687': {
        'total': 738.46,
        'vencido': 120.10,
        'count': 4,
        'nombre': 'CLIENTE DE PRUEBA CON NOMBRE COMPLETO Y APELLIDOS',
      },
    },
  );
  return ProviderScope(
    overrides: [
      cobrosProvider.overrideWith(() => _FixtureCobrosNotifier(fixture)),
      connectivityStatusProvider.overrideWith(
        (ref) async* {
          yield ConnectivityStatus.online;
        },
      ),
    ],
    child: MaterialApp(
      theme: AppTheme.darkTheme,
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: const TextScaler.linear(2),
        ),
        child: const CobrosPage(employeeCode: '35'),
      ),
    ),
  );
}

void main() {
  group('commercial cobros responsive presentation', () {
    for (final viewport in const {
      'narrow phone': Size(390, 844),
      'tablet landscape': Size(1280, 800),
    }.entries) {
      testWidgets('${viewport.key} live client list grows naturally at 200%',
          (tester) async {
        tester.view.physicalSize = viewport.value;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(_liveCobrosPage(size: viewport.value));
        await tester.pumpAndSettle();

        final tile = find.byKey(const Key('commercial-cobros-client-tile'));
        final name = find.text(
          'CLIENTE DE PRUEBA CON NOMBRE COMPLETO Y APELLIDOS',
        );
        final status = find.text('Estado: Vencido');
        final pending = find.textContaining('738,46');
        final scroll = find.byType(CustomScrollView);
        for (var attempt = 0;
            attempt < 8 && tile.evaluate().isEmpty;
            attempt++) {
          await tester.drag(scroll, const Offset(0, -300));
          await tester.pump();
        }
        expect(tile, findsOneWidget);
        await tester.ensureVisible(tile);
        await tester.pumpAndSettle();
        expect(name, findsOneWidget);
        expect(status, findsOneWidget);
        expect(pending, findsOneWidget);
        expect(tester.takeException(), isNull);

        final tileRect = tester.getRect(tile);
        for (final content in [name, status, pending]) {
          final contentRect = tester.getRect(content);
          expect(contentRect.top, greaterThanOrEqualTo(tileRect.top));
          expect(contentRect.bottom, lessThanOrEqualTo(tileRect.bottom));
        }
        expect(tileRect.height, greaterThan(104));
        if (viewport.key == 'tablet landscape') {
          expect(tileRect.width, greaterThan(viewport.value.width * 0.75));
        }

        await tester.tap(tile);
        await tester.pumpAndSettle();
        expect(find.byType(CobroDetailScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('accessible empty search keeps its clear control',
        (tester) async {
      const size = Size(390, 844);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(_liveCobrosPage(size: size));
      await tester.pumpAndSettle();

      final search = find.byType(TextField);
      final scroll = find.byType(CustomScrollView);
      for (var attempt = 0;
          attempt < 8 && search.evaluate().isEmpty;
          attempt++) {
        await tester.drag(scroll, const Offset(0, -250));
        await tester.pump();
      }
      expect(search, findsOneWidget);
      await tester.ensureVisible(search);
      await tester.enterText(search, 'SIN COINCIDENCIAS');
      final dynamic pageState = tester.state(find.byType(CobrosPage));
      pageState.setState(() {});
      await tester.pump();

      expect(find.text('No se encontraron resultados'), findsOneWidget);
      expect(find.byTooltip('Limpiar búsqueda'), findsOneWidget);
      expect(search, findsOneWidget);
      expect(tester.takeException(), isNull);

      final clear = find.byTooltip('Limpiar búsqueda');
      await tester.ensureVisible(clear);
      await tester.pump();
      await tester.tap(clear);
      await tester.pump();
      expect(find.text('No se encontraron resultados'), findsNothing);
    });

    for (final viewport in _viewports.entries) {
      testWidgets(
        '${viewport.key} keeps customer, status and primary amounts readable',
        (tester) async {
          tester.view.physicalSize = viewport.value;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);

          await tester.pumpWidget(
            _surface(
              size: viewport.value,
              child: Column(
                children: [
                  const CommercialCobrosSummaryPanel(
                    pendingTotal: 1234.56,
                    overdueTotal: 456.78,
                    clientCount: 12,
                    overdueClientCount: 3,
                    sourceLabel: 'ERP CVC',
                  ),
                  CommercialCobroClientTile(
                    code: '4300040687',
                    name: 'CLIENTE DE PRUEBA CON NOMBRE COMPLETO',
                    pending: 738.46,
                    overdue: 120.10,
                    status: 'VENCIDO',
                    hasSummary: true,
                    documentCount: 4,
                    fromErpDebt: false,
                    onTap: () {},
                  ),
                ],
              ),
            ),
          );
          await tester.pump();

          expect(tester.takeException(), isNull);
          expect(find.text('Pendiente total'), findsOneWidget);
          expect(find.text('Vencido'), findsWidgets);
          expect(
            find.text('CLIENTE DE PRUEBA CON NOMBRE COMPLETO'),
            findsOneWidget,
          );
          expect(find.text('Estado: Vencido'), findsOneWidget);
          expect(find.textContaining('738,46'), findsOneWidget);

          final tile = tester.getSize(
            find.byKey(const Key('commercial-cobros-client-tile')),
          );
          expect(tile.height, greaterThanOrEqualTo(56));
        },
      );
    }

    for (final viewport in _viewports.entries) {
      testWidgets(
        '${viewport.key} payment choices and primary action remain usable',
        (tester) async {
          tester.view.physicalSize = viewport.value;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          var method = 'CONTADO';
          var submitted = false;

          await tester.pumpWidget(
            _surface(
              size: viewport.value,
              child: StatefulBuilder(
                builder: (context, setState) => CommercialPaymentControls(
                  paymentMethod: method,
                  total: 738.46,
                  isSubmitting: false,
                  onPaymentMethodChanged: (value) {
                    setState(() => method = value);
                  },
                  onSubmit: () => submitted = true,
                ),
              ),
            ),
          );
          await tester.pump();

          expect(tester.takeException(), isNull);
          expect(find.text('Forma de pago'), findsOneWidget);
          expect(find.textContaining('Cobrar'), findsOneWidget);

          final methodControl = tester.getSize(
            find.byKey(const Key('commercial-payment-method-control')),
          );
          final submit = tester.getSize(
            find.byKey(const Key('commercial-payment-submit')),
          );
          expect(methodControl.height, greaterThanOrEqualTo(56));
          expect(submit.height, greaterThanOrEqualTo(56));

          await tester.tap(find.byKey(const Key('commercial-payment-submit')));
          await tester.pump();
          expect(submitted, isTrue);
        },
      );
    }

    testWidgets('payment method callback keeps the existing choices',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var method = 'CONTADO';

      await tester.pumpWidget(
        _surface(
          size: const Size(390, 844),
          textScale: 1,
          child: StatefulBuilder(
            builder: (context, setState) => CommercialPaymentControls(
              paymentMethod: method,
              total: 120,
              isSubmitting: false,
              onPaymentMethodChanged: (value) {
                setState(() => method = value);
              },
              onSubmit: () {},
            ),
          ),
        ),
      );

      await tester.tap(
        find.byKey(const Key('commercial-payment-method-control')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('CREDITO').last);
      await tester.pumpAndSettle();

      expect(method, 'CREDITO');
    });

    test('primary foregrounds retain WCAG AA contrast', () {
      double luminance(Color color) {
        return color.computeLuminance();
      }

      double ratio(Color foreground, Color background) {
        final light = luminance(foreground);
        final dark = luminance(background);
        final highest = light > dark ? light : dark;
        final lowest = light > dark ? dark : light;
        return (highest + 0.05) / (lowest + 0.05);
      }

      expect(
        ratio(AppColors.systemWhite, AppColors.info),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        ratio(AppColors.systemWhite, AppColors.inkSurface),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        ratio(AppColors.systemWhite, AppColors.softPanel),
        greaterThanOrEqualTo(4.5),
      );
    });
  });

  group('live commercial collection detail at 200%', () {
    for (final viewport in _viewports.entries) {
      testWidgets('${viewport.key} renders live list and actions without clip',
          (tester) async {
        tester.view.physicalSize = viewport.value;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        await tester.pumpWidget(
          _liveDetail(
            size: viewport.value,
            state: CobrosState(
              employeeCode: '35',
              cobrosPendientes: [_payableFixture()],
              pendingSummary: const {
                '4300040687': {
                  'total': 738.46,
                  'vencido': 738.46,
                  'count': 1,
                },
              },
            ),
          ),
        );
        await tester.pump();
        await tester.pump();

        expect(tester.takeException(), isNull);
        expect(
          find.text('CLIENTE DE PRUEBA CON NOMBRE COMPLETO'),
          findsOneWidget,
        );
        expect(
          tester.getSize(find.byTooltip('Actualizar')).shortestSide,
          greaterThanOrEqualTo(56),
        );
        expect(
          tester
              .getSize(
                find.byKey(const Key('commercial-payment-method-control')),
              )
              .height,
          greaterThanOrEqualTo(56),
        );
        expect(
          tester
              .getSize(find.byKey(const Key('commercial-payment-submit')))
              .height,
          greaterThanOrEqualTo(56),
        );

        final verticalList = find.byType(ListView).first;
        for (var i = 0;
            i < 6 && find.byType(ExpansionTile).evaluate().isEmpty;
            i++) {
          await tester.drag(verticalList, const Offset(0, -300));
          await tester.pump();
        }
        final document = find.byType(ExpansionTile).first;
        final documentHeader = find.descendant(
          of: document,
          matching: find.byType(ListTile),
        );
        await tester.ensureVisible(documentHeader);
        await tester.pumpAndSettle();
        await tester.drag(verticalList, const Offset(0, -240));
        await tester.pumpAndSettle();
        expect(find.textContaining('738,46'), findsWidgets);
        await tester.tap(documentHeader);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        for (final label in ['NINGUNO', 'COMPLETO', 'PARCIAL']) {
          final button = find.ancestor(
            of: find.text(label),
            matching: find.byWidgetPredicate(
              (widget) => widget is ElevatedButton,
            ),
          );
          expect(button, findsOneWidget);
          expect(
            tester.getSize(button).height,
            greaterThanOrEqualTo(56),
          );
        }
      });
    }

    testWidgets('live error uses readable text and keeps refresh actionable',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        _liveDetail(
          size: const Size(390, 844),
          state: const CobrosState(
            employeeCode: '35',
            error: 'No se pudo cargar la deuda comercial',
          ),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
      final errorText = tester.widget<Text>(
        find.text('No se pudo cargar la deuda comercial'),
      );
      expect(errorText.style?.fontSize, greaterThanOrEqualTo(18));
      expect(
        tester.getSize(find.byTooltip('Actualizar')).shortestSide,
        greaterThanOrEqualTo(56),
      );
    });

    testWidgets('live empty state remains readable at 200%', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        _liveDetail(
          size: const Size(390, 844),
          state: const CobrosState(employeeCode: '35'),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
      final title = tester.widget<Text>(find.text('No hay cobros pendientes'));
      final subtitle = tester.widget<Text>(find.text('El cliente esta al dia'));
      expect(title.style?.fontSize, greaterThanOrEqualTo(18));
      expect(subtitle.style?.fontSize, greaterThanOrEqualTo(18));
    });
  });
}
