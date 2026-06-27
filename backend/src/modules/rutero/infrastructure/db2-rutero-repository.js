/**
 * Rutero Repository Implementation - DB2
 */
const { RuteroRepository } = require('../domain/rutero-repository');
const { RutaConfig } = require('../domain/ruta-config');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');

const LACLAE_SALES_FILTER = `
        L.TPDC = 'LAC'
        AND L.LCTPVT IN ('CC', 'VC')
        AND L.LCCLLN IN ('AB', 'VT')
        AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
`;

function getDateParts(date) {
  const source = date ? new Date(date) : new Date();
  if (Number.isNaN(source.getTime())) return null;
  return {
    year: source.getFullYear(),
    month: source.getMonth() + 1,
    day: source.getDate(),
  };
}

function normalizeVendorCode(vendorCode) {
  return String(vendorCode || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 2);
}

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
        COALESCE(TRIM(CL.NOMBRECLIENTE), TRIM(RC.CODIGOCLIENTE)) AS NOMBRECLIENTE,
        RC.ORDEN,
        RC.DIA_SEMANA,
        RC.VENDEDOR,
        RC.TIEMPO_ESTIMADO
      FROM JAVIER.RUTERO_CONFIG RC
      LEFT JOIN DSEDAC.CLI CL ON TRIM(CL.CODIGOCLIENTE) = TRIM(RC.CODIGOCLIENTE)
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
    const safeVendorCode = normalizeVendorCode(vendorCode);
    if (!safeVendorCode) return [];

    const dateParts = getDateParts(date);
    const dateFilter = dateParts ? 'AND L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC = ?' : '';

    const sql = `
      SELECT
        TRIM(L.LCCDCL) AS CODIGOCLIENTE,
        COALESCE(TRIM(CL.NOMBRECLIENTE), TRIM(L.LCCDCL)) AS NOMBRE_CLIENTE,
        COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS TOTAL_COMISION,
        COUNT(*) as NUM_VENTAS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CL ON TRIM(CL.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      WHERE L.R1_T8CDVD = CAST(? AS CHAR(2))
        ${dateFilter}
        AND ${LACLAE_SALES_FILTER}
      GROUP BY TRIM(L.LCCDCL), COALESCE(TRIM(CL.NOMBRECLIENTE), TRIM(L.LCCDCL))
      ORDER BY TOTAL_VENTAS DESC
      FETCH FIRST 100 ROWS ONLY
    `;

    const params = [safeVendorCode];
    if (dateParts) params.push(dateParts.year, dateParts.month, dateParts.day);

    const result = await this._db.executeParams(sql, params);
    return result;
  }

  async getDaySummary({ vendorCode, date }) {
    const safeVendorCode = normalizeVendorCode(vendorCode);
    if (!safeVendorCode) return {};

    const dateParts = getDateParts(date);
    const dateFilter = dateParts ? 'AND L.LCAADC = ? AND L.LCMMDC = ? AND L.LCDDDC = ?' : '';

    const sql = `
      SELECT
        COUNT(DISTINCT L.LCCDCL) AS TOTAL_CLIENTES,
        COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS TOTAL_COMISION,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTES_CON_VENTA
      FROM DSED.LACLAE L
      WHERE L.R1_T8CDVD = CAST(? AS CHAR(2))
        ${dateFilter}
        AND ${LACLAE_SALES_FILTER}
    `;

    const params = [safeVendorCode];
    if (dateParts) params.push(dateParts.year, dateParts.month, dateParts.day);

    const result = await this._db.executeParams(sql, params);
    return result[0] || {};
  }
}

module.exports = { Db2RuteroRepository };
