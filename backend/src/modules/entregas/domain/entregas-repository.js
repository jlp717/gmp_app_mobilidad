/**
 * Entregas Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class EntregasRepository extends Repository {
  async getAlbaranes({ repartidorId, date, status }) {
    throw new Error('Method not implemented: getAlbaranes');
  }

  async getAlbaranDetail(albaranId) {
    throw new Error('Method not implemented: getAlbaranDetail');
  }

  async markDelivered({ albaranId, observations, signaturePath, latitude, longitude, repartidorId }) {
    throw new Error('Method not implemented: markDelivered');
  }

  async getGamificationStats(repartidorId) {
    throw new Error('Method not implemented: getGamificationStats');
  }

  async getRouteSummary({ repartidorId, date }) {
    throw new Error('Method not implemented: getRouteSummary');
  }
}

module.exports = { EntregasRepository };
