/**
 * Get Commissions Use Case - Rutero Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class GetCommissionsUseCase extends UseCase {
  constructor(ruteroRepository) {
    super();
    this._ruteroRepository = ruteroRepository;
  }

  async execute({ vendorCode, date, role }) {
    if (!vendorCode) {
      throw new Error('vendorCode is required');
    }

    logger.info(`GetCommissionsUseCase: Fetching commissions for vendor ${vendorCode}`);

    const commissions = await this._ruteroRepository.getCommissions({ vendorCode, date, role });

    logger.info(`GetCommissionsUseCase: Found ${commissions.length} commission entries for vendor ${vendorCode}`);

    return commissions;
  }
}

module.exports = { GetCommissionsUseCase };
