/**
 * Commission Entity - Commissions Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Commission extends Entity {
  constructor({ id, vendedor, clientCode, clientName, document, date, importe, porcentaje, comision }) {
    super(id);
    this._vendedor = vendedor;
    this._clientCode = clientCode;
    this._clientName = clientName;
    this._document = document;
    this._date = date;
    this._importe = importe || 0;
    this._porcentaje = porcentaje || 0;
    this._comision = comision || 0;
  }

  get vendedor() { return this._vendedor; }
  get clientCode() { return this._clientCode; }
  get clientName() { return this._clientName; }
  get document() { return this._document; }
  get date() { return this._date; }
  get importe() { return this._importe; }
  get porcentaje() { return this._porcentaje; }
  get comision() { return this._comision; }

  static fromDbRow(row) {
    return new Commission({
      id: row.ID || `${row.VENDEDOR}-${row.NUMDOC}-${row.FECHA}`,
      vendedor: row.VENDEDOR,
      clientCode: row.CODIGO || row.CODCLI,
      clientName: row.NOMBRE || row.NOMCLI,
      document: row.NUMDOC,
      date: row.FECHA,
      importe: parseFloat(row.IMPORTE || row.IMPTOTAL || 0),
      porcentaje: parseFloat(row.PORCENTAJE || row.PORC_COM || 0),
      comision: parseFloat(row.COMISION || row.IMP_COM || 0)
    });
  }
}

module.exports = { Commission };
