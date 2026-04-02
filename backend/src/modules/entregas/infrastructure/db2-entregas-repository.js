/**
 * Entregas Repository Implementation - DB2
 */
const { EntregasRepository } = require('../domain/entregas-repository');
const { Albaran } = require('../domain/albaran');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2EntregasRepository extends EntregasRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getAlbaranes({ repartidorId, date, status }) {
    const dateFilter = date ? `AND DATE(CPC.FECHAENTREGA) = DATE(?)` : '';
    const statusFilter = status ? `AND DS.STATUS = ?` : '';

    const sql = `
      SELECT DISTINCT
        CPC.NUMEROALBARAN as NUMERO,
        CPC.CODIGOCLIENTE as CODIGOCLIENTE,
        CL.NOMBRE as NOMBRECLIENTE,
        CPC.FECHAENTREGA as FECHA,
        CPC.IMPORTE as TOTAL,
        COALESCE(DS.STATUS, 'PENDIENTE') as ESTADO,
        DS.OBSERVACIONES,
        DS.FIRMA_PATH,
        DS.LATITUD,
        DS.LONGITUD
      FROM DSEDAC.CPC CPC
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(CPC.CODIGOCLIENTE) = TRIM(CL.CODIGO)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON CPC.NUMEROALBARAN = DS.ID
      WHERE TRIM(CPC.CODIGOREPARTIDOR) = ?
        ${dateFilter}
        ${statusFilter}
      ORDER BY CPC.FECHAENTREGA
      FETCH FIRST 200 ROWS ONLY
    `;

    const params = [repartidorId];
    if (date) params.push(date);
    if (status) params.push(status);

    const result = await this._db.executeParams(sql, params);
    return result.map(row => Albaran.fromDbRow({
      ID: row.NUMERO,
      NUMERO: row.NUMERO,
      CODIGOCLIENTE: row.CODIGOCLIENTE,
      NOMBRECLIENTE: row.NOMBRECLIENTE,
      FECHA: row.FECHA,
      TOTAL: row.TOTAL,
      ESTADO: row.ESTADO,
      OBSERVACIONES: row.OBSERVACIONES
    }));
  }

  async getAlbaranDetail(albaranId) {
    const sql = `
      SELECT
        CPC.NUMEROALBARAN as NUMERO,
        CPC.CODIGOCLIENTE as CODIGOCLIENTE,
        CL.NOMBRE as NOMBRECLIENTE,
        CPC.FECHAENTREGA as FECHA,
        CPC.IMPORTE as TOTAL,
        COALESCE(DS.STATUS, 'PENDIENTE') as ESTADO,
        DS.OBSERVACIONES,
        DS.FIRMA_PATH,
        DS.LATITUD,
        DS.LONGITUD,
        DS.UPDATED_AT as ENTREGADO_EN
      FROM DSEDAC.CPC CPC
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(CPC.CODIGOCLIENTE) = TRIM(CL.CODIGO)
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON CPC.NUMEROALBARAN = DS.ID
      WHERE CPC.NUMEROALBARAN = ?
      FETCH FIRST 1 ROW ONLY
    `;

    const result = await this._db.executeParams(sql, [albaranId]);
    if (!result || result.length === 0) return null;

    const row = result[0];
    return Albaran.fromDbRow({
      ID: row.NUMERO,
      NUMERO: row.NUMERO,
      CODIGOCLIENTE: row.CODIGOCLIENTE,
      NOMBRECLIENTE: row.NOMBRECLIENTE,
      FECHA: row.FECHA,
      TOTAL: row.TOTAL,
      ESTADO: row.ESTADO,
      OBSERVACIONES: row.OBSERVACIONES
    });
  }

  async markDelivered({ albaranId, observations, signaturePath, latitude, longitude, repartidorId }) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();

    const sql = `
      INSERT INTO JAVIER.DELIVERY_STATUS (
        ID, STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD,
        UPDATED_AT, REPARTIDOR_ID
      ) VALUES (?, 'ENTREGADO', ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `;

    await this._db.executeParams(sql, [
      albaranId,
      observations || '',
      signaturePath || '',
      latitude || null,
      longitude || null,
      repartidorId
    ]);

    return { albaranId, status: 'ENTREGADO', deliveredAt: new Date() };
  }

  async getGamificationStats(repartidorId) {
    const currentYear = new Date().getFullYear();

    const sql = `
      SELECT COUNT(*) as TOTAL_DELIVERIES
      FROM DSEDAC.CPC
      WHERE TRIM(CODIGOREPARTIDOR) = ?
        AND ANODOCUMENTO = ?
    `;

    const result = await this._db.executeParams(sql, [repartidorId, currentYear]);
    return {
      totalDeliveries: result[0]?.TOTAL_DELIVERIES || 0,
      level: Math.floor((result[0]?.TOTAL_DELIVERIES || 0) / 10) + 1,
      currentYear
    };
  }

  async getRouteSummary({ repartidorId, date }) {
    const dateFilter = date ? `AND DATE(CPC.FECHAENTREGA) = DATE(?)` : '';

    const sql = `
      SELECT
        COUNT(*) as TOTAL,
        SUM(CASE WHEN DS.STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as ENTREGADOS,
        SUM(CASE WHEN DS.STATUS IS NULL OR DS.STATUS = 'PENDIENTE' THEN 1 ELSE 0 END) as PENDIENTES,
        SUM(CASE WHEN DS.STATUS = 'ENTREGA_PARCIAL' THEN 1 ELSE 0 END) as PARCIALES
      FROM DSEDAC.CPC CPC
      LEFT JOIN JAVIER.DELIVERY_STATUS DS ON CPC.NUMEROALBARAN = DS.ID
      WHERE TRIM(CPC.CODIGOREPARTIDOR) = ?
        ${dateFilter}
    `;

    const params = [repartidorId];
    if (date) params.push(date);

    const result = await this._db.executeParams(sql, params);
    return result[0] || {};
  }
}

module.exports = { Db2EntregasRepository };
