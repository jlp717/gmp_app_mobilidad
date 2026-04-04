/**
 * Get Active Alerts Use Case - KPI Alerts Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetActiveAlertsUseCase extends UseCase {
  constructor(kpiAlertRepository) {
    super();
    this._repository = kpiAlertRepository;
  }

  async execute({ vendorCodes }) {
    const alerts = await this._repository.getActiveAlerts(vendorCodes);

    return {
      alerts: alerts.map(a => ({
        id: a.id,
        type: a.type,
        threshold: a.threshold,
        current: a.current,
        triggered: a.isTriggered,
        deviation: a.deviation,
        message: a.message,
        createdAt: a.createdAt
      })),
      total: alerts.length,
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

module.exports = { GetActiveAlertsUseCase, ValidationError };
