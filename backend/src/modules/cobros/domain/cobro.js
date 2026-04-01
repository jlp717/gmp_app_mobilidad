/**
 * Cobro Entity - Cobros Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Cobro extends Entity {
  constructor({ id, clientCode, clientName, amount, paidAmount, paymentMethod, date, reference, status }) {
    super(id);
    this._clientCode = clientCode;
    this._clientName = clientName;
    this._amount = amount || 0;
    this._paidAmount = paidAmount || 0;
    this._paymentMethod = paymentMethod;
    this._date = date || new Date();
    this._reference = reference;
    this._status = status || 'PENDIENTE';
  }

  get clientCode() { return this._clientCode; }
  get clientName() { return this._clientName; }
  get amount() { return this._amount; }
  get paidAmount() { return this._paidAmount; }
  get paymentMethod() { return this._paymentMethod; }
  get date() { return this._date; }
  get reference() { return this._reference; }
  get status() { return this._status; }

  get remaining() { return this._amount - this._paidAmount; }
  get isFullyPaid() { return this._paidAmount >= this._amount; }
  get isPending() { return this._status === 'PENDIENTE'; }

  registerPayment(amount, method, reference) {
    if (amount <= 0) throw new Error('Payment amount must be positive');
    if (this.isFullyPaid) throw new Error('Cobro already fully paid');

    this._paidAmount = Math.min(this._paidAmount + amount, this._amount);
    this._paymentMethod = method;
    this._reference = reference;

    if (this.isFullyPaid) {
      this._status = 'COBRADO';
      this.addDomainEvent({ type: 'COBRO_FULLY_PAID', cobroId: this._id });
    } else {
      this._status = 'PARCIAL';
      this.addDomainEvent({ type: 'COBRO_PARTIAL_PAYMENT', cobroId: this._id, amount });
    }
  }

  static fromDbRow(row) {
    return new Cobro({
      id: row.ID || row.NUMCOBRO,
      clientCode: row.CODIGOCLIENTE || row.CLIENTE,
      clientName: row.NOMBRECLIENTE || row.NOMBRE,
      amount: parseFloat(row.IMPORTE || row.TOTAL || 0),
      paidAmount: parseFloat(row.PAGADO || row.COBRO || 0),
      paymentMethod: row.FORMAPAGO || row.TPAGO,
      date: row.FECHA ? new Date(row.FECHA) : new Date(),
      reference: row.REFERENCIA || row.OBSERVACIONES,
      status: row.ESTADO || 'PENDIENTE'
    });
  }
}

module.exports = { Cobro };
