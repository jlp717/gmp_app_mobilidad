/**
 * ChatSession Entity - Chatbot Domain
 */
const { Entity } = require('../../../core/domain/entity');

class ChatSession extends Entity {
  constructor({ id, userId, messages, createdAt, updatedAt }) {
    super(id);
    this._userId = userId;
    this._messages = messages || [];
    this._createdAt = createdAt || new Date().toISOString();
    this._updatedAt = updatedAt || new Date().toISOString();
  }

  get userId() { return this._userId; }
  get messages() { return this._messages; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }

  addMessage(message) {
    this._messages.push({
      role: message.role,
      content: message.content,
      timestamp: new Date().toISOString()
    });
    this._updatedAt = new Date().toISOString();
  }

  getMessageCount() {
    return this._messages.length;
  }

  static fromDbRow(row) {
    return new ChatSession({
      id: row.ID || row.CS_ID,
      userId: row.USER_ID || row.CS_USERID,
      messages: row.MESSAGES ? JSON.parse(row.MESSAGES) : [],
      createdAt: row.FECHA_CREACION || row.CS_CREATED,
      updatedAt: row.FECHA_ACTUALIZACION || row.CS_UPDATED
    });
  }
}

module.exports = { ChatSession };
