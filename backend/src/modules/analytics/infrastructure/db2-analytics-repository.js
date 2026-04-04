/**
 * Analytics Repository Implementation - DB2
 * Growth rates, predictions, top performers, concentration analysis
 */
const { AnalyticsRepository } = require('../domain/analytics-repository');
const { AnalyticsMetrics, GrowthRate, Prediction, TopPerformer } = require('../domain/analytics-metrics');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { VENDOR_COLUMN, LACLAE_SALES_FILTER, sanitizeCodeList } = require('../../../../utils/common');

class Db2AnalyticsRepository extends AnalyticsRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async getPeriodMetrics(vendedorCodes, year, month) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
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
        COUNT(DISTINCT L.LCSRAB || '-' || L.LCNRAB) AS PEDIDOS,
        COALESCE(SUM(L.LCCTEV), 0) AS CAJAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTES,
        COUNT(DISTINCT L.LCCDRF) AS PRODUCTOS,
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCAADC, L.LCMMDC
    `;

    const result = await this._db.executeParams(sql, params);
    return result[0] || { VENTAS: 0, MARGEN: 0, PEDIDOS: 0, CAJAS: 0, CLIENTES: 0, PRODUCTOS: 0 };
  }

  async getMonthlyEvolution(vendedorCodes, year, months = 12) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
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
        COUNT(DISTINCT L.LCSRAB || '-' || L.LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTES
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY ANIO, MES
      FETCH FIRST ${months} ROWS ONLY
    `;

    return await this._db.executeParams(sql, params);
  }

  async getGrowthRates(vendedorCodes, year, month) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const params = [];
    let yearParam = year;
    let monthParam = month;

    if (!yearParam || !monthParam) {
      const nowSql = `SELECT YEAR(CURRENT DATE) AS ANIO, MONTH(CURRENT DATE) AS MES FROM SYSIBM.SYSDUMMY1`;
      const nowResult = await this._db.executeParams(nowSql, []);
      yearParam = nowResult[0].ANIO;
      monthParam = nowResult[0].MES;
    }

    const prevMonth = monthParam === 1 ? 12 : monthParam - 1;
    const prevYear = monthParam === 1 ? yearParam - 1 : yearParam;

    const sql = `
      SELECT 
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || '-' || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        AND ((L.LCAADC = ? AND L.LCMMDC = ?)
          OR (L.LCAADC = ? AND L.LCMMDC = ?))
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY ANIO, MES
    `;

    params.push(yearParam, monthParam, prevYear, prevMonth);

    const result = await this._db.executeParams(sql, params);

    const current = result.find(r => r.ANIO === yearParam && r.MES === monthParam) || {};
    const previous = result.find(r => r.ANIO === prevYear && r.MES === prevMonth) || {};

    return {
      ventas: GrowthRate.calculate(
        parseFloat(current.VENTAS || 0),
        parseFloat(previous.VENTAS || 0),
        'ventas'
      ),
      margen: GrowthRate.calculate(
        parseFloat(current.MARGEN || 0),
        parseFloat(previous.MARGEN || 0),
        'margen'
      ),
      pedidos: GrowthRate.calculate(
        parseInt(current.PEDIDOS || 0),
        parseInt(previous.PEDIDOS || 0),
        'pedidos'
      )
    };
  }

  async getTopClientsByMetric(vendedorCodes, year, month, metric = 'ventas', limit = 10) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(limit);

    const orderBy = metric === 'margen' ? 'MARGEN' : metric === 'pedidos' ? 'PEDIDOS' : 'VENTAS';

    const sql = `
      SELECT 
        L.LCCDCL AS CODIGO,
        COALESCE(C.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || '-' || L.LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI C ON TRIM(C.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDCL, C.NOMBRECLIENTE
      ORDER BY ${orderBy} DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map((row, idx) => new TopPerformer({
      rank: idx + 1,
      code: row.CODIGO,
      name: row.NOMBRE,
      value: parseFloat(row[orderBy] || 0),
      metric,
      growth: 0
    }));
  }

  async getTopProductsByMetric(vendedorCodes, year, month, metric = 'ventas', limit = 10) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    params.push(limit);

    const orderBy = metric === 'unidades' ? 'UNIDADES' : 'VENTAS';

    const sql = `
      SELECT 
        L.LCCDRF AS CODIGO,
        COALESCE(ART.DESCRIPCIONARTICULO, L.LCCDRF) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
        COALESCE(ART.CODIGOFAMILIA, '') AS FAMILIA
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON ART.CODIGOARTICULO = L.LCCDRF
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDRF, ART.DESCRIPCIONARTICULO, ART.CODIGOFAMILIA
      ORDER BY ${orderBy} DESC
      FETCH FIRST ? ROWS ONLY
    `;

    const result = await this._db.executeParams(sql, params);
    return (result || []).map((row, idx) => new TopPerformer({
      rank: idx + 1,
      code: row.CODIGO,
      name: row.NOMBRE,
      value: parseFloat(row[orderBy] || 0),
      metric,
      growth: 0
    }));
  }

  async getHistoricalData(vendedorCodes, years = 2) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const sql = `
      SELECT 
        L.LCAADC AS ANIO,
        L.LCMMDC AS MES,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCSRAB || '-' || L.LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT L.LCCDCL) AS CLIENTES
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        AND L.LCAADC >= YEAR(CURRENT DATE) - ?
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY ANIO, MES
    `;

    return await this._db.executeParams(sql, [years]);
  }

  async getClientConcentration(vendedorCodes, year, month) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        L.LCCDCL AS CODIGO,
        COALESCE(C.NOMBRECLIENTE, L.LCCDCL) AS NOMBRE,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI C ON TRIM(C.CODIGOCLIENTE) = TRIM(L.LCCDCL)
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY L.LCCDCL, C.NOMBRECLIENTE
      ORDER BY VENTAS DESC
    `;

    const result = await this._db.executeParams(sql, params);
    const totalVentas = result.reduce((sum, r) => sum + parseFloat(r.VENTAS || 0), 0);

    let cumulative = 0;
    const clients = result.map((row, idx) => {
      const ventas = parseFloat(row.VENTAS || 0);
      const share = totalVentas > 0 ? (ventas / totalVentas) * 100 : 0;
      cumulative += share;
      return {
        rank: idx + 1,
        code: row.CODIGO,
        name: row.NOMBRE,
        ventas,
        share,
        cumulativeShare: cumulative
      };
    });

    const top10Share = clients.slice(0, 10).reduce((sum, c) => sum + c.share, 0);
    const top20Share = clients.slice(0, 20).reduce((sum, c) => sum + c.share, 0);
    const hhi = clients.reduce((sum, c) => sum + Math.pow(c.share / 100, 2), 0) * 10000;

    return {
      totalClients: clients.length,
      totalVentas,
      top10Share,
      top20Share,
      hhi,
      clients: clients.slice(0, 50)
    };
  }

  async getProductFamilyBreakdown(vendedorCodes, year, month) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendedorCodes === 'ALL'
      ? '1=1'
      : `L.${vendorCol} IN (${sanitizeCodeList(vendedorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;
    const yearFilter = year ? `AND L.LCAADC = ?` : '';
    const monthFilter = month ? `AND L.LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    const sql = `
      SELECT 
        COALESCE(ART.CODIGOFAMILIA, 'SIN_FAMILIA') AS FAMILIA,
        COALESCE(ART.CODIGOFAMILIA, 'Sin Familia') AS NOMBRE_FAMILIA,
        COALESCE(SUM(L.LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(L.LCIMVT - L.LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT L.LCCDRF) AS PRODUCTOS,
        COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.ART ART ON ART.CODIGOARTICULO = L.LCCDRF
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY ART.CODIGOFAMILIA
      ORDER BY VENTAS DESC
    `;

    const result = await this._db.executeParams(sql, params);
    const totalVentas = result.reduce((sum, r) => sum + parseFloat(r.VENTAS || 0), 0);

    return (result || []).map(row => ({
      familia: row.FAMILIA,
      nombre: row.NOMBRE_FAMILIA,
      ventas: parseFloat(row.VENTAS || 0),
      margen: parseFloat(row.MARGEN || 0),
      productos: parseInt(row.PRODUCTOS || 0),
      unidades: parseFloat(row.UNIDADES || 0),
      share: totalVentas > 0 ? (parseFloat(row.VENTAS || 0) / totalVentas) * 100 : 0,
      margenPercent: row.VENTAS > 0 ? (parseFloat(row.MARGEN || 0) / parseFloat(row.VENTAS || 0)) * 100 : 0
    }));
  }

  _linearRegression(dataPoints) {
    const n = dataPoints.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (const point of dataPoints) {
      sumX += point.x;
      sumY += point.y;
      sumXY += point.x * point.y;
      sumX2 += point.x * point.x;
      sumY2 += point.y * point.y;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    const meanY = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (const point of dataPoints) {
      const predicted = slope * point.x + intercept;
      ssTot += Math.pow(point.y - meanY, 2);
      ssRes += Math.pow(point.y - predicted, 2);
    }

    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    return { slope, intercept, r2: Math.max(0, r2) };
  }

  _calculatePrediction(regression, nextX) {
    const predicted = regression.slope * nextX + regression.intercept;
    const stdError = Math.sqrt(Math.max(0, 1 - regression.r2)) * Math.abs(predicted || 1);
    const confidence = Math.min(0.95, regression.r2);

    return new Prediction({
      metric: 'ventas',
      predictedValue: Math.max(0, predicted),
      confidence,
      lowerBound: Math.max(0, predicted - stdError * 1.96),
      upperBound: predicted + stdError * 1.96,
      method: 'linear_regression'
    });
  }

  async getForecast(vendedorCodes, months = 3) {
    const historical = await this.getHistoricalData(vendedorCodes, 2);

    const dataPoints = (historical || []).map((row, idx) => ({
      x: idx,
      y: parseFloat(row.VENTAS || 0)
    }));

    if (dataPoints.length < 2) {
      return {
        predictions: [],
        regression: { slope: 0, intercept: 0, r2: 0 },
        dataPoints: dataPoints.length
      };
    }

    const regression = this._linearRegression(dataPoints);
    const lastX = dataPoints[dataPoints.length - 1].x;

    const predictions = [];
    for (let i = 1; i <= months; i++) {
      const nextX = lastX + i;
      const pred = this._calculatePrediction(regression, nextX);
      predictions.push(pred);
    }

    return {
      predictions,
      regression,
      dataPoints: dataPoints.length,
      historical: dataPoints.map((p, idx) => ({
        month: idx + 1,
        value: p.y
      }))
    };
  }
}

module.exports = { Db2AnalyticsRepository };
