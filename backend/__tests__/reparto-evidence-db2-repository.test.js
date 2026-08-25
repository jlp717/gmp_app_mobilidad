'use strict';

const {
  EVIDENCE_TABLE,
  QUALIFIED_EVIDENCE_TABLE,
  QUALIFIED_CONFIRMATION_EVIDENCE_TABLE,
  REQUIRED_EVIDENCE_COLUMNS,
  MAX_EVIDENCE_BLOB_BYTES,
  createRepartoEvidenceDb2Repository,
} = require('../repositories/reparto-evidence-db2-repository');

const NOW = new Date('2026-08-07T10:00:00.000Z');
const FUTURE_EXPIRY = new Date('2026-08-08T10:00:00.000Z');
const EXPIRED_AT = new Date('2026-08-07T09:59:59.000Z');

function record(overrides = {}) {
  const evidenceId = `ev_${'a'.repeat(64)}`;
  return {
    evidenceId,
    documentId: '2026-S-10-404-4300009479',
    repartidorId: '94',
    kind: 'FIRMA',
    mimeType: 'image/png',
    contentSha256: 'b'.repeat(64),
    contentBytes: 8,
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    storageReference: `DB2_BLOB:${evidenceId}`,
    ...overrides,
  };
}

function fakeConnection({
  existing, ownershipRows, linkedRow, linkedVerificationRows, hexRow, expiredRows, insertError, commitError, transactionMethods = true,
  columns = REQUIRED_EVIDENCE_COLUMNS,
} = {}) {
  const calls = [];
  let closed = false;
  let transactionActive = false;
  let stagedWrites = 0;
  let persistedWrites = 0;
  const connection = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('QSYS2.SYSTABLES')) return [{ TABLE_NAME: EVIDENCE_TABLE }];
      if (sql.includes('QSYS2.SYSCOLUMNS')) {
        return columns.map((COLUMN_NAME) => ({ COLUMN_NAME }));
      }
      if (sql.startsWith('SELECT E.EVIDENCE_ID FROM') && sql.includes('EXPIRES_AT')) {
        return expiredRows || [];
      }
      if (sql.includes('WHERE EVIDENCE_ID = ? FOR UPDATE')) return existing ? [existing] : [];
      if (sql.startsWith('SELECT EVIDENCE_ID, STATUS, LINKED_AT, EXPIRES_AT')) {
        return linkedVerificationRows || [];
      }
      if (sql.includes('WHERE EVIDENCE_ID IN (')) return ownershipRows || [];
      if (sql.includes('HEX(SUBSTR(E.CONTENT_BLOB')) {
        const plan = [...sql.matchAll(/\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((match) => ({
          ordinal: Number(match[1]),
          offset: Number(match[2]),
          length: Number(match[3]),
        }));
        if (hexRow) return plan.map(({ ordinal }) => ({ ORDINAL: ordinal, ...hexRow }));
        return Buffer.isBuffer(linkedRow?.CONTENT_BLOB)
          ? plan.map(({ ordinal, offset, length }) => ({
            ORDINAL: ordinal,
            CONTENT_HEX: linkedRow.CONTENT_BLOB.subarray(offset - 1, offset - 1 + length).toString('hex'),
          }))
          : [];
      }
      if (sql.startsWith('SELECT EVIDENCE_ID, DOCUMENT_ID') && sql.includes('WHERE EVIDENCE_ID = ?')) {
        return linkedRow ? [linkedRow] : [];
      }
      if (sql.includes('CONTENT_BLOB') && sql.includes('WHERE EVIDENCE_ID = ?')) return linkedRow ? [linkedRow] : [];
      if (/^(INSERT|UPDATE) /.test(sql)) {
        if (transactionActive) stagedWrites += 1;
        else persistedWrites += 1;
      }
      if (sql.startsWith('INSERT INTO') && insertError) throw insertError;
      return [];
    },
    async close() { closed = true; },
  };
  if (transactionMethods) {
    connection.beginTransaction = async () => {
      calls.push({ sql: 'BEGIN_TRANSACTION', params: [] });
      transactionActive = true;
      stagedWrites = 0;
    };
    connection.commit = async () => {
      calls.push({ sql: 'COMMIT_TRANSACTION', params: [] });
      if (commitError) throw commitError;
      persistedWrites += stagedWrites;
      stagedWrites = 0;
      transactionActive = false;
    };
    connection.rollback = async () => {
      calls.push({ sql: 'ROLLBACK_TRANSACTION', params: [] });
      stagedWrites = 0;
      transactionActive = false;
    };
  }
  return {
    connection,
    calls,
    isClosed: () => closed,
    persistedWrites: () => persistedWrites,
  };
}

