/**
 * Get Client Detail Use Case - Clients Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetClientDetailUseCase extends UseCase {
  constructor(clientRepository) {
    super();
    this._repository = clientRepository;
  }

  async execute({ code, vendedorCodes, year }) {
    if (!code) {
      throw new ValidationError('client code is required');
    }

    const detail = await this._repository.findDetail(code, vendedorCodes, year);
    if (!detail) {
      throw new NotFoundError(`Client ${code} not found`);
    }

    return detail;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

module.exports = { GetClientDetailUseCase, ValidationError, NotFoundError };
