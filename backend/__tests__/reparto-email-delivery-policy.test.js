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
    REPARTO_EMAIL_TEST_ALLOWLIST: 'sink@example.test, auditor@example.test',
    REPARTO_EMAIL_TEST_SINK: 'sink@example.test',
  };

  test('automatic isolated messages are deduplicated and redirected to the explicit sink', () => {
    expect(resolveRepartoEmailDelivery({
      recipients: ['driver@example.test', 'driver@example.test', 'office@example.test'],
      env: isolatedEnv,
    })).toEqual({
      effectiveRecipients: ['sink@example.test'],
      redirected: true,
      policy: 'isolated_test_sink',
    });
  });

  test('isolated test fails closed without an explicit allowlisted sink', () => {
    expect(() => resolveRepartoEmailDelivery({ recipients: ['x@example.test'], env: { REPARTO_TABLE_SET: 'isolated_test' } }))
      .toThrow(RepartoEmailDeliveryPolicyError);
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
