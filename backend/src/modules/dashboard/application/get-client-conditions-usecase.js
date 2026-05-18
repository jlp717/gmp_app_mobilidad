/**
 * Get Client Conditions Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetClientConditionsUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const conditions = await this._repository.getClientConditions(vendedorCodes);

    return conditions;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetClientConditionsUseCase, ValidationError };
