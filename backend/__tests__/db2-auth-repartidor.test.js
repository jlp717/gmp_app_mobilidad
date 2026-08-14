'use strict';

jest.mock('../config/db', () => ({
  query: jest.fn(), queryWithParams: jest.fn(), getPool: jest.fn(), initDb: jest.fn(),
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
const { Db2AuthRepository } = require('../src/modules/auth/infrastructure/db2-auth-repository');

describe('Db2AuthRepository reparto association', () => {
  test('queries only ERP VDDX rows with PERMITEREPARTOSN and a parameterized vendor code', async () => {
    const db = { executeParams: jest.fn().mockResolvedValue([]) };
    const repo = new Db2AuthRepository(db);

    await expect(repo.findRepartidorAssociation(' a17 ')).resolves.toBeNull();
    expect(db.executeParams).toHaveBeenCalledTimes(1);
    const [sql, params] = db.executeParams.mock.calls[0];
    expect(sql).toMatch(/FROM\s+DSEDAC\.VDDX/i);
    expect(sql).toMatch(/TRIM\(X\.CODIGOVENDEDOR\)\s*=\s*CAST\(\?\s+AS VARCHAR\(50\)\)/i);
    expect(sql).toMatch(/TRIM\(X\.PERMITEREPARTOSN\)\s*=\s*'S'/i);
    expect(sql).not.toMatch(/JAVIER\.RUTERO_CONFIG/i);
    expect((sql.match(/\?/g) || [])).toHaveLength(1);
    expect(sql).not.toContain("'A17'");
    expect(params).toEqual(['A17']);
  });

  test('returns null when ERP has no repartidor flag', async () => {
    const repo = new Db2AuthRepository({ executeParams: jest.fn().mockResolvedValue([]) });

    await expect(repo.findRepartidorAssociation('A17')).resolves.toBeNull();
  });

  test('maps an ERP repartidor association with nullable matricula', async () => {
    const repo = new Db2AuthRepository({ executeParams: jest.fn().mockResolvedValue([
      { CODIGO_CONDUCTOR: ' A17 ', MATRICULA: null },
    ]) });

    await expect(repo.findRepartidorAssociation('A17')).resolves.toEqual({
      isRepartidor: true,
      codigoConductor: 'A17',
      matricula: null,
    });
  });

  test('rejects invalid identity input without querying DB2', async () => {
    const db = { executeParams: jest.fn() };
    const repo = new Db2AuthRepository(db);
    await expect(repo.findRepartidorAssociation("05' OR 1=1", 2026)).resolves.toBeNull();
    expect(db.executeParams).not.toHaveBeenCalled();
  });

  test('findByCode derives mobility flags from DSEDAC.VDDX and deterministic vendor membership', async () => {
    const db = { executeParams: jest.fn().mockResolvedValue([{
      USUARIO: '050', NOMBRE: 'Persona', ROL: 'JEFE_VENTAS', PASSWORD_HASH: '1234', ACTIVO: 1,
      TIPOVENDEDOR: 'R', HIDE_COMMISSIONS: 'Y',
      PREVENTISTA_SN: 'S', REPARTIDOR_SN: 'N', JEFE_SN: 'S', MATRICULA: ' 02 ',
    }]) };
    const repo = new Db2AuthRepository(db);

    const user = await repo.findByCode('050');

    expect(user.code).toBe('050');
    expect(user.tipoVendedor).toBe('R');
    expect(user.showCommissions).toBe(false);
    expect(user.permitePreventa).toBe(true);
    expect(user.permiteReparto).toBe(false);
    expect(user.isJefeVentas).toBe(true);
    expect(user.matricula).toBe('02');
    const [sql, params] = db.executeParams.mock.calls[0];
    expect(sql).toMatch(/PERMITEPREVENTASN/);
    expect(sql).toMatch(/PERMITEREPARTOSN/);
    expect(sql).toMatch(/JEFEVENTASSN/);
    expect(sql).toMatch(/WHERE EXISTS[\s\S]+FROM DSEDAC\.VDC/);
    expect(sql).not.toMatch(/JAVIER\.RUTERO_CONFIG/i);
    expect(sql).toMatch(/ORDER BY[\s\S]+FETCH FIRST 2 ROWS ONLY/);
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
