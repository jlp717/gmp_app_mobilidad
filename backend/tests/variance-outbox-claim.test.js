'use strict';

/**
 * Variance outbox claim+token lease (Tier-1 ALTA).
 *
 * Same pattern as repartidor-liquidacion-outbox-service.js (claimOutboxForDelivery
 * + completeClaimedOutbox verifies token; claim lost = skip): two workers racing
 * the same PENDING row must not send two digests.
 *
 * Mock level: repository only — an in-memory fake of the outbox table behind the
 * injected `query(sql, params)` function. The domain code under test (claim,
 * complete, sendDailyVarianceDigest, digest HTML, delivery policy) is REAL.
 * Only the SMTP gateway (sendEmail) and the staff-directory lookup
 * (resolveRecipients) are stubbed — both are external boundaries, not the
 * mechanism under test.
 */

const varianceService = require('../services/reparto-variance-notification-service');

const TABLE = 'JAVIER.TEST_REPARTO_VARIANCE_OUTBOX';

const TEST_ENV = Object.freeze({
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'false',
  REPARTO_EMAIL_TEST_ALLOWLIST: 'ops@test.local,reparto-test@localhost',
  REPARTO_EMAIL_TEST_SINK: 'reparto-test@localhost',
});

function makePayload(docId, repartidorId = '12') {
  return JSON.stringify({
    confirmationId: '9001',
    documentId: docId,
    documentoTipo: 'ALBARAN',
    fecha: '2026-09-25',
    clienteCodigo: 'C001',
    clienteNombre: 'Cliente Test',
    repartidorId,
    comercialCode: '80',
    deliveryStatus: 'PARCIAL',
    lineas: [
      {
        codigoArticulo: 'ART-1',
        descripcion: 'Articulo uno',
        cantidadPedida: 10,
        cantidadEntregada: 8,
        cantidadRechazada: 0,
        cantidadPendiente: 2,
        diff: -2,
        motivoDiferencia: null,
      },
    ],
  });
}

function seedRows() {
  return new Map([
    [1, {
      ID: 1,
      CONFIRMATION_ID: 9001,
      DOCUMENT_ID: '2026-P-15-1-C001',
      REPARTIDOR_ID: '12',
      COMERCIAL_CODE: '80',
      PAYLOAD_JSON: makePayload('2026-P-15-1-C001', '12'),
      STATUS: 'PENDING',
      CREATED_AT: '2026-09-25 10:00:00',
      SENT_AT: null,
      ERROR: null,
      DIGEST_INCLUDED: 'N',
    }],
    [2, {
      ID: 2,
      CONFIRMATION_ID: 9002,
      DOCUMENT_ID: '2026-P-15-2-C002',
      REPARTIDOR_ID: '13',
      COMERCIAL_CODE: '81',
      PAYLOAD_JSON: makePayload('2026-P-15-2-C002', '13'),
      STATUS: 'PENDING',
      CREATED_AT: '2026-09-25 11:00:00',
      SENT_AT: null,
      ERROR: null,
      DIGEST_INCLUDED: 'N',
    }],
  ]);
}

/**
 * Repository-level fake: executes each statement's check-and-set synchronously
 * (atomic within one JS turn, exactly like a single DB2 UPDATE...WHERE), then
 * resolves. Concurrent callers interleave only at `await` points, so the second
 * UPDATE...WHERE STATUS='PENDING' observes the first winner's FAILED row.
 */
function makeFakeQuery(store) {
  const rowById = (id) => store.get(Number(id));
  const publicRow = (row) => ({ ...row });

  return (sql, params = []) => {
    const text = String(sql);

    // Digest candidate SELECT (ORDER BY CREATED_AT, DIGEST_INCLUDED filter).
    if (text.includes('ORDER BY CREATED_AT') && text.includes("DIGEST_INCLUDED = 'N'")) {
      const out = [...store.values()]
        .filter((row) => row.DIGEST_INCLUDED === 'N'
          && ['PENDING', 'SENT', 'FAILED'].includes(row.STATUS))
        .sort((a, b) => String(a.CREATED_AT).localeCompare(String(b.CREATED_AT)))
        .map(publicRow);
      return Promise.resolve(out);
    }

    // Claim re-read: SELECT STATUS, PAYLOAD_JSON ... AND DIGEST_INCLUDED = 'N'.
    if (text.includes('SELECT STATUS, PAYLOAD_JSON') && text.includes("DIGEST_INCLUDED = 'N'")) {
      const row = rowById(params[0]);
      return Promise.resolve(row && row.DIGEST_INCLUDED === 'N' ? [publicRow(row)] : []);
    }

    // Claim UPDATE for PENDING rows: PENDING -> FAILED + claim marker.
    if (text.includes("SET STATUS = 'FAILED', PAYLOAD_JSON = ?")) {
      const row = rowById(params[1]);
      if (row && row.STATUS === 'PENDING' && row.DIGEST_INCLUDED === 'N') {
        row.STATUS = 'FAILED';
        row.PAYLOAD_JSON = params[0];
      }
      return Promise.resolve([]);
    }

    // Claim UPDATE for FAILED/SENT rows: marker only when no claim present.
    if (text.includes('SET PAYLOAD_JSON = ?') && text.includes('LOCATE(CAST(? AS VARCHAR(64)), PAYLOAD_JSON) = 0')) {
      const row = rowById(params[1]);
      if (row && row.STATUS === params[2] && row.DIGEST_INCLUDED === 'N'
        && !String(row.PAYLOAD_JSON).includes(String(params[3]))) {
        row.PAYLOAD_JSON = params[0];
      }
      return Promise.resolve([]);
    }

    // Claim verify: SELECT STATUS, PAYLOAD_JSON WHERE ID = ?.
    if (text.includes('SELECT STATUS, PAYLOAD_JSON') && text.includes('WHERE ID = ?')) {
      const row = rowById(params[0]);
      return Promise.resolve(row ? [publicRow(row)] : []);
    }

    // Complete UPDATE: restore status, set digest outcome, requires token.
    if (text.includes('SET STATUS = ?, DIGEST_INCLUDED = ?')) {
      const row = rowById(params[4]);
      if (row && String(row.PAYLOAD_JSON).includes(String(params[5]))) {
        row.STATUS = params[0];
        row.DIGEST_INCLUDED = params[1];
        row.ERROR = params[2];
        row.PAYLOAD_JSON = params[3];
      }
      return Promise.resolve([]);
    }

    // Complete verify: SELECT STATUS, PAYLOAD_JSON, DIGEST_INCLUDED WHERE ID = ?.
    if (text.includes('SELECT STATUS, PAYLOAD_JSON, DIGEST_INCLUDED')) {
      const row = rowById(params[0]);
      return Promise.resolve(row ? [publicRow(row)] : []);
    }

    throw new Error(`fake-query: unsupported statement: ${text.slice(0, 120)}`);
  };
}

