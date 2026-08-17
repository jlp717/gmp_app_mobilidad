'use strict';

const {
  detectVarianceLines,
  notifyAfterConfirm,
  buildVarianceEmailHtml,
} = require('../services/reparto-variance-notification-service');

describe('reparto-variance-notification-service', () => {
  test('detectVarianceLines catches delivered != ordered', () => {
    const lines = detectVarianceLines([
      {
        lineaId: '1',
        codigoArticulo: 'A1',
        cantidadPedida: 10,
        cantidadEntregada: 10,
        cantidadRechazada: 0,
        cantidadPendiente: 0,
      },
      {
        lineaId: '2',
        codigoArticulo: 'A2',
        cantidadPedida: 5,
        cantidadEntregada: 3,
        cantidadRechazada: 1,
        cantidadPendiente: 1,
        motivoDiferencia: 'PRODUCTO_FALTANTE',
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineaId: '2',
      codigoArticulo: 'A2',
      cantidadPedida: 5,
      cantidadEntregada: 3,
      diff: -2,
      motivoDiferencia: 'PRODUCTO_FALTANTE',
    });
  });

  test('detectVarianceLines treats pending/rejected as variance', () => {
    const lines = detectVarianceLines([
      {
        lineaId: '9',
        codigoArticulo: 'X',
        cantidadPedida: 4,
        cantidadEntregada: 0,
        cantidadRechazada: 0,
        cantidadPendiente: 4,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].diff).toBe(-4);
  });

  test('buildVarianceEmailHtml includes table headers and diffs', () => {
    const html = buildVarianceEmailHtml({
      documentId: '2026-A-1-100-4300001',
      fecha: '2026-08-12',
      clienteCodigo: '4300001',
      clienteNombre: 'Cliente Demo',
      repartidorId: '94',
      comercialCode: '15',
      deliveryStatus: 'PARCIAL',
      lineas: [{
        codigoArticulo: 'SKU1',
        descripcion: 'Huevos',
        cantidadPedida: 10,
        cantidadEntregada: 8,
        diff: -2,
        motivoDiferencia: 'PRODUCTO_FALTANTE',
      }],
    });
    expect(html).toContain('Diferencia de cantidades');
    expect(html).toContain('SKU1');
    expect(html).toContain('PEDIDA');
    expect(html).toContain('ENTREGADA');
  });

  test('notifyAfterConfirm skips when no variance', async () => {
    const result = await notifyAfterConfirm({
      command: {
        delivery: {
          itemId: '2026-A-1-1-C1',
          lineas: [{
            lineaId: '1',
            codigoArticulo: 'A',
            cantidadPedida: 1,
            cantidadEntregada: 1,
            cantidadRechazada: 0,
            cantidadPendiente: 0,
          }],
        },
        actor: { repartidorId: '94' },
      },
      result: { created: true, confirmationId: '11', deliveryStatus: 'ENTREGADO' },
    }, {
      query: jest.fn(),
      sendEmail: jest.fn(),
      resolveRecipients: jest.fn(),
      resolveComercial: jest.fn(),
    });
    expect(result).toEqual({ skipped: true, reason: 'no_variance' });
  });

  test('notifyAfterConfirm enqueues and emails on variance', async () => {
    const query = jest.fn(async () => []);
    const sendEmail = jest.fn(async () => ({ success: true, messageId: 'm1' }));
    const resolveRecipients = jest.fn(async () => ({
      emails: ['oficina@example.test'],
      details: [],
    }));
    const resolveComercial = jest.fn(async () => '15');

    const env = {
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
      REPARTO_WRITES_ENABLED: 'false',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    };

    const result = await notifyAfterConfirm({
      command: {
        delivery: {
          itemId: '2026-A-1-100-4300001',
          occurredAt: '2026-08-12T10:00:00+02:00',
          status: 'PARCIAL',
          lineas: [{
            lineaId: '1',
            codigoArticulo: 'SKU1',
            cantidadPedida: 10,
            cantidadEntregada: 7,
            cantidadRechazada: 0,
            cantidadPendiente: 3,
            motivoDiferencia: 'PRODUCTO_FALTANTE',
          }],
        },
        actor: { repartidorId: '94' },
        cobro: { codigoCliente: '4300001', nombreCliente: 'Cliente Demo' },
      },
      result: { created: true, confirmationId: '77', deliveryStatus: 'PARCIAL' },
    }, {
      query,
      env,
      sendEmail,
      resolveRecipients,
      resolveComercial,
    });

    expect(resolveComercial).toHaveBeenCalledWith('2026-A-1-100-4300001', expect.any(Object));
    expect(resolveRecipients).toHaveBeenCalledWith(
      { repartidorId: '94', comercialCode: '15' },
      expect.any(Object),
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'oficina@example.test',
      subject: expect.stringContaining('2026-A-1-100-4300001'),
      pdfBuffer: expect.any(Buffer),
      pdfFilename: expect.stringContaining('Diferencia_entrega_'),
    }));
    expect(result.skipped).toBe(false);
    expect(result.sent).toBe(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(true);
  });
});
