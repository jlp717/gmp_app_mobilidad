/**
 * Get Export Data Use Case - Export Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetExportDataUseCase extends UseCase {
  constructor(exportRepository) {
    super();
    this._repository = exportRepository;
  }

  async execute({ type, filters }) {
    if (!type) {
      throw new ValidationError('type is required');
    }

    const data = await this._repository.getExportData(type, filters || {});

    return {
      type,
      recordCount: data ? data.length : 0,
      data: data || []
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetExportDataUseCase, ValidationError };
