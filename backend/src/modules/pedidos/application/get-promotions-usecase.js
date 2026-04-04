/**
 * Get Promotions Use Case - Pedidos Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class GetPromotionsUseCase extends UseCase {
  constructor(pedidosRepository) {
    super();
    this._pedidosRepository = pedidosRepository;
  }

  async execute({ clientCode, vendedorCodes }) {
    if (!clientCode) {
      throw new Error('clientCode is required');
    }

    logger.info({ usecase: 'GetPromotionsUseCase', clientCode }, 'Fetching promotions');

    const promotions = await this._pedidosRepository.getPromotions({
      clientCode,
      vendedorCodes
    });

    logger.info({ usecase: 'GetPromotionsUseCase', count: promotions.length }, 'Promotions fetched');

    return promotions;
  }
}

module.exports = { GetPromotionsUseCase };
