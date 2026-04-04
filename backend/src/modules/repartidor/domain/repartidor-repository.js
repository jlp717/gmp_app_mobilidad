/**
 * Repartidor Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class RepartidorRepository extends Repository {
  async getWeekRoutes(repartidorCode, weekStart) {
    throw new Error('Method not implemented: getWeekRoutes');
  }

  async getDayDeliveries(repartidorCode, date) {
    throw new Error('Method not implemented: getDayDeliveries');
  }

  async getDeliveryDetail(albaranNumber) {
    throw new Error('Method not implemented: getDeliveryDetail');
  }

  async updateStatus(albaranNumber, status, observations) {
    throw new Error('Method not implemented: updateStatus');
  }

  async registerSignature(albaranNumber, signaturePath) {
    throw new Error('Method not implemented: registerSignature');
  }

  async getHistorico(repartidorCode, filters = {}) {
    throw new Error('Method not implemented: getHistorico');
  }

  async getCommissions(repartidorCode, year, month) {
    throw new Error('Method not implemented: getCommissions');
  }
}

module.exports = { RepartidorRepository };
