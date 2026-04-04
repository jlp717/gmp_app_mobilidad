/**
 * Dashboard Repository Implementation - DB2
 * Optimized queries with vendor code 'ALL' handling
 */
const { DashboardRepository } = require('../domain/dashboard-repository');
const { DashboardMetrics, SalesEvolutionPoint, TopClient, TopProduct } = require('../domain/dashboard-metrics');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { VENDOR_COLUMN, LACLAE_SALES_FILTER, sanitizeCodeList } = require('../../../../utils/common');

class Db2DashboardRepository extends DashboardRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getMetrics(vendedorCodes, year, month) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const monthFilter = month ? `AND MONTH(L.FECHA) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS,
        COALESCE(SUM(L.BULTOS), 0) AS CAJAS
      FROM JAVIER.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
    `;

    const result = await this._db.executeParams(sql, params);
    return result[0] || { VENTAS: 0, MARGEN: 0, PEDIDOS: 0, CAJAS: 0 };
  }

  async getSalesEvolution(vendedorCodes, year, months = 12) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        YEAR(L.FECHA) AS ANIO,
        MONTH(L.FECHA) AS MES,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS
      FROM JAVIER.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
      GROUP BY YEAR(L.FECHA), MONTH(L.FECHA)
      ORDER BY ANIO, MES
      FETCH FIRST ${months} ROWS ONLY
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => new SalesEvolutionPoint({
      date: `${row.ANIO}-${String(row.MES).padStart(2, '0')}`,
      ventas: parseFloat(row.VENTAS),
      margen: parseFloat(row.MARGEN),
      pedidos: parseInt(row.PEDIDOS)
    }));
  }

  async getTopClients(vendedorCodes, year, month, limit = 10) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const monthFilter = month ? `AND MONTH(L.FECHA) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(limit);

    const sql = `
      SELECT 
        L.CODIGO AS CODIGO,
        COALESCE(C.NOMBRE, L.CODIGO) AS NOMBRE,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(L.CODIGO)
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.CODIGO, C.NOMBRE
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => new TopClient({
      code: row.CODIGO,
      name: row.NOMBRE,
      ventas: parseFloat(row.VENTAS),
      margen: parseFloat(row.MARGEN),
      pedidos: parseInt(row.PEDIDOS)
    }));
  }

  async getTopProducts(vendedorCodes, year, month, limit = 10) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const monthFilter = month ? `AND MONTH(L.FECHA) = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(limit);

    const sql = `
      SELECT 
        L.CODART AS CODIGO,
        COALESCE(A.DESCART, L.CODART) AS NOMBRE,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.CANTIDAD), 0) AS UNIDADES,
        COALESCE(A.CODFAM, '') AS FAMILIA
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.ART A ON A.CODART = L.CODART
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.CODART, A.DESCART, A.CODFAM
      ORDER BY VENTAS DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map(row => new TopProduct({
      code: row.CODIGO,
      name: row.NOMBRE,
      ventas: parseFloat(row.VENTAS),
      unidades: parseFloat(row.UNIDADES),
      familia: row.FAMILIA
    }));
  }

  async getRecentSales(vendedorCodes, limit = 10) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const sql = `
      SELECT 
        L.FECHA,
        L.CODIGO AS CLIENTE,
        COALESCE(C.NOMBRE, L.CODIGO) AS NOMBRE_CLIENTE,
        L.CODART AS PRODUCTO,
        COALESCE(A.DESCART, L.CODART) AS NOMBRE_PRODUCTO,
        L.IMPORTE AS VENTAS,
        L.CANTIDAD AS CANTIDAD
      FROM JAVIER.LACLAE L
      LEFT JOIN JAVIER.CLI C ON TRIM(C.CODCLI) = TRIM(L.CODIGO)
      LEFT JOIN JAVIER.ART A ON A.CODART = L.CODART
      WHERE ${vendorFilter}
        AND ${dateFilter}
      ORDER BY L.FECHA DESC
      FETCH FIRST ? ROWS ONLY
    `;

    return await this._db.executeParams(sql, [limit]);
  }

  async getYoYComparison(vendedorCodes) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const sql = `
      SELECT 
        YEAR(L.FECHA) AS ANIO,
        MONTH(L.FECHA) AS MES,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN
      FROM JAVIER.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        AND YEAR(L.FECHA) >= YEAR(CURRENT DATE) - 1
      GROUP BY YEAR(L.FECHA), MONTH(L.FECHA)
      ORDER BY ANIO, MES
    `;

    return await this._db.executeParams(sql, []);
  }

  async getHierarchyData(vendedorCodes, year) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND YEAR(L.FECHA) = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        ${vendorCol} AS VENDEDOR,
        COALESCE(SUM(L.IMPORTE), 0) AS VENTAS,
        COALESCE(SUM(L.IMPORTE - L.COSTE), 0) AS MARGEN,
        COUNT(DISTINCT L.NUMDOC) AS PEDIDOS,
        COUNT(DISTINCT L.CODIGO) AS CLIENTES
      FROM JAVIER.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
      GROUP BY ${vendorCol}
      ORDER BY VENTAS DESC
    `;

    return await this._db.executeParams(sql, params);
  }

  async getClientConditions(vendedorCodes) {
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `CLI.CODVEN IN (${sanitizeCodeList(vendedorCodes)})`;

    const sql = `
      SELECT 
        CLI.CODCLI AS CODIGO,
        CLI.NOMCLI AS NOMBRE,
        CLI.DIRCLI AS DIRECCION,
        CLI.POBLAC AS POBLACION,
        CLI.PROVINC,
        CLI.TELCLI AS TELEFONO,
        CLI.EMAIL,
        CLI.CODTAR AS TARIFA,
        CLI.DTOPP AS DTO_PRONTO_PAGO,
        CLI.RIESGO AS LIMITE_RIESGO
      FROM JAVIER.CLI CLI
      WHERE ${vendorFilter}
        AND CLI.ACTIVO = 1
      ORDER BY CLI.NOMCLI
    `;

    return await this._db.executeParams(sql, []);
  }
}

module.exports = { Db2DashboardRepository };
