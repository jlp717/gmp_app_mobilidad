/**
 * Commission Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class CommissionRepository extends Repository {
  async findByVendor(vendedorCodes, year, month, filters = {}) {
    throw new Error('Method not implemented: findByVendor');
  }

  async getSummary(vendedorCodes, year) {
    throw new Error('Method not implemented: getSummary');
  }

  async getByClient(vendedorCodes, clientCode, year) {
    throw new Error('Method not implemented: getByClient');
  }
}

module.exports = { CommissionRepository };
