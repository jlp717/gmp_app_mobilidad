/**
 * Get Sales Evolution Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetSalesEvolutionUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes, year, months = 12 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const evolution = await this._repository.getSalesEvolution(vendedorCodes, year, months);

    return {
      evolution,
      total: evolution.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetSalesEvolutionUseCase, ValidationError };
