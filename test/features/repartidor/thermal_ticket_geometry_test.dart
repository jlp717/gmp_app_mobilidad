import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/thermal_zpl_geometry.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';

AlbaranEntrega _sampleAlbaran() {
  return AlbaranEntrega(
    id: 'I-2-1507',
    numeroAlbaran: 1507,
    ejercicio: 2026,
    serie: 'I',
    terminal: 2,
    codigoCliente: '4300010049',
    nombreCliente: 'ENCEBOLLADOS BUTANO RESTURANTE',
    fecha: '2026-08-20',
    importeTotal: 36.40,
    importeNeto: 35,
    direccion: 'CL TENOR GABARRON, ALAMEDA CERVANTES 12',
    formaPagoDesc: 'CREDITO',
    nombreRepartidor: '08 DAVID MUÑOZ RODRIGUEZ',
    ordenPreparacion: 44520,
    ivaBreakdown: [
      IvaBreakdownItem(base: 35, pct: 4, iva: 1.40),
    ],
  );
}

List<EntregaItem> _sampleItems() {
  return [
    EntregaItem(
      itemId: '1',
      codigoArticulo: '2323',
      descripcion: 'HUEVOS L MORENOS 63/73 (10)',
      cantidadPedida: 1,
      bultos: 1,
      precioUnitario: 35,
    ),
    EntregaItem(
      itemId: '2',
      codigoArticulo: '1001',
      descripcion:
          'PRODUCTO LARGO PARA PROBAR TRUNCADO SIN CORTAR BORDE DERECHO',
      cantidadPedida: 3,
      bultos: 2,
      precioUnitario: 12.50,
    ),
  ];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Thermal ticket confidence (no physical printer)', () {
    late ZplGraphic logo80;
    late ZplGraphic logo58;

    setUpAll(() async {
      const wide = ThermalTicketLayout(widthMm: 80);
      const narrow = ThermalTicketLayout(widthMm: 58);

      // Prove asset ships with the app (same art as factura PDF).
      final bytes = await rootBundle.load('assets/branding/ticket_header.png');
      expect(bytes.lengthInBytes, greaterThan(10 * 1024));

      final g80 = await ZebraPrintService.loadCompanyLogoGrf(
        maxWidth: wide.logoMaxWidth,
        maxHeight: wide.logoMaxHeight,
      );
      final g58 = await ZebraPrintService.loadCompanyLogoGrf(
        maxWidth: narrow.logoMaxWidth,
        maxHeight: narrow.logoMaxHeight,
      );
      expect(g80, isNotNull, reason: 'Logo GRF must convert for 80mm');
      expect(g58, isNotNull, reason: 'Logo GRF must convert for 58mm');
      logo80 = g80!;
      logo58 = g58!;
    });

    test('logo fits and centers inside 80mm content box', () {
      const L = ThermalTicketLayout(widthMm: 80);
      expect(logo80.widthDots, lessThanOrEqualTo(L.logoMaxWidth));
      expect(logo80.heightDots, lessThanOrEqualTo(L.logoMaxHeight));
      final x = L.centerX(logo80.widthDots);
      expect(x, greaterThanOrEqualTo(L.xLeft));
      expect(x + logo80.widthDots, lessThanOrEqualTo(L.xRight));
      expect(x, L.xLeft + ((L.contentWidth - logo80.widthDots) ~/ 2));
    });

    test('logo fits and centers inside 58mm content box', () {
      const L = ThermalTicketLayout(widthMm: 58);
      expect(logo58.widthDots, lessThanOrEqualTo(L.logoMaxWidth));
      expect(logo58.heightDots, lessThanOrEqualTo(L.logoMaxHeight));
      final x = L.centerX(logo58.widthDots);
      expect(x, greaterThanOrEqualTo(L.xLeft));
      expect(x + logo58.widthDots, lessThanOrEqualTo(L.xRight));
    });

    for (final widthMm in [58, 80]) {
      test('delivery ZPL geometry safe @ ${widthMm}mm', () {
        final L = ThermalTicketLayout(widthMm: widthMm);
        final logo = widthMm == 80 ? logo80 : logo58;
        final zpl = ZebraPrintService.generateDeliveryZpl(
          albaran: _sampleAlbaran(),
          items: _sampleItems(),
          observaciones: 'Entregar en cocina, no dejar en barra',
          receptorNombre: 'prueba',
          receptorDni: '23331494H',
          signatureGrf: null,
          fechaFirma: DateTime(2026, 8, 20, 10, 5),
          layout: L,
          logoGrf: logo,
        );

        expect(zpl, contains('^PW${L.printWidthDots}'));
        expect(zpl, contains('^LT0'));
        expect(zpl, contains('ALBARAN: I-2-1507'));
        expect(zpl, contains('TOTAL:'));
        // With logo present, no redundant text company header.
        expect(zpl, isNot(contains('CIF: B04008710')));

        final report = ThermalZplGeometry.audit(zpl, L);
        expect(
          report.ok,
          isTrue,
          reason: report.issues.map((e) => e.message).join('\n'),
        );
        expect(report.firstContentY, L.marginTop);
        expect(report.printWidth, L.printWidthDots);
        expect(
          report.labelLength,
          lessThanOrEqualTo((report.lastContentY ?? 0) + L.marginBottom + 30),
        );
        expect(
          utf8ByteLength(zpl),
          lessThan(65536),
          reason: 'Payload must fit printer buffer',
        );
      });

      test('history reprint ZPL geometry safe @ ${widthMm}mm', () {
        final L = ThermalTicketLayout(widthMm: widthMm);
        final logo = widthMm == 80 ? logo80 : logo58;
        final zpl = ZebraPrintService.generateHistoryDeliveryZpl(
          title: 'ALBARAN I-2-1507',
          clientName: 'ENCEBOLLADOS BUTANO RESTURANTE',
          dateLabel: '20/08/2026',
          total: 36.40,
          receptorNombre: 'prueba',
          receptorDni: '23331494H',
          layout: L,
          logoGrf: logo,
        );
        final report = ThermalZplGeometry.audit(zpl, L);
        expect(
          report.ok,
          isTrue,
          reason: report.issues.map((e) => e.message).join('\n'),
        );
      });
    }

    test('fallback text header still respects margins without logo', () {
      const L = ThermalTicketLayout(widthMm: 80);
      final zpl = ZebraPrintService.generateDeliveryZpl(
        albaran: _sampleAlbaran(),
        items: _sampleItems(),
        observaciones: '',
        receptorNombre: 'Ana',
        receptorDni: '12345678Z',
        layout: L,
        logoGrf: null,
      );
      expect(zpl, contains('GRANJA MARI PEPA S.L.'));
      final report = ThermalZplGeometry.audit(zpl, L);
      expect(
        report.ok,
        isTrue,
        reason: report.issues.map((e) => e.message).join('\n'),
      );
    });

    test('printer-name inference picks safe printable widths', () {
      expect(
        ThermalTicketLayout.forPrinter(printerName: 'Zebra ZQ210')
            .printWidthDots,
        384,
      );
      expect(
        ThermalTicketLayout.forPrinter(printerName: 'Zebra ZQ320')
            .printWidthDots,
        576,
      );
      expect(
        ThermalTicketLayout.forPrinter(printerName: 'Unknown BT Printer')
            .printWidthDots,
        576,
      );
    });
  });
}

int utf8ByteLength(String s) => s.codeUnits.fold<int>(0, (n, c) {
      if (c <= 0x7f) return n + 1;
      if (c <= 0x7ff) return n + 2;
      return n + 3;
    });
