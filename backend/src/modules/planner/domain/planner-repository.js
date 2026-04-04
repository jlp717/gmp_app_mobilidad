/**
 * Planner Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class PlannerRepository extends Repository {
  async getDayPlan(date, vendorCodes) {
    throw new Error('Method not implemented: getDayPlan');
  }

  async savePlan(plan) {
    throw new Error('Method not implemented: savePlan');
  }

  async updateStatus(planId, status) {
    throw new Error('Method not implemented: updateStatus');
  }

  async getVehicles() {
    throw new Error('Method not implemented: getVehicles');
  }

  async getPendingOrders(date, vendorCodes) {
    throw new Error('Method not implemented: getPendingOrders');
  }

  async getHistory(dateFrom, dateTo, vendorCodes) {
    throw new Error('Method not implemented: getHistory');
  }
}

module.exports = { PlannerRepository };
