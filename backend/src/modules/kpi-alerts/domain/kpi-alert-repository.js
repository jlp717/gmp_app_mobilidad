/**
 * KPI Alert Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class KpiAlertRepository extends Repository {
  async checkAlerts(vendorCodes, year, month) {
    throw new Error('Method not implemented: checkAlerts');
  }

  async createAlert(alert) {
    throw new Error('Method not implemented: createAlert');
  }

  async getActiveAlerts(vendorCodes) {
    throw new Error('Method not implemented: getActiveAlerts');
  }

  async getKpiData(vendorCodes, year, month) {
    throw new Error('Method not implemented: getKpiData');
  }
}

module.exports = { KpiAlertRepository };
