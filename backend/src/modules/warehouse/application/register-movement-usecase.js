/**
 * Register Movement Use Case - Warehouse Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class RegisterMovementUseCase extends UseCase {
  constructor(warehouseRepository) {
    super();
    this._repository = warehouseRepository;
  }

  async execute({ productCode, type, quantity, reference, user }) {
    if (!productCode) {
      throw new ValidationError('productCode is required');
    }
    if (!type) {
      throw new ValidationError('type is required');
    }
    if (quantity === undefined || quantity === null) {
      throw new ValidationError('quantity is required');
    }
    if (!reference) {
      throw new ValidationError('reference is required');
    }
    if (!user) {
      throw new ValidationError('user is required');
    }

    const movement = { productCode, type, quantity, reference, user };
    const result = await this._repository.registerMovement(movement);

    return result;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { RegisterMovementUseCase, ValidationError };
