/**
 * Get Factura Detail Use Case - Facturas Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetFacturaDetailUseCase extends UseCase {
  constructor(facturasRepository) {
    super();
    this._repository = facturasRepository;
  }

  async execute({ serie, numero, ejercicio }) {
    if (!serie || !numero || !ejercicio) {
      throw new ValidationError('serie, numero and ejercicio are required');
    }

    const num = parseInt(numero);
    const ejer = parseInt(ejercicio);

    if (num >= 900000 || num <= 0) {
      throw new NotFoundError('Factura no encontrada');
    }

    const factura = await this._repository.getDetail(serie, num, ejer);

    if (!factura) {
      throw new NotFoundError('Factura no encontrada');
    }

    return factura;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

module.exports = { GetFacturaDetailUseCase, ValidationError, NotFoundError };
