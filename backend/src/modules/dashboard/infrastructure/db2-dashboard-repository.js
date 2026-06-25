/**
 * Dashboard Repository Implementation - DB2
 * Uses REAL schema: DSED.LACLAE (sales view), DSEDAC.CLI (clients), DSEDAC.ART (products)
 */
const { DashboardRepository } = require('../domain/dashboard-repository');
const { DashboardMetrics, SalesEvolutionPoint, TopClient, TopProduct } = require('../domain/dashboard-metrics');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { LACLAE_SALES_FILTER, sanitizeCodeList, buildClientListVendorSqlFilter, getVendorColumnExpr } = require('../../../../utils/common');

function clampInt(value, defaultValue, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, min), max);
}

class Db2DashboardRepository extends DashboardRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getMetrics(vendedorCodes, year, month) {
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS,
        COALESCE(SUM(L.LCCTEV), 0) AS CAJAS
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
    `;

    const result = await this._db.executeParams(sql, params);
    return result[0] || { VENTAS: 0, MARGEN: 0, PEDIDOS: 0, CAJAS: 0 };
  }

  async getSalesEvolution(vendedorCodes, year, months = 12) {
    const safeMonths = clampInt(months, 12, 1, 36);
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY ANIO, MES
      FETCH FIRST ${safeMonths} ROWS ONLY
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
    const safeLimit = clampInt(limit, 10, 1, 100);
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(safeLimit);

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
    const safeLimit = clampInt(limit, 10, 1, 100);
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(safeLimit);

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
    const safeLimit = clampInt(limit, 10, 1, 100);
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
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

    return await this._db.executeParams(sql, [safeLimit]);
  }

  async getYoYComparison(vendedorCodes) {
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const sql = `
      SELECT 
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        AND L.LCAADC >= YEAR(CURRENT DATE) - 1
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY ANIO, MES
    `;

    return await this._db.executeParams(sql, []);
  }

  async getHierarchyData(vendedorCodes, year) {
    const vendorExpr = getVendorColumnExpr('L');
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `${vendorExpr} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const params = [];
    if (year) params.push(year);

    const sql = `
      SELECT 
        ${vendorExpr} AS VENDEDOR,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || L.LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTES
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
      GROUP BY ${vendorExpr}
      ORDER BY VENTAS DESC
    `;

    return await this._db.executeParams(sql, params);
  }

  async getClientConditions(vendedorCodes, { limit = 500, offset = 0 } = {}) {
    const safeLimit = clampInt(limit, 500, 1, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const vendorFilter = buildClientListVendorSqlFilter(vendedorCodes, 'CLI');

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
      WHERE (CLI.ANOBAJA IS NULL OR CLI.ANOBAJA = 0)
        ${vendorFilter}
      ORDER BY CLI.NOMBRECLIENTE
      OFFSET ? ROWS FETCH FIRST ? ROWS ONLY
    `;

    return await this._db.executeParams(sql, [safeOffset, safeLimit]);
  }
}

module.exports = { Db2DashboardRepository };
