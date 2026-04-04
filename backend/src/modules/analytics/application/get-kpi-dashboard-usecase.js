/**
 * Get KPI Dashboard Use Case - Analytics Domain
 * Returns KPI dashboard data with evolution, concentration, and breakdowns
 */
const { UseCase } = require('../../../core/application/use-case');

class GetKpiDashboardUseCase extends UseCase {
  constructor(analyticsRepository) {
    super();
    this._repository = analyticsRepository;
  }

  async execute({ vendedorCodes, year, month, includeConcentration = true }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const [evolution, concentration, familyBreakdown, topClients, topProducts] = await Promise.all([
      this._repository.getMonthlyEvolution(vendedorCodes, year, 12),
      includeConcentration ? this._repository.getClientConcentration(vendedorCodes, year, month) : Promise.resolve(null),
      this._repository.getProductFamilyBreakdown(vendedorCodes, year, month),
      this._repository.getTopClientsByMetric(vendedorCodes, year, month, 'ventas', 10),
      this._repository.getTopProductsByMetric(vendedorCodes, year, month, 'ventas', 10)
    ]);

    const monthlyData = (evolution || []).map(row => ({
      year: parseInt(row.ANIO),
      month: parseInt(row.MES),
      label: `${row.MES}/${row.ANIO}`,
      ventas: parseFloat(row.VENTAS || 0),
      margen: parseFloat(row.MARGEN || 0),
      pedidos: parseInt(row.PEDIDOS || 0),
      clientes: parseInt(row.CLIENTES || 0),
      margenPercent: row.VENTAS > 0 ? (parseFloat(row.MARGEN || 0) / parseFloat(row.VENTAS || 0)) * 100 : 0,
      ticketMedio: row.PEDIDOS > 0 ? parseFloat(row.VENTAS || 0) / parseInt(row.PEDIDOS || 1) : 0
    }));

    const totalVentas = monthlyData.reduce((sum, m) => sum + m.ventas, 0);
    const totalMargen = monthlyData.reduce((sum, m) => sum + m.margen, 0);
    const totalPedidos = monthlyData.reduce((sum, m) => sum + m.pedidos, 0);

    const avgTicketMedio = totalPedidos > 0 ? totalVentas / totalPedidos : 0;
    const avgMargenPercent = totalVentas > 0 ? (totalMargen / totalVentas) * 100 : 0;

    const kpis = {
      totalVentas,
      totalMargen,
      totalPedidos,
      avgTicketMedio,
      avgMargenPercent,
      monthsAnalyzed: monthlyData.length
    };

    return {
      kpis,
      evolution: monthlyData,
      concentration: concentration || null,
      familyBreakdown,
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
      }))
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetKpiDashboardUseCase, ValidationError };
