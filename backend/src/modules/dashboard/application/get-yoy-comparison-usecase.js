/**
 * Get YoY Comparison Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetYoYComparisonUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const data = await this._repository.getYoYComparison(vendedorCodes);

    const byYear = {};
    (data || []).forEach(row => {
      const year = row.ANIO;
      if (!byYear[year]) byYear[year] = {};
      byYear[year][row.MES] = {
        ventas: parseFloat(row.VENTAS),
        margen: parseFloat(row.MARGEN)
      };
    });

    return {
      years: Object.keys(byYear).sort(),
      data: byYear
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetYoYComparisonUseCase, ValidationError };
