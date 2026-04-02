/**
 * Entregas Module - DDD Entry Point
 */
const { Albaran } = require('./domain/albaran');
const { EntregasRepository } = require('./domain/entregas-repository');
const { Db2EntregasRepository } = require('./infrastructure/db2-entregas-repository');
const { GetAlbaranesUseCase } = require('./application/get-albaranes-usecase');
const { MarkDeliveredUseCase, DeliveryError } = require('./application/mark-delivered-usecase');
const { GetGamificationStatsUseCase } = require('./application/get-gamification-stats-usecase');

module.exports = {
  Albaran,
  EntregasRepository,
  Db2EntregasRepository,
  GetAlbaranesUseCase,
  MarkDeliveredUseCase,
  DeliveryError,
  GetGamificationStatsUseCase
};
