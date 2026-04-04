/**
 * Facturas Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class FacturasRepository extends Repository {
  async findByVendor(vendedorCodes, year, month, filters = {}) {
    throw new Error('Method not implemented: findByVendor');
  }

  async findByClient(vendedorCodes, clientId, year) {
    throw new Error('Method not implemented: findByClient');
  }

  async getSummary(vendedorCodes, year, month, filters = {}) {
    throw new Error('Method not implemented: getSummary');
  }

  async getDetail(serie, numero, ejercicio) {
    throw new Error('Method not implemented: getDetail');
  }

  async getPending(vendedorCodes) {
    throw new Error('Method not implemented: getPending');
  }

  async getAvailableYears(vendedorCodes) {
    throw new Error('Method not implemented: getAvailableYears');
  }
}

module.exports = { FacturasRepository };
