/**
 * SERVICIO DE PRODUCTOS
 * Gestión del catálogo de productos y precios personalizados
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { sanitizeCode, sanitizeSearch } from '../utils/validators';
import { toFloat, toInt, toStr, clampLimit, clampOffset, totalPages, formatNumericDate } from '../utils/db-helpers';
import { queryCache, TTL } from '../utils/query-cache';
import type { Producto, PaginatedResponse } from '../types/entities';

interface ObtenerProductosParams {
  pagina?: number;
  limite?: number;
  busqueda?: string;
  codigoCliente?: string;
  familia?: string;
}

interface FamiliaProducto {
  codigo: string;
  nombre: string;
  totalProductos: number;
}

class ProductsService {
  /**
   * Obtiene productos con paginación y filtros
   */
  async obtenerProductos(params: ObtenerProductosParams): Promise<PaginatedResponse<Producto>> {
    const cacheKey = `gmp:productos:${params.codigoCliente || 'all'}:${params.pagina || 1}:${params.limite || 100}:${params.busqueda || ''}:${params.familia || ''}`;
    return queryCache.getOrSet(cacheKey, () => this._fetchProductos(params), TTL.STATIC);
  }

  private async _fetchProductos(params: ObtenerProductosParams): Promise<PaginatedResponse<Producto>> {
    try {
      const {
        pagina = 1,
        limite = 100,
        busqueda = '',
        codigoCliente,
        familia,
      } = params;

      logger.info(`[PRODUCTOS] Obteniendo - Cliente: ${codigoCliente}, Búsqueda: ${busqueda}`);

      const paginaNum = Math.max(1, pagina);
      const limiteNum = clampLimit(limite, 100, 200);
      const offset = clampOffset((paginaNum - 1) * limiteNum);

      const whereConditions: string[] = [];
      const queryParams: unknown[] = [];

      // Filtro por cliente
      if (codigoCliente) {
        whereConditions.push(`TRIM(LAC.CODIGOCLIENTEFACTURA) = ?`);
        queryParams.push(sanitizeCode(codigoCliente));
      }

      // Filtro por búsqueda
      if (busqueda) {
        whereConditions.push(`(
          UPPER(TRIM(LAC.DESCRIPCION)) LIKE ? OR 
          UPPER(TRIM(LAC.CODIGOARTICULO)) LIKE ?
        )`);
        const searchTerm = `%${sanitizeSearch(busqueda)}%`;
        queryParams.push(searchTerm, searchTerm);
      }

      // Filtro por familia
      if (familia) {
        whereConditions.push(`TRIM(LAC.CODIGOSECCION) = ?`);
        queryParams.push(sanitizeCode(familia));
      }

      const whereClause = whereConditions.length > 0 
        ? 'WHERE ' + whereConditions.join(' AND ') 
        : '';

      // Query principal
      const query = `
        SELECT 
          TRIM(LAC.CODIGOARTICULO) AS codigo,
          MAX(LAC.DESCRIPCION) AS nombre,
          MAX(LAC.PRECIOVENTA) AS precio,
          MAX(LAC.PRECIOTARIFACLIENTE) AS precioTarifaCliente,
          MAX(LAC.PRECIOTARIFA01) AS precioTarifa01,
          MAX(LAC.PORCENTAJEDESCUENTO) AS descuentoPorcentaje,
          MAX(LAC.PORCENTAJEDESCUENTO02) AS descuentoPorcentaje2,
          MAX(LAC.CODIGOPROMOCIONREGALO) AS codigoPromocion,
          MAX(LAC.CODIGOIVA) AS codigoIva,
          MAX(LAC.CODIGOSECCION) AS familia,
          COUNT(*) AS vecesComprado,
          MAX(LAC.ANODOCUMENTO * 10000 + LAC.MESDOCUMENTO * 100 + LAC.DIADOCUMENTO) AS ultimaCompraNum
        FROM DSEDAC.LAC AS LAC
        ${whereClause}
        GROUP BY TRIM(LAC.CODIGOARTICULO)
        ORDER BY COUNT(*) DESC
        OFFSET ? ROWS
        FETCH NEXT ? ROWS ONLY
      `;

      // Ejecutar data + count en paralelo
      const countQuery = `
        SELECT COUNT(DISTINCT TRIM(LAC.CODIGOARTICULO)) AS TOTAL
        FROM DSEDAC.LAC AS LAC
        ${whereClause}
      `;

      const [productos, countResult] = await Promise.all([
        odbcPool.query<Record<string, unknown>[]>(query, [...queryParams, offset, limiteNum]),
        odbcPool.query<{ TOTAL: number }[]>(countQuery, queryParams),
      ]);
      const totalProductos = countResult[0]?.TOTAL || 0;

      // Formatear productos
      const productosFormateados = productos.map((prod) => this.formatearProducto(prod));

      return {
        success: true,
        data: productosFormateados,
        paginacion: {
          pagina: paginaNum,
          limite: limiteNum,
          total: totalProductos,
          totalPaginas: totalPages(totalProductos, limiteNum),
        },
      };
    } catch (error) {
      logger.error('[PRODUCTOS] Error obteniendo productos:', error);
      throw new Error(`Error obteniendo productos: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * Obtiene un producto específico
   */
  async obtenerProducto(
    codigoArticulo: string, 
    codigoCliente?: string
  ): Promise<{ success: boolean; producto?: Producto; error?: string }> {
    try {
      logger.info(`[PRODUCTO] Obteniendo ${codigoArticulo} para cliente ${codigoCliente}`);

      const whereConditions = [`TRIM(LAC.CODIGOARTICULO) = ?`];
      const params: unknown[] = [sanitizeCode(codigoArticulo)];

      if (codigoCliente) {
        whereConditions.push(`TRIM(LAC.CODIGOCLIENTEFACTURA) = ?`);
        params.push(sanitizeCode(codigoCliente));
      }

      const query = `
        SELECT 
          TRIM(LAC.CODIGOARTICULO) AS codigo,
          TRIM(MAX(LAC.DESCRIPCION)) AS nombre,
          MAX(LAC.PRECIOVENTA) AS precio,
          MAX(LAC.PRECIOTARIFACLIENTE) AS precioTarifaCliente,
          MAX(LAC.PRECIOTARIFA01) AS precioTarifa01,
          MAX(LAC.PORCENTAJEDESCUENTO) AS descuentoPorcentaje,
          MAX(LAC.PORCENTAJEDESCUENTO02) AS descuentoPorcentaje2,
          MAX(LAC.CODIGOPROMOCIONREGALO) AS codigoPromocion,
          MAX(LAC.CODIGOIVA) AS codigoIva,
          MAX(LAC.CODIGOSECCION) AS familia,
          MAX(LAC.CANTIDADUNIDADES) AS unidadesUltima,
          MAX(LAC.CANTIDADENVASES) AS envasesUltimos,
          COUNT(*) AS vecesComprado,
          MAX(LAC.ANODOCUMENTO * 10000 + LAC.MESDOCUMENTO * 100 + LAC.DIADOCUMENTO) AS ultimaCompraNum
        FROM DSEDAC.LAC AS LAC
        WHERE ${whereConditions.join(' AND ')}
        GROUP BY TRIM(LAC.CODIGOARTICULO)
      `;

      const resultado = await odbcPool.query<Record<string, unknown>[]>(query, params);

      if (resultado.length === 0) {
        return { success: false, error: 'Producto no encontrado' };
      }

      const producto = this.formatearProducto(resultado[0], true);
      return { success: true, producto };
    } catch (error) {
      logger.error('[PRODUCTO] Error obteniendo producto:', error);
      throw error;
    }
  }

  /**
   * Obtiene familias/categorías de productos
   */
  async obtenerFamilias(codigoCliente?: string): Promise<{ success: boolean; familias: FamiliaProducto[] }> {
    return queryCache.getOrSet(
      `gmp:productos:familias:${codigoCliente || 'all'}`,
      () => this._fetchFamilias(codigoCliente),
      TTL.STATIC
    );
  }

  private async _fetchFamilias(codigoCliente?: string): Promise<{ success: boolean; familias: FamiliaProducto[] }> {
    try {
      const whereConditions: string[] = [];
      const params: unknown[] = [];

      if (codigoCliente) {
        whereConditions.push(`TRIM(LAC.CODIGOCLIENTEFACTURA) = ?`);
        params.push(sanitizeCode(codigoCliente));
      }

      const whereClause = whereConditions.length > 0 
        ? 'WHERE ' + whereConditions.join(' AND ') 
        : '';

      const query = `
        SELECT 
          TRIM(LAC.CODIGOSECCION) AS codigo,
          COUNT(DISTINCT LAC.CODIGOARTICULO) AS totalProductos
        FROM DSEDAC.LAC AS LAC
        ${whereClause}
        AND LAC.CODIGOSECCION IS NOT NULL
        AND LAC.CODIGOSECCION <> ''
        GROUP BY TRIM(LAC.CODIGOSECCION)
        ORDER BY totalProductos DESC
        FETCH FIRST 50 ROWS ONLY
      `;

      const resultado = await odbcPool.query<Record<string, unknown>[]>(query, params);

      const familias: FamiliaProducto[] = resultado.map((row) => ({
        codigo: toStr(row.CODIGO),
        nombre: toStr(row.CODIGO) || 'Sin categoría',
        totalProductos: toInt(row.TOTALPRODUCTOS),
      }));

      return { success: true, familias };
    } catch (error) {
      logger.error('[FAMILIAS] Error obteniendo familias:', error);
      return { success: true, familias: [] };
    }
  }

  /**
   * Obtiene productos públicos (sin precios personalizados)
   */
  async obtenerProductosPublicos(params: ObtenerProductosParams): Promise<PaginatedResponse<Producto>> {
    // Para productos públicos, no pasamos codigoCliente
    return this.obtenerProductos({ ...params, codigoCliente: undefined });
  }

  // ============================================
  // MÉTODOS PRIVADOS
  // ============================================

  private formatearProducto(prod: Record<string, unknown>, detallado = false): Producto {
    const precio = toFloat(prod.PRECIO);
    const precioTarifaCliente = toFloat(prod.PRECIOTARIFACLIENTE);
    const precioTarifa01 = toFloat(prod.PRECIOTARIFA01);
    const descuento1 = toFloat(prod.DESCUENTOPORCENTAJE);
    const descuento2 = toFloat(prod.DESCUENTOPORCENTAJE2);

    // Calcular precio final
    let precioFinal = precio || precioTarifaCliente || precioTarifa01 || 0;

    if (descuento1 > 0) {
      precioFinal = precioFinal * (1 - descuento1 / 100);
    }
    if (descuento2 > 0) {
      precioFinal = precioFinal * (1 - descuento2 / 100);
    }

    const codigoPromocion = toStr(prod.CODIGOPROMOCION);

    const producto: Producto = {
      id: toStr(prod.CODIGO),
      codigo: toStr(prod.CODIGO),
      nombre: toStr(prod.NOMBRE) || 'Producto sin nombre',
      descripcion: toStr(prod.NOMBRE) || 'Sin descripción',
      precio: parseFloat(precioFinal.toFixed(2)),
      precioOriginal: parseFloat(precio.toFixed(2)),
      descuento: descuento1 + descuento2,
      codigoIva: toStr(prod.CODIGOIVA),
      porcentajeIva: 10, // Por defecto, debería obtenerse de la tabla IVA
      familia: toStr(prod.FAMILIA),
      stock: 999,
      disponible: true,
      promocion: codigoPromocion
        ? { codigo: codigoPromocion, activa: true }
        : undefined,
      metadata: {
        vecesComprado: Number(prod.VECESCOMPRADO) || 0,
        ultimaCompra: formatNumericDate(Number(prod.ULTIMACOMPRANUMA)),
      },
    };

    if (detallado) {
      producto.metadata = {
        ...producto.metadata,
        unidadesUltimas: Number(prod.UNIDADESULTIMA) || 0,
        envasesUltimos: Number(prod.ENVASESULTIMOS) || 0,
      };
    }

    return producto;
  }

}

export const productsService = new ProductsService();
export default productsService;
