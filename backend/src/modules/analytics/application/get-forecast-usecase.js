/**
 * Get Forecast Use Case - Analytics Domain
 * Returns sales predictions using linear regression
 */
const { UseCase } = require('../../../core/application/use-case');

class GetForecastUseCase extends UseCase {
  constructor(analyticsRepository) {
    super();
    this._repository = analyticsRepository;
  }

  async execute({ vendedorCodes, months = 3 }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const forecast = await this._repository.getForecast(vendedorCodes, months);

    return {
      predictions: forecast.predictions.map(p => ({
        metric: p.metric,
        predictedValue: p.predictedValue,
        confidence: p.confidence,
        lowerBound: p.lowerBound,
        upperBound: p.upperBound,
        method: p.method
      })),
      model: {
        slope: forecast.regression.slope,
        intercept: forecast.regression.intercept,
        r2: forecast.regression.r2,
        dataPoints: forecast.dataPoints
      },
      historical: forecast.historical || []
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetForecastUseCase, ValidationError };
