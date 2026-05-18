/**
 * Check KPI Alerts Use Case - KPI Alerts Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class CheckKpiAlertsUseCase extends UseCase {
  constructor(kpiAlertRepository) {
    super();
    this._repository = kpiAlertRepository;
  }

  async execute({ vendorCodes, year, month }) {
    if (!vendorCodes) {
      throw new ValidationError('vendorCodes is required');
    }

    const alerts = await this._repository.checkAlerts(vendorCodes, year, month);
    const kpiData = await this._repository.getKpiData(vendorCodes, year, month);

    return {
      alerts,
      kpiData: {
        sales: kpiData.sales,
        margin: kpiData.margin,
        orders: kpiData.orders,
        clients: kpiData.clients,
        marginPercent: kpiData.marginPercent,
        salesDeviation: kpiData.salesDeviation,
        marginDeviation: kpiData.marginDeviation,
        orderDeviation: kpiData.orderDeviation,
        topClientShare: kpiData.topClientShare
      },
      alertCount: alerts.length,
      hasAlerts: alerts.length > 0
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { CheckKpiAlertsUseCase, ValidationError };
