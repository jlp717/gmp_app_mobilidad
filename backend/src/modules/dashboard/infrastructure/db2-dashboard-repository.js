/**
 * Dashboard Repository Implementation - DB2
 * Uses REAL schema: DSED.LACLAE (sales view), DSEDAC.CLI (clients), DSEDAC.ART (products)
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
    const vendorCol = VENDOR_COLUMN; // R1_T8CDVD or LCCDVD depending on date
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const yearFilter = year ? `AND LCMMDC = ?` : '';
    const monthFilter = month ? `AND LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT LCSRAB || LCNRAB) AS PEDIDOS,
        COALESCE(SUM(LCCTEV), 0) AS CAJAS
      FROM DSED.LACLAE
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
    const yearFilter = year ? `AND LCAADC = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        LCAADC AS ANIO,
        LCMMDC AS MES,
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT LCSRAB || LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
      GROUP BY LCAADC, LCMMDC
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
    const yearFilter = year ? `AND LCAADC = ?` : '';
    const monthFilter = month ? `AND LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(limit);

    const sql = `
      SELECT 
        L.LCCDCL AS CODIGO,
        COALESCE(CLI.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDCL, CLI.NOMBRECLIENTE
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
    const yearFilter = year ? `AND LCAADC = ?` : '';
    const monthFilter = month ? `AND LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(limit);

    const sql = `
      SELECT 
        L.LCCDRF AS CODIGO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
        COALESCE(ART.CODIGOFAMILIA, '') AS FAMILIA
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDRF, ART.DESCRIPCIONARTICULO, ART.CODIGOFAMILIA
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
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        L.LCDDDC AS DIA,
        L.LCCDCL AS CLIENTE,
        COALESCE(CLI.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE_CLIENTE,
        L.LCCDRF AS PRODUCTO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE_PRODUCTO,
        L.LCIMVT AS VENTAS,
        L.LCCTUD AS CANTIDAD
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      LEFT JOIN DSEDAC.ART ART ON TRIM(ART.CODIGOARTICULO) = TRIM(L.LCCDRF)
      WHERE ${vendorFilter}
        AND ${dateFilter}
      ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
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
        LCAADC AS ANIO,
        LCMMDC AS MES,
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN
      FROM DSED.LACLAE
      WHERE ${vendorFilter}
        AND ${dateFilter}
        AND LCAADC >= YEAR(CURRENT DATE) - 1
      GROUP BY LCAADC, LCMMDC
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
    const yearFilter = year ? `AND LCAADC = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        ${vendorCol} AS VENDEDOR,
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT LCSRAB || LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT LCCDCL) AS CLIENTES
      FROM DSED.LACLAE
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
      : `CLI.CODIGOVENDEDOR IN (${sanitizeCodeList(vendedorCodes)})`;

    const sql = `
      SELECT 
        CLI.CODIGOCLIENTE AS CODIGO,
        CLI.NOMBRECLIENTE AS NOMBRE,
        CLI.DIRECCION,
        CLI.POBLACION,
        CLI.PROVINCIA,
        CLI.TELEFONO1 AS TELEFONO,
        CLI.EMAIL,
        CLI.CODCLI AS TARIFA
      FROM DSEDAC.CLI CLI
      WHERE ${vendorFilter}
        AND (CLI.ANOBAJA IS NULL OR CLI.ANOBAJA = 0)
      ORDER BY CLI.NOMBRECLIENTE
    `;

    return await this._db.executeParams(sql, []);
  }
}

module.exports = { Db2DashboardRepository };
