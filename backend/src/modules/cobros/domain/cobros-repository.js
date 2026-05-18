/**
 * Cobros Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class CobrosRepository extends Repository {
  async getPendientes(clientCode) {
    throw new Error('Method not implemented: getPendientes');
  }

  async registerPayment({ clientCode, amount, paymentMethod, reference, observations, userId }) {
    throw new Error('Method not implemented: registerPayment');
  }

  async getHistorico({ clientCode, limit, offset }) {
    throw new Error('Method not implemented: getHistorico');
  }

  async getTotalesByVendor(vendorCode) {
    throw new Error('Method not implemented: getTotalesByVendor');
  }
}

module.exports = { CobrosRepository };
