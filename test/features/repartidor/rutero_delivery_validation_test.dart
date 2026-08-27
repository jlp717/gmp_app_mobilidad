import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';

RuteroDeliveryValidationInput _base({
  bool isLoadingItems = false,
  String? loadError,
  bool hasItems = true,
  bool anyQtyModified = false,
  bool anyUnchecked = false,
  RepartoDeliveryStatus status = RepartoDeliveryStatus.entregado,
  String nombre = 'Ana',
  String apellidos = 'Lopez',
  String dni = '12345678Z',
  String observaciones = 'ok',
  String incidenciaMotivo = '',
  bool isUrgent = false,
  bool isPaid = false,
  bool signatureEmpty = false,
  bool hasPersistedSignature = false,
  String importeCobradoText = '',
  double importeTotal = 10,
  double? importeDisponibleCobro,
}) {
  return RuteroDeliveryValidationInput(
    isLoadingItems: isLoadingItems,
    loadError: loadError,
    hasItems: hasItems,
    anyQtyModified: anyQtyModified,
    anyUnchecked: anyUnchecked,
    status: status,
    nombre: nombre,
    apellidos: apellidos,
    dni: dni,
    observaciones: observaciones,
    incidenciaMotivo: incidenciaMotivo,
    isUrgent: isUrgent,
    isPaid: isPaid,
    signatureEmpty: signatureEmpty,
    hasPersistedSignature: hasPersistedSignature,
    importeCobradoText: importeCobradoText,
    importeTotal: importeTotal,
    importeDisponibleCobro: importeDisponibleCobro,
  );
}

void main() {
  test('DNI 12345678Z is valid', () {
    expect(isValidRuteroDniNie('12345678Z'), isTrue);
  });

  test('valid delivery has no issues', () {
    final result = validateRuteroDeliveryForm(_base());
    expect(result.isValid, isTrue);
    expect(result.issues, isEmpty);
  });

  test('jumps to first tab when products and finalize both fail', () {
    final result = validateRuteroDeliveryForm(
      _base(
        anyUnchecked: true,
        nombre: '',
        signatureEmpty: true,
        observaciones: '',
      ),
    );
    expect(result.isValid, isFalse);
    expect(result.firstTabIndex, 0);
    expect(result.countForTab(RuteroDeliveryTab.products), greaterThan(0));
    expect(result.countForTab(RuteroDeliveryTab.finalize), greaterThan(0));
  });

  test('urgent unpaid jumps to cobro before finalize', () {
    final result = validateRuteroDeliveryForm(
      _base(
          isUrgent: true,
          isPaid: false,
          nombre: '',
          importeDisponibleCobro: 10),
    );
    expect(result.firstTabIndex, 1);
    expect(result.messageFor('pago'), contains('Cobro obligatorio'));
    expect(result.messageFor('nombre'), isNotNull);
  });

  test('urgent delivery with explicit zero CVC balance can be delivered unpaid',
      () {
    final result = validateRuteroDeliveryForm(
      _base(isUrgent: true, importeDisponibleCobro: 0),
    );
    expect(result.messageFor('pago'), isNull);
  });

  test('paid amount is capped by the CVC balance, not the invoice total', () {
    final result = validateRuteroDeliveryForm(
      _base(
        importeTotal: 100,
        importeDisponibleCobro: 12,
        isPaid: true,
        importeCobradoText: '12,01',
      ),
    );
    expect(result.messageFor('importe'), contains('saldo cobrable'));
  });
  test('urgent rejected delivery does not demand an impossible payment', () {
    final result = validateRuteroDeliveryForm(
      _base(
        status: RepartoDeliveryStatus.rechazado,
        isUrgent: true,
        nombre: 'Ana',
        apellidos: 'Lopez',
        observaciones: 'Cliente rechaza la entrega',
        incidenciaMotivo: 'Rechazo del cliente',
      ),
    );
    expect(result.messageFor('pago'), isNull);
  });
  test('invalid DNI stays on finalizar', () {
    final result = validateRuteroDeliveryForm(_base(dni: '1234'));
    expect(result.firstTabIndex, 2);
    expect(result.messageFor('dni'), contains('Formato no válido'));
  });

  test('missing DNI is the first finalize issue to jump to', () {
    final result = validateRuteroDeliveryForm(
      _base(dni: '', nombre: 'Ana', apellidos: 'Lopez'),
    );
    expect(result.isValid, isFalse);
    expect(result.firstTabIndex, 2);
    expect(result.issues.first.field, 'dni');
    expect(result.messageFor('dni'), contains('obligatorio'));
  });

  test('paid amount above total is visible on cobro', () {
    final result = validateRuteroDeliveryForm(
      _base(isPaid: true, importeCobradoText: '20,00', importeTotal: 10),
    );
    expect(result.firstTabIndex, 1);
    expect(result.messageFor('importe'), contains('no puede superar'));
  });

  test('prepaid zero total can confirm without product lines', () {
    final result = validateRuteroDeliveryForm(
      _base(hasItems: false, importeTotal: 0),
    );
    expect(result.messageFor('items'), isNull);
  });

  test('each blocking field maps to its tab scroll pane', () {
    expect(ruteroScrollPaneForField('items'), RuteroScrollPane.products);
    expect(
      ruteroScrollPaneForField('productsStatus'),
      RuteroScrollPane.products,
    );
    expect(ruteroScrollPaneForField('pago'), RuteroScrollPane.payment);
    expect(ruteroScrollPaneForField('importe'), RuteroScrollPane.payment);
    expect(ruteroScrollPaneForField('nombre'), RuteroScrollPane.finalize);
    expect(ruteroScrollPaneForField('apellidos'), RuteroScrollPane.finalize);
    expect(ruteroScrollPaneForField('dni'), RuteroScrollPane.finalize);
    expect(
      ruteroScrollPaneForField('observaciones'),
      RuteroScrollPane.finalize,
    );
    expect(ruteroScrollPaneForField('firma'), RuteroScrollPane.finalize);
  });

  test('printer timeout message is honest and not zebra-only', () {
    const result = PrinterJobResult.fail(PrinterFailureCode.timeout);
    expect(result.ok, isFalse);
    expect(result.message.toLowerCase(), contains('impresora'));
    expect(result.message.toLowerCase(), isNot(contains('zebra')));
  });

  test('printer sendFailed tells user to switch ZPL or ESC/POS', () {
    const result = PrinterJobResult.fail(PrinterFailureCode.sendFailed);
    expect(result.ok, isFalse);
    expect(result.message.toLowerCase(), contains('zpl'));
    expect(result.message.toLowerCase(), contains('esc/pos'));
  });
}
