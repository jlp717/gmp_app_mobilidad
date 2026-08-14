/**
 * User Entity - Auth Domain
 */
const { Entity } = require('../../../core/domain/entity');
const { mobilityFlagsFromRow } = require('./erp-mobility-roles');

class User extends Entity {
  constructor({
    id,
    code,
    name,
    role,
    isJefeVentas,
    permitePreventa,
    permiteReparto,
    email,
    passwordHash,
    active,
    tipoVendedor,
    showCommissions,
    matricula,
  }) {
    super(id);
    this._code = code;
    this._name = name;
    this._role = role;
    this._isJefeVentas = isJefeVentas || false;
    this._permitePreventa = permitePreventa || false;
    this._permiteReparto = permiteReparto || false;
    this._email = email;
    this._passwordHash = passwordHash;
    this._active = active !== false;
    this._tipoVendedor = String(tipoVendedor || '-').trim() || '-';
    this._showCommissions = showCommissions !== false;
    this._matricula = String(matricula || '').trim() || null;
  }

  get code() { return this._code; }
  get name() { return this._name; }
  get role() { return this._role; }
  get isJefeVentas() { return this._isJefeVentas; }
  get permitePreventa() { return this._permitePreventa; }
  get permiteReparto() { return this._permiteReparto; }
  get email() { return this._email; }
  get isActive() { return this._active; }
  get tipoVendedor() { return this._tipoVendedor; }
  get showCommissions() { return this._showCommissions; }
  get matricula() { return this._matricula; }

  hasRole(role) {
    return this._role === role;
  }

  hasAnyRole(roles) {
    return roles.includes(this._role);
  }

  deactivate() {
    this._active = false;
    this.addDomainEvent({ type: 'USER_DEACTIVATED', userId: this._id });
  }

  activate() {
    this._active = true;
    this.addDomainEvent({ type: 'USER_ACTIVATED', userId: this._id });
  }

  static fromDbRow(row) {
    const mobility = mobilityFlagsFromRow(row);
    return new User({
      id: row.ID || row.USUARIO,
      code: row.CODIGO || row.USUARIO,
      name: row.NOMBRE || row.NOMBREUSUARIO,
      role: row.ROL || 'COMERCIAL',
      isJefeVentas: mobility.isJefeVentas,
      permitePreventa: mobility.permitePreventa,
      permiteReparto: mobility.permiteReparto,
      email: row.EMAIL,
      passwordHash: row.PASSWORD_HASH,
      active: row.ACTIVO !== 0,
      tipoVendedor: row.TIPOVENDEDOR,
      showCommissions: String(row.HIDE_COMMISSIONS || 'N').trim().toUpperCase() !== 'Y',
      matricula: row.MATRICULA,
    });
  }
}

module.exports = { User };
