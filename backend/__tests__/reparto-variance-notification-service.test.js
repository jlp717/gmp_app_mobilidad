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
      emails: [
        'javier@example.test',
        'carlos@example.test',
        'driver@example.test',
        'comercial@example.test',
      ],
      details: [],
      missingRequired: [],
    }));
    const resolveComercial = jest.fn(async () => '15');

    const env = {
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EMAIL_TEST_ALLOWLIST: 'javier@example.test,carlos@example.test,driver@example.test,comercial@example.test',
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
    expect(sendEmail).toHaveBeenCalledTimes(4);
    expect(sendEmail.mock.calls.map(([message]) => message.to).sort()).toEqual([
      'carlos@example.test',
      'comercial@example.test',
      'driver@example.test',
      'javier@example.test',
    ]);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('2026-A-1-100-4300001'),
      pdfBuffer: expect.any(Buffer),
      pdfFilename: expect.stringContaining('Diferencia_entrega_'),
    }));
    expect(result.skipped).toBe(false);
    expect(result.sent).toBe(4);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(true);
  });

  test('notifyAfterConfirm fails closed when a required DB recipient is unresolved', async () => {
    const query = jest.fn(async () => []);
    const sendEmail = jest.fn();
    const env = {
      NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EMAIL_TEST_ALLOWLIST: 'javier@example.test', ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'false',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false', REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
      REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false', REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false', REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    };

    const result = await notifyAfterConfirm({
      command: {
        delivery: {
          itemId: '2026-A-1-101-4300001', occurredAt: '2026-08-12T10:00:00+02:00', status: 'PARCIAL',
          lineas: [{ lineaId: '1', codigoArticulo: 'SKU1', cantidadPedida: 2, cantidadEntregada: 1 }],
        },
        actor: { repartidorId: '94' },
      },
      result: { created: true, confirmationId: '79', deliveryStatus: 'PARCIAL' },
    }, {
      query, env, sendEmail,
      resolveComercial: jest.fn(async () => '15'),
      resolveRecipients: jest.fn(async () => ({
        emails: ['javier@example.test'],
        details: [{ label: 'repartidor', email: null }],
        missingRequired: ['repartidor'],
      })),
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET STATUS = 'FAILED'"))).toBe(true);
  });

  test('notifyAfterConfirm does not send a duplicate for existing durable outbox item', async () => {
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SELECT ID, STATUS')) return [{ ID: 77, STATUS: 'SENT' }];
      return [];
    });
    const sendEmail = jest.fn();
    const result = await notifyAfterConfirm({
      command: {
        delivery: {
          itemId: '2026-A-1-100-4300001',
          status: 'PARCIAL',
          lineas: [{ lineaId: '1', codigoArticulo: 'SKU1', cantidadPedida: 2, cantidadEntregada: 1 }],
        },
        actor: { repartidorId: '94' },
      },
      result: { created: true, confirmationId: '77', deliveryStatus: 'PARCIAL' },
    }, {
      query,
      env: {
        NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
        REPARTO_EMAIL_TEST_ALLOWLIST: 'driver@example.test',
        ODBC_DSN: 'GMP', REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
        REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER', REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
        REPARTO_WRITES_ENABLED: 'false', REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
        REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false', REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false', REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      },
      sendEmail,
      resolveRecipients: jest.fn(),
      resolveComercial: jest.fn(),
    });
    expect(result).toEqual(expect.objectContaining({ skipped: true, reason: 'already_enqueued' }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('notifyAfterConfirm does not send when durable outbox enqueue fails', async () => {
    const query = jest.fn(async () => { throw new Error('DB down'); });
    const sendEmail = jest.fn();
    const result = await notifyAfterConfirm({
      command: {
        delivery: {
          itemId: '2026-A-1-100-4300001', status: 'RECHAZADO',
          lineas: [{ lineaId: '1', codigoArticulo: 'SKU1', cantidadPedida: 2, cantidadEntregada: 0, cantidadRechazada: 2 }],
        }, actor: { repartidorId: '94' },
      },
      result: { created: true, confirmationId: '78', deliveryStatus: 'RECHAZADO' },
    }, {
      query,
      env: {
        NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
        REPARTO_EMAIL_TEST_ALLOWLIST: 'driver@example.test',
        ODBC_DSN: 'GMP', REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
        REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER', REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
        REPARTO_WRITES_ENABLED: 'false', REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
        REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false', REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false', REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
        REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      },
      sendEmail,
      resolveRecipients: jest.fn(),
      resolveComercial: jest.fn(),
    });
    expect(result).toEqual(expect.objectContaining({ skipped: true, reason: 'outbox_unavailable' }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('previousMadridIsoDate is the calendar day before Europe/Madrid today', () => {
    const { previousMadridIsoDate } = require('../services/reparto-variance-notification-service');
    expect(previousMadridIsoDate(new Date('2026-08-18T06:30:00+02:00'))).toBe('2026-08-17');
    expect(previousMadridIsoDate(new Date('2026-08-18T00:15:00+02:00'))).toBe('2026-08-17');
  });

  test('sendDailyVarianceDigest preserves all allowlisted DB recipients and marks rows only after delivery', async () => {
    const { sendDailyVarianceDigest } = require('../services/reparto-variance-notification-service');
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SELECT ID, CONFIRMATION_ID')) {
        return [{
          ID: 9,
          DOCUMENT_ID: '2026-A-1-1-C1',
          REPARTIDOR_ID: '08',
          COMERCIAL_CODE: '33',
          PAYLOAD_JSON: JSON.stringify({ lineas: [{ codigoArticulo: 'A', diff: -1 }] }),
        }];
      }
      return [];
    });
    const sendEmail = jest.fn(async () => ({ success: true }));
    const resolveRecipients = jest.fn(async ({ repartidorId, comercialCode }) => {
      const emails = ['javier@example.test', 'carlos@example.test'];
      if (repartidorId === '08') emails.push('driver@example.test');
      if (comercialCode === '33') emails.push('comercial@example.test');
      return { emails, details: [] };
    });
    const env = {
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EMAIL_TEST_ALLOWLIST: 'javier@example.test,carlos@example.test,driver@example.test,comercial@example.test',
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

    const result = await sendDailyVarianceDigest({
      query,
      env,
      sendEmail,
      resolveRecipients,
      digestDate: '2026-08-17',
    });

    expect(query.mock.calls[0][1]).toEqual(['2026-08-17', '2026-08-17']);
    expect(result).toMatchObject({ sent: 4, items: 1, digestDate: '2026-08-17' });
    const tos = sendEmail.mock.calls.map((call) => call[0].to).sort();
    expect(tos).toEqual(['carlos@example.test', 'comercial@example.test', 'driver@example.test', 'javier@example.test']);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      messageId: expect.stringMatching(/^<gmp-reparto-variance-digest-/),
    }));
    expect(query.mock.calls.some(([sql, params]) => (
      String(sql).includes("SET DIGEST_INCLUDED = 'S'") && params?.[0] === 9
    ))).toBe(true);
  });

  test('sendDailyVarianceDigest retains rows when an effective recipient fails', async () => {
    const { sendDailyVarianceDigest } = require('../services/reparto-variance-notification-service');
    const query = jest.fn(async (sql) => {
      if (String(sql).includes('SELECT ID, CONFIRMATION_ID')) {
        return [{ ID: 12, DOCUMENT_ID: '2026-A-1-2-C2', REPARTIDOR_ID: '08', COMERCIAL_CODE: '33', PAYLOAD_JSON: JSON.stringify({ lineas: [{ codigoArticulo: 'A', diff: -1 }] }) }];
      }
      return [];
    });
    const env = {
      NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'test', REPARTO_TABLE_SET: 'isolated_test',
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
      REPARTO_EMAIL_TEST_ALLOWLIST: 'driver@example.test',
    };
    const result = await sendDailyVarianceDigest({
      query, env,
      sendEmail: jest.fn(async () => { throw new Error('SMTP unavailable'); }),
      resolveRecipients: jest.fn(async () => ({ emails: ['driver@example.test'], details: [] })),
      digestDate: '2026-08-17',
    });
    expect(result.delivery).toEqual({ attempted: 1, sent: 0, failed: 1, allSucceeded: false });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET DIGEST_INCLUDED = 'S'"))).toBe(false);
    const pendingUpdate = query.mock.calls.find(([sql]) => String(sql).includes('SET ERROR = ?'));
    expect(pendingUpdate?.[1]).toEqual(['Digest pending: 0/1 delivered', 12]);
  });
});
