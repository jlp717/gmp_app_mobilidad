/**
 * Confirm Order Use Case - Pedidos Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class ConfirmOrderError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ConfirmOrderError';
    this.code = code;
  }
}

class ConfirmOrderUseCase extends UseCase {
  constructor(pedidosRepository) {
    super();
    this._pedidosRepository = pedidosRepository;
  }

  async execute({ userId, clientCode, lines, observations }) {
    if (!userId) {
      throw new ConfirmOrderError('userId is required', 'MISSING_USER_ID');
    }
    if (!clientCode) {
      throw new ConfirmOrderError('clientCode is required', 'MISSING_CLIENT_CODE');
    }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      throw new ConfirmOrderError('Order must have at least 1 line item', 'EMPTY_ORDER');
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.productCode) {
        throw new ConfirmOrderError(`Line ${i + 1}: productCode is required`, 'INVALID_LINE');
      }
      if (!line.quantity || line.quantity <= 0) {
        throw new ConfirmOrderError(`Line ${i + 1}: quantity must be greater than 0`, 'INVALID_QUANTITY');
      }
    }

    logger.info({ usecase: 'ConfirmOrderUseCase', userId, clientCode, linesCount: lines.length }, 'Confirming order');

    const result = await this._pedidosRepository.confirmOrder({
      userId,
      clientCode,
      lines,
      observations: observations || ''
    });

    logger.info({ usecase: 'ConfirmOrderUseCase', orderId: result.orderId }, 'Order confirmed');

    return result;
  }
}

module.exports = { ConfirmOrderUseCase, ConfirmOrderError };
