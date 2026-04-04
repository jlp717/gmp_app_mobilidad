/**
 * Analytics Metrics Entity - Analytics Domain
 */
const { Entity } = require('../../../core/domain/entity');

class AnalyticsMetrics extends Entity {
  constructor({ id, ventas, margen, pedidos, cajas, clientes, productos, year, month, vendedorCodes }) {
    super(id);
    this._ventas = ventas || 0;
    this._margen = margen || 0;
    this._pedidos = pedidos || 0;
    this._cajas = cajas || 0;
    this._clientes = clientes || 0;
    this._productos = productos || 0;
    this._year = year;
    this._month = month;
    this._vendedorCodes = vendedorCodes;
  }

  get ventas() { return this._ventas; }
  get margen() { return this._margen; }
  get pedidos() { return this._pedidos; }
  get cajas() { return this._cajas; }
  get clientes() { return this._clientes; }
  get productos() { return this._productos; }
  get year() { return this._year; }
  get month() { return this._month; }
  get vendedorCodes() { return this._vendedorCodes; }
  get margenPercent() { return this._ventas > 0 ? (this._margen / this._ventas) * 100 : 0; }
  get ticketMedio() { return this._pedidos > 0 ? this._ventas / this._pedidos : 0; }

  static fromDbRow(row) {
    return new AnalyticsMetrics({
      id: `${row.ANIO}-${row.MES}-${row.VENDEDOR || 'ALL'}`,
      ventas: parseFloat(row.VENTAS || row.IMPORTE || 0),
      margen: parseFloat(row.MARGEN || 0),
      pedidos: parseInt(row.PEDIDOS || row.NUMPEDIDOS || 0),
      cajas: parseFloat(row.CAJAS || row.BULTOS || 0),
      clientes: parseInt(row.CLIENTES || row.NUMPEDIDOS || 0),
      productos: parseInt(row.PRODUCTOS || 0),
      year: parseInt(row.ANIO || row.ANO || row.YEAR),
      month: parseInt(row.MES || row.MONTH),
      vendedorCodes: row.VENDEDOR
    });
  }
}

class GrowthRate {
  constructor({ metric, currentPeriod, previousPeriod, rate, trend }) {
    this._metric = metric;
    this._currentPeriod = currentPeriod || 0;
    this._previousPeriod = previousPeriod || 0;
    this._rate = rate || 0;
    this._trend = trend || 'stable';
  }

  get metric() { return this._metric; }
  get currentPeriod() { return this._currentPeriod; }
  get previousPeriod() { return this._previousPeriod; }
  get rate() { return this._rate; }
  get trend() { return this._trend; }
  get isPositive() { return this._rate > 0; }

  static calculate(current, previous, metric) {
    const rate = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : 0;
    const trend = rate > 5 ? 'up' : rate < -5 ? 'down' : 'stable';
    return new GrowthRate({ metric, currentPeriod: current, previousPeriod: previous, rate, trend });
  }
}

class Prediction {
  constructor({ metric, predictedValue, confidence, lowerBound, upperBound, method }) {
    this._metric = metric;
    this._predictedValue = predictedValue || 0;
    this._confidence = confidence || 0;
    this._lowerBound = lowerBound || 0;
    this._upperBound = upperBound || 0;
    this._method = method || 'linear_regression';
  }

  get metric() { return this._metric; }
  get predictedValue() { return this._predictedValue; }
  get confidence() { return this._confidence; }
  get lowerBound() { return this._lowerBound; }
  get upperBound() { return this._upperBound; }
  get method() { return this._method; }
  get range() { return this._upperBound - this._lowerBound; }
}

class TopPerformer {
  constructor({ rank, code, name, value, metric, growth }) {
    this._rank = rank;
    this._code = code;
    this._name = name;
    this._value = value || 0;
    this._metric = metric;
    this._growth = growth || 0;
  }

  get rank() { return this._rank; }
  get code() { return this._code; }
  get name() { return this._name; }
  get value() { return this._value; }
  get metric() { return this._metric; }
  get growth() { return this._growth; }
}

module.exports = { AnalyticsMetrics, GrowthRate, Prediction, TopPerformer };
