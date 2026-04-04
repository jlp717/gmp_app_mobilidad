/**
 * User Entity - Auth Domain
 */
const { Entity } = require('../../../core/domain/entity');

class User extends Entity {
  constructor({ id, code, name, role, isJefeVentas, email, passwordHash, active }) {
    super(id);
    this._code = code;
    this._name = name;
    this._role = role;
    this._isJefeVentas = isJefeVentas || false;
    this._email = email;
    this._passwordHash = passwordHash;
    this._active = active !== false;
  }

  get code() { return this._code; }
  get name() { return this._name; }
  get role() { return this._role; }
  get isJefeVentas() { return this._isJefeVentas; }
  get email() { return this._email; }
  get isActive() { return this._active; }

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
    return new User({
      id: row.ID || row.USUARIO,
      code: row.CODIGO || row.USUARIO,
      name: row.NOMBRE || row.NOMBREUSUARIO,
      role: row.ROL || 'COMERCIAL',
      isJefeVentas: (row.ROL === 'JEFE_VENTAS'),
      email: row.EMAIL,
      passwordHash: row.PASSWORD_HASH,
      active: row.ACTIVO !== 0
    });
  }
}

module.exports = { User };