const tables = { varianceOutbox: TABLE };
const resolveRecipients = async () => ({ emails: ['ops@test.local'], missingRequired: [] });

describe('variance outbox claim+token lease', () => {
  test('carrera: dos claims concurrentes sobre el mismo PENDING -> solo uno gana', async () => {
    const store = seedRows();
    const query = makeFakeQuery(store);
    const original = store.get(1).PAYLOAD_JSON;

    const [first, second] = await Promise.all([
      varianceService.claimVarianceOutboxForDigest(1, original, { query, tables }),
      varianceService.claimVarianceOutboxForDigest(1, original, { query, tables }),
    ]);

    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0].token).toEqual(expect.any(String));
    expect(winners[0].prevStatus).toBe('PENDING');
    expect(varianceService.hasVarianceDigestClaim(store.get(1).PAYLOAD_JSON, winners[0].token)).toBe(true);
  });

  test('complete con token ganador restaura STATUS y marca digest; token ajeno = false', async () => {
    const store = seedRows();
    const query = makeFakeQuery(store);
    const original = store.get(1).PAYLOAD_JSON;

    const claim = await varianceService.claimVarianceOutboxForDigest(1, original, { query, tables });
    expect(claim).not.toBeNull();

    // Foreign token can never complete: claim lost = skip.
    await expect(varianceService.completeClaimedVarianceOutbox(
      1,
      { ...claim, token: 'token-ajeno-que-nunca-gana' },
      { digested: true },
      { query, tables },
    )).resolves.toBe(false);

    await expect(varianceService.completeClaimedVarianceOutbox(
      1, claim, { digested: true }, { query, tables },
    )).resolves.toBe(true);

    const row = store.get(1);
    expect(row.STATUS).toBe('PENDING'); // digest never owned the status change
    expect(row.DIGEST_INCLUDED).toBe('S');
    expect(row.ERROR).toBeNull();
    expect(row.PAYLOAD_JSON).toBe(original); // byte-identical restore, no reserialization drift
    expect(varianceService.hasVarianceDigestClaim(row.PAYLOAD_JSON)).toBe(false);
  });

  test('FAILED con claim ajeno (in-flight) no se puede reclamar', async () => {
    const store = seedRows();
    const query = makeFakeQuery(store);
    const row = store.get(1);
    row.STATUS = 'FAILED';
    row.PAYLOAD_JSON = JSON.stringify({
      ...JSON.parse(row.PAYLOAD_JSON),
      _varianceDigestClaim: { token: 'otro-worker', prevStatus: 'FAILED', claimedAt: '2026-09-25T00:00:00.000Z' },
    });

    await expect(varianceService.claimVarianceOutboxForDigest(
      1, row.PAYLOAD_JSON, { query, tables },
    )).resolves.toBeNull();
  });

  test('digest concurrente: dos workers -> un solo envio; perdedor no envia', async () => {
    const store = seedRows();
    const query = makeFakeQuery(store);
    const smtpCalls = [];
    const sendEmail = jest.fn(async (message) => {
      smtpCalls.push(message);
      return { messageId: 'test' };
    });

    const [winner, loser] = await Promise.all([
      varianceService.sendDailyVarianceDigest({
        query, env: TEST_ENV, sendEmail, resolveRecipients, digestDate: '2026-09-25',
      }),
      varianceService.sendDailyVarianceDigest({
        query, env: TEST_ENV, sendEmail, resolveRecipients, digestDate: '2026-09-25',
      }),
    ]);

    const results = [winner, loser];
    expect(results.filter((r) => r.sent === 1)).toHaveLength(1);
    expect(results.filter((r) => r.sent === 0 && r.reason === 'outbox_claim_unavailable')).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1); // un solo digest SMTP en total
    expect(smtpCalls[0].to).toBe('ops@test.local');

    const ok = results.find((r) => r.sent === 1);
    expect(ok.items).toBe(2);
    expect(ok.claimed).toBe(2);

    for (const id of [1, 2]) {
      const row = store.get(id);
      expect(row.DIGEST_INCLUDED).toBe('S');
      expect(row.STATUS).toBe('PENDING');
      expect(varianceService.hasVarianceDigestClaim(row.PAYLOAD_JSON)).toBe(false);
    }
  });

  test('digest sin candidatos no envia y no reclama nada', async () => {
    const store = new Map();
    const query = makeFakeQuery(store);
    const sendEmail = jest.fn();

    const result = await varianceService.sendDailyVarianceDigest({
      query, env: TEST_ENV, sendEmail, resolveRecipients, digestDate: '2026-09-25',
    });

    expect(result).toMatchObject({ sent: 0, items: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
