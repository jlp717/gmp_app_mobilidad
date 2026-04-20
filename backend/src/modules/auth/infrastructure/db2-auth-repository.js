/**
 * Auth Repository Implementation - DB2
 */
const { AuthRepository } = require('../domain/auth-repository');
const { User } = require('../domain/user');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2AuthRepository extends AuthRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async findByCode(code) {
    // Same query structure as legacy routes/auth.js - start from VDPL1 (PIN table) and JOIN VDD + VDC
    const sql = `
      SELECT TRIM(P.CODIGOVENDEDOR) AS USUARIO, TRIM(D.NOMBREVENDEDOR) AS NOMBRE,
        CASE WHEN X.JEFEVENTASSN = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
        '' AS EMAIL, P.CODIGOPIN AS PASSWORD_HASH, 1 AS ACTIVO
      FROM DSEDAC.VDPL1 P
      JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
      JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
      LEFT JOIN DSEDAC.VDDX X ON P.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      WHERE TRIM(P.CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
      FETCH FIRST 1 ROWS ONLY
    `;
    const result = await this._db.executeParams(sql, [code.trim()]);
    if (!result || result.length === 0) return null;
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
    const sql = `
      INSERT INTO JAVIER.APP_LOGIN_LOG (USUARIO, EXITO, IP, FECHA)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    try {
      await this._db.executeParams(sql, [userId || 'UNKNOWN', success ? 1 : 0, ip || 'unknown']);
    } catch (err) {
      // Log table might not exist yet - non-fatal
    }
  }
}

module.exports = { Db2AuthRepository };