function repository(fake, plannedDelivery = jest.fn().mockResolvedValue({ documentId: record().documentId }), options = {}) {
  const plannedDeliveryPort = {
    forConnection: jest.fn((connection) => ({
      getPlannedDelivery: (...args) => plannedDelivery(connection, ...args),
    })),
  };
  const repo = createRepartoEvidenceDb2Repository({
    tables: {
      evidences: QUALIFIED_EVIDENCE_TABLE,
      confirmationEvidences: QUALIFIED_CONFIRMATION_EVIDENCE_TABLE,
    },
    connectionFactory: async () => fake.connection,
    plannedDeliveryPort,
    pendingTtlHours: options.pendingTtlHours ?? 24,
    clock: options.clock || (() => NOW),
    logger: { error: jest.fn() },
  });
  return { repo, plannedDeliveryPort, plannedDelivery };
}

describe('DB2 reparto evidence repository', () => {
  test('stages a BLOB in one explicit transaction and closes the connection', async () => {
    const fake = fakeConnection();
    const ports = repository(fake);

    await expect(ports.repo.stage(record())).resolves.toMatchObject({ created: true, idempotent: false });
    const insert = fake.calls.find((call) => call.sql.startsWith('INSERT INTO JAVIER.TEST_REPARTO_EVIDENCIAS'));
    expect(insert.sql).toContain('EXPIRES_AT');
    expect(insert.params.at(-2)).toEqual(record().content);
    expect(insert.params.at(-1)).toBe('2026-08-08 10:00:00.000');
    expect(fake.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('QSYS2.SYSTABLES'),
      expect.stringContaining('QSYS2.SYSCOLUMNS'),
      'BEGIN_TRANSACTION',
      'COMMIT_TRANSACTION',
    ]));
    expect(fake.calls.filter((call) => call.sql === 'BEGIN_TRANSACTION')).toHaveLength(1);
    expect(fake.calls.map((call) => call.sql)).not.toContain('ROLLBACK_TRANSACTION');
    expect(ports.plannedDeliveryPort.forConnection).toHaveBeenCalledWith(fake.connection);
    expect(fake.isClosed()).toBe(true);
  });

  test('returns an exact retry without inserting and rejects conflicting metadata', async () => {
    const item = record();
    const matching = {
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: item.repartidorId,
      EVIDENCE_KIND: item.kind,
      STORAGE_REFERENCE: item.storageReference,
      MIME_TYPE: item.mimeType,
      CONTENT_SHA256: item.contentSha256,
      CONTENT_BYTES: item.contentBytes,
      STATUS: 'PENDIENTE',
      EXPIRES_AT: FUTURE_EXPIRY,
    };
    const exact = fakeConnection({ existing: matching });
    await expect(repository(exact).repo.stage(item)).resolves.toMatchObject({ created: false, idempotent: true });
    expect(exact.calls.some((call) => call.sql.startsWith('INSERT INTO'))).toBe(false);

    const conflict = fakeConnection({ existing: { ...matching, MIME_TYPE: 'image/jpeg' } });
    await expect(repository(conflict).repo.stage(item)).rejects.toMatchObject({
      code: 'EVIDENCE_ID_CONFLICT', statusCode: 409,
    });
    expect(conflict.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');
  });

  test('rejects expired pending evidence on exact replay and ownership checks', async () => {
    const item = record();
    const expired = {
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: item.repartidorId,
      EVIDENCE_KIND: item.kind,
      STORAGE_REFERENCE: item.storageReference,
      MIME_TYPE: item.mimeType,
      CONTENT_SHA256: item.contentSha256,
      CONTENT_BYTES: item.contentBytes,
      STATUS: 'PENDIENTE',
      EXPIRES_AT: EXPIRED_AT,
    };
    const replay = fakeConnection({ existing: expired });
    await expect(repository(replay).repo.stage(item)).rejects.toMatchObject({
      code: 'EVIDENCE_EXPIRED', statusCode: 410,
    });
    expect(replay.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');

    const ownership = fakeConnection({ ownershipRows: [{
      EVIDENCE_ID: item.evidenceId,
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: item.repartidorId,
      EVIDENCE_KIND: item.kind,
      STATUS: 'PENDIENTE',
      EXPIRES_AT: EXPIRED_AT,
    }] });
    await expect(repository(ownership).repo.forConnection(ownership.connection).assertOwnership(
      [{ evidenceId: item.evidenceId, expectedKind: 'FIRMA' }],
      { documentId: item.documentId, repartidorId: item.repartidorId },
    )).rejects.toMatchObject({ code: 'EVIDENCE_EXPIRED', statusCode: 410 });
  });

  test('marks evidence linked while clearing its pending expiration', async () => {
    const item = record();
    const fake = fakeConnection({ linkedVerificationRows: [{
      EVIDENCE_ID: item.evidenceId,
      STATUS: 'ENLAZADA',
      LINKED_AT: NOW,
      EXPIRES_AT: null,
    }] });
    await repository(fake).repo.forConnection(fake.connection).markLinked([item.evidenceId, item.evidenceId]);
    const update = fake.calls.find((call) => call.sql.startsWith('UPDATE'));
    expect(update.sql).toContain("STATUS = 'ENLAZADA'");
    expect(update.sql).toContain('EXPIRES_AT = NULL');
    expect(update.params).toEqual([item.evidenceId]);
  });

  test('fails closed when the linked evidence postcondition is not persisted', async () => {
    const item = record();
    const fake = fakeConnection({ linkedVerificationRows: [{
      EVIDENCE_ID: item.evidenceId,
      STATUS: 'PENDIENTE',
      LINKED_AT: null,
      EXPIRES_AT: FUTURE_EXPIRY,
    }] });
    await expect(repository(fake).repo.forConnection(fake.connection).markLinked([item.evidenceId]))
      .rejects.toMatchObject({ code: 'EVIDENCE_LINK_FAILED', statusCode: 503 });
  });

  test('checks all ownership rows in one parameterized query and rejects foreign evidence', async () => {
    const item = record();
    const fake = fakeConnection({ ownershipRows: [{
      EVIDENCE_ID: item.evidenceId,
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: '95',
      EVIDENCE_KIND: item.kind,
      STATUS: 'PENDIENTE',
      EXPIRES_AT: FUTURE_EXPIRY,
    }] });
    const { repo } = repository(fake);

    await expect(repo.forConnection(fake.connection).assertOwnership(
      [{ evidenceId: item.evidenceId, expectedKind: 'FIRMA' }],
      { documentId: item.documentId, repartidorId: '94' },
    )).rejects.toMatchObject({ code: 'EVIDENCE_OWNERSHIP_REQUIRED', statusCode: 403 });
    const lookup = fake.calls.find((call) => call.sql.includes('EVIDENCE_ID IN'));
    expect(lookup.sql).toContain('IN (?)');
    expect(lookup.params).toEqual([item.evidenceId]);
  });

  test('rejects cross-kind evidence reuse in the same ownership batch', async () => {
    const item = record();
    const fake = fakeConnection({ ownershipRows: [{
      EVIDENCE_ID: item.evidenceId,
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: item.repartidorId,
      EVIDENCE_KIND: 'FOTO',
      STATUS: 'PENDIENTE',
      EXPIRES_AT: FUTURE_EXPIRY,
    }] });

    await expect(repository(fake).repo.forConnection(fake.connection).assertOwnership(
      [{ evidenceId: item.evidenceId, expectedKind: 'FIRMA' }],
      { documentId: item.documentId, repartidorId: item.repartidorId },
    )).rejects.toMatchObject({ code: 'EVIDENCE_KIND_MISMATCH', statusCode: 422 });
    expect(fake.calls.filter((call) => call.sql.includes('EVIDENCE_ID IN'))).toHaveLength(1);
  });

  test('retrieves linked content without projecting the BLOB directly', async () => {
    const item = record();
    const fake = fakeConnection({ linkedRow: {
      EVIDENCE_ID: item.evidenceId,
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: item.repartidorId,
      EVIDENCE_KIND: item.kind,
      MIME_TYPE: item.mimeType,
      CONTENT_SHA256: item.contentSha256,
      CONTENT_BYTES: item.contentBytes,
      CONTENT_BLOB: item.content,
      STATUS: 'ENLAZADA',
    } });

    await expect(repository(fake).repo.getLinked(item.evidenceId)).resolves.toMatchObject({
      evidenceId: item.evidenceId,
      content: item.content,
    });
    const directBlobSelect = fake.calls.find((call) =>
      call.sql.startsWith('SELECT EVIDENCE_ID, DOCUMENT_ID') && call.sql.includes('CONTENT_BLOB'));
    expect(directBlobSelect).toBeUndefined();
    expect(fake.calls.some((call) => call.sql.includes('HEX(SUBSTR(E.CONTENT_BLOB'))).toBe(true);
    expect(fake.isClosed()).toBe(true);
  });

  test('retrieves linked evidence via HEX when ODBC returns a null BLOB', async () => {
    const item = record();
    const fake = fakeConnection({
      linkedRow: {
        EVIDENCE_ID: item.evidenceId,
        DOCUMENT_ID: item.documentId,
        REPARTIDOR_ID: item.repartidorId,
        EVIDENCE_KIND: item.kind,
        MIME_TYPE: item.mimeType,
        CONTENT_SHA256: item.contentSha256,
        CONTENT_BYTES: item.contentBytes,
        CONTENT_BLOB: null,
        STATUS: 'ENLAZADA',
      },
      hexRow: { CONTENT_HEX: item.content.toString('hex') },
    });

    await expect(repository(fake).repo.getLinked(item.evidenceId)).resolves.toMatchObject({
      evidenceId: item.evidenceId,
      content: item.content,
    });
    expect(fake.calls.some((call) => call.sql.includes('HEX(SUBSTR(E.CONTENT_BLOB'))).toBe(true);
  });

  test('reads a maximum-size signature in one ordered set-based BLOB query', async () => {
    const signature = Buffer.alloc(1024 * 1024, 0);
    for (let index = 0; index < signature.length; index += 4096) signature[index] = index / 4096;
    const item = record({ content: signature, contentBytes: signature.length });
    const fake = fakeConnection({ linkedRow: {
      EVIDENCE_ID: item.evidenceId,
      DOCUMENT_ID: item.documentId,
      REPARTIDOR_ID: item.repartidorId,
      EVIDENCE_KIND: item.kind,
      MIME_TYPE: item.mimeType,
      CONTENT_SHA256: item.contentSha256,
      CONTENT_BYTES: item.contentBytes,
      CONTENT_BLOB: signature,
      STATUS: 'ENLAZADA',
    } });

    await expect(repository(fake).repo.getLinked(item.evidenceId)).resolves.toMatchObject({ content: signature });
    const blobReads = fake.calls.filter((call) => call.sql.includes('HEX(SUBSTR(E.CONTENT_BLOB'));
    expect(blobReads).toHaveLength(1);
    expect(blobReads[0].sql).toContain('WITH CHUNKS (ORDINAL, BYTE_OFFSET, BYTE_LENGTH) AS (VALUES');
    expect(blobReads[0].sql).toContain('ORDER BY C.ORDINAL');
    expect(blobReads[0].sql).not.toMatch(/VALUES[^S]*\?/);
    expect(blobReads[0].params).toEqual([item.evidenceId]);
  });

  test('rejects incomplete or malformed set-based BLOB fragments', async () => {
    const item = record({ content: Buffer.alloc(16001, 7), contentBytes: 16001 });
    const fake = fakeConnection({
      linkedRow: {
        EVIDENCE_ID: item.evidenceId, DOCUMENT_ID: item.documentId, REPARTIDOR_ID: item.repartidorId,
        EVIDENCE_KIND: item.kind, MIME_TYPE: item.mimeType, CONTENT_SHA256: item.contentSha256,
        CONTENT_BYTES: item.contentBytes, CONTENT_BLOB: item.content, STATUS: 'ENLAZADA',
      },
      hexRow: { CONTENT_HEX: item.content.subarray(0, 16000).toString('hex') },
    });

    await expect(repository(fake).repo.getLinked(item.evidenceId)).rejects.toMatchObject({
      code: 'REPARTO_EVIDENCE_STORE_UNAVAILABLE',
    });
    expect(MAX_EVIDENCE_BLOB_BYTES).toBe(4 * 1024 * 1024);
  });

  test('cancels and closes a hung linked-evidence query without continuing or leaking a rejection', async () => {
    const item = record();
    const calls = [];
    let releaseQuery;
    let closed = false;
    const cancel = jest.fn();
    const connection = {
      cancel,
      async execute(sql, params = []) {
        calls.push({ sql, params });
        if (sql.includes('QSYS2.SYSTABLES')) return [{ TABLE_NAME: EVIDENCE_TABLE }];
        if (sql.includes('QSYS2.SYSCOLUMNS')) {
          return REQUIRED_EVIDENCE_COLUMNS.map((COLUMN_NAME) => ({ COLUMN_NAME }));
        }
        return new Promise((resolve) => { releaseQuery = resolve; });
      },
      async close() { closed = true; },
    };
    const { repo } = repository({ connection });
    const controller = new AbortController();
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const pending = repo.getLinked(item.evidenceId, { signal: controller.signal });
      await new Promise((resolve) => setImmediate(resolve));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'EVIDENCE_TIMEOUT', statusCode: 504 });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(closed).toBe(true);
      expect(calls.filter(({ sql }) => sql.includes('CONTENT_BLOB'))).toHaveLength(0);

      releaseQuery([{
        EVIDENCE_ID: item.evidenceId, REPARTIDOR_ID: item.repartidorId,
        EVIDENCE_KIND: item.kind, MIME_TYPE: item.mimeType,
        CONTENT_SHA256: item.contentSha256, CONTENT_BYTES: item.contentBytes,
        CONTENT_BLOB: item.content, STATUS: 'ENLAZADA',
      }]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(calls.filter(({ sql }) => sql.includes('CONTENT_BLOB'))).toHaveLength(0);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('purges at most one locked batch and never targets linked evidence', async () => {
    const firstId = `ev_${'c'.repeat(64)}`;
    const secondId = `ev_${'d'.repeat(64)}`;
    const fake = fakeConnection({
      expiredRows: [{ EVIDENCE_ID: firstId }, { EVIDENCE_ID: secondId }],
    });

    await expect(repository(fake).repo.purgeExpired()).resolves.toEqual({ purged: 2 });
    const select = fake.calls.find((call) => call.sql.startsWith('SELECT E.EVIDENCE_ID FROM'));
    const deletion = fake.calls.find((call) => call.sql.startsWith('DELETE FROM'));
    expect(select.sql).toContain("STATUS = 'PENDIENTE'");
    expect(select.sql).toContain('NOT EXISTS');
    expect(select.sql).toContain(QUALIFIED_CONFIRMATION_EVIDENCE_TABLE);
    expect(select.sql).toContain('EXPIRES_AT <= CURRENT TIMESTAMP');
    expect(select.sql).toContain('FETCH FIRST 100 ROWS ONLY');
    expect(select.sql).toContain('USE AND KEEP EXCLUSIVE LOCKS');
    expect(deletion.sql).toContain("STATUS = 'PENDIENTE'");
    expect(deletion.sql).toContain('NOT EXISTS');
    expect(deletion.sql).toContain(QUALIFIED_CONFIRMATION_EVIDENCE_TABLE);
    expect(deletion.sql).toContain('EXPIRES_AT <= CURRENT TIMESTAMP');
    expect(deletion.sql).not.toContain('ENLAZADA');
    expect(deletion.params).toEqual([firstId, secondId]);
    expect(fake.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      'BEGIN_TRANSACTION', 'COMMIT_TRANSACTION',
    ]));
    expect(fake.calls.map((call) => call.sql)).not.toContain('ROLLBACK_TRANSACTION');
  });

  test('rejects a non-canonical confirmation-evidence mapping', () => {
    const fake = fakeConnection();
    expect(() => createRepartoEvidenceDb2Repository({
      tables: {
        evidences: QUALIFIED_EVIDENCE_TABLE,
        confirmationEvidences: 'JAVIER.OTHER_LINKS',
      },
      connectionFactory: async () => fake.connection,
      plannedDeliveryPort: { forConnection: jest.fn() },
      pendingTtlHours: 24,
    })).toThrow(expect.objectContaining({
      code: 'REPARTO_EVIDENCE_STORE_UNAVAILABLE',
      details: { key: 'confirmationEvidences' },
    }));
  });

  test('fails capability checks when EXPIRES_AT is absent', async () => {
    const fake = fakeConnection({
      columns: REQUIRED_EVIDENCE_COLUMNS.filter((column) => column !== 'EXPIRES_AT'),
    });

    await expect(repository(fake).repo.stage(record())).rejects.toMatchObject({
      code: 'REPARTO_EVIDENCE_STORE_UNAVAILABLE',
      details: { missingColumns: ['EXPIRES_AT'] },
    });
    expect(fake.calls.map((call) => call.sql)).not.toContain('BEGIN_TRANSACTION');
    expect(fake.calls.some((call) => call.sql.startsWith('INSERT'))).toBe(false);
  });

  test('rolls back staged BLOB data when insertion fails', async () => {
    const fake = fakeConnection({ insertError: new Error('insert failed') });

    await expect(repository(fake).repo.stage(record())).rejects.toMatchObject({
      code: 'REPARTO_EVIDENCE_PERSISTENCE_FAILED', statusCode: 503,
    });
    expect(fake.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');
    expect(fake.persistedWrites()).toBe(0);
    expect(fake.isClosed()).toBe(true);
  });

  test('rolls back and persists no BLOB when commit fails', async () => {
    const fake = fakeConnection({ commitError: new Error('commit failed') });

    await expect(repository(fake).repo.stage(record())).rejects.toMatchObject({
      code: 'REPARTO_EVIDENCE_PERSISTENCE_FAILED', statusCode: 503,
    });
    expect(fake.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      'BEGIN_TRANSACTION', 'COMMIT_TRANSACTION', 'ROLLBACK_TRANSACTION',
    ]));
    expect(fake.persistedWrites()).toBe(0);
  });

  test('fails closed before staging when explicit transaction methods are absent', async () => {
    const fake = fakeConnection({ transactionMethods: false });

    await expect(repository(fake).repo.stage(record())).rejects.toMatchObject({
      code: 'REPARTO_EVIDENCE_TRANSACTION_UNAVAILABLE', statusCode: 503,
    });
    expect(fake.calls.some((call) => call.sql.startsWith('INSERT'))).toBe(false);
    expect(fake.persistedWrites()).toBe(0);
  });

  test('rolls back and closes when planned ownership validation fails', async () => {
    const fake = fakeConnection();
    const plannedDelivery = jest.fn().mockRejectedValue(new Error('planned unavailable'));

    await expect(repository(fake, plannedDelivery).repo.stage(record())).rejects.toMatchObject({
      code: 'REPARTO_EVIDENCE_PERSISTENCE_FAILED', statusCode: 503,
    });
    expect(fake.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');
    expect(fake.calls.map((call) => call.sql)).not.toContain('COMMIT_TRANSACTION');
    expect(fake.isClosed()).toBe(true);
  });
});
