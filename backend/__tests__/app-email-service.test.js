'use strict';

describe('legacy delivery email service TLS policy', () => {
  const originalEnv = process.env;

  function loadService(overrides = {}) {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      SMTP_HOST: 'smtp.internal.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'noreply@example.test',
      SMTP_PASSWORD: 'test-password',
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
      ...overrides,
    };

    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'message-legacy-1' }),
        verify: jest.fn().mockResolvedValue(true),
        close: jest.fn(),
      })),
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }));

    return {
      service: require('../app/services/emailService'),
      nodemailer: require('nodemailer'),
    };
  }

  afterEach(() => {
    process.env = originalEnv;
    jest.dontMock('nodemailer');
    jest.dontMock('../middleware/logger');
    jest.clearAllMocks();
  });

  test('keeps certificate and hostname verification enabled', async () => {
    const { service, nodemailer } = loadService();

    await expect(service.verifyConnection()).resolves.toEqual({ success: true });

    const config = nodemailer.createTransport.mock.calls[0][0];
    expect(config.tls).toEqual({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      servername: 'smtp.internal.example.test',
    });
  });

  test('uses the explicitly approved certificate hostname', async () => {
    const { service, nodemailer } = loadService({
      SMTP_TLS_SERVERNAME: 'smtp.certificate.example.test',
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
    });

    await expect(service.verifyConnection()).resolves.toEqual({ success: true });

    const config = nodemailer.createTransport.mock.calls[0][0];
    expect(config.tls.rejectUnauthorized).toBe(true);
    expect(config.tls.servername).toBe('smtp.certificate.example.test');
  });
});
