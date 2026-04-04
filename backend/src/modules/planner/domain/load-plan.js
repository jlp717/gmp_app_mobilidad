/**
 * LoadPlan Entity - Planner Domain
 */
const { Entity } = require('../../../core/domain/entity');

class LoadPlan extends Entity {
  constructor({ id, vehicle, date, vendor, orders, weight, volume, status, notes }) {
    super(id);
    this._vehicle = vehicle;
    this._date = date;
    this._vendor = vendor;
    this._orders = orders || [];
    this._weight = weight || 0;
    this._volume = volume || 0;
    this._status = status || 'PENDING';
    this._notes = notes || '';
  }

  get vehicle() { return this._vehicle; }
  get date() { return this._date; }
  get vendor() { return this._vendor; }
  get orders() { return this._orders; }
  get weight() { return this._weight; }
  get volume() { return this._volume; }
  get status() { return this._status; }
  get notes() { return this._notes; }

  addOrder(order) {
    this._orders.push(order);
  }

  removeOrder(orderId) {
    this._orders = this._orders.filter(o => o.id !== orderId);
  }

  updateStatus(status) {
    this._status = status;
  }

  static fromDbRow(row) {
    return new LoadPlan({
      id: row.ID || row.ACM_ID,
      vehicle: row.VEHICULO || row.ACM_VEHICULO,
      date: row.FECHA || row.ACM_FECHA,
      vendor: row.VENDEDOR || row.ACM_VENDEDOR,
      orders: row.ORDENES ? JSON.parse(row.ORDENES) : [],
      weight: parseFloat(row.PESO || row.ACM_PESO || 0),
      volume: parseFloat(row.VOLUMEN || row.ACM_VOLUMEN || 0),
      status: row.ESTADO || row.ACM_ESTADO || 'PENDING',
      notes: row.NOTAS || row.ACM_NOTAS || ''
    });
  }
}

module.exports = { LoadPlan };
