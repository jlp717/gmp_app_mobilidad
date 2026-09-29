'use strict';

const {
  RepartoEmailDeliveryPolicyError,
  resolveRepartoEmailDelivery,
  composeProductEmailDispatch,
  buildRepartoMessageId,
  redactDeliverySummary,
  resolveSalesAlertEmailDelivery,
} = require('../services/reparto-email-delivery-policy');

describe('reparto email delivery policy', () => {
  const isolatedEnv = {
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_EMAIL_STRICT_TEST_POLICY: 'true',
    REPARTO_EMAIL_TEST_ALLOWLIST: 'sink@example.test, auditor@example.test',
    REPARTO_EMAIL_TEST_SINK: 'sink@example.test',
  };

  test('direct delivery is default outside isolated test', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['cliente@empresa.com'],
      env: { REPARTO_TABLE_SET: 'production' },
      mode: 'manual',
    })).toEqual({
      intendedRecipients: ['cliente@empresa.com'],
      effectiveRecipients: ['cliente@empresa.com'],
      redirected: false,
      policy: 'direct',
    });
  });

  test('isolated test rejects external recipients even when the code default allowlist is active', () => {
    expect(() => resolveRepartoEmailDelivery({
      recipients: ['cliente@empresa.com'],
      env: { REPARTO_TABLE_SET: 'isolated_test' },
      mode: 'manual',
    })).toThrow(RepartoEmailDeliveryPolicyError);
    try {
      resolveRepartoEmailDelivery({
        recipients: ['cliente@empresa.com'],
        env: { REPARTO_TABLE_SET: 'isolated_test' },
        mode: 'manual',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'REPARTO_EMAIL_RECIPIENT_NOT_ALLOWED', statusCode: 403 });
    }
  });

  test('automatic isolated messages preserve all allowlisted DB-resolved recipients', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['sink@example.test', 'auditor@example.test', 'sink@example.test'],
      env: isolatedEnv,
    })).toEqual({
      intendedRecipients: ['sink@example.test', 'auditor@example.test'],
      effectiveRecipients: ['sink@example.test', 'auditor@example.test'],
      redirected: false,
      policy: 'isolated_test_allowlist',
    });
  });

  test('isolated test uses the code default allowlist when env is empty', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['reparto-test@localhost'],
      env: { REPARTO_TABLE_SET: 'isolated_test' },
      mode: 'manual',
    })).toEqual({
      intendedRecipients: ['reparto-test@localhost'],
      effectiveRecipients: ['reparto-test@localhost'],
      redirected: false,
      policy: 'isolated_test_allowlist',
    });
  });

  test('isolated_test always keeps the code default sink even with a custom allowlist', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['reparto-test@localhost'],
      env: {
        REPARTO_TABLE_SET: 'isolated_test',
        REPARTO_EMAIL_TEST_ALLOWLIST: 'sink@example.test',
      },
      mode: 'manual',
    })).toEqual({
      intendedRecipients: ['reparto-test@localhost'],
      effectiveRecipients: ['reparto-test@localhost'],
      redirected: false,
      policy: 'isolated_test_allowlist',
    });
  });

  test('automatic isolated_test redirects product mailboxes to the sink and keeps intended to/cc', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['cliente@empresa.com', 'comercial@empresa.com', 'interno@empresa.com'],
      env: { REPARTO_TABLE_SET: 'isolated_test' },
    })).toEqual({
      intendedRecipients: ['cliente@empresa.com', 'comercial@empresa.com', 'interno@empresa.com'],
      effectiveRecipients: ['reparto-test@localhost'],
      redirected: true,
      policy: 'isolated_test_redirect',
    });
  });

  test('automatic isolated_test redirects non-allowlisted product recipients to the sink', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['x@example.test'],
      env: {
        REPARTO_TABLE_SET: 'isolated_test',
        REPARTO_EMAIL_STRICT_TEST_POLICY: 'true',
      },
    })).toEqual({
      intendedRecipients: ['x@example.test'],
      effectiveRecipients: ['reparto-test@localhost'],
      redirected: true,
      policy: 'isolated_test_redirect',
    });
  });

  test('manual isolated messages reject non-allowlisted recipients', () => {
    try {
      resolveRepartoEmailDelivery({ recipients: ['outside@example.test'], env: isolatedEnv, mode: 'manual' });
      throw new Error('expected policy rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'REPARTO_EMAIL_RECIPIENT_NOT_ALLOWED', statusCode: 403 });
    }
  });

  test('message id is deterministic and CRLF-safe', () => {
    const first = buildRepartoMessageId({ kind: 'receipt\r\nBcc:x', identity: 'doc-7', recipient: 'Sink@Example.Test' });
    const second = buildRepartoMessageId({ kind: 'receipt\r\nBcc:x', identity: 'doc-7', recipient: 'sink@example.test' });
    expect(first).toBe(second);
    expect(first).toMatch(/^<gmp-reparto-[^\r\n<>]+@[^\r\n<>]+>$/);
  });

  test('delivery summary retains no recipient or SMTP detail', () => {
    expect(redactDeliverySummary([{ success: true, to: 'private@example.test' }, { success: false, error: 'smtp secret' }]))
      .toEqual({ attempted: 2, sent: 1, failed: 1, allSucceeded: false });
  });

  test('product dispatch keeps Carlos in intended CC while SMTP goes to the sink', () => {
    const dispatch = composeProductEmailDispatch({
      destinatario: 'reparto-test@localhost',
      staffEmails: ['carlos@empresa.com', 'javier@empresa.com', 'repartidor@empresa.com'],
      env: { REPARTO_TABLE_SET: 'isolated_test' },
    });
    expect(dispatch.intendedTo).toEqual(['reparto-test@localhost']);
    expect(dispatch.intendedCc).toEqual([
      'carlos@empresa.com',
      'javier@empresa.com',
      'repartidor@empresa.com',
    ]);
    expect(dispatch.smtpTo).toBe('reparto-test@localhost');
    expect(dispatch.smtpCc).toEqual([]);
    expect(dispatch.redirected).toBe(true);
    expect(dispatch.policy).toBe('isolated_test_redirect');
  });

  test('product dispatch in production CCs staff including Carlos', () => {
    const dispatch = composeProductEmailDispatch({
      destinatario: 'cliente@empresa.com',
      staffEmails: ['carlos@empresa.com', 'javier@empresa.com'],
      env: { NODE_ENV: 'production' },
    });
    expect(dispatch.smtpTo).toBe('cliente@empresa.com');
    expect(dispatch.smtpCc).toEqual(['carlos@empresa.com', 'javier@empresa.com']);
    expect(dispatch.redirected).toBe(false);
    expect(dispatch.intendedCc).toContain('carlos@empresa.com');
  });

  describe('sales discrepancy alert delivery', () => {
    const productRecipient = 'javier.lacal.pelegrin@gmail.com';

    test('delivers directly only with all three production flags', () => {
      expect(resolveSalesAlertEmailDelivery({
        recipient: productRecipient,
        env: {
          NODE_ENV: 'production',
          REPARTO_ENVIRONMENT: 'production',
          REPARTO_TABLE_SET: 'production',
        },
      })).toEqual({
        intendedRecipient: productRecipient,
        effectiveRecipient: productRecipient,
        redirected: false,
        policy: 'sales_alert_production_direct',
      });
    });

    test.each([
      [{ NODE_ENV: 'production', REPARTO_ENVIRONMENT: 'staging', REPARTO_TABLE_SET: 'production' }],
      [{ NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'production', REPARTO_TABLE_SET: 'production' }],
      [{ NODE_ENV: 'production', REPARTO_ENVIRONMENT: 'production', REPARTO_TABLE_SET: 'testmovil' }],
      [{}],
    ])('fails closed outside production when a test sink is missing (%j)', (env) => {
      expect(() => resolveSalesAlertEmailDelivery({ recipient: productRecipient, env }))
        .toThrow(expect.objectContaining({ code: 'SALES_ALERT_TEST_SINK_UNSAFE' }));
    });

    test('uses an allowlisted non-product sink in staging', () => {
      expect(resolveSalesAlertEmailDelivery({
        recipient: productRecipient,
        env: {
          NODE_ENV: 'production',
          REPARTO_ENVIRONMENT: 'staging',
          REPARTO_TABLE_SET: 'testmovil',
          REPARTO_EMAIL_TEST_SINK: 'sales-alert@example.test',
          REPARTO_EMAIL_TEST_ALLOWLIST: 'sales-alert@example.test',
        },
      })).toMatchObject({
        effectiveRecipient: 'sales-alert@example.test',
        redirected: true,
        policy: 'sales_alert_test_sink',
      });
    });

    test('isolated_test never sends to product even if product is allowlisted', () => {
      expect(resolveSalesAlertEmailDelivery({
        recipient: productRecipient,
        env: {
          NODE_ENV: 'production',
          REPARTO_ENVIRONMENT: 'staging',
          REPARTO_TABLE_SET: 'isolated_test',
          REPARTO_EMAIL_TEST_ALLOWLIST: productRecipient,
        },
      })).toMatchObject({
        effectiveRecipient: 'reparto-test@localhost',
        redirected: true,
      });
    });

    test('rejects product recipient reused as a sink', () => {
      expect(() => resolveSalesAlertEmailDelivery({
        recipient: productRecipient,
        env: {
          NODE_ENV: 'test',
          REPARTO_ENVIRONMENT: 'test',
          REPARTO_TABLE_SET: 'testmovil',
          REPARTO_EMAIL_TEST_SINK: productRecipient,
          REPARTO_EMAIL_TEST_ALLOWLIST: productRecipient,
        },
      })).toThrow(expect.objectContaining({ code: 'SALES_ALERT_TEST_SINK_UNSAFE' }));
    });
  });
});
