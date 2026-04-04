/**
 * Factura Entity - Facturas Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Factura extends Entity {
  constructor({ id, serie, numero, ejercicio, clienteId, clienteNombre, fecha, total, base, iva, estado }) {
    super(id);
    this._serie = serie;
    this._numero = numero;
    this._ejercicio = ejercicio;
    this._clienteId = clienteId;
    this._clienteNombre = clienteNombre;
    this._fecha = fecha;
    this._total = total || 0;
    this._base = base || 0;
    this._iva = iva || 0;
    this._estado = estado || 'emitida';
  }

  get serie() { return this._serie; }
  get numero() { return this._numero; }
  get ejercicio() { return this._ejercicio; }
  get clienteId() { return this._clienteId; }
  get clienteNombre() { return this._clienteNombre; }
  get fecha() { return this._fecha; }
  get total() { return this._total; }
  get base() { return this._base; }
  get iva() { return this._iva; }
  get estado() { return this._estado; }

  static fromDbRow(row) {
    const sanitize = (v) => {
      const n = parseFloat(v) || 0;
      if (Object.is(n, -0)) return 0;
      if (Math.abs(n) >= 900000) return 0;
      return n;
    };

    return new Factura({
      id: `${row.SERIE}-${row.NUMERO}-${row.EJERCICIO}`,
      serie: row.SERIE,
      numero: row.NUMERO,
      ejercicio: row.EJERCICIO,
      clienteId: row.CLIENTE_ID,
      clienteNombre: row.CLIENTE_NOMBRE || `Cliente ${row.CLIENTE_ID}`,
      fecha: row.FECHA,
      total: sanitize(row.TOTAL),
      base: sanitize(row.BASE),
      iva: sanitize(row.IVA),
      estado: row.ESTADO || 'emitida'
    });
  }
}

module.exports = { Factura };
