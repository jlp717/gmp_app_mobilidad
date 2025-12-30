/**
 * CONTROLADOR DE PRODUCTOS
 * Maneja endpoints del catálogo de productos
 */

import { Request, Response } from 'express';
import { productsService } from '../services/products.service';
import { asyncHandler } from '../middleware/error.middleware';

/**
 * GET /api/productos
 * Obtener productos con paginación y filtros
 */
export const obtenerProductos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { pagina, limite, busqueda, familia } = req.query;
  const codigoVendedor = req.user?.codigoVendedor;

  const resultado = await productsService.obtenerProductos({
    pagina: pagina ? parseInt(pagina as string) : undefined,
    limite: limite ? parseInt(limite as string) : undefined,
    busqueda: busqueda as string,
    familia: familia as string,
    codigoCliente: codigoVendedor, // Pasamos código vendedor, el service lo usa para filtrar
  });

  res.json(resultado);
});

/**
 * GET /api/productos/:codigo
 * Obtener un producto específico
 */
export const obtenerProducto = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;
  const codigoVendedor = req.user?.codigoVendedor;

  const resultado = await productsService.obtenerProducto(codigo, codigoVendedor);

  if (!resultado.success) {
    res.status(404).json(resultado);
    return;
  }

  res.json(resultado);
});

/**
 * GET /api/productos/familias
 * Obtener familias/categorías de productos
 */
export const obtenerFamilias = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const codigoVendedor = req.user?.codigoVendedor;

  const resultado = await productsService.obtenerFamilias(codigoVendedor);

  res.json(resultado);
});

/**
 * GET /api/public/productos
 * Obtener productos públicos (sin precios personalizados)
 */
export const obtenerProductosPublicos = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { pagina, limite, busqueda, familia } = req.query;

  const resultado = await productsService.obtenerProductosPublicos({
    pagina: pagina ? parseInt(pagina as string) : undefined,
    limite: limite ? parseInt(limite as string) : undefined,
    busqueda: busqueda as string,
    familia: familia as string,
  });

  res.json(resultado);
});

/**
 * GET /api/public/productos/familias
 * Obtener familias públicas
 */
export const obtenerFamiliasPublicas = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const resultado = await productsService.obtenerFamilias();
  res.json(resultado);
});

/**
 * GET /api/public/productos/:codigo
 * Obtener producto público
 */
export const obtenerProductoPublico = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { codigo } = req.params;

  const resultado = await productsService.obtenerProducto(codigo);

  if (!resultado.success) {
    res.status(404).json(resultado);
    return;
  }

  res.json(resultado);
});

export default {
  obtenerProductos,
  obtenerProducto,
  obtenerFamilias,
  obtenerProductosPublicos,
  obtenerFamiliasPublicas,
  obtenerProductoPublico,
};
