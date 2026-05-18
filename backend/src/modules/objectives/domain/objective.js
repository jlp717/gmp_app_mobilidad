/**
 * Objective Entity - Objectives Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Objective extends Entity {
  constructor({ id, vendedor, year, month, target, actual, type }) {
    super(id);
    this._vendedor = vendedor;
    this._year = year;
    this._month = month;
    this._target = target || 0;
    this._actual = actual || 0;
    this._type = type || 'VENTAS';
  }

  get vendedor() { return this._vendedor; }
  get year() { return this._year; }
  get month() { return this._month; }
  get target() { return this._target; }
  get actual() { return this._actual; }
  get type() { return this._type; }
  get progress() { return this._target > 0 ? (this._actual / this._target) * 100 : 0; }
  get isAchieved() { return this._actual >= this._target; }
  get gap() { return this._target - this._actual; }

  static fromDbRow(row) {
    return new Objective({
      id: row.ID || `${row.VENDEDOR}-${row.ANIO}-${row.MES}-${row.TIPO}`,
      vendedor: row.VENDEDOR,
      year: parseInt(row.ANIO || row.ANO || row.YEAR),
      month: parseInt(row.MES || row.MONTH),
      target: parseFloat(row.OBJETIVO || row.TARGET || 0),
      actual: parseFloat(row.ACTUAL || row.REAL || row.VENTAS || 0),
      type: row.TIPO || row.TYPE || 'VENTAS'
    });
  }
}

class ObjectiveProgress {
  constructor({ vendedor, year, objectives, summary }) {
    this._vendedor = vendedor;
    this._year = year;
    this._objectives = objectives || [];
    this._summary = summary || {};
  }

  get vendedor() { return this._vendedor; }
  get year() { return this._year; }
  get objectives() { return this._objectives; }
  get summary() { return this._summary; }
  get overallProgress() {
    if (!this._objectives.length) return 0;
    const total = this._objectives.reduce((s, o) => s + o.progress, 0);
    return total / this._objectives.length;
  }
  get achievedCount() { return this._objectives.filter(o => o.isAchieved).length; }
}

module.exports = { Objective, ObjectiveProgress };
