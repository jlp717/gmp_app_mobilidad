/**
 * Rutero Repository Implementation - DB2
 */
const { RuteroRepository } = require('../domain/rutero-repository');
const { RutaConfig } = require('../domain/ruta-config');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

class Db2RuteroRepository extends RuteroRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getRutaConfig({ vendorCode, date }) {
    const dayOfWeek = date ? new Date(date).getDay() : new Date().getDay();

    const sql = `
      SELECT
        RC.ID,
        RC.CODIGOCLIENTE,
        CL.NOMBRE as NOMBRECLIENTE,
        RC.ORDEN,
        RC.DIA_SEMANA,
        RC.VENDEDOR,
        RC.TIEMPO_ESTIMADO
      FROM JAVIER.RUTERO_CONFIG RC
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(RC.CODIGOCLIENTE) = TRIM(CL.CODIGO)
      WHERE RC.VENDEDOR = ?
        AND RC.DIA_SEMANA = ?
        AND RC.ORDEN >= 0
      ORDER BY RC.ORDEN
    `;

    const result = await this._db.executeParams(sql, [vendorCode, dayOfWeek]);
    return result.map(row => RutaConfig.fromDbRow(row));
  }

  async updateOrder({ configId, newOrder }) {
    const sql = `
      UPDATE JAVIER.RUTERO_CONFIG
      SET ORDEN = ?
      WHERE ID = ?
    `;

    await this._db.executeParams(sql, [newOrder, configId]);
    return { configId, newOrder };
  }

  async moveClient({ clientCode, fromDay, toDay, vendorCode }) {
    const sql = `
      UPDATE JAVIER.RUTERO_CONFIG
      SET DIA_SEMANA = ?
      WHERE CODIGOCLIENTE = ?
        AND VENDEDOR = ?
        AND DIA_SEMANA = ?
    `;

    const result = await this._db.executeParams(sql, [toDay, clientCode, vendorCode, fromDay]);
    return { clientCode, fromDay, toDay, affected: result.length };
  }

  async getCommissions({ vendorCode, date, role }) {
    const dateFilter = date ? `AND DATE(LAC.FECHA) = DATE(?)` : '';

    const sql = `
      SELECT
        LAC.CODIGOCLIENTE,
        CL.NOMBRE as NOMBRE_CLIENTE,
        SUM(LAC.IMPORTE) as TOTAL_VENTAS,
        SUM(LAC.COMISION) as TOTAL_COMISION,
        COUNT(*) as NUM_VENTAS
      FROM JAVIER.LACLAE LAC
      LEFT JOIN JAVIER.CLIENTES CL ON TRIM(LAC.CODIGOCLIENTE) = TRIM(CL.CODIGO)
      WHERE LAC.VENDEDOR = ?
        ${dateFilter}
      GROUP BY LAC.CODIGOCLIENTE, CL.NOMBRE
      ORDER BY TOTAL_VENTAS DESC
      FETCH FIRST 100 ROWS ONLY
    `;

    const params = [vendorCode];
    if (date) params.push(date);

    const result = await this._db.executeParams(sql, params);
    return result;
  }

  async getDaySummary({ vendorCode, date }) {
    const dateFilter = date ? `AND DATE(LAC.FECHA) = DATE(?)` : '';

    const sql = `
      SELECT
        COUNT(*) as TOTAL_CLIENTES,
        SUM(LAC.IMPORTE) as TOTAL_VENTAS,
        SUM(LAC.COMISION) as TOTAL_COMISION,
        COUNT(DISTINCT LAC.CODIGOCLIENTE) as CLIENTES_CON_VENTA
      FROM JAVIER.LACLAE LAC
      WHERE LAC.VENDEDOR = ?
        ${dateFilter}
    `;

    const params = [vendorCode];
    if (date) params.push(date);

    const result = await this._db.executeParams(sql, params);
    return result[0] || {};
  }
}

module.exports = { Db2RuteroRepository };
