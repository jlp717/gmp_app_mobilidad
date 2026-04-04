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

  async findByVendor(vendedorCodes, year, month, filters = {}) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `V.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND YEAR(V.FECHA) = ?` : '';
    const monthFilter = month ? `AND MONTH(V.FECHA) = ?` : '';
    const clientFilter = filters.clientCode ? `AND TRIM(V.CODCLI) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (filters.clientCode) params.push(filters.clientCode);

    const sql = `
      SELECT 
        V.VENDEDOR,
        V.CODCLI AS CODIGO,
        COALESCE(C.NOMCLI, V.CODCLI) AS NOMBRE,
        V.NUMDOC,
        V.FECHA,
        COALESCE(V.IMPORTE, 0) AS IMPORTE,
        COALESCE(V.PORC_COM, 0) AS PORCENTAJE,
        COALESCE(V.IMP_COM, 0) AS COMISION
      FROM JAVIER.VENTAS_COM V
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(V.CODCLI)
      WHERE ${vendorFilter}
        ${yearFilter}
        ${monthFilter}
        ${clientFilter}
      ORDER BY V.FECHA DESC
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Commission.fromDbRow(row));
  }

  async getSummary(vendedorCodes, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `V.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND YEAR(V.FECHA) = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        V.VENDEDOR,
        COALESCE(SUM(V.IMPORTE), 0) AS TOTAL_VENTAS,
        COALESCE(SUM(V.IMP_COM), 0) AS TOTAL_COMISIONES,
        COUNT(DISTINCT V.NUMDOC) AS TOTAL_DOCUMENTOS,
        COUNT(DISTINCT V.CODCLI) AS TOTAL_CLIENTES
      FROM JAVIER.VENTAS_COM V
      WHERE ${vendorFilter}
        ${yearFilter}
      GROUP BY V.VENDEDOR
      ORDER BY TOTAL_COMISIONES DESC
    `;

    return await this._db.executeParams(sql, params);
  }

  async getByClient(vendedorCodes, clientCode, year) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `V.VENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;
    const yearFilter = year ? `AND YEAR(V.FECHA) = ?` : '';
    const params = [clientCode];
    if (year) params.push(year);

    const sql = `
      SELECT 
        V.VENDEDOR,
        V.CODCLI AS CODIGO,
        COALESCE(C.NOMCLI, V.CODCLI) AS NOMBRE,
        V.NUMDOC,
        V.FECHA,
        COALESCE(V.IMPORTE, 0) AS IMPORTE,
        COALESCE(V.PORC_COM, 0) AS PORCENTAJE,
        COALESCE(V.IMP_COM, 0) AS COMISION
      FROM JAVIER.VENTAS_COM V
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(V.CODCLI)
      WHERE TRIM(V.CODCLI) = ?
        AND ${vendorFilter}
        ${yearFilter}
      ORDER BY V.FECHA DESC
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => Commission.fromDbRow(row));
  }
}

module.exports = { Db2CommissionRepository };
