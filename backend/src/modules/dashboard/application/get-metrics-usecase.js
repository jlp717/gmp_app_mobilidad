/**
 * Get Metrics Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetMetricsUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes, year, month }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const metrics = await this._repository.getMetrics(vendedorCodes, year, month);

    return {
      ventas: parseFloat(metrics.VENTAS || 0),
      margen: parseFloat(metrics.MARGEN || 0),
      pedidos: parseInt(metrics.PEDIDOS || 0),
      cajas: parseFloat(metrics.CAJAS || 0),
      margenPercent: metrics.VENTAS > 0 ? (metrics.MARGEN / metrics.VENTAS) * 100 : 0
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetMetricsUseCase, ValidationError };
