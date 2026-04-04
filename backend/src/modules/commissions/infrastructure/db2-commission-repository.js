/**
 * Commissions Repository Implementation - DB2
 */
const { CommissionRepository } = require('../domain/commission-repository');
const { Commission } = require('../domain/commission');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { sanitizeCodeList } = require('../../../../utils/common');

class Db2CommissionRepository extends CommissionRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getCommissionPayments(vendedorCodes, year, month) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `CP.VENDEDOR_CODIGO IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND CP.ANIO = ?` : '';
    const monthFilter = month ? `AND CP.MES = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        CP.ID,
        CP.VENDEDOR_CODIGO AS VENDEDOR,
        CP.ANIO,
        CP.MES,
        COALESCE(CP.VENTAS_REAL, 0) AS VENTAS_REAL,
        COALESCE(CP.OBJETIVO_MES, 0) AS OBJETIVO_MES,
        COALESCE(CP.VENTAS_SOBRE_OBJETIVO, 0) AS VENTAS_SOBRE_OBJETIVO,
        COALESCE(CP.COMISION_GENERADA, 0) AS COMISION_GENERADA,
        COALESCE(CP.IMPORTE_PAGADO, 0) AS IMPORTE_PAGADO
      FROM JAVIER.COMMISSION_PAYMENTS CP
      WHERE ${vendorFilter}
        ${yearFilter}
        ${monthFilter}
      ORDER BY CP.ANIO DESC, CP.MES DESC
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Commission.fromDbRow(row));
  }

  async getSummary(vendedorCodes, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `CP.VENDEDOR_CODIGO IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND CP.ANIO = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        CP.VENDEDOR_CODIGO AS VENDEDOR,
        COALESCE(SUM(CP.VENTAS_REAL), 0) AS TOTAL_VENTAS,
        COALESCE(SUM(CP.COMISION_GENERADA), 0) AS TOTAL_COMISIONES,
        COALESCE(SUM(CP.IMPORTE_PAGADO), 0) AS TOTAL_PAGADO,
        COUNT(DISTINCT CP.MES) AS TOTAL_MESES
      FROM JAVIER.COMMISSION_PAYMENTS CP
      WHERE ${vendorFilter}
        ${yearFilter}
      GROUP BY CP.VENDEDOR_CODIGO
      ORDER BY TOTAL_COMISIONES DESC
    `;

    return await this._db.executeParams(sql, params);
  }

  async getByClient(vendedorCodes, clientCode, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `LAC.CODIGOVENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND LAC.ANODOCUMENTO = ?` : '';
    const params = [clientCode];
    if (year) params.push(year);

    const sql = `
      SELECT 
        LAC.CODIGOVENDEDOR AS VENDEDOR,
        LAC.CODIGOCLIENTEALBARAN AS CODIGO,
        COALESCE(CLI.NOMBRECLIENTE, LAC.CODIGOCLIENTEALBARAN) AS NOMBRE,
        LAC.NUMEROALBARAN AS NUMDOC,
        LAC.DIADOCUMENTO AS DIA,
        LAC.MESDOCUMENTO AS MES,
        LAC.ANODOCUMENTO AS ANIO,
        COALESCE(LAC.IMPORTEVENTA, 0) AS IMPORTE,
        0 AS PORCENTAJE,
        0 AS COMISION
      FROM DSEDAC.LAC LAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(LAC.CODIGOCLIENTEALBARAN)
      WHERE TRIM(LAC.CODIGOCLIENTEALBARAN) = ?
        AND ${vendorFilter}
        ${yearFilter}
      ORDER BY LAC.ANODOCUMENTO DESC, LAC.MESDOCUMENTO DESC, LAC.DIADOCUMENTO DESC
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Commission.fromDbRow(row));
  }
}

module.exports = { Db2CommissionRepository };
