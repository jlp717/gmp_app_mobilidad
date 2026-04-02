/**
 * Get Order History Use Case - Pedidos Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class GetOrderHistoryUseCase extends UseCase {
  constructor(pedidosRepository) {
    super();
    this._pedidosRepository = pedidosRepository;
  }

  async execute({ userId, limit, offset }) {
    if (!userId) {
      throw new Error('userId is required');
    }

    logger.info({ usecase: 'GetOrderHistoryUseCase', userId }, 'Fetching order history');

    const orders = await this._pedidosRepository.getOrderHistory({
      userId,
      limit: limit || 20,
      offset: offset || 0
    });

    logger.info({ usecase: 'GetOrderHistoryUseCase', count: orders.length }, 'Order history fetched');

    return orders;
  }
}

module.exports = { GetOrderHistoryUseCase };
