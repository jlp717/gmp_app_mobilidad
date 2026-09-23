'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
}));

jest.mock('../services/reparto-cobro-pdf-service', () => ({
  buildCobroPdfBuffer: jest.fn(async () => Buffer.from('%PDF-1.4 sink-evidence')),
  buildCobroPdfFileName: jest.fn(() => 'cobro-comercial-test.pdf'),
}));

jest.mock('../services/staff-email-directory-service', () => ({
  VARIANCE_ROLE_KEYS: ['carlos', 'javier'],
  resolveVendorProfile: jest.fn(async () => ({
    vendorCode: '35',
    email: 'comercial35@empresa.com',
    nombre: 'Comercial 35',
  })),
  resolveRoleEmails: jest.fn(async () => ([
    { roleKey: 'carlos', vendorCode: 'C1', email: 'carlos@empresa.com', nombre: 'Carlos' },
    { roleKey: 'javier', vendorCode: 'J1', email: 'javier@empresa.com', nombre: 'Javier' },
  ])),
}));

const {
  notifyCommercialCobro,
} = require('../services/comercial-cobro-notify-service');

describe('notifyCommercialCobro delivery evidence', () => {
  test('isolated_test sink returns pdf magic + redirected policy (not opaque)', async () => {
    const sendEmail = jest.fn(async () => ({ ok: true }));
    const result = await notifyCommercialCobro({
      paymentId: 'CBR-test-sink',
      codigoCliente: '4300009586',
      referencia: 'F-0-12346',
      importe: 0.01,
      formaPago: 'E',
      codigoUsuario: '35',
      observaciones: 'sink evidence',
    }, {
      env: {
        REPARTO_TABLE_SET: 'isolated_test',
      },
      sendEmail,
    });

    expect(result.skipped).toBe(false);
    expect(result.pdfMagic).toBe('%PDF-');
    expect(result.pdfBytes).toBeGreaterThan(10);
    expect(result.pdfFilename).toBe('cobro-comercial-test.pdf');
    expect(result.policy).toBe('isolated_test_redirect');
    expect(result.redirected).toBe(true);
    expect(result.intendedCount).toBeGreaterThanOrEqual(1);
    expect(result.effectiveCount).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.allSucceeded).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('reparto-test@localhost');
  });
});
