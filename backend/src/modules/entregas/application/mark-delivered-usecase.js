/**
 * Mark Delivered Use Case - Entregas Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../middleware/logger');

class DeliveryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DeliveryError';
    this.code = code;
  }
}

class MarkDeliveredUseCase extends UseCase {
  constructor(entregasRepository) {
    super();
    this._entregasRepository = entregasRepository;
  }

  async execute({ albaranId, observations, signaturePath, latitude, longitude, repartidorId }) {
    if (!albaranId) {
      throw new DeliveryError('albaranId is required', 'MISSING_ALBARAN_ID');
    }

    if (!repartidorId) {
      throw new DeliveryError('repartidorId is required', 'MISSING_REPARTIDOR_ID');
    }

    logger.info(`MarkDeliveredUseCase: Marking albaran ${albaranId} as delivered by ${repartidorId}`);

    const result = await this._entregasRepository.markDelivered({
      albaranId,
      observations,
      signaturePath,
      latitude,
      longitude,
      repartidorId
    });

    logger.info(`MarkDeliveredUseCase: Albaran ${albaranId} marked as delivered`);

    return result;
  }
}

module.exports = { MarkDeliveredUseCase, DeliveryError };
