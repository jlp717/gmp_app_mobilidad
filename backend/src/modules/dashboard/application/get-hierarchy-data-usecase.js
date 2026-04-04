/**
 * Get Hierarchy Data Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetHierarchyDataUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes, year }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }
    if (!year) {
      throw new ValidationError('year is required');
    }

    const data = await this._repository.getHierarchyData(vendedorCodes, year);

    return data;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetHierarchyDataUseCase, ValidationError };
