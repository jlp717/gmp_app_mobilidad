'use strict';

const {
  RepartoContractError,
  buildConfirmationCommand,
} = require('../services/reparto-confirmation-contract');

function requestFor(repartidorId) {
  return {
    headers: { 'idempotency-key': 'actor-privilege-test' },
    body: {
      delivery: {
        itemId: '2026-S-10-404-4300009479',
        repartidorId,
        status: 'ENTREGADO',
        occurredAt: new Date().toISOString(),
        receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
        firma: 'ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        lineas: [{
          lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 1,
          cantidadEntregada: 1, cantidadRechazada: 0, cantidadPendiente: 0,
        }],
      },
    },
  };
}

describe('canonical reparto actor privilege', () => {
  test.each([
    { id: 'J1', code: '17', role: 'JEFE_VENTAS' },
    { id: 'J1', code: '17', role: 'JEFE_VENTAS', isJefeVentas: true },
    { id: 'J1', code: '17', role: 'JEFE_VENTAS', activeMode: 'COMERCIAL', isJefeVentas: true },
  ])('does not let sales-manager flags act for another repartidor', (user) => {
    expect(() => buildConfirmationCommand({
      user,
      ...requestFor('95'),
    })).toThrow(expect.objectContaining({
      code: 'DELIVERY_OWNERSHIP_REQUIRED',
      statusCode: 403,
    }));
  });

  test('allows JEFE supervising Perfil Reparto to confirm for selected driver', () => {
    const command = buildConfirmationCommand({
      user: {
        id: 'V98',
        code: '98',
        role: 'JEFE_VENTAS',
        activeMode: 'REPARTIDOR',
        isJefeVentas: true,
      },
      ...requestFor('95'),
    });

    expect(command.actor).toMatchObject({
      repartidorId: '95',
      privileged: true,
      role: 'JEFE_VENTAS',
    });
  });

  test('allows only ADMIN to select another repartidor in the internal contract', () => {
    const command = buildConfirmationCommand({
      user: { id: 'A1', code: '17', role: 'ADMIN' },
      ...requestFor('95'),
    });

    expect(command.actor).toMatchObject({ repartidorId: '95', privileged: true, role: 'ADMIN' });
  });

  test('keeps typed ownership failures', () => {
    try {
      buildConfirmationCommand({
        user: { id: 'R1', code: '17', role: 'REPARTIDOR' },
        ...requestFor('95'),
      });
      throw new Error('expected ownership failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RepartoContractError);
      expect(error).toMatchObject({ code: 'DELIVERY_OWNERSHIP_REQUIRED', statusCode: 403 });
    }
  });
});
