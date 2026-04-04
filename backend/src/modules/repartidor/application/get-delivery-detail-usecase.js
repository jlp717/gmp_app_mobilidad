/**
 * Get Delivery Detail Use Case - Repartidor Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetDeliveryDetailUseCase extends UseCase {
  constructor(repartidorRepository) {
    super();
    this._repository = repartidorRepository;
  }

  async execute({ albaranNumber }) {
    if (!albaranNumber) {
      throw new ValidationError('albaranNumber is required');
    }

    const detail = await this._repository.getDeliveryDetail(albaranNumber);
    if (!detail) {
      throw new NotFoundError(`Delivery ${albaranNumber} not found`);
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

module.exports = { GetDeliveryDetailUseCase, ValidationError, NotFoundError };
