/**
 * Get Objective Progress Use Case - Objectives Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetObjectiveProgressUseCase extends UseCase {
  constructor(objectiveRepository) {
    super();
    this._repository = objectiveRepository;
  }

  async execute({ vendedorCodes, year }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const progress = await this._repository.getProgress(vendedorCodes, year);

    return {
      progress,
      vendorCount: progress.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetObjectiveProgressUseCase, ValidationError };
