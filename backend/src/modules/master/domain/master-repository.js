/**
 * Master Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class MasterRepository extends Repository {
  async getByType(type) {
    throw new Error('Method not implemented: getByType');
  }

  async getAll() {
    throw new Error('Method not implemented: getAll');
  }

  async update(type, code, data) {
    throw new Error('Method not implemented: update');
  }

  async getFamilies() {
    throw new Error('Method not implemented: getFamilies');
  }

  async getTarifas() {
    throw new Error('Method not implemented: getTarifas');
  }

  async getVendors() {
    throw new Error('Method not implemented: getVendors');
  }

  async getPaymentConditions() {
    throw new Error('Method not implemented: getPaymentConditions');
  }
}

module.exports = { MasterRepository };
