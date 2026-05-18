/**
 * Get Albaranes Use Case - Entregas Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class GetAlbaranesUseCase extends UseCase {
  constructor(entregasRepository) {
    super();
    this._entregasRepository = entregasRepository;
  }

  async execute({ repartidorId, date, status }) {
    if (!repartidorId) {
      throw new Error('repartidorId is required');
    }

    logger.info(`GetAlbaranesUseCase: Fetching albaranes for repartidor ${repartidorId}`);

    const albaranes = await this._entregasRepository.getAlbaranes({ repartidorId, date, status });

    logger.info(`GetAlbaranesUseCase: Found ${albaranes.length} albaranes for repartidor ${repartidorId}`);

    return albaranes;
  }
}

module.exports = { GetAlbaranesUseCase };
