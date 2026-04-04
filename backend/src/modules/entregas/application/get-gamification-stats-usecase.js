/**
 * Get Gamification Stats Use Case - Entregas Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../middleware/logger');

class GetGamificationStatsUseCase extends UseCase {
  constructor(entregasRepository) {
    super();
    this._entregasRepository = entregasRepository;
  }

  async execute({ repartidorId }) {
    if (!repartidorId) {
      throw new Error('repartidorId is required');
    }

    logger.info(`GetGamificationStatsUseCase: Fetching gamification stats for repartidor ${repartidorId}`);

    const stats = await this._entregasRepository.getGamificationStats(repartidorId);

    logger.info(`GetGamificationStatsUseCase: Stats retrieved - level ${stats.level}, ${stats.totalDeliveries} deliveries`);

    return stats;
  }
}

module.exports = { GetGamificationStatsUseCase };
