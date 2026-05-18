/**
 * Chatbot Repository Implementation - DB2
 * READ/WRITE: JAVIER tables for session storage
 * READ-ONLY: DSEDAC.CLI (clients), DSEDAC.ART (products)
 */
const { ChatbotRepository } = require('../domain/chatbot-repository');
const { ChatSession } = require('../domain/chat-session');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2ChatbotRepository extends ChatbotRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getSession(userId) {
    const sql = `
      SELECT ID, USER_ID, MESSAGES, FECHA_CREACION, FECHA_ACTUALIZACION
      FROM JAVIER.CHATBOT_SESSIONS
      WHERE USER_ID = ?
      ORDER BY FECHA_ACTUALIZACION DESC
      FETCH FIRST 1 ROWS ONLY
    `;
    const result = await this._db.executeParams(sql, [userId]);
    return result && result.length > 0 ? ChatSession.fromDbRow(result[0]) : null;
  }

  async createSession(userId) {
    const sql = `
      INSERT INTO JAVIER.CHATBOT_SESSIONS (USER_ID, MESSAGES, FECHA_CREACION, FECHA_ACTUALIZACION)
      VALUES (?, '[]', CURRENT TIMESTAMP, CURRENT TIMESTAMP)
    `;
    await this._db.executeParams(sql, [userId]);
    return this.getSession(userId);
  }

  async saveMessage(sessionId, message) {
    const getSql = `SELECT MESSAGES FROM JAVIER.CHATBOT_SESSIONS WHERE ID = ?`;
    const current = await this._db.executeParams(getSql, [sessionId]);

    if (!current || current.length === 0) return null;

    const messages = JSON.parse(current[0].MESSAGES || '[]');
    messages.push({
      role: message.role,
      content: message.content,
      timestamp: new Date().toISOString()
    });

    const updateSql = `
      UPDATE JAVIER.CHATBOT_SESSIONS
      SET MESSAGES = ?, FECHA_ACTUALIZACION = CURRENT TIMESTAMP
      WHERE ID = ?
    `;
    await this._db.executeParams(updateSql, [JSON.stringify(messages), sessionId]);

    return { success: true, messageCount: messages.length };
  }

  async getHistory(userId, limit = 50) {
    const sql = `
      SELECT ID, USER_ID, MESSAGES, FECHA_CREACION, FECHA_ACTUALIZACION
      FROM JAVIER.CHATBOT_SESSIONS
      WHERE USER_ID = ?
      ORDER BY FECHA_ACTUALIZACION DESC
      FETCH FIRST ? ROWS ONLY
    `;
    const result = await this._db.executeParams(sql, [userId, limit]);
    return (result || []).map(row => ChatSession.fromDbRow(row));
  }

  async lookupClient(code) {
    const sql = `
      SELECT 
        CODIGOCLIENTE AS CODIGO,
        NOMBRECLIENTE AS NOMBRE,
        DIRECCION,
        POBLACION,
        PROVINCIA,
        TELEFONO1 AS TELEFONO,
        EMAIL,
        CODCLI AS TARIFA,
        CODIGOVENDEDOR AS VENDEDOR
      FROM DSEDAC.CLI
      WHERE TRIM(CODIGOCLIENTE) = ?
    `;
    const result = await this._db.executeParams(sql, [code]);
    return result && result.length > 0 ? result[0] : null;
  }

  async lookupProduct(code) {
    const sql = `
      SELECT 
        CODIGOARTICULO AS CODIGO,
        DESCRIPCIONARTICULO AS NOMBRE,
        CODIGOFAMILIA AS FAMILIA,
        PRECIOVENTA AS PRECIO,
        UNIDADESPORCAJA AS UDS_CAJA
      FROM DSEDAC.ART
      WHERE TRIM(CODIGOARTICULO) = ?
    `;
    const result = await this._db.executeParams(sql, [code]);
    return result && result.length > 0 ? result[0] : null;
  }

  async searchClients(query, limit = 10) {
    const searchTerm = `%${query.toUpperCase()}%`;
    const sql = `
      SELECT 
        CODIGOCLIENTE AS CODIGO,
        NOMBRECLIENTE AS NOMBRE,
        POBLACION,
        PROVINCIA
      FROM DSEDAC.CLI
      WHERE (UPPER(NOMBRECLIENTE) LIKE ? OR TRIM(CODIGOCLIENTE) LIKE ?)
        AND (ANOBAJA IS NULL OR ANOBAJA = 0)
      ORDER BY NOMBRECLIENTE
      FETCH FIRST ? ROWS ONLY
    `;
    return await this._db.executeParams(sql, [searchTerm, searchTerm, limit]);
  }

  async searchProducts(query, limit = 10) {
    const searchTerm = `%${query.toUpperCase()}%`;
    const sql = `
      SELECT 
        CODIGOARTICULO AS CODIGO,
        DESCRIPCIONARTICULO AS NOMBRE,
        CODIGOFAMILIA AS FAMILIA
      FROM DSEDAC.ART
      WHERE UPPER(DESCRIPCIONARTICULO) LIKE ? OR TRIM(CODIGOARTICULO) LIKE ?
      ORDER BY DESCRIPCIONARTICULO
      FETCH FIRST ? ROWS ONLY
    `;
    return await this._db.executeParams(sql, [searchTerm, searchTerm, limit]);
  }
}

module.exports = { Db2ChatbotRepository };
