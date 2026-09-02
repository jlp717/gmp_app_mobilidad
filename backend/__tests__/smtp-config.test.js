'use strict';

const {
  TLS_MIN_VERSION,
  CERTIFIED_SMTP_IDENTITY,
  assertSecureSmtpConfig,
  buildSmtpConfig,
  isValidServerName,
  resolveSmtpHost,
  resolveTlsServername,
} = require('../services/smtp-config');

describe('SMTP TLS configuration', () => {
  test('requires certificate verification and uses the configured certificate identity', () => {
    const previous = { ...process.env };
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'mailer@example.test';
    process.env.SMTP_PASSWORD = 'test-only-password';
    process.env.SMTP_TLS_SERVERNAME = 'certificate.example.test';
    process.env.SMTP_SECURE = 'true';

    const config = buildSmtpConfig();

    expect(config.secure).toBe(false);
    expect(config.requireTLS).toBe(true);
    expect(config.tls).toEqual({
      servername: 'certificate.example.test',
      minVersion: TLS_MIN_VERSION,
      rejectUnauthorized: true,
    });
    expect(assertSecureSmtpConfig(config)).toBe(config);

    process.env = previous;
  });

  test('rejects an attempt to disable certificate validation', () => {
    expect(() => assertSecureSmtpConfig({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      auth: { user: 'mailer@example.test', pass: 'test-only-password' },
      tls: {
        servername: 'smtp.example.test',
        minVersion: TLS_MIN_VERSION,
        rejectUnauthorized: false,
      },
    })).toThrow(/certificate verification/i);
  });

  test('validates DNS names and IP identities without contacting SMTP', () => {
    expect(isValidServerName('smtp.example.test')).toBe(true);
    expect(isValidServerName('192.0.2.10')).toBe(true);
    expect(isValidServerName('smtp..example.test')).toBe(false);
    expect(isValidServerName('smtp example.test')).toBe(false);
  });

  test('fails closed in production when a non-certified host has no identity', () => {
    const previous = { ...process.env };
    process.env = {
      ...previous,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_USER: 'mailer@example.test',
      SMTP_PASSWORD: 'test-only-password',
    };
    delete process.env.SMTP_TLS_SERVERNAME;

    expect(() => assertSecureSmtpConfig(buildSmtpConfig())).toThrow(
      /certificate identity/i,
    );
    process.env = previous;
  });

  test('remaps the Cloudflare web frontend to the certified SMTP identity', () => {
    const previous = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'mail.mari-pepa.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'mailer@example.test';
    process.env.SMTP_PASSWORD = 'test-only-password';
    delete process.env.SMTP_TLS_SERVERNAME;

    const config = assertSecureSmtpConfig(buildSmtpConfig());
    expect(config.host).toBe(CERTIFIED_SMTP_IDENTITY);
    expect(config.tls.servername).toBe(CERTIFIED_SMTP_IDENTITY);
    expect(config.tls.rejectUnauthorized).toBe(true);

    process.env = previous;
  });

  test('ignores SMTP_TLS_REJECT_UNAUTHORIZED and keeps verification on', () => {
    const previous = { ...process.env };
    process.env.SMTP_HOST = CERTIFIED_SMTP_IDENTITY;
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'mailer@example.test';
    process.env.SMTP_PASSWORD = 'test-only-password';
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED = 'false';

    const config = assertSecureSmtpConfig(buildSmtpConfig());
    expect(config.tls.rejectUnauthorized).toBe(true);
    expect(config.requireTLS).toBe(true);

    process.env = previous;
  });

  test('resolves empty or frontend hosts to the certified endpoint', () => {
    expect(resolveSmtpHost('')).toBe(CERTIFIED_SMTP_IDENTITY);
    expect(resolveSmtpHost('mail.mari-pepa.com')).toBe(CERTIFIED_SMTP_IDENTITY);
    expect(resolveSmtpHost('smtp.example.test')).toBe('smtp.example.test');
    expect(resolveTlsServername('mail.mari-pepa.com', 'smtp.example.test'))
      .toBe(CERTIFIED_SMTP_IDENTITY);
  });
});
