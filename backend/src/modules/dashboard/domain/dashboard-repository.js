/**
 * Dashboard Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class DashboardRepository extends Repository {
  async getMetrics(vendedorCodes, year, month) {
    throw new Error('Method not implemented: getMetrics');
  }

  async getSalesEvolution(vendedorCodes, year, months = 12) {
    throw new Error('Method not implemented: getSalesEvolution');
  }

  async getTopClients(vendedorCodes, year, month, limit = 10) {
    throw new Error('Method not implemented: getTopClients');
  }

  async getTopProducts(vendedorCodes, year, month, limit = 10) {
    throw new Error('Method not implemented: getTopProducts');
  }

  async getRecentSales(vendedorCodes, limit = 10) {
    throw new Error('Method not implemented: getRecentSales');
  }

  async getYoYComparison(vendedorCodes) {
    throw new Error('Method not implemented: getYoYComparison');
  }

  async getHierarchyData(vendedorCodes, year) {
    throw new Error('Method not implemented: getHierarchyData');
  }

  async getClientConditions(vendedorCodes) {
    throw new Error('Method not implemented: getClientConditions');
  }
}

module.exports = { DashboardRepository };
