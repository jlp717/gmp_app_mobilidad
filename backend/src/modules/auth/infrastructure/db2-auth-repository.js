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

  async findRepartidorAssociation(code, year = new Date().getFullYear()) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const normalizedYear = Number.parseInt(year, 10);
    if (!normalizedCode || normalizedCode.length > 50 || !/^[A-Z0-9]+$/.test(normalizedCode)) return null;
    if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 9999) return null;

    // Resolve both legacy reparto sources in one parameterized query. Ambiguous
    // conductor/vehicle associations fail closed instead of assigning a role.
    const sql = `
      SELECT CODIGO_CONDUCTOR, MATRICULA, ORIGEN
      FROM (
        SELECT DISTINCT TRIM(CODIGOCONDUCTOR) AS CODIGO_CONDUCTOR,
          NULLIF(TRIM(MATRICULA), '') AS MATRICULA, 'VEH' AS ORIGEN
        FROM DSEDAC.VEH
        WHERE TRIM(CODIGOCONDUCTOR) = CAST(? AS VARCHAR(50))
          AND TRIM(CODIGOCONDUCTOR) <> '98'

        UNION ALL

        SELECT TRIM(CODIGOREPARTIDOR) AS CODIGO_CONDUCTOR,
          CAST(NULL AS VARCHAR(30)) AS MATRICULA, 'OPP' AS ORIGEN
        FROM DSEDAC.OPP
        WHERE TRIM(CODIGOREPARTIDOR) = CAST(? AS VARCHAR(50))
          AND TRIM(CODIGOREPARTIDOR) <> '98'
          AND ANOREPARTO = ?
        GROUP BY TRIM(CODIGOREPARTIDOR)
        HAVING COUNT(*) >= 100
      ) REPARTO_ASOCIACION
      ORDER BY ORIGEN, MATRICULA
    `;
    const rows = await this._db.executeParams(sql, [normalizedCode, normalizedCode, normalizedYear]);
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const associations = rows
      .map((row) => ({
        codigoConductor: String(row.CODIGO_CONDUCTOR || row.codigo_conductor || '').trim().toUpperCase(),
        matricula: String(row.MATRICULA || row.matricula || '').trim() || null,
      }))
      .filter((row) => row.codigoConductor && row.codigoConductor !== '98');
    const conductorCodes = new Set(associations.map((row) => row.codigoConductor));
    const matriculas = new Set(associations.map((row) => row.matricula).filter(Boolean));

    if (conductorCodes.size !== 1 || !conductorCodes.has(normalizedCode) || matriculas.size > 1) return null;
    return {
      isRepartidor: true,
      codigoConductor: normalizedCode,
      matricula: matriculas.size === 1 ? [...matriculas][0] : null,
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
    try {
      const sql = `
        INSERT INTO JAVIER.APP_LOGIN_LOG (USUARIO, EXITO, IP, FECHA)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `;
      await this._db.executeParamsSilent(sql, [userId || 'UNKNOWN', success ? 1 : 0, ip || 'unknown']);
      return Object.freeze({ ok: true });
    } catch (_error) {
      return Object.freeze({ ok: false, code: 'AUTH_AUDIT_UNAVAILABLE' });
    }
  }
}

module.exports = { Db2AuthRepository };
