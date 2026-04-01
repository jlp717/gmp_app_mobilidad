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
      SELECT USUARIO, NOMBRE, ROL, EMAIL, PASSWORD_HASH, ACTIVO
      FROM JAVIER.APP_USUARIOS
      WHERE USUARIO = ?
    `;
    const result = await this._db.executeParams(sql, [code]);
    if (!result || result.length === 0) return null;
    return User.fromDbRow(result[0]);
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
