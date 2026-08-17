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
      _base(isUrgent: true, isPaid: false, nombre: ''),
    );
    expect(result.firstTabIndex, 1);
    expect(result.messageFor('pago'), contains('Cobro obligatorio'));
    expect(result.messageFor('nombre'), isNotNull);
  });

  test('invalid DNI stays on finalizar', () {
    final result = validateRuteroDeliveryForm(_base(dni: '1234'));
    expect(result.firstTabIndex, 2);
    expect(result.messageFor('dni'), contains('Formato no válido'));
  });

  test('paid amount above total is visible on cobro', () {
    final result = validateRuteroDeliveryForm(
      _base(isPaid: true, importeCobradoText: '20,00', importeTotal: 10),
    );
    expect(result.firstTabIndex, 1);
    expect(result.messageFor('importe'), contains('no puede superar'));
  });

  test('printer timeout message is honest and not zebra-only', () {
    const result = PrinterJobResult.fail(PrinterFailureCode.timeout);
    expect(result.ok, isFalse);
    expect(result.message.toLowerCase(), contains('impresora'));
    expect(result.message.toLowerCase(), isNot(contains('zebra')));
  });
}
