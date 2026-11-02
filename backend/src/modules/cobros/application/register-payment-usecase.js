/**
 * Register Payment Use Case - Cobros Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');
const {
  normalizeCommercialActor,
  normalizeCommercialPaymentInput,
} = require('../domain/commercial-payment-contract');

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

  async execute({
    clientCode,
    amount,
    paymentMethod,
    reference,
    observations,
    userId,
    userRole,
    idempotencyToken,
  }) {
    const actor = normalizeCommercialActor({ userId, userRole });
    const payment = normalizeCommercialPaymentInput({
      clientCode,
      amount,
      paymentMethod,
      reference,
      observations,
    });

    logger.info(`RegisterPaymentUseCase: Registering payment for client ${payment.clientCode}, amount ${payment.amount}`);

    const result = await this._cobrosRepository.registerPayment({
      clientCode: payment.clientCode,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      reference: payment.reference,
      observations: payment.observations,
      userId: actor.userId,
      userRole: actor.userRole,
      idempotencyToken,
    });

    logger.info(`RegisterPaymentUseCase: Payment registered with id ${result.id}`);

    return result;
  }
}

module.exports = { RegisterPaymentUseCase, PaymentError };
