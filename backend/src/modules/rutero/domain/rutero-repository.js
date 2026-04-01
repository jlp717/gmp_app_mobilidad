/**
 * Rutero Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class RuteroRepository extends Repository {
  async getRutaConfig({ vendorCode, date }) {
    throw new Error('Method not implemented: getRutaConfig');
  }

  async updateOrder({ configId, newOrder }) {
    throw new Error('Method not implemented: updateOrder');
  }

  async moveClient({ clientCode, fromDay, toDay, vendorCode }) {
    throw new Error('Method not implemented: moveClient');
  }

  async getCommissions({ vendorCode, date, role }) {
    throw new Error('Method not implemented: getCommissions');
  }

  async getDaySummary({ vendorCode, date }) {
    throw new Error('Method not implemented: getDaySummary');
  }
}

module.exports = { RuteroRepository };
