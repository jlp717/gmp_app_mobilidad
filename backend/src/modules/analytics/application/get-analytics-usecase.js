/**
 * Get Analytics Use Case - Analytics Domain
 * Returns comprehensive analytics data for a given period
 */
const { UseCase } = require('../../../core/application/use-case');

class GetAnalyticsUseCase extends UseCase {
  constructor(analyticsRepository) {
    super();
    this._repository = analyticsRepository;
  }

  async execute({ vendedorCodes, year, month }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const [metrics, growthRates, topClients, topProducts, familyBreakdown] = await Promise.all([
      this._repository.getPeriodMetrics(vendedorCodes, year, month),
      this._repository.getGrowthRates(vendedorCodes, year, month),
      this._repository.getTopClientsByMetric(vendedorCodes, year, month, 'ventas', 10),
      this._repository.getTopProductsByMetric(vendedorCodes, year, month, 'ventas', 10),
      this._repository.getProductFamilyBreakdown(vendedorCodes, year, month)
    ]);

    const ventas = parseFloat(metrics.VENTAS || 0);
    const margen = parseFloat(metrics.MARGEN || 0);
    const pedidos = parseInt(metrics.PEDIDOS || 0);
    const cajas = parseFloat(metrics.CAJAS || 0);
    const clientes = parseInt(metrics.CLIENTES || 0);
    const productos = parseInt(metrics.PRODUCTOS || 0);

    return {
      metrics: {
        ventas,
        margen,
        pedidos,
        cajas,
        clientes,
        productos,
        margenPercent: ventas > 0 ? (margen / ventas) * 100 : 0,
        ticketMedio: pedidos > 0 ? ventas / pedidos : 0
      },
      growthRates: {
        ventas: {
          current: growthRates.ventas.currentPeriod,
          previous: growthRates.ventas.previousPeriod,
          rate: growthRates.ventas.rate,
          trend: growthRates.ventas.trend
        },
        margen: {
          current: growthRates.margen.currentPeriod,
          previous: growthRates.margen.previousPeriod,
          rate: growthRates.margen.rate,
          trend: growthRates.margen.trend
        },
        pedidos: {
          current: growthRates.pedidos.currentPeriod,
          previous: growthRates.pedidos.previousPeriod,
          rate: growthRates.pedidos.rate,
          trend: growthRates.pedidos.trend
        }
      },
      topClients: topClients.map(c => ({
        rank: c.rank,
        code: c.code,
        name: c.name,
        value: c.value
      })),
      topProducts: topProducts.map(p => ({
        rank: p.rank,
        code: p.code,
        name: p.name,
        value: p.value
      })),
      familyBreakdown
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetAnalyticsUseCase, ValidationError };
