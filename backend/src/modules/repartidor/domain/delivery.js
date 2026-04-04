/**
 * Delivery Entity - Repartidor Domain
 */
const { Entity } = require('../../../core/domain/entity');

class DeliveryRoute extends Entity {
  constructor({ id, day, clientCode, clientName, address, albaranes, estimatedTime }) {
    super(id);
    this._day = day;
    this._clientCode = clientCode;
    this._clientName = clientName;
    this._address = address;
    this._albaranes = albaranes || [];
    this._estimatedTime = estimatedTime;
  }

  get day() { return this._day; }
  get clientCode() { return this._clientCode; }
  get clientName() { return this._clientName; }
  get address() { return this._address; }
  get albaranes() { return this._albaranes; }
  get estimatedTime() { return this._estimatedTime; }
  get albaranCount() { return this._albaranes.length; }

  static fromDbRow(row) {
    return new DeliveryRoute({
      id: row.ID || `${row.DIA}-${row.CODCLI}`,
      day: row.DIA,
      clientCode: row.CODCLI,
      clientName: row.NOMCLI,
      address: row.DIRCLI,
      albaranes: [],
      estimatedTime: row.TIEMPO_EST
    });
  }
}

class DeliveryItem {
  constructor({ albaran, clientCode, clientName, items, total, status, signature }) {
    this._albaran = albaran;
    this._clientCode = clientCode;
    this._clientName = clientName;
    this._items = items || [];
    this._total = total || 0;
    this._status = status || 'PENDIENTE';
    this._signature = signature;
  }

  get albaran() { return this._albaran; }
  get clientCode() { return this._clientCode; }
  get clientName() { return this._clientName; }
  get items() { return this._items; }
  get total() { return this._total; }
  get status() { return this._status; }
  get signature() { return this._signature; }
  get isDelivered() { return this._status === 'ENTREGADO'; }
}

module.exports = { DeliveryRoute, DeliveryItem };
