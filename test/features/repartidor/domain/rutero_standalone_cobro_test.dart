import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_standalone_cobro.dart';

AlbaranEntrega _albaran({
  EstadoEntrega estado = EstadoEntrega.pendiente,
  double? saldoCvc = 3279.61,
  double importeDocumento = 2841.76,
  bool esCTR = false,
  String pricingState = 'READY',
  String subempresa = 'GMP',
  String cobroTipoDocumento = '',
  String serie = 'P',
  bool ambiguousCvc = false,
}) {
  final cappedSaldo = ambiguousCvc
      ? 0.0
      : (saldoCvc == null
          ? null
          : (saldoCvc > importeDocumento + 0.004
              ? importeDocumento
              : saldoCvc));
  return AlbaranEntrega(
    id: '2026-P-93-1532-4300001119',
    numeroAlbaran: 1532,
    ejercicio: 2026,
    serie: serie,
    terminal: 93,
    codigoCliente: '4300001119',
    nombreCliente: 'RESTAURANTE LA PEÑA',
    fecha: '2026-09-03',
    importeTotal: importeDocumento,
    estado: estado,
    esCTR: esCTR,
    puedeCobrarse: cappedSaldo != null && cappedSaldo > 0.004,
    importeDisponibleCobro: cappedSaldo,
    importeCvcPendiente: saldoCvc,
    cobroSaldoCapped: saldoCvc != null && saldoCvc > importeDocumento + 0.004,
    pricingState: pricingState,
    subempresa: subempresa,
    cobroTipoDocumento: cobroTipoDocumento,
    tipoPago: 'CREDITO',
    emailCliente: 'cliente@example.com',
  );
}

void main() {
  test('repartidor can collect optional credit with remaining CVC balance', () {
    final albaran = _albaran();
    expect(albaran.esCTR, isFalse);
    expect(canRegisterRuteroStandaloneCobro(albaran), isTrue);
  });

  test('completed partial delivery with remaining balance stays collectible',
      () {
    final albaran = _albaran(
      estado: EstadoEntrega.entregado,
      saldoCvc: 100,
    );
    expect(canRegisterRuteroStandaloneCobro(albaran), isTrue);
  });

  test('no-delivery and rejected stops cannot collect', () {
    expect(
      canRegisterRuteroStandaloneCobro(
          _albaran(estado: EstadoEntrega.noEntregado)),
      isFalse,
    );
    expect(
      canRegisterRuteroStandaloneCobro(
          _albaran(estado: EstadoEntrega.rechazado)),
      isFalse,
    );
  });

  test('zero or missing CVC balance cannot collect', () {
    expect(canRegisterRuteroStandaloneCobro(_albaran(saldoCvc: 0)), isFalse);
    expect(canRegisterRuteroStandaloneCobro(_albaran(saldoCvc: null)), isFalse);
  });

  test('ambiguous CVC (pending exists but collectable is 0) cannot collect',
      () {
    final albaran = _albaran(ambiguousCvc: true);
    expect(albaran.importeCvcPendiente, 3279.61);
    expect(albaran.importeDisponibleCobro, 0);
    expect(canRegisterRuteroStandaloneCobro(albaran), isFalse);
  });

  test('pending ERP price cannot collect', () {
    expect(
      canRegisterRuteroStandaloneCobro(_albaran(pricingState: 'PENDING_PRICE')),
      isFalse,
    );
  });

  test('payload uses existing finance cobro contract with RUTERO origin', () {
    final payload = buildRuteroStandaloneCobroPayload(
      albaran: _albaran(cobroTipoDocumento: 'CAC', subempresa: '01'),
      repartidorId: '94',
      importeCobrado: 100,
      formaPago: 'efectivo',
      idempotencyToken: 'rut_94_doc_0123456789abcdef0123456789abcdef',
      notas: 'resto ruta',
    );

    expect(payload['pantallaOrigen'], 'RUTERO');
    expect(payload['tipoDocumento'], 'CAC');
    expect(payload['origenDocumento'], 'B');
    expect(payload['subempresaDocumento'], '01');
    expect(payload['ejercicioDocumento'], 2026);
    expect(payload['serieDocumento'], 'P');
    expect(payload['terminalDocumento'], 93);
    expect(payload['numeroDocumento'], 1532);
    expect(payload['xdeDocumento'], 1);
    expect(payload['dexDocumento'], 1);
    expect(payload['importeCobrado'], 100);
    expect(payload['importePendiente'], 2741.76);
    expect(payload['formaPago'], 'EFECTIVO');
    expect(payload['notas'], 'resto ruta');
    expect(payload['entregaId'], '2026-P-93-1532-4300001119');
  });

  test('payload defaults tipo CAC when the albarán has no CVC tipo', () {
    final payload = buildRuteroStandaloneCobroPayload(
      albaran: _albaran(),
      repartidorId: '94',
      importeCobrado: 10,
      formaPago: 'BIZUM',
      idempotencyToken: 'rut_94_abc_0123456789abcdef0123456789abcdef',
    );
    expect(payload['tipoDocumento'], 'CAC');
    expect(payload.containsKey('notas'), isFalse);
  });

  test('partial amount cannot exceed collectible balance', () {
    expect(
      validateRuteroStandaloneCobroAmount(amount: 50, maxCollectable: 40),
      isNotNull,
    );
    expect(
      validateRuteroStandaloneCobroAmount(amount: 40, maxCollectable: 40),
      isNull,
    );
    expect(
      validateRuteroStandaloneCobroAmount(amount: null, maxCollectable: 40),
      isNotNull,
    );
  });

  test('idempotency token stays within finance schema bounds', () {
    final token = createRuteroStandaloneCobroIdempotencyToken(
      '94',
      '2026-P-93-1532-4300001119',
      entropy: List<int>.filled(16, 1),
    );
    expect(token.length, lessThanOrEqualTo(128));
    expect(token, startsWith('rut_94_'));
    expect(RegExp(r'^[A-Za-z0-9_.:-]+$').hasMatch(token), isTrue);
  });

  test('84,68 CVC vs 49,56 document: payload remaining uses the document cap',
      () {
    final payload = buildRuteroStandaloneCobroPayload(
      albaran: _albaran(saldoCvc: 84.68, importeDocumento: 49.56),
      repartidorId: '08',
      importeCobrado: 0.01,
      formaPago: 'EFECTIVO',
      idempotencyToken: 'rut_08_doc_0123456789abcdef0123456789abcdef',
    );
    expect(payload['importeCobrado'], 0.01);
    expect(payload['importePendiente'], 49.55);
  });

  test('remaining collectable drops to zero below one cent', () {
    expect(remainingCollectableAfter(currentAvailable: 10, collected: 10), 0);
    expect(
      remainingCollectableAfter(currentAvailable: 10.01, collected: 0.01),
      10,
    );
  });
}
