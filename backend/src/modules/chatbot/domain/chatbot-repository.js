/**
 * Chatbot Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class ChatbotRepository extends Repository {
  async getSession(userId) {
    throw new Error('Method not implemented: getSession');
  }

  async saveMessage(sessionId, message) {
    throw new Error('Method not implemented: saveMessage');
  }

  async getHistory(userId, limit = 50) {
    throw new Error('Method not implemented: getHistory');
  }

  async lookupClient(code) {
    throw new Error('Method not implemented: lookupClient');
  }

  async lookupProduct(code) {
    throw new Error('Method not implemented: lookupProduct');
  }

  async searchClients(query, limit = 10) {
    throw new Error('Method not implemented: searchClients');
  }

  async searchProducts(query, limit = 10) {
    throw new Error('Method not implemented: searchProducts');
  }
}

module.exports = { ChatbotRepository };
