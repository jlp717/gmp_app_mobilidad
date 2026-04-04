/**
 * Get Top Products Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetTopProductsUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes, year, month, limit = 10 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const products = await this._repository.getTopProducts(vendedorCodes, year, month, limit);

    return {
      products,
      total: products.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetTopProductsUseCase, ValidationError };
