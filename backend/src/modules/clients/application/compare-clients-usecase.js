/**
 * Compare Clients Use Case - Clients Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class CompareClientsUseCase extends UseCase {
  constructor(clientRepository) {
    super();
    this._repository = clientRepository;
  }

  async execute({ clientCodes, vendedorCodes, year }) {
    if (!clientCodes || clientCodes.length === 0) {
      throw new ValidationError('At least one client code is required');
    }

    const comparison = await this._repository.compare(clientCodes, vendedorCodes, year);

    return {
      comparison: comparison || [],
      clientCount: comparison ? comparison.length : 0
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { CompareClientsUseCase, ValidationError };
