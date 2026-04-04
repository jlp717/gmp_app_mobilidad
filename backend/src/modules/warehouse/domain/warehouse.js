/**
 * Warehouse Stock Entity - Warehouse Domain
 */
const { Entity } = require('../../../core/domain/entity');

class WarehouseStock extends Entity {
  constructor({ productCode, productName, stock, reserved, available, warehouse, lastUpdated }) {
    super(productCode);
    this._productCode = productCode;
    this._productName = productName;
    this._stock = stock || 0;
    this._reserved = reserved || 0;
    this._available = available !== undefined ? available : stock - reserved;
    this._warehouse = warehouse;
    this._lastUpdated = lastUpdated || new Date();
  }

  get productCode() { return this._productCode; }
  get productName() { return this._productName; }
  get stock() { return this._stock; }
  get reserved() { return this._reserved; }
  get available() { return this._available; }
  get warehouse() { return this._warehouse; }
  get lastUpdated() { return this._lastUpdated; }
  get isLowStock() { return this._available < 10; }
  get isOutOfStock() { return this._available <= 0; }

  static fromDbRow(row) {
    return new WarehouseStock({
      productCode: row.CODART || row.CODIGO,
      productName: row.DESCART || row.NOMBRE,
      stock: parseFloat(row.STOCK || row.STOCKACT || 0),
      reserved: parseFloat(row.RESERVADO || row.RESERV || 0),
      warehouse: row.ALMACEN || row.CODALM,
      lastUpdated: row.FECHA_ACT || row.FECHA
    });
  }
}

class WarehouseMovement {
  constructor({ id, productCode, type, quantity, date, reference, user }) {
    this._id = id;
    this._productCode = productCode;
    this._type = type;
    this._quantity = quantity || 0;
    this._date = date;
    this._reference = reference;
    this._user = user;
  }

  get id() { return this._id; }
  get productCode() { return this._productCode; }
  get type() { return this._type; }
  get quantity() { return this._quantity; }
  get date() { return this._date; }
  get reference() { return this._reference; }
  get user() { return this._user; }
  get isIncoming() { return this._type === 'ENTRADA'; }
  get isOutgoing() { return this._type === 'SALIDA'; }
}

module.exports = { WarehouseStock, WarehouseMovement };
