/**
 * KpiAlert Entity - KPI Alerts Domain
 */
const { Entity } = require('../../../core/domain/entity');

class KpiAlert extends Entity {
  constructor({ id, type, threshold, current, triggered, createdAt, message }) {
    super(id);
    this._type = type;
    this._threshold = threshold || 0;
    this._current = current || 0;
    this._triggered = triggered || false;
    this._createdAt = createdAt || new Date().toISOString();
    this._message = message || '';
  }

  get type() { return this._type; }
  get threshold() { return this._threshold; }
  get current() { return this._current; }
  get isTriggered() { return this._triggered; }
  get createdAt() { return this._createdAt; }
  get message() { return this._message; }

  get deviation() {
    if (this._threshold === 0) return 0;
    return ((this._current - this._threshold) / this._threshold) * 100;
  }

  static fromDbRow(row) {
    return new KpiAlert({
      id: row.ID || row.KA_ID,
      type: row.TIPO || row.KA_TIPO,
      threshold: parseFloat(row.UMBRAL || row.KA_THRESHOLD || 0),
      current: parseFloat(row.ACTUAL || row.KA_CURRENT || 0),
      triggered: (row.ACTIVADA || row.KA_TRIGGERED) !== 0,
      createdAt: row.FECHA_CREACION || row.KA_CREATED,
      message: row.MENSAJE || row.KA_MSG || ''
    });
  }
}

module.exports = { KpiAlert };
