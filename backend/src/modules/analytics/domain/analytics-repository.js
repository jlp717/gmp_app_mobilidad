/**
 * Analytics Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class AnalyticsRepository extends Repository {
  async getPeriodMetrics(vendedorCodes, year, month) {
    throw new Error('Method not implemented: getPeriodMetrics');
  }

  async getMonthlyEvolution(vendedorCodes, year, months = 12) {
    throw new Error('Method not implemented: getMonthlyEvolution');
  }

  async getGrowthRates(vendedorCodes, year, month) {
    throw new Error('Method not implemented: getGrowthRates');
  }

  async getTopClientsByMetric(vendedorCodes, year, month, metric = 'ventas', limit = 10) {
    throw new Error('Method not implemented: getTopClientsByMetric');
  }

  async getTopProductsByMetric(vendedorCodes, year, month, metric = 'ventas', limit = 10) {
    throw new Error('Method not implemented: getTopProductsByMetric');
  }

  async getHistoricalData(vendedorCodes, years = 2) {
    throw new Error('Method not implemented: getHistoricalData');
  }

  async getClientConcentration(vendedorCodes, year, month) {
    throw new Error('Method not implemented: getClientConcentration');
  }

  async getProductFamilyBreakdown(vendedorCodes, year, month) {
    throw new Error('Method not implemented: getProductFamilyBreakdown');
  }
}

module.exports = { AnalyticsRepository };
