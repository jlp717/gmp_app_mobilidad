/**
 * Update Delivery Status Use Case - Repartidor Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class UpdateDeliveryStatusUseCase extends UseCase {
  constructor(repartidorRepository) {
    super();
    this._repository = repartidorRepository;
  }

  async execute({ albaranNumber, status, observations = '', signaturePath = null }) {
    if (!albaranNumber) {
      throw new ValidationError('albaranNumber is required');
    }
    if (!status) {
      throw new ValidationError('status is required');
    }

    const result = await this._repository.updateStatus(albaranNumber, status, observations);

    if (signaturePath) {
      await this._repository.registerSignature(albaranNumber, signaturePath);
    }

    return {
      albaranNumber,
      status,
      signaturePath,
      updatedAt: result.updatedAt
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { UpdateDeliveryStatusUseCase, ValidationError };
