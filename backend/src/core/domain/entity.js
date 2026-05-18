/**
 * Base Entity - DDD Domain Pattern
 * All domain entities extend this class
 */
class Entity {
  constructor(id) {
    if (new.target === Entity) {
      throw new TypeError('Cannot construct Entity instances directly');
    }
    this._id = id;
    this._domainEvents = [];
  }

  get id() {
    return this._id;
  }

  equals(other) {
    if (!other || !(other instanceof Entity)) return false;
    return this._id === other.id;
  }

  addDomainEvent(event) {
    this._domainEvents.push(event);
  }

  getUncommittedEvents() {
    return [...this._domainEvents];
  }

  markEventsAsCommitted() {
    this._domainEvents = [];
  }
}

module.exports = { Entity };
