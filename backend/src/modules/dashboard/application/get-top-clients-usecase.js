/**
 * Get Top Clients Use Case - Dashboard Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetTopClientsUseCase extends UseCase {
  constructor(dashboardRepository) {
    super();
    this._repository = dashboardRepository;
  }

  async execute({ vendedorCodes, year, month, limit = 10 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const clients = await this._repository.getTopClients(vendedorCodes, year, month, limit);

    return {
      clients,
      total: clients.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetTopClientsUseCase, ValidationError };
