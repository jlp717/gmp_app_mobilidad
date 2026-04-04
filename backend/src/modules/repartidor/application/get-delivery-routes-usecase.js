/**
 * Get Delivery Routes Use Case - Repartidor Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetDeliveryRoutesUseCase extends UseCase {
  constructor(repartidorRepository) {
    super();
    this._repository = repartidorRepository;
  }

  async execute({ repartidorCode, weekStart }) {
    if (!repartidorCode) {
      throw new ValidationError('repartidorCode is required');
    }
    if (!weekStart) {
      throw new ValidationError('weekStart date is required');
    }

    const routes = await this._repository.getWeekRoutes(repartidorCode, new Date(weekStart));

    return {
      routes,
      weekStart,
      totalRoutes: routes.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetDeliveryRoutesUseCase, ValidationError };
