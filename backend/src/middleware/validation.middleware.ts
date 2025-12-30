/**
 * MIDDLEWARE DE VALIDACIÓN
 * Validación de inputs con Joi
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../utils/logger';

// Esquemas de validación
const schemas = {
  // Login - acepta tanto formato nuevo (usuario/password) como legacy (codigoCliente/nif)
  login: Joi.object({
    // Formato nuevo para comerciales
    usuario: Joi.string()
      .trim()
      .min(1)
      .max(20)
      .messages({
        'string.empty': 'El usuario es requerido',
        'string.min': 'El usuario debe tener al menos 1 carácter',
        'string.max': 'El usuario no puede exceder 20 caracteres',
      }),
    password: Joi.string()
      .trim()
      .min(1)
      .max(50)
      .messages({
        'string.empty': 'La contraseña es requerida',
      }),
    // Formato legacy
    codigoCliente: Joi.string()
      .trim()
      .min(1)
      .max(20)
      .messages({
        'string.empty': 'El código de cliente es requerido',
        'string.min': 'El código de cliente debe tener al menos 1 carácter',
        'string.max': 'El código de cliente no puede exceder 20 caracteres',
      }),
    codigoUsuario: Joi.string()
      .trim()
      .min(1)
      .max(20),
    nif: Joi.string()
      .trim()
      .min(1)
      .max(50)
      .messages({
        'string.empty': 'La contraseña es requerida',
      }),
  }).or('usuario', 'codigoCliente', 'codigoUsuario')  // Requiere al menos uno
    .or('password', 'nif'),  // Requiere al menos una contraseña

  // Refresh token
  refreshToken: Joi.object({
    refreshToken: Joi.string()
      .required()
      .messages({
        'any.required': 'El refresh token es requerido',
      }),
  }),

  // Productos
  productos: Joi.object({
    pagina: Joi.number().integer().min(1).default(1),
    limite: Joi.number().integer().min(1).max(200).default(100),
    busqueda: Joi.string().max(100).allow('').default(''),
    familia: Joi.string().max(20).allow(''),
  }),

  // Producto individual
  producto: Joi.object({
    codigo: Joi.string()
      .trim()
      .min(1)
      .max(20)
      .required(),
  }),

  // Actualizar contacto
  actualizarContacto: Joi.object({
    email: Joi.string()
      .email()
      .max(100)
      .allow('', null),
    telefono: Joi.string()
      .pattern(/^[0-9+\s-]+$/)
      .min(9)
      .max(20)
      .allow('', null),
  }).or('email', 'telefono'),

  // Crear presupuesto
  crearPresupuesto: Joi.object({
    lineas: Joi.array()
      .items(
        Joi.object({
          codigoArticulo: Joi.string().required(),
          descripcion: Joi.string().max(200),
          cantidad: Joi.number().min(0.001).required(),
          unidad: Joi.string().valid('kg', 'cajas', 'envases', 'unidades').default('unidades'),
          precioUnitario: Joi.number().min(0).required(),
          descuento: Joi.number().min(0).max(100).default(0),
          importeTotal: Joi.number().min(0).required(),
        })
      )
      .min(1)
      .required(),
    formaPago: Joi.string().max(20).required(),
    observaciones: Joi.string().max(500).allow(''),
  }),

  // Registrar cobro
  registrarCobro: Joi.object({
    referencia: Joi.string().max(50).required(),
    importe: Joi.number().min(0.01).required(),
    formaPago: Joi.string().max(20).required(),
    observaciones: Joi.string().max(500).allow(''),
  }),

  // Crear promoción
  crearPromocion: Joi.object({
    codigo: Joi.string().max(20).required(),
    nombre: Joi.string().max(100).required(),
    descripcion: Joi.string().max(500).allow(''),
    tipo: Joi.string().valid('simple', 'compuesta').required(),
    tipoAplicacion: Joi.string().valid('cliente_especifico', 'general').required(),
    fechaDesde: Joi.date().required(),
    fechaHasta: Joi.date().greater(Joi.ref('fechaDesde')).required(),
    prioridad: Joi.number().integer().min(1).max(100).default(10),
    condiciones: Joi.array().items(Joi.object()).required(),
    resultado: Joi.object().required(),
    clientesAplicables: Joi.array().items(Joi.string()),
  }),

  // Histórico de ventas
  historicoVentas: Joi.object({
    ano: Joi.number().integer().min(2000).max(2100),
    mes: Joi.number().integer().min(1).max(12),
    semana: Joi.number().integer().min(1).max(53),
    codigoArticulo: Joi.string().max(20),
    descripcion: Joi.string().max(100),
    fechaDesde: Joi.date(),
    fechaHasta: Joi.date(),
    pagina: Joi.number().integer().min(1).default(1),
    limite: Joi.number().integer().min(1).max(500).default(100),
  }),
};

/**
 * Factory para crear middleware de validación
 */
function createValidator(schemaName: keyof typeof schemas, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const schema = schemas[schemaName];
    const dataToValidate = source === 'body' ? req.body : source === 'query' ? req.query : req.params;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errores = error.details.map((detail) => ({
        campo: detail.path.join('.'),
        mensaje: detail.message,
      }));

      logger.warn('Validación fallida:', { schemaName, errores });

      res.status(400).json({
        success: false,
        error: 'Error de validación',
        errores,
      });
      return;
    }

    // Reemplazar datos con valores validados y transformados
    if (source === 'body') {
      req.body = value;
    } else if (source === 'query') {
      req.query = value;
    } else {
      req.params = value;
    }

    next();
  };
}

// Exportar validadores específicos
export const validateLogin = createValidator('login', 'body');
export const validateRefreshToken = createValidator('refreshToken', 'body');
export const validateProductos = createValidator('productos', 'query');
export const validateProducto = createValidator('producto', 'params');
export const validateActualizarContacto = createValidator('actualizarContacto', 'body');
export const validateCrearPresupuesto = createValidator('crearPresupuesto', 'body');
export const validateRegistrarCobro = createValidator('registrarCobro', 'body');
export const validateCrearPromocion = createValidator('crearPromocion', 'body');
export const validateHistoricoVentas = createValidator('historicoVentas', 'query');

// Validador genérico para esquemas personalizados
export function validate(schema: Joi.Schema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const dataToValidate = source === 'body' ? req.body : source === 'query' ? req.query : req.params;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      res.status(400).json({
        success: false,
        error: 'Error de validación',
        errores: error.details.map((d) => ({
          campo: d.path.join('.'),
          mensaje: d.message,
        })),
      });
      return;
    }

    if (source === 'body') req.body = value;
    else if (source === 'query') req.query = value;
    else req.params = value;

    next();
  };
}

export default {
  validateLogin,
  validateRefreshToken,
  validateProductos,
  validateProducto,
  validateActualizarContacto,
  validateCrearPresupuesto,
  validateRegistrarCobro,
  validateCrearPromocion,
  validateHistoricoVentas,
  validate,
};
