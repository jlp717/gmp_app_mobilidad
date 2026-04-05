/**
 * Get Ruta Config Use Case - Rutero Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class GetRutaConfigUseCase extends UseCase {
  constructor(ruteroRepository) {
    super();
    this._ruteroRepository = ruteroRepository;
  }

  async execute({ vendorCode, date }) {
    if (!vendorCode) {
      throw new Error('vendorCode is required');
    }

    logger.info(`GetRutaConfigUseCase: Fetching ruta config for vendor ${vendorCode}`);

    const config = await this._ruteroRepository.getRutaConfig({ vendorCode, date });

    logger.info(`GetRutaConfigUseCase: Found ${config.length} route entries for vendor ${vendorCode}`);

    return config;
  }
}

module.exports = { GetRutaConfigUseCase };
