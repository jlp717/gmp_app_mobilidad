/**
 * Get Historico Use Case - Repartidor Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetHistoricoUseCase extends UseCase {
  constructor(repartidorRepository) {
    super();
    this._repository = repartidorRepository;
  }

  async execute({ repartidorCode, year, month, limit = 20, offset = 0 }) {
    if (!repartidorCode) {
      throw new ValidationError('repartidorCode is required');
    }

    const filters = { year, month, limit, offset };
    const historico = await this._repository.getHistorico(repartidorCode, filters);

    return historico;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetHistoricoUseCase, ValidationError };
