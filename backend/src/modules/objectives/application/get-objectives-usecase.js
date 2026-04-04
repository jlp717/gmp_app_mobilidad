/**
 * Get Objectives Use Case - Objectives Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetObjectivesUseCase extends UseCase {
  constructor(objectiveRepository) {
    super();
    this._repository = objectiveRepository;
  }

  async execute({ vendedorCodes, year }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const objectives = await this._repository.findByVendor(vendedorCodes, year);

    return {
      objectives,
      total: objectives.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetObjectivesUseCase, ValidationError };
