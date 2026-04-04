/**
 * Objective Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class ObjectiveRepository extends Repository {
  async findByVendor(vendedorCodes, year) {
    throw new Error('Method not implemented: findByVendor');
  }

  async getProgress(vendedorCodes, year) {
    throw new Error('Method not implemented: getProgress');
  }

  async getClientMatrix(vendedorCodes, year, filters = {}) {
    throw new Error('Method not implemented: getClientMatrix');
  }

  async save(objective) {
    throw new Error('Method not implemented: save');
  }
}

module.exports = { ObjectiveRepository };
