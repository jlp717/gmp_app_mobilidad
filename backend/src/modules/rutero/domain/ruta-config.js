/**
 * Ruta/Cliente Entity - Rutero Domain
 */
const { Entity } = require('../../../core/domain/entity');

class RutaConfig extends Entity {
  constructor({ id, clientCode, clientName, order, dayOfWeek, vendorCode, estimatedTime }) {
    super(id);
    this._clientCode = clientCode;
    this._clientName = clientName;
    this._order = order || 0;
    this._dayOfWeek = dayOfWeek;
    this._vendorCode = vendorCode;
    this._estimatedTime = estimatedTime;
  }

  get clientCode() { return this._clientCode; }
  get clientName() { return this._clientName; }
  get order() { return this._order; }
  get dayOfWeek() { return this._dayOfWeek; }
  get vendorCode() { return this._vendorCode; }
  get estimatedTime() { return this._estimatedTime; }

  setOrder(newOrder) {
    if (newOrder < 0) throw new Error('Order must be >= 0');
    this._order = newOrder;
    this.addDomainEvent({ type: 'RUTA_ORDER_CHANGED', configId: this._id, newOrder });
  }

  static fromDbRow(row) {
    return new RutaConfig({
      id: row.ID,
      clientCode: row.CODIGOCLIENTE || row.CLIENTE,
      clientName: row.NOMBRECLIENTE || row.NOMBRE,
      order: parseInt(row.ORDEN || row.ORDEN_VISITA || 0),
      dayOfWeek: row.DIA_SEMANA || row.DIA,
      vendorCode: row.VENDEDOR || row.CODVENDEDOR,
      estimatedTime: row.TIEMPO_ESTIMADO ? parseInt(row.TIEMPO_ESTIMADO) : null
    });
  }
}

module.exports = { RutaConfig };
