'use strict';

const {
  LiquidacionContractError,
  LIQUIDACION_MARKER_MAX_LENGTH,
  buildLiquidacionCommand,
  assertReplayCompatible,
} = require('../services/repartidor-liquidacion-contract');

const validInput = () => ({
  repartidorId: ' r-17 ',
  date: '2026-08-09',
  idempotencyToken: 'liquidacion-2026-08-09-r17',
  matricula: ' 1234 abc ',
  codigoVehiculo: ' furgon-1 ',
  sendEmails: true,
});

function expectContractError(fn, code, statusCode = 422) {
  try {
    fn();
    throw new Error('Expected LiquidacionContractError');
  } catch (error) {
    expect(error).toBeInstanceOf(LiquidacionContractError);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(statusCode);
  }
}

describe('repartidor-liquidacion-contract', () => {
  test('normaliza metadatos operativos y genera marcador estable sin token crudo', () => {
    const first = buildLiquidacionCommand(validInput());
    const second = buildLiquidacionCommand(validInput());

    expect(first.repartidorId).toBe('R-17');
    expect(first.matricula).toBe('1234 ABC');
    expect(first.marker).toBe(second.marker);
    expect(first.marker).toHaveLength(LIQUIDACION_MARKER_MAX_LENGTH);
    expect(first.marker).not.toContain(first.idempotencyToken);
  });

  test.each([
    ['idempotencyToken', 'x', 'INVALID_IDEMPOTENCY_TOKEN'],
    ['date', '2026-02-30', 'INVALID_LIQUIDACION_DATE'],
    ['repartidorId', ' ', 'INVALID_REPARTIDOR_ID'],
    ['repartidorId', 'REP/01', 'INVALID_REPARTIDOR_ID'],
    ['repartidorId', '123456789012345678901', 'INVALID_REPARTIDOR_ID'],
    ['codigoVehiculo', '12345678901', 'INVALID_CODIGO_VEHICULO'],
    ['codigoVehiculo', 'FUR/GON', 'INVALID_CODIGO_VEHICULO'],
    ['matricula', '../1234ABC', 'INVALID_MATRICULA'],
    ['matricula', 'ABC@123', 'INVALID_MATRICULA'],
    ['matricula', '🚚1234', 'INVALID_MATRICULA'],
    ['matricula', 'A', 'INVALID_MATRICULA'],
  ])('rechaza %s invalido', (field, value, code) => {
    const input = validInput();
    input[field] = value;
    expectContractError(() => buildLiquidacionCommand(input), code);
  });

  test.each([
    'totals', 'gastos', 'ajustes', 'efectivo', 'cheques', 'tarjeta', 'postdatados', 'saldo',
    'clientDerivedTotals', 'importe', 'entregas', 'ingresos', 'cobros',
  ])('rechaza valor derivado de cliente: %s', (field) => {
    const input = validInput();
    input[field] = [];
    expectContractError(() => buildLiquidacionCommand(input), 'CLIENT_DERIVED_TOTALS_FORBIDDEN');
  });

  test('rechaza campos desconocidos', () => {
    const unknown = validInput();
    unknown.otraCosa = true;
    expectContractError(() => buildLiquidacionCommand(unknown), 'UNKNOWN_LIQUIDACION_FIELD');

    const list = validInput();
    list.otraLista = [];
    expectContractError(() => buildLiquidacionCommand(list), 'CLIENT_DERIVED_TOTALS_FORBIDDEN');
  });

  test('el replay compara identidad canonica, ignora email y falla 409 ante diferencias financieras', () => {
    const first = buildLiquidacionCommand(validInput());
    expect(assertReplayCompatible(first, buildLiquidacionCommand(validInput()))).toBe(true);

    const notificationOnly = validInput();
    notificationOnly.sendEmails = false;
    expect(assertReplayCompatible(first, buildLiquidacionCommand(notificationOnly))).toBe(true);

    for (const [field, value] of [
      ['codigoVehiculo', 'FURGON-2'],
      ['date', '2026-08-10'],
      ['repartidorId', 'R-18'],
    ]) {
      const different = validInput();
      different[field] = value;
      expectContractError(
        () => assertReplayCompatible(first, buildLiquidacionCommand(different)),
        'LIQUIDACION_REPLAY_MISMATCH',
        409,
      );
    }
  });

  test('replay rechaza shapes vacias, parciales o con identidad financiera derivada', () => {
    const command = buildLiquidacionCommand(validInput());
    expectContractError(() => assertReplayCompatible({}, command), 'INVALID_LIQUIDACION_REPLAY_IDENTITY');
    expectContractError(
      () => assertReplayCompatible({ idempotencyToken: command.idempotencyToken, replayIdentity: {} }, command),
      'INVALID_LIQUIDACION_REPLAY_IDENTITY',
    );
    expectContractError(
      () => assertReplayCompatible({
        idempotencyToken: command.idempotencyToken,
        replayIdentity: { ...command.replayIdentity, totals: { efectivo: 10 } },
      }, command),
      'INVALID_LIQUIDACION_REPLAY_IDENTITY',
    );
  });

  test('el resultado es profundamente inmutable', () => {
    const command = buildLiquidacionCommand(validInput());
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.replayIdentity)).toBe(true);
  });
});
