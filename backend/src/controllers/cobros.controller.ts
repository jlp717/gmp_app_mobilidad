/**
 * CONTROLADOR DE COBROS
 * Maneja endpoints de cobros y presupuestos
 */

import { Request, Response } from 'express';
import { cobrosService } from '../services/cobros.service';
import { asyncHandler } from '../middleware/error.middleware';

/**
 * GET /api/cobros/:codigoCliente/pendientes
 * Obtener cobros pendientes del cliente
 */
export const obtenerCobrosPendientes = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente } = req.params;

  const pendientes = await cobrosService.obtenerCobrosPendientes(codigoCliente);

  res.json({
    success: true,
    cobros: pendientes,
    total: pendientes.length,
  });
});

/**
 * GET /api/cobros/:codigoCliente/resumen
 * Obtener resumen de cobros
 */
export const obtenerResumenCobros = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente } = req.params;

  const resumen = await cobrosService.obtenerResumenCobros(codigoCliente);

  res.json({
    success: true,
    resumen,
  });
});

/**
 * POST /api/cobros/:codigoCliente/registrar
 * Registrar un cobro
 */
export const registrarCobro = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente } = req.params;
  const { referencia, importe, formaPago, observaciones } = req.body;

  const resultado = await cobrosService.registrarCobro({
    codigoCliente,
    referencia,
    importe,
    formaPago,
    observaciones,
  });

  if (!resultado.success) {
    res.status(400).json(resultado);
    return;
  }

  res.status(201).json({
    success: true,
    mensaje: 'Cobro registrado correctamente',
  });
});

/**
 * GET /api/presupuestos/:codigoCliente
 * Obtener presupuestos del cliente
 */
export const obtenerPresupuestos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente } = req.params;

  const presupuestos = await cobrosService.obtenerPresupuestosCliente(codigoCliente);

  res.json({
    success: true,
    presupuestos,
    total: presupuestos.length,
  });
});

/**
 * POST /api/presupuestos/:codigoCliente
 * Crear un nuevo presupuesto
 */
export const crearPresupuesto = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigoCliente } = req.params;
  const { lineas, formaPago, observaciones } = req.body;

  const resultado = await cobrosService.crearPresupuesto({
    codigoCliente,
    tipo: 'presupuesto',
    lineas,
    formaPago,
    observaciones,
  });

  if (!resultado.success) {
    res.status(400).json(resultado);
    return;
  }

  res.status(201).json({
    success: true,
    mensaje: 'Presupuesto creado correctamente',
    presupuesto: resultado.presupuesto,
  });
});

/**
 * POST /api/presupuestos/:id/convertir
 * Convertir presupuesto a pedido
 */
export const convertirPresupuesto = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const resultado = await cobrosService.convertirPresupuestoAPedido(id);

  if (!resultado.success) {
    res.status(400).json(resultado);
    return;
  }

  res.json({
    success: true,
    mensaje: 'Presupuesto convertido a pedido',
    numeroPedido: resultado.numeroPedido,
  });
});

export default {
  obtenerCobrosPendientes,
  obtenerResumenCobros,
  registrarCobro,
  obtenerPresupuestos,
  crearPresupuesto,
  convertirPresupuesto,
};
