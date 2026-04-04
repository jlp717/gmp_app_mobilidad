/**
 * Cobros Module - DDD Entry Point
 */
const { Cobro } = require('./domain/cobro');
const { CobrosRepository } = require('./domain/cobros-repository');
const { Db2CobrosRepository } = require('./infrastructure/db2-cobros-repository');
const { GetPendientesUseCase } = require('./application/get-pendientes-usecase');
const { RegisterPaymentUseCase, PaymentError } = require('./application/register-payment-usecase');

module.exports = {
  Cobro,
  CobrosRepository,
  Db2CobrosRepository,
  GetPendientesUseCase,
  RegisterPaymentUseCase,
  PaymentError
};
