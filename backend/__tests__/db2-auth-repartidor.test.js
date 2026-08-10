'use strict';

jest.mock('../config/db', () => ({
  query: jest.fn(), queryWithParams: jest.fn(), getPool: jest.fn(), initDb: jest.fn(),
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
const { Db2AuthRepository } = require('../src/modules/auth/infrastructure/db2-auth-repository');

describe('Db2AuthRepository reparto association', () => {
  test('detects one real conductor with one parameterized VEH/OPP batch', async () => {
    const db = { executeParams: jest.fn().mockResolvedValue([
      { CODIGO_CONDUCTOR: ' 050 ', MATRICULA: ' 1234ABC ' },
      { CODIGO_CONDUCTOR: '050', MATRICULA: null },
    ]) };
    const repo = new Db2AuthRepository(db);

    await expect(repo.findRepartidorAssociation(' 050 ', 2026)).resolves.toEqual({
      isRepartidor: true, codigoConductor: '050', matricula: '1234ABC',
    });
    expect(db.executeParams).toHaveBeenCalledTimes(1);
    const [sql, params] = db.executeParams.mock.calls[0];
    expect(sql).toContain('FROM DSEDAC.VEH');
    expect(sql).toContain('FROM DSEDAC.OPP');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('HAVING COUNT(*) >= 100');
    expect((sql.match(/\?/g) || [])).toHaveLength(3);
    expect(sql).not.toContain("'050'");
    expect(params).toEqual(['050', '050', 2026]);
  });

  test('does not escalate absent or ambiguous reparto', async () => {
    const absent = new Db2AuthRepository({ executeParams: jest.fn().mockResolvedValue([]) });
    const conductors = new Db2AuthRepository({ executeParams: jest.fn().mockResolvedValue([
      { CODIGO_CONDUCTOR: '052', MATRICULA: null },
      { CODIGO_CONDUCTOR: '053', MATRICULA: null },
    ]) });
    const vehicles = new Db2AuthRepository({ executeParams: jest.fn().mockResolvedValue([
      { CODIGO_CONDUCTOR: '052', MATRICULA: '1111AAA' },
      { CODIGO_CONDUCTOR: '052', MATRICULA: '2222BBB' },
    ]) });

    await expect(absent.findRepartidorAssociation('052', 2026)).resolves.toBeNull();
    await expect(conductors.findRepartidorAssociation('052', 2026)).resolves.toBeNull();
    await expect(vehicles.findRepartidorAssociation('052', 2026)).resolves.toBeNull();
  });

  test('rejects invalid identity input without querying DB2', async () => {
    const db = { executeParams: jest.fn() };
    const repo = new Db2AuthRepository(db);
    await expect(repo.findRepartidorAssociation("05' OR 1=1", 2026)).resolves.toBeNull();
    expect(db.executeParams).not.toHaveBeenCalled();
  });

  test('findByCode derives manager status with scalar VDDX subselect and deterministic vendor membership', async () => {
    const db = { executeParams: jest.fn().mockResolvedValue([{
      USUARIO: '050', NOMBRE: 'Persona', ROL: 'JEFE_VENTAS', PASSWORD_HASH: '1234', ACTIVO: 1,
      TIPOVENDEDOR: 'R', HIDE_COMMISSIONS: 'Y',
    }]) };
    const repo = new Db2AuthRepository(db);

    const user = await repo.findByCode('050');

    expect(user.code).toBe('050');
    expect(user.tipoVendedor).toBe('R');
    expect(user.showCommissions).toBe(false);
    const [sql, params] = db.executeParams.mock.calls[0];
    // DB2 for i rejects EXISTS in the SELECT-list CASE (SQLCODE -104 / ODBC 42000).
    // Use scalar MAX subselect (same pattern as TIPOVENDEDOR / HIDE_COMMISSIONS).
    expect(sql).toMatch(/CASE WHEN \([\s\S]+MAX\(NULLIF\(TRIM\(X\.JEFEVENTASSN\)[\s\S]+FROM DSEDAC\.VDDX/);
    expect(sql).toMatch(/WHERE EXISTS[\s\S]+FROM DSEDAC\.VDC/);
    expect(sql).not.toMatch(/LEFT JOIN DSEDAC\.VDDX|JOIN DSEDAC\.VDC V ON/);
    expect(sql).not.toMatch(/SELECT DISTINCT TRIM\(P\.CODIGOVENDEDOR\)/);
    expect(sql).toMatch(/ORDER BY[\s\S]+FETCH FIRST 2 ROWS ONLY/);
    expect(sql).toMatch(/MAX\(NULLIF\(TRIM\(V2\.TIPOVENDEDOR\)/);
    expect(sql).toMatch(/MAX\(NULLIF\(TRIM\(E\.HIDE_COMMISSIONS\)/);
    expect(sql).not.toMatch(/CASE WHEN EXISTS[\s\S]+FROM DSEDAC\.VDDX/);
    expect(params).toEqual(['050']);
  });

  test('fails closed when a code lookup returns duplicate credential rows', async () => {
    const db = { executeParams: jest.fn().mockResolvedValue([
      { USUARIO: '050', NOMBRE: 'Persona', ROL: 'COMERCIAL', PASSWORD_HASH: '1', ACTIVO: 1 },
      { USUARIO: '050', NOMBRE: 'Persona', ROL: 'COMERCIAL', PASSWORD_HASH: '2', ACTIVO: 1 },
    ]) };
    const repo = new Db2AuthRepository(db);

    await expect(repo.findByCode('050')).resolves.toBeNull();
    expect(db.executeParams).toHaveBeenCalledTimes(1);
  });

  test('fails closed when a name lookup matches more than one vendor', async () => {
    const db = { executeParams: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { USUARIO: '050', NOMBRE: 'ANA', ROL: 'COMERCIAL', PASSWORD_HASH: '1', ACTIVO: 1 },
        { USUARIO: '051', NOMBRE: 'ANA MARIA', ROL: 'COMERCIAL', PASSWORD_HASH: '2', ACTIVO: 1 },
      ]) };
    const repo = new Db2AuthRepository(db);

    await expect(repo.findByCode('ana')).resolves.toBeNull();
    expect(db.executeParams).toHaveBeenCalledTimes(2);
    const [nameSql, params] = db.executeParams.mock.calls[1];
    expect(nameSql).toMatch(/ORDER BY[\s\S]+FETCH FIRST 2 ROWS ONLY/);
    expect(params).toEqual(['ANA']);
  });

  test('findNameLoginCandidates returns multiple active name matches for PIN disambiguation', async () => {
    const db = { executeParams: jest.fn().mockResolvedValue([
      { USUARIO: '22', NOMBRE: '22 DIEGO ALCAZAR', ROL: 'COMERCIAL', PASSWORD_HASH: '0484', ACTIVO: 1 },
      { USUARIO: '98', NOMBRE: '98 DIEGO (98)', ROL: 'COMERCIAL', PASSWORD_HASH: '9322', ACTIVO: 1 },
    ]) };
    const repo = new Db2AuthRepository(db);
    const users = await repo.findNameLoginCandidates('diego');
    expect(users.map((u) => u.code)).toEqual(['22', '98']);
    expect(users[1]._passwordHash).toBe('9322');
    expect(db.executeParams.mock.calls[0][1]).toEqual(['DIEGO']);
  });
  test('resolves commercial visibility without a DB round trip', async () => {
    const db = { execute: jest.fn(), executeParams: jest.fn() };
    const repo = new Db2AuthRepository(db);

    await expect(repo.getVendorVisibilityScope('80', { role: 'COMERCIAL' })).resolves.toEqual([
      '80', '72', '73', '81', '83',
    ]);
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.executeParams).not.toHaveBeenCalled();
  });

  test('resolves the manager scope from one read-only DB2 query', async () => {
    const db = {
      execute: jest.fn().mockResolvedValue([
        { CODE: '050' }, { CODE: ' 051 ' }, { CODE: '050' },
      ]),
      executeParams: jest.fn(),
    };
    const repo = new Db2AuthRepository(db);

    await expect(repo.getVendorVisibilityScope('050', { role: 'JEFE_VENTAS' })).resolves.toEqual([
      '050', '051', '82', '20', 'UNK',
    ]);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toMatch(/SELECT DISTINCT[\s\S]+FROM DSEDAC\.VDC/);
  });

  test('treats missing APP_LOGIN_LOG as non-fatal skip so login stays available', async () => {
    const db = { executeParamsSilent: jest.fn()
      .mockRejectedValueOnce(new Error('sensitive DB detail'))
      .mockResolvedValueOnce() };
    const repo = new Db2AuthRepository(db);

    await expect(repo.logLoginAttempt('V050', true, '127.0.0.1')).resolves.toEqual({
      ok: true, skipped: true, code: 'AUTH_AUDIT_SKIPPED',
    });
    await expect(repo.logLoginAttempt('V050', false, '127.0.0.1')).resolves.toEqual({ ok: true });
    expect(db.executeParamsSilent).toHaveBeenCalledTimes(2);
  });
});
