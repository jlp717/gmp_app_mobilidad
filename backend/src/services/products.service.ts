/**
 * SERVICIO DE PRODUCTOS
 * Gestión del catálogo de productos y precios personalizados
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
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
      const limiteNum = Math.min(200, Math.max(1, limite));
      const offset = (paginaNum - 1) * limiteNum;

      const whereConditions: string[] = [];
      const queryParams: unknown[] = [];

      // Filtro por cliente
      if (codigoCliente) {
        whereConditions.push(`TRIM(LAC.CODIGOCLIENTEFACTURA) = ?`);
        queryParams.push(this.sanitizarCodigo(codigoCliente));
      }

      // Filtro por búsqueda
      if (busqueda) {
        whereConditions.push(`(
          UPPER(TRIM(LAC.DESCRIPCION)) LIKE ? OR 
          UPPER(TRIM(LAC.CODIGOARTICULO)) LIKE ?
        )`);
        const searchTerm = `%${this.sanitizarBusqueda(busqueda)}%`;
        queryParams.push(searchTerm, searchTerm);
      }

      // Filtro por familia
      if (familia) {
        whereConditions.push(`TRIM(LAC.CODIGOSECCION) = ?`);
        queryParams.push(this.sanitizarCodigo(familia));
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
        OFFSET ${offset} ROWS
        FETCH NEXT ${limiteNum} ROWS ONLY
      `;

      const productos = await odbcPool.query<Record<string, unknown>[]>(query, queryParams);

      // Contar total
      const countQuery = `
        SELECT COUNT(DISTINCT TRIM(LAC.CODIGOARTICULO)) AS TOTAL
        FROM DSEDAC.LAC AS LAC
        ${whereClause}
      `;

      const countResult = await odbcPool.query<{ TOTAL: number }[]>(countQuery, queryParams);
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
          totalPaginas: Math.ceil(totalProductos / limiteNum),
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
      const params: unknown[] = [this.sanitizarCodigo(codigoArticulo)];

      if (codigoCliente) {
        whereConditions.push(`TRIM(LAC.CODIGOCLIENTEFACTURA) = ?`);
        params.push(this.sanitizarCodigo(codigoCliente));
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
    try {
      const whereConditions: string[] = [];
      const params: unknown[] = [];

      if (codigoCliente) {
        whereConditions.push(`TRIM(LAC.CODIGOCLIENTEFACTURA) = ?`);
        params.push(this.sanitizarCodigo(codigoCliente));
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
        codigo: String(row.CODIGO || ''),
        nombre: String(row.CODIGO || 'Sin categoría'),
        totalProductos: Number(row.TOTALPRODUCTOS) || 0,
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
    const precio = parseFloat(String(prod.PRECIO)) || 0;
    const precioTarifaCliente = parseFloat(String(prod.PRECIOTARIFACLIENTE)) || 0;
    const precioTarifa01 = parseFloat(String(prod.PRECIOTARIFA01)) || 0;
    const descuento1 = parseFloat(String(prod.DESCUENTOPORCENTAJE)) || 0;
    const descuento2 = parseFloat(String(prod.DESCUENTOPORCENTAJE2)) || 0;

    // Calcular precio final
    let precioFinal = precio || precioTarifaCliente || precioTarifa01 || 0;

    if (descuento1 > 0) {
      precioFinal = precioFinal * (1 - descuento1 / 100);
    }
    if (descuento2 > 0) {
      precioFinal = precioFinal * (1 - descuento2 / 100);
    }

    const codigoPromocion = String(prod.CODIGOPROMOCION || '').trim();

    const producto: Producto = {
      id: String(prod.CODIGO || ''),
      codigo: String(prod.CODIGO || ''),
      nombre: String(prod.NOMBRE || 'Producto sin nombre'),
      descripcion: String(prod.NOMBRE || 'Sin descripción'),
      precio: parseFloat(precioFinal.toFixed(2)),
      precioOriginal: parseFloat(precio.toFixed(2)),
      descuento: descuento1 + descuento2,
      codigoIva: String(prod.CODIGOIVA || ''),
      porcentajeIva: 10, // Por defecto, debería obtenerse de la tabla IVA
      familia: String(prod.FAMILIA || ''),
      stock: 999,
      disponible: true,
      promocion: codigoPromocion
        ? { codigo: codigoPromocion, activa: true }
        : undefined,
      metadata: {
        vecesComprado: Number(prod.VECESCOMPRADO) || 0,
        ultimaCompra: this.formatearFecha(Number(prod.ULTIMACOMPRANUMA)),
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

  private sanitizarCodigo(codigo: string): string {
    return String(codigo)
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .substring(0, 20);
  }

  private sanitizarBusqueda(busqueda: string): string {
    return String(busqueda)
      .replace(/[';\-\-]/g, '')
      .substring(0, 100)
      .toUpperCase();
  }

  private formatearFecha(numeroFecha: number): string | undefined {
    if (!numeroFecha) return undefined;
    const str = String(numeroFecha);
    if (str.length < 8) return undefined;
    return `${str.substring(6, 8)}/${str.substring(4, 6)}/${str.substring(0, 4)}`;
  }
}

export const productsService = new ProductsService();
export default productsService;
