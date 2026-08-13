/**
 * Auth Repository Implementation - DB2
 */
const { AuthRepository } = require('../domain/auth-repository');
const { User } = require('../domain/user');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { getVendorVisibilityScope } = require('../../../../utils/common');

class Db2AuthRepository extends AuthRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findByCode(code) {
    const requested = String(code || '').trim();
    if (!requested || requested.length > 50) return null;

    const codeSql = `
      SELECT TRIM(P.CODIGOVENDEDOR) AS USUARIO,
        TRIM(D.NOMBREVENDEDOR) AS NOMBRE,
        CASE WHEN (
          SELECT MAX(NULLIF(TRIM(X.JEFEVENTASSN), ''))
          FROM DSEDAC.VDDX X
          WHERE X.CODIGOVENDEDOR = P.CODIGOVENDEDOR
        ) = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
        COALESCE((
          SELECT MAX(NULLIF(TRIM(V2.TIPOVENDEDOR), ''))
          FROM DSEDAC.VDC V2
          WHERE V2.CODIGOVENDEDOR = P.CODIGOVENDEDOR
            AND V2.SUBEMPRESA = 'GMP'
        ), '-') AS TIPOVENDEDOR,
        COALESCE((
          SELECT MAX(NULLIF(TRIM(E.HIDE_COMMISSIONS), ''))
          FROM JAVIER.COMMISSION_EXCEPTIONS E
          WHERE E.CODIGOVENDEDOR = P.CODIGOVENDEDOR
        ), 'N') AS HIDE_COMMISSIONS,
        '' AS EMAIL, P.CODIGOPIN AS PASSWORD_HASH, 1 AS ACTIVO
      FROM DSEDAC.VDPL1 P
      JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
      WHERE EXISTS (
        SELECT 1 FROM DSEDAC.VDC V
        WHERE V.CODIGOVENDEDOR = P.CODIGOVENDEDOR
          AND V.SUBEMPRESA = 'GMP'
      )
        AND TRIM(P.CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
      ORDER BY TRIM(P.CODIGOVENDEDOR)
      FETCH FIRST 2 ROWS ONLY
    `;
    let result = await this._db.executeParams(codeSql, [requested]);
    if (Array.isArray(result) && result.length > 1) return null;

    if (!Array.isArray(result) || result.length === 0) {
      const nameSql = `
        SELECT TRIM(P.CODIGOVENDEDOR) AS USUARIO,
          TRIM(D.NOMBREVENDEDOR) AS NOMBRE,
          CASE WHEN (
            SELECT MAX(NULLIF(TRIM(X.JEFEVENTASSN), ''))
            FROM DSEDAC.VDDX X
            WHERE X.CODIGOVENDEDOR = P.CODIGOVENDEDOR
          ) = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
          COALESCE((
            SELECT MAX(NULLIF(TRIM(V2.TIPOVENDEDOR), ''))
            FROM DSEDAC.VDC V2
            WHERE V2.CODIGOVENDEDOR = P.CODIGOVENDEDOR
              AND V2.SUBEMPRESA = 'GMP'
          ), '-') AS TIPOVENDEDOR,
          COALESCE((
            SELECT MAX(NULLIF(TRIM(E.HIDE_COMMISSIONS), ''))
            FROM JAVIER.COMMISSION_EXCEPTIONS E
            WHERE E.CODIGOVENDEDOR = P.CODIGOVENDEDOR
          ), 'N') AS HIDE_COMMISSIONS,
          '' AS EMAIL, P.CODIGOPIN AS PASSWORD_HASH, 1 AS ACTIVO
        FROM DSEDAC.VDD D
        JOIN DSEDAC.VDPL1 P ON D.CODIGOVENDEDOR = P.CODIGOVENDEDOR
        WHERE EXISTS (
          SELECT 1 FROM DSEDAC.VDC V
          WHERE V.CODIGOVENDEDOR = P.CODIGOVENDEDOR
            AND V.SUBEMPRESA = 'GMP'
        )
          AND REPLACE(UPPER(TRIM(D.NOMBREVENDEDOR)), ' ', '')
            LIKE '%' || CAST(? AS VARCHAR(100)) || '%'
        ORDER BY TRIM(P.CODIGOVENDEDOR)
        FETCH FIRST 2 ROWS ONLY
      `;
      const searchParam = requested.replace(/ /g, '').toUpperCase();
      result = await this._db.executeParams(nameSql, [searchParam]);
      if (!Array.isArray(result) || result.length !== 1) return null;
    }

