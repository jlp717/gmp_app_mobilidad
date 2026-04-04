/**
 * Register Payment Use Case - Cobros Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../middleware/logger');

class PaymentError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

class RegisterPaymentUseCase extends UseCase {
  constructor(cobrosRepository) {
    super();
    this._cobrosRepository = cobrosRepository;
  }

  async execute({ clientCode, amount, paymentMethod, reference, observations, userId }) {
    if (!clientCode) {
      throw new PaymentError('clientCode is required', 'MISSING_CLIENT_CODE');
    }

    if (!paymentMethod) {
      throw new PaymentError('paymentMethod is required', 'MISSING_PAYMENT_METHOD');
    }

    if (!amount || amount <= 0) {
      throw new PaymentError('amount must be greater than 0', 'INVALID_AMOUNT');
    }

    logger.info(`RegisterPaymentUseCase: Registering payment for client ${clientCode}, amount ${amount}`);

    const result = await this._cobrosRepository.registerPayment({
      clientCode,
      amount,
      paymentMethod,
      reference,
      observations,
      userId
    });

    logger.info(`RegisterPaymentUseCase: Payment registered with id ${result.id}`);

    return result;
  }
}

module.exports = { RegisterPaymentUseCase, PaymentError };
