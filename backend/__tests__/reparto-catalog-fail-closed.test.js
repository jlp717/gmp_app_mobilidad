'use strict';

const {
  RepartoCatalogError,
  createRepartoCatalogService,
} = require('../services/reparto-catalog-service');

const canonicalCatalog = Object.freeze({
  statuses: ['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO'],
  differenceReasons: ['PRODUCTO_FALTANTE', 'PRODUCTO_DANADO', 'OTRO'],
  incidentTypes: ['CLIENTE_AUSENTE', 'OTRO'],
  paymentMethods: ['EFECTIVO', 'TARJETA'],
});

function fakeCatalog(load) {
  return { load: jest.fn(load || (async () => canonicalCatalog)) };
}

function command(overrides = {}) {
  return {
    delivery: {
      status: 'PARCIAL',
      lineas: [{ motivoDiferencia: 'PRODUCTO_FALTANTE' }],
      incidencia: { tipo: 'OTRO' },
      ...overrides.delivery,
    },
    cobro: { formaPago: 'EFECTIVO', ...overrides.cobro },
  };
}

async function expectCatalogError(operation, expected) {
  await expect(operation()).rejects.toMatchObject({
    name: 'RepartoCatalogError',
    ...expected,
  });
}

describe('reparto catalog port fails closed', () => {
  test('permite solamente codigos entregados por el catalogo inyectado', async () => {
    const catalog = fakeCatalog();
    const service = createRepartoCatalogService({ catalog, timeoutMs: 100 });

    await expect(service.validateConfirmation(command())).resolves.toEqual(command());
    expect(catalog.load).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  test.each([
    ['estado', { delivery: { status: 'CERRADO' } }, 'delivery.status'],
    ['motivo de diferencia', { delivery: { lineas: [{ motivoDiferencia: 'INVENTADO' }] } }, 'delivery.lineas.0.motivoDiferencia'],
    ['tipo de incidencia', { delivery: { incidencia: { tipo: 'AVERIA' } } }, 'delivery.incidencia.tipo'],
    ['forma de pago', { cobro: { formaPago: 'BIZUM' } }, 'cobro.formaPago'],
  ])('rechaza con 422 un %s que no esta en catalogo', async (_label, overrides, field) => {
    const service = createRepartoCatalogService({ catalog: fakeCatalog(), timeoutMs: 100 });

    await expectCatalogError(
      () => service.validateConfirmation(command(overrides)),
      { code: 'REPARTO_CATALOG_VALUE_UNKNOWN', statusCode: 422, details: { field } },
    );
  });

  test.each([
    ['respuesta vacia', async () => null],
    ['coleccion vacia', async () => ({ ...canonicalCatalog, paymentMethods: [] })],
    ['coleccion ausente', async () => ({ statuses: [] })],
    ['valor vacio', async () => ({ ...canonicalCatalog, statuses: [''] })],
    ['valor duplicado', async () => ({ ...canonicalCatalog, statuses: ['ENTREGADO', 'ENTREGADO'] })],
    ['error de origen', async () => { throw new Error('db unavailable'); }],
  ])('devuelve 503 ante %s', async (_label, load) => {
    const service = createRepartoCatalogService({ catalog: fakeCatalog(load), timeoutMs: 100 });
    await expectCatalogError(
      () => service.validateConfirmation(command()),
      { code: 'REPARTO_CATALOG_UNAVAILABLE', statusCode: 503 },
    );
  });

  test('cancela y devuelve 503 ante timeout sin aplicar allowlist local', async () => {
    let receivedSignal;
    const catalog = fakeCatalog(({ signal }) => new Promise((_resolve, reject) => {
      receivedSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const service = createRepartoCatalogService({ catalog, timeoutMs: 10 });

    await expectCatalogError(
      () => service.validateConfirmation(command()),
      { code: 'REPARTO_CATALOG_UNAVAILABLE', statusCode: 503 },
    );
    expect(receivedSignal.aborted).toBe(true);
  });

  test('propaga cancelacion del llamador como indisponibilidad controlada', async () => {
    const controller = new AbortController();
    const catalog = fakeCatalog(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const service = createRepartoCatalogService({ catalog, timeoutMs: 100 });
    const operation = service.validateConfirmation(command(), { signal: controller.signal });
    controller.abort(new Error('caller cancelled'));

    await expectCatalogError(() => operation, { code: 'REPARTO_CATALOG_UNAVAILABLE', statusCode: 503 });
  });

  test('expone errores tipados', () => {
    const error = new RepartoCatalogError('x');
    expect(error).toMatchObject({ code: 'REPARTO_CATALOG_UNAVAILABLE', statusCode: 503 });
  });
});
