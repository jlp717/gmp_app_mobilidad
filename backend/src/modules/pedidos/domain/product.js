/**
 * Product Entity - Pedidos Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Product extends Entity {
  constructor({ code, name, price, stock, unit, tarifa, imagen }) {
    super(code);
    this._name = name;
    this._price = price || 0;
    this._stock = stock || 0;
    this._unit = unit || 'UD';
    this._tarifa = tarifa;
    this._imagen = imagen;
  }

  get name() { return this._name; }
  get price() { return this._price; }
  get stock() { return this._stock; }
  get unit() { return this._unit; }
  get tarifa() { return this._tarifa; }
  get imagen() { return this._imagen; }

  get isAvailable() { return this._stock > 0; }

  static fromDbRow(row) {
    return new Product({
      code: row.CODIGO || row.CODART,
      name: row.NOMBRE || row.DESCART,
      price: parseFloat(row.PRECIO || row.PVP || 0),
      stock: parseFloat(row.STOCK || row.STOCKACT || 0),
      unit: row.UNIDAD || row.UMEDIDA || 'UD',
      tarifa: row.CODIGOTARIFA || row.TARIFA,
      imagen: row.IMAGEN || row.FOTO
    });
  }
}

class OrderLine {
  constructor({ productCode, productName, quantity, unitPrice, unit, gift = false }) {
    this._productCode = productCode;
    this._productName = productName;
    this._quantity = quantity;
    this._unitPrice = unitPrice;
    this._unit = unit || 'UD';
    this._gift = gift;
  }

  get productCode() { return this._productCode; }
  get productName() { return this._productName; }
  get quantity() { return this._quantity; }
  get unitPrice() { return this._unitPrice; }
  get unit() { return this._unit; }
  get isGift() { return this._gift; }

  get total() { return this._gift ? 0 : this._quantity * this._unitPrice; }

  setQuantity(qty) {
    if (qty <= 0) throw new Error('Quantity must be positive');
    this._quantity = qty;
  }
}

class Cart {
  constructor(clientCode) {
    this._clientCode = clientCode;
    this._lines = new Map();
    this._promotions = [];
  }

  get clientCode() { return this._clientCode; }
  get lines() { return Array.from(this._lines.values()); }
  get promotions() { return [...this._promotions]; }
  get lineCount() { return this._lines.size; }

  get total() {
    return this.lines.reduce((sum, line) => sum + line.total, 0);
  }

  addLine(line) {
    const existing = this._lines.get(line.productCode);
    if (existing) {
      existing.setQuantity(existing.quantity + line.quantity);
    } else {
      this._lines.set(line.productCode, line);
    }
  }

  removeLine(productCode) {
    this._lines.delete(productCode);
  }

  clear() {
    this._lines.clear();
    this._promotions = [];
  }

  addPromotion(promo) {
    this._promotions.push(promo);
  }

  isEmpty() {
    return this._lines.size === 0;
  }
}

module.exports = { Product, OrderLine, Cart };
