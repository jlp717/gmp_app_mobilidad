/**
 * Get Day Plan Use Case - Planner Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetDayPlanUseCase extends UseCase {
  constructor(plannerRepository) {
    super();
    this._repository = plannerRepository;
  }

  async execute({ date, vendorCodes }) {
    if (!date) {
      throw new ValidationError('date is required');
    }
    if (!vendorCodes) {
      throw new ValidationError('vendorCodes is required');
    }

    const plans = await this._repository.getDayPlan(date, vendorCodes);
    const pendingOrders = await this._repository.getPendingOrders(date, vendorCodes);

    return {
      date,
      plans: plans.map(p => ({
        id: p.id,
        vehicle: p.vehicle,
        vendor: p.vendor,
        orders: p.orders,
        weight: p.weight,
        volume: p.volume,
        status: p.status,
        notes: p.notes
      })),
      pendingOrders,
      totalPlans: plans.length,
      totalPending: pendingOrders.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetDayPlanUseCase, ValidationError };
