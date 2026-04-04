/**
 * Get Client Matrix Use Case - Objectives Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetClientMatrixUseCase extends UseCase {
  constructor(objectiveRepository) {
    super();
    this._repository = objectiveRepository;
  }

  async execute({ vendedorCodes, year, family = null, limit = 50, offset = 0 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const filters = { limit, offset, family };
    const matrix = await this._repository.getClientMatrix(vendedorCodes, year, filters);

    return {
      matrix: matrix || [],
      total: matrix ? matrix.length : 0,
      hasMore: matrix && matrix.length >= limit
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetClientMatrixUseCase, ValidationError };
