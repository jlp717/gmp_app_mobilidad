/**
 * Base Value Object - DDD Domain Pattern
 * Immutable objects defined by their attributes
 */
class ValueObject {
  constructor(props) {
    if (new.target === ValueObject) {
      throw new TypeError('Cannot construct ValueObject instances directly');
    }
    Object.freeze(props);
    this._props = props;
  }

  get props() {
    return this._props;
  }

  equals(other) {
    if (!other || !(other instanceof ValueObject)) return false;
    return JSON.stringify(this._props) === JSON.stringify(other._props);
  }
}

module.exports = { ValueObject };
