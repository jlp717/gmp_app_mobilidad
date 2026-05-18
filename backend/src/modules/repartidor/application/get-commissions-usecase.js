/**
 * Get Commissions Use Case - Repartidor Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetCommissionsUseCase extends UseCase {
  constructor(repartidorRepository) {
    super();
    this._repository = repartidorRepository;
  }

  async execute({ repartidorCode, year, month }) {
    if (!repartidorCode) {
      throw new ValidationError('repartidorCode is required');
    }
    if (!year) {
      throw new ValidationError('year is required');
    }
    if (!month) {
      throw new ValidationError('month is required');
    }

    const commissions = await this._repository.getCommissions(repartidorCode, year, month);

    return commissions;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetCommissionsUseCase, ValidationError };
