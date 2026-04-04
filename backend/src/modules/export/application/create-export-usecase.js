/**
 * Create Export Use Case - Export Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class CreateExportUseCase extends UseCase {
  constructor(exportRepository) {
    super();
    this._repository = exportRepository;
  }

  async execute({ type, format, filters, userId }) {
    if (!type || !format) {
      throw new ValidationError('type and format are required');
    }

    const job = {
      type,
      format,
      filters: filters || {},
      userId: userId || ''
    };

    const jobId = await this._repository.createJob(job);

    return {
      jobId,
      type,
      format,
      status: 'PENDING',
      message: 'Export job created successfully'
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { CreateExportUseCase, ValidationError };
