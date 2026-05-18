/**
 * Entrega/Albaran Entity - Entregas Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Albaran extends Entity {
  constructor({ id, number, clientCode, clientName, date, total, status, items, observations }) {
    super(id);
    this._number = number;
    this._clientCode = clientCode;
    this._clientName = clientName;
    this._date = date || new Date();
    this._total = total || 0;
    this._status = status || 'PENDIENTE';
    this._items = items || [];
    this._observations = observations;
    this._deliveryData = null;
  }

  get number() { return this._number; }
  get clientCode() { return this._clientCode; }
  get clientName() { return this._clientName; }
  get date() { return this._date; }
  get total() { return this._total; }
  get status() { return this._status; }
  get items() { return [...this._items]; }
  get observations() { return this._observations; }
  get deliveryData() { return this._deliveryData; }

  get isDelivered() { return this._status === 'ENTREGADO'; }
  get isPending() { return this._status === 'PENDIENTE'; }
  get isPartial() { return this._status === 'ENTREGA_PARCIAL'; }

  markDelivered({ observations, signaturePath, latitude, longitude, repartidorId }) {
    if (this.isDelivered) throw new Error('Albaran already delivered');

    this._status = 'ENTREGADO';
    this._observations = observations || this._observations;
    this._deliveryData = {
      signaturePath,
      latitude,
      longitude,
      repartidorId,
      deliveredAt: new Date()
    };

    this.addDomainEvent({
      type: 'ALBARAN_DELIVERED',
      albaranId: this._id,
      number: this._number
    });
  }

  markPartialDelivery({ observations, deliveredItems }) {
    this._status = 'ENTREGA_PARCIAL';
    this._observations = observations || this._observations;

    this.addDomainEvent({
      type: 'ALBARAN_PARTIAL_DELIVERY',
      albaranId: this._id,
      number: this._number,
      deliveredItems
    });
  }

  static fromDbRow(row) {
    return new Albaran({
      id: row.ID || row.NUMALB,
      number: row.NUMERO || row.NUMALB,
      clientCode: row.CODIGOCLIENTE || row.CLIENTE,
      clientName: row.NOMBRECLIENTE || row.NOMBRE,
      date: row.FECHA ? new Date(row.FECHA) : new Date(),
      total: parseFloat(row.TOTAL || row.IMPORTE || 0),
      status: row.ESTADO || 'PENDIENTE',
      observations: row.OBSERVACIONES
    });
  }
}

module.exports = { Albaran };
