/**
 * MasterData Entity - Master Domain
 */
const { Entity } = require('../../../core/domain/entity');

class MasterData extends Entity {
  constructor({ type, code, name, description, active, extra }) {
    super(`${type}:${code}`);
    this._type = type;
    this._code = code;
    this._name = name;
    this._description = description || '';
    this._active = active !== false;
    this._extra = extra || {};
  }

  get type() { return this._type; }
  get code() { return this._code; }
  get name() { return this._name; }
  get description() { return this._description; }
  get isActive() { return this._active; }
  get extra() { return this._extra; }

  static fromDbRow(row, type) {
    return new MasterData({
      type: type || row.TIPO || row.MD_TIPO,
      code: row.CODIGO || row.MD_CODE,
      name: row.NOMBRE || row.MD_NAME,
      description: row.DESCRIPCION || row.MD_DESC || '',
      active: (row.ACTIVO || row.MD_ACTV) !== 0,
      extra: {}
    });
  }
}

module.exports = { MasterData };