    return User.fromDbRow(result[0]);
  }

  /**
   * Name login can match several vendors (e.g. "diego" → 22/25/86/98).
   * Caller must disambiguate with PIN; never invent a single row here.
   */
  async findNameLoginCandidates(name, { limit = 10 } = {}) {
    const requested = String(name || '').trim();
    if (!requested || requested.length > 50) return [];
    const max = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 20) : 10;
    const searchParam = requested.replace(/ /g, '').toUpperCase();
    const sql = `
      SELECT TRIM(P.CODIGOVENDEDOR) AS USUARIO,
        TRIM(D.NOMBREVENDEDOR) AS NOMBRE,
        CASE WHEN (
          SELECT MAX(NULLIF(TRIM(X.JEFEVENTASSN), ''))
          FROM DSEDAC.VDDX X
          WHERE X.CODIGOVENDEDOR = P.CODIGOVENDEDOR
        ) = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
        COALESCE((
          SELECT MAX(NULLIF(TRIM(V2.TIPOVENDEDOR), ''))
          FROM DSEDAC.VDC V2
          WHERE V2.CODIGOVENDEDOR = P.CODIGOVENDEDOR
            AND V2.SUBEMPRESA = 'GMP'
        ), '-') AS TIPOVENDEDOR,
        COALESCE((
          SELECT MAX(NULLIF(TRIM(E.HIDE_COMMISSIONS), ''))
          FROM JAVIER.COMMISSION_EXCEPTIONS E
          WHERE E.CODIGOVENDEDOR = P.CODIGOVENDEDOR
        ), 'N') AS HIDE_COMMISSIONS,
        '' AS EMAIL, P.CODIGOPIN AS PASSWORD_HASH, 1 AS ACTIVO
      FROM DSEDAC.VDD D
      JOIN DSEDAC.VDPL1 P ON D.CODIGOVENDEDOR = P.CODIGOVENDEDOR
      WHERE EXISTS (
        SELECT 1 FROM DSEDAC.VDC V
        WHERE V.CODIGOVENDEDOR = P.CODIGOVENDEDOR
          AND V.SUBEMPRESA = 'GMP'
      )
        AND REPLACE(UPPER(TRIM(D.NOMBREVENDEDOR)), ' ', '')
          LIKE '%' || CAST(? AS VARCHAR(100)) || '%'
      ORDER BY TRIM(P.CODIGOVENDEDOR)
      FETCH FIRST ${max} ROWS ONLY
    `;
    // max is a clamped integer only; never accept raw user input into SQL text.
    const rows = await this._db.executeParams(sql, [searchParam]);
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map((row) => User.fromDbRow(row));
  }

  async findByCredentials(username, password) {
    // CAST(? AS VARCHAR(50)) avoids ODBC 22001/CWB0111 when binding to IBM i CHAR columns
    const sql = `
      SELECT TRIM(V.CODIGOVENDEDOR) AS USUARIO, TRIM(V.NOMBREVENDEDOR) AS NOMBRE,
        CASE WHEN VX.JEFEVENTASSN = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
        '' AS EMAIL, TRIM(PL.CODIGOPIN) AS PASSWORD_HASH, 1 AS ACTIVO
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX VX ON V.CODIGOVENDEDOR = VX.CODIGOVENDEDOR
      LEFT JOIN DSEDAC.VDPL1 PL ON V.CODIGOVENDEDOR = PL.CODIGOVENDEDOR
      WHERE TRIM(V.CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
    `;
    const result = await this._db.executeParams(sql, [username.trim()]);
    if (!result || result.length === 0) return null;
    const user = User.fromDbRow(result[0]);
    // PIN-based auth: compare trimmed plain text PIN (CODIGOPIN is CHAR in DB2)
    if ((user._passwordHash || '').trim() === password.trim()) {
      return user;
    }
    return null;
  }

  async findRepartidorAssociation(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode || normalizedCode.length > 50 || !/^[A-Z0-9]+$/.test(normalizedCode)) return null;

    const sql = `
      SELECT DISTINCT TRIM(VENDEDOR) AS CODIGO_CONDUCTOR,
        CAST(NULL AS VARCHAR(30)) AS MATRICULA
      FROM JAVIER.RUTERO_CONFIG
      WHERE TRIM(VENDEDOR) = CAST(? AS VARCHAR(50))
        AND ORDEN >= 0
      FETCH FIRST 2 ROWS ONLY
    `;
    const rows = await this._db.executeParams(sql, [normalizedCode]);
    if (!Array.isArray(rows) || rows.length !== 1) return null;

    const associationCode = String(
      rows[0].CODIGO_CONDUCTOR || rows[0].codigo_conductor || rows[0].VENDEDOR || rows[0].vendedor || '',
    ).trim().toUpperCase();
    if (associationCode !== normalizedCode) return null;
    return {
      isRepartidor: true,
      codigoConductor: normalizedCode,
      matricula: String(rows[0].MATRICULA || rows[0].matricula || '').trim() || null,
    };
  }

  async getVendorVisibilityScope(code, { role } = {}) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode || normalizedCode.length > 50 || !/^[A-Z0-9]+$/.test(normalizedCode)) {
      return [];
    }
    if (role !== 'JEFE_VENTAS') {
      return getVendorVisibilityScope(normalizedCode);
    }

    const rows = await this._db.execute(`
      SELECT DISTINCT TRIM(CODIGOVENDEDOR) AS CODE
      FROM DSEDAC.VDC
      WHERE SUBEMPRESA = 'GMP'
      ORDER BY TRIM(CODIGOVENDEDOR)
    `);
    const codes = (Array.isArray(rows) ? rows : [])
      .map((row) => String(row.CODE || '').trim().toUpperCase())
      .filter(Boolean);
    return [...new Set([...codes, '82', '20', 'UNK'])];
  }
  async updatePassword(userId, newPasswordHash) {
    // NEVER write to DSEDAC/DSED (ERP tables are read-only)
    // Store password hash in JAVIER.APP_USUARIOS (our app's table)
    const sql = `
      MERGE INTO JAVIER.APP_USUARIOS U
      USING (VALUES (?)) AS V(USUARIO)
      ON U.USUARIO = V.USUARIO
      WHEN MATCHED THEN UPDATE SET U.PASSWORD_HASH = ?
      WHEN NOT MATCHED THEN INSERT (USUARIO, PASSWORD_HASH, ACTIVO) VALUES (?, ?, 1)
    `;
    await this._db.executeParams(sql, [userId, newPasswordHash, userId, newPasswordHash]);
    return true;
  }

  async logLoginAttempt(userId, success, ip) {
    // Pre-e7cfd8ee behavior (see 5e02bfc): APP_LOGIN_LOG is optional.
    // Missing table must never block login with AUTH_AUDIT_UNAVAILABLE / 503.
    try {
      const sql = `
        INSERT INTO JAVIER.APP_LOGIN_LOG (USUARIO, EXITO, IP, FECHA)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `;
      await this._db.executeParamsSilent(sql, [userId || 'UNKNOWN', success ? 1 : 0, ip || 'unknown']);
      return Object.freeze({ ok: true });
    } catch (_error) {
      return Object.freeze({ ok: true, skipped: true, code: 'AUTH_AUDIT_SKIPPED' });
    }
  }
}

module.exports = { Db2AuthRepository };
