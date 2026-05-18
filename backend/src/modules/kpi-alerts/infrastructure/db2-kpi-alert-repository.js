/**
 * KPI Alerts Repository Implementation - DB2
 * READ-ONLY: DSED.LACLAE for KPI data
 * READ/WRITE: JAVIER tables for alert storage
 */
const { KpiAlertRepository } = require('../domain/kpi-alert-repository');
const { KpiAlert } = require('../domain/kpi-alert');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { VENDOR_COLUMN, LACLAE_SALES_FILTER, sanitizeCodeList } = require('../../../../utils/common');

class Db2KpiAlertRepository extends KpiAlertRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async checkAlerts(vendorCodes, year, month) {
    const kpiData = await this.getKpiData(vendorCodes, year, month);
    const alerts = [];

    const rules = [
      { type: 'SALES_DROP', threshold: -10, check: (data) => data.salesDeviation < -10 },
      { type: 'MARGIN_DROP', threshold: -5, check: (data) => data.marginDeviation < -5 },
      { type: 'ORDER_DROP', threshold: -15, check: (data) => data.orderDeviation < -15 },
      { type: 'LOW_MARGIN', threshold: 15, check: (data) => data.marginPercent < 15 },
      { type: 'HIGH_CLIENT_CONCENTRATION', threshold: 30, check: (data) => data.topClientShare > 30 }
    ];

    for (const rule of rules) {
      if (rule.check(kpiData)) {
        const alert = {
          type: rule.type,
          threshold: rule.threshold,
          current: this._getCurrentValue(rule.type, kpiData),
          triggered: true,
          message: this._buildMessage(rule.type, kpiData)
        };
        await this.createAlert(alert);
        alerts.push(alert);
      }
    }

