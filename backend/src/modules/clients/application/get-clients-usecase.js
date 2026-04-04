/**
 * Get Clients Use Case - Clients Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetClientsUseCase extends UseCase {
  constructor(clientRepository) {
    super();
    this._repository = clientRepository;
  }

  async execute({ vendedorCodes, search = '', limit = 100, offset = 0 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const clients = await this._repository.findAll({ vendedorCodes, search, limit, offset });

    return {
      clients,
      total: clients.length,
      hasMore: clients.length >= limit
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetClientsUseCase, ValidationError };
