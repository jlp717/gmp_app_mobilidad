/**
 * Client Entity - Clients Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Client extends Entity {
  constructor({ code, name, address, city, province, phone, email, tarifa, vendedor, activo }) {
    super(code);
    this._code = code;
    this._name = name;
    this._address = address;
    this._city = city;
    this._province = province;
    this._phone = phone;
    this._email = email;
    this._tarifa = tarifa;
    this._vendedor = vendedor;
    this._activo = activo !== false;
  }

  get code() { return this._code; }
  get name() { return this._name; }
  get address() { return this._address; }
  get city() { return this._city; }
  get province() { return this._province; }
  get phone() { return this._phone; }
  get email() { return this._email; }
  get tarifa() { return this._tarifa; }
  get vendedor() { return this._vendedor; }
  get isActive() { return this._activo; }

  static fromDbRow(row) {
    return new Client({
      code: row.CODIGO || row.CODCLI,
      name: row.NOMBRE || row.NOMCLI,
      address: row.DIRECCION || row.DIRCLI,
      city: row.POBLACION || row.POBLAC,
      province: row.PROVINCIA || row.PROVINC,
      phone: row.TELEFONO || row.TELCLI,
      email: row.EMAIL,
      tarifa: row.TARIFA || row.CODTAR,
      vendedor: row.VENDEDOR || row.CODVEN,
      activo: row.ACTIVO !== 0
    });
  }
}

class ClientDetail extends Client {
  constructor(data) {
    super(data);
    this._salesHistory = data.salesHistory || [];
    this._productsPurchased = data.productsPurchased || [];
    this._paymentStatus = data.paymentStatus || {};
    this._totalSales = data.totalSales || 0;
    this._totalMargin = data.totalMargin || 0;
    this._orderCount = data.orderCount || 0;
  }

  get salesHistory() { return this._salesHistory; }
  get productsPurchased() { return this._productsPurchased; }
  get paymentStatus() { return this._paymentStatus; }
  get totalSales() { return this._totalSales; }
  get totalMargin() { return this._totalMargin; }
  get orderCount() { return this._orderCount; }
  get marginPercent() { return this._totalSales > 0 ? (this._totalMargin / this._totalSales) * 100 : 0; }
}

module.exports = { Client, ClientDetail };
