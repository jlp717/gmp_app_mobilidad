/**
 * Get Pendientes Use Case - Cobros Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../middleware/logger');

class GetPendientesUseCase extends UseCase {
  constructor(cobrosRepository) {
    super();
    this._cobrosRepository = cobrosRepository;
  }

  async execute({ clientCode }) {
    if (!clientCode) {
      throw new Error('clientCode is required');
    }

    logger.info(`GetPendientesUseCase: Fetching pendientes for client ${clientCode}`);

    const pendientes = await this._cobrosRepository.getPendientes(clientCode);

    logger.info(`GetPendientesUseCase: Found ${pendientes.length} pendientes for client ${clientCode}`);

    return pendientes;
  }
}

module.exports = { GetPendientesUseCase };
