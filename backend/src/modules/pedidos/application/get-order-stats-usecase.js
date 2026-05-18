/**
 * Get Order Stats Use Case - Pedidos Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetOrderStatsUseCase extends UseCase {
  constructor(pedidosRepository) {
    super();
    this._repository = pedidosRepository;
  }

  async execute({ userId }) {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const stats = await this._repository.getOrderStats({ userId });

    return stats;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetOrderStatsUseCase, ValidationError };
