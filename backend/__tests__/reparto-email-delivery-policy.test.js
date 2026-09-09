'use strict';

const {
  RepartoEmailDeliveryPolicyError,
  resolveRepartoEmailDelivery,
  buildRepartoMessageId,
  redactDeliverySummary,
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
});
