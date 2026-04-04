/**
 * Dashboard Metrics Entity - Dashboard Domain
 */
const { Entity } = require('../../../core/domain/entity');

class DashboardMetrics extends Entity {
  constructor({ id, ventas, margen, pedidos, cajas, year, month, vendedorCodes }) {
    super(id);
    this._ventas = ventas || 0;
    this._margen = margen || 0;
    this._pedidos = pedidos || 0;
    this._cajas = cajas || 0;
    this._year = year;
    this._month = month;
    this._vendedorCodes = vendedorCodes;
  }

  get ventas() { return this._ventas; }
  get margen() { return this._margen; }
  get pedidos() { return this._pedidos; }
  get cajas() { return this._cajas; }
  get year() { return this._year; }
  get month() { return this._month; }
  get vendedorCodes() { return this._vendedorCodes; }
  get margenPercent() { return this._ventas > 0 ? (this._margen / this._ventas) * 100 : 0; }

  static fromDbRow(row) {
    return new DashboardMetrics({
      id: `${row.ANIO}-${row.MES}-${row.VENDEDOR || 'ALL'}`,
      ventas: parseFloat(row.VENTAS || row.IMPORTE || 0),
      margen: parseFloat(row.MARGEN || 0),
      pedidos: parseInt(row.PEDIDOS || row.NUMPEDIDOS || 0),
      cajas: parseFloat(row.CAJAS || row.BULTOS || 0),
      year: parseInt(row.ANIO || row.ANO || row.YEAR),
      month: parseInt(row.MES || row.MONTH),
      vendedorCodes: row.VENDEDOR
    });
  }
}

class SalesEvolutionPoint {
  constructor({ date, ventas, margen, pedidos }) {
    this._date = date;
    this._ventas = ventas || 0;
    this._margen = margen || 0;
    this._pedidos = pedidos || 0;
  }

  get date() { return this._date; }
  get ventas() { return this._ventas; }
  get margen() { return this._margen; }
  get pedidos() { return this._pedidos; }
  get margenPercent() { return this._ventas > 0 ? (this._margen / this._ventas) * 100 : 0; }
}

class TopClient {
  constructor({ code, name, ventas, margen, pedidos }) {
    this._code = code;
    this._name = name;
    this._ventas = ventas || 0;
    this._margen = margen || 0;
    this._pedidos = pedidos || 0;
  }

  get code() { return this._code; }
  get name() { return this._name; }
  get ventas() { return this._ventas; }
  get margen() { return this._margen; }
  get pedidos() { return this._pedidos; }
  get margenPercent() { return this._ventas > 0 ? (this._margen / this._ventas) * 100 : 0; }
}

class TopProduct {
  constructor({ code, name, ventas, unidades, familia }) {
    this._code = code;
    this._name = name;
    this._ventas = ventas || 0;
    this._unidades = unidades || 0;
    this._familia = familia;
  }

  get code() { return this._code; }
  get name() { return this._name; }
  get ventas() { return this._ventas; }
  get unidades() { return this._unidades; }
  get familia() { return this._familia; }
}

module.exports = { DashboardMetrics, SalesEvolutionPoint, TopClient, TopProduct };
