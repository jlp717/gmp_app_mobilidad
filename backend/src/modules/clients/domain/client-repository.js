/**
 * Client Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class ClientRepository extends Repository {
  async findAll({ vendedorCodes, search, limit, offset }) {
    throw new Error('Method not implemented: findAll');
  }

  async findByCode(code) {
    throw new Error('Method not implemented: findByCode');
  }

  async findDetail(code, vendedorCodes, year) {
    throw new Error('Method not implemented: findDetail');
  }

  async compare(clientCodes, vendedorCodes, year) {
    throw new Error('Method not implemented: compare');
  }

  async findSalesHistory(code, year, limit) {
    throw new Error('Method not implemented: findSalesHistory');
  }

  async findProductsPurchased(code, limit) {
    throw new Error('Method not implemented: findProductsPurchased');
  }

  async findPaymentStatus(code) {
    throw new Error('Method not implemented: findPaymentStatus');
  }
}

module.exports = { ClientRepository };
