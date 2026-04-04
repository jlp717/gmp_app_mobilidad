/**
 * Filter Entity - Filters Domain
 */
const { Entity } = require('../../../core/domain/entity');

class Filter extends Entity {
  constructor({ code, name, type, order, active, description }) {
    super(code);
    this._code = code;
    this._name = name;
    this._type = type;
    this._order = order || 0;
    this._active = active !== false;
    this._description = description || '';
  }

  get code() { return this._code; }
  get name() { return this._name; }
  get type() { return this._type; }
  get order() { return this._order; }
  get isActive() { return this._active; }
  get description() { return this._description; }

  static fromDbRow(row) {
    return new Filter({
      code: row.CODIGO || row.FICODE,
      name: row.NOMBRE || row.FINOMB,
      type: row.TIPO || row.FITIPO,
      order: parseInt(row.ORDEN || row.FIORDN || 0),
      active: (row.ACTIVO || row.FIACTV) !== 0,
      description: row.DESCRIPCION || row.FIDESC || ''
    });
  }
}

module.exports = { Filter };
