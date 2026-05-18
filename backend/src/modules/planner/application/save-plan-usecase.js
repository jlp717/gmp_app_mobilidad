/**
 * Save Plan Use Case - Planner Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class SavePlanUseCase extends UseCase {
  constructor(plannerRepository) {
    super();
    this._repository = plannerRepository;
  }

  async execute({ vehicle, date, vendor, orders, weight, volume, status, notes }) {
    if (!vehicle || !date) {
      throw new ValidationError('vehicle and date are required');
    }

    const plan = {
      id: null,
      vehicle,
      date,
      vendor: vendor || '',
      orders: orders || [],
      weight: parseFloat(weight) || 0,
      volume: parseFloat(volume) || 0,
      status: status || 'PENDING',
      notes: notes || ''
    };

    const result = await this._repository.savePlan(plan);

    return {
      success: result.success,
      vehicle,
      date,
      orderCount: plan.orders.length,
      weight: plan.weight,
      volume: plan.volume
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { SavePlanUseCase, ValidationError };
