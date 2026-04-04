/**
 * Get Recent Sales Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetRecentSalesUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes, limit = 10 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const sales = await this._repository.getRecentSales(vendedorCodes, limit);

    return {
      sales: sales || [],
      total: sales ? sales.length : 0
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetRecentSalesUseCase, ValidationError };
