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
    const sql = `
      SELECT V.CODIGOVENDEDOR AS USUARIO, V.NOMBREVENDEDOR AS NOMBRE,
        CASE WHEN VX.JEFEVENTASSN = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
        '' AS EMAIL, '' AS PASSWORD_HASH, 1 AS ACTIVO
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX VX ON VX.CODIGOVENDEDOR = V.CODIGOVENDEDOR
      WHERE V.CODIGOVENDEDOR = ?
    `;
    const result = await this._db.executeParams(sql, [code]);
    if (!result || result.length === 0) return null;
    return User.fromDbRow(result[0]);
  }

  async findByCredentials(username, password) {
    const sql = `
      SELECT V.CODIGOVENDEDOR AS USUARIO, V.NOMBREVENDEDOR AS NOMBRE,
        CASE WHEN VX.JEFEVENTASSN = 'S' THEN 'JEFE_VENTAS' ELSE 'COMERCIAL' END AS ROL,
        '' AS EMAIL, PL.CODIGOPIN AS PASSWORD_HASH, 1 AS ACTIVO
      FROM DSEDAC.VDD V
      LEFT JOIN DSEDAC.VDDX VX ON VX.CODIGOVENDEDOR = V.CODIGOVENDEDOR
      LEFT JOIN DSEDAC.VDPL1 PL ON PL.CODIGOVENDEDOR = V.CODIGOVENDEDOR
      WHERE V.CODIGOVENDEDOR = ?
    `;
    const result = await this._db.executeParams(sql, [username]);
    if (!result || result.length === 0) return null;
    const user = User.fromDbRow(result[0]);
    // PIN-based auth: compare plain text PIN
    if (user._passwordHash === password) {
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
