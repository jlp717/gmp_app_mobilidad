/**
 * Update Order Use Case - Rutero Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../middleware/logger');

class RutaConfigError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RutaConfigError';
    this.code = code;
  }
}

class UpdateOrderUseCase extends UseCase {
  constructor(ruteroRepository) {
    super();
    this._ruteroRepository = ruteroRepository;
  }

  async execute({ configId, newOrder }) {
    if (!configId) {
      throw new RutaConfigError('configId is required', 'MISSING_CONFIG_ID');
    }

    if (newOrder === undefined || newOrder === null || newOrder < 0) {
      throw new RutaConfigError('newOrder must be >= 0', 'INVALID_ORDER');
    }

    logger.info(`UpdateOrderUseCase: Updating config ${configId} to order ${newOrder}`);

    const result = await this._ruteroRepository.updateOrder({ configId, newOrder });

    logger.info(`UpdateOrderUseCase: Config ${configId} updated to order ${newOrder}`);

    return result;
  }
}

module.exports = { UpdateOrderUseCase, RutaConfigError };