    return alerts;
  }

  async createAlert(alert) {
    const sql = `
      INSERT INTO JAVIER.KPI_ALERTS 
        (TIPO, UMBRAL, ACTUAL, ACTIVADA, MENSAJE, FECHA_CREACION)
      VALUES (?, ?, ?, 1, ?, CURRENT TIMESTAMP)
    `;
    await this._db.executeParams(sql, [
      alert.type, alert.threshold, alert.current, alert.message || ''
    ]);
    return { success: true };
  }

  async getActiveAlerts(vendorCodes) {
    const sql = `
      SELECT ID, TIPO, UMBRAL, ACTUAL, ACTIVADA, MENSAJE, FECHA_CREACION
      FROM JAVIER.KPI_ALERTS
      WHERE ACTIVADA = 1
      ORDER BY FECHA_CREACION DESC
      FETCH FIRST 50 ROWS ONLY
    `;
    const result = await this._db.executeParams(sql, []);
    return (result || []).map(row => KpiAlert.fromDbRow(row));
  }

  async getKpiData(vendorCodes, year, month) {
    const vendorCol = VENDOR_COLUMN;
    const vendorFilter = vendorCodes === 'ALL'
      ? '1=1'
      : `${vendorCol} IN (${sanitizeCodeList(vendorCodes)})`;
    const dateFilter = LACLAE_SALES_FILTER;

    const yearFilter = year ? `AND LCAADC = ?` : '';
    const monthFilter = month ? `AND LCMMDC = ?` : '';
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);

    // Current period
    const currentSql = `
      SELECT 
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT LCSRAB || LCNRAB) AS PEDIDOS,
        COUNT(DISTINCT LCCDCL) AS CLIENTES
      FROM DSED.LACLAE
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
    `;

    // Previous period comparison
    const prevParams = [...params];
    const prevYear = year ? year - 1 : null;
    const prevMonthFilter = month ? `AND LCMMDC = ?` : '';
    if (prevYear) prevParams.push(prevYear);
    if (month) prevParams.push(month);

    const prevYearFilter = prevYear ? `AND LCAADC = ?` : '';
    const previousSql = `
      SELECT 
        COALESCE(SUM(LCIMVT), 0) AS VENTAS,
        COALESCE(SUM(LCIMVT - LCIMCT), 0) AS MARGEN,
        COUNT(DISTINCT LCSRAB || LCNRAB) AS PEDIDOS
      FROM DSED.LACLAE
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${prevYearFilter}
        ${prevMonthFilter}
    `;

    // Top client share
    const topClientSql = `
      SELECT 
        COALESCE(SUM(LCIMVT), 0) AS TOTAL,
        (SELECT COALESCE(SUM(LCIMVT), 0) FROM DSED.LACLAE L2 
         WHERE ${vendorFilter} AND ${dateFilter} ${yearFilter} ${monthFilter}) AS TOTAL_ALL
      FROM DSED.LACLAE L
      WHERE ${vendorFilter}
        AND ${dateFilter}
        ${yearFilter}
        ${monthFilter}
      GROUP BY LCCDCL
      ORDER BY TOTAL DESC
      FETCH FIRST 1 ROWS ONLY
    `;

    const [current, previous, topClient] = await Promise.all([
      this._db.executeParams(currentSql, params),
      this._db.executeParams(previousSql, prevParams),
      this._db.executeParams(topClientSql, params)
    ]);

    const curr = current ? current[0] : { VENTAS: 0, MARGEN: 0, PEDIDOS: 0, CLIENTES: 0 };
    const prev = previous ? previous[0] : { VENTAS: 0, MARGEN: 0, PEDIDOS: 0 };
    const top = topClient && topClient.length > 0 ? topClient[0] : { TOTAL: 0, TOTAL_ALL: 1 };

    const sales = parseFloat(curr.VENTAS);
    const margin = parseFloat(curr.MARGEN);
    const orders = parseFloat(curr.PEDIDOS);
    const prevSales = parseFloat(prev.VENTAS);
    const prevMargin = parseFloat(prev.MARGEN);
    const prevOrders = parseFloat(prev.PEDIDOS);

    return {
      sales,
      margin,
      orders,
      clients: parseFloat(curr.CLIENTES),
      marginPercent: sales > 0 ? (margin / sales) * 100 : 0,
      salesDeviation: prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : 0,
      marginDeviation: prevMargin > 0 ? ((margin - prevMargin) / prevMargin) * 100 : 0,
      orderDeviation: prevOrders > 0 ? ((orders - prevOrders) / prevOrders) * 100 : 0,
      topClientShare: top.TOTAL_ALL > 0 ? (top.TOTAL / top.TOTAL_ALL) * 100 : 0
    };
  }

  _getCurrentValue(type, data) {
    switch (type) {
      case 'SALES_DROP': return data.salesDeviation;
      case 'MARGIN_DROP': return data.marginDeviation;
      case 'ORDER_DROP': return data.orderDeviation;
      case 'LOW_MARGIN': return data.marginPercent;
      case 'HIGH_CLIENT_CONCENTRATION': return data.topClientShare;
      default: return 0;
    }
  }

  _buildMessage(type, data) {
    switch (type) {
      case 'SALES_DROP':
        return `Ventas caídas ${Math.abs(data.salesDeviation).toFixed(1)}% vs período anterior`;
      case 'MARGIN_DROP':
        return `Margen caído ${Math.abs(data.marginDeviation).toFixed(1)}% vs período anterior`;
      case 'ORDER_DROP':
        return `Pedidos caídos ${Math.abs(data.orderDeviation).toFixed(1)}% vs período anterior`;
      case 'LOW_MARGIN':
        return `Margen actual ${data.marginPercent.toFixed(1)}% por debajo del umbral`;
      case 'HIGH_CLIENT_CONCENTRATION':
        return `Cliente principal representa ${data.topClientShare.toFixed(1)}% de las ventas`;
      default:
        return `Alerta KPI: ${type}`;
    }
  }
}

module.exports = { Db2KpiAlertRepository };
