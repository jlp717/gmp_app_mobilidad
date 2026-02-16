/**
 * SERVICIO DE VENTAS - Histórico y Estadísticas
 *
 * Maneja consultas de histórico de ventas y estadísticas
 * desde la vista LACLAE del IBM i
 *
 * SECURITY: All queries use parameterized placeholders (?).
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toFloat, toInt, toStr, clampLimit, clampOffset, currentPage } from '../utils/db-helpers';
import { queryCache, TTL } from '../utils/query-cache';

export interface VentaItem {
  numeroDocumento: string;
  fecha: string;
  codigoCliente: string;
  nombreCliente: string;
  codigoArticulo: string;
  descripcionArticulo: string;
  cantidad: number;
  precioUnitario: number;
  importeTotal: number;
  categoria: string;
  comercial: string;
}

export interface VentasHistoricoParams {
  codigoCliente?: string;
  codigoProducto?: string;
  desde?: string;
  hasta?: string;
  comercial?: string;
  limit?: number;
  offset?: number;
}

export interface EstadisticasParams {
  tipo?: 'diario' | 'semanal' | 'mensual' | 'anual';
  desde?: string;
  hasta?: string;
  codigoCliente?: string;
  codigoProducto?: string;
  comercial?: string;
  agrupacion?: 'cliente' | 'producto' | 'categoria' | 'comercial';
}

export interface EstadisticaItem {
  etiqueta: string;
  valor: number;
  cantidad: number;
  porcentaje?: number;
}

/**
 * Helper: builds parameterized conditions for ventas filters.
 * Extracts the repeated pattern from getHistorico/getEstadisticas/getVentasSemanales.
 */
function buildVentasConditions(params: {
  codigoCliente?: string;
  codigoProducto?: string;
  desde?: string;
  hasta?: string;
  comercial?: string;
}): { conditions: string[]; queryParams: unknown[] } {
  const conditions: string[] = [
    "TIPO_LINEA = 'T'",
    "CLASE_LINEA = 'VT'",
  ];
  const queryParams: unknown[] = [];

  if (params.codigoCliente) {
    conditions.push('CODIGO_CLIENTE_ALBARAN = ?');
    queryParams.push(params.codigoCliente);
  }

  if (params.codigoProducto) {
    conditions.push('CODIGO_ARTICULO = ?');
    queryParams.push(params.codigoProducto);
  }

  if (params.desde) {
    conditions.push('FECHA_ALBARAN >= ?');
    queryParams.push(params.desde);
  }

  if (params.hasta) {
    conditions.push('FECHA_ALBARAN <= ?');
    queryParams.push(params.hasta);
  }

  if (params.comercial) {
    conditions.push('CODIGO_COMERCIAL = ?');
    queryParams.push(params.comercial);
  }

  return { conditions, queryParams };
}

class VentasService {
  /**
   * Obtiene el histórico de ventas con filtros
   */
  async getHistorico(params: VentasHistoricoParams): Promise<{
    data: VentaItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const cacheKey = `gmp:ventas:historico:${params.codigoCliente || ''}:${params.codigoProducto || ''}:${params.desde || ''}:${params.hasta || ''}:${params.comercial || ''}:${params.limit || ''}:${params.offset || ''}`;
    return queryCache.getOrSet(cacheKey, () => this._fetchHistorico(params), TTL.SHORT);
  }

  private async _fetchHistorico(params: VentasHistoricoParams): Promise<{
    data: VentaItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    try {
      const { conditions, queryParams } = buildVentasConditions(params);

      const limit = clampLimit(params.limit);
      const offset = clampOffset(params.offset);

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      // Query para contar total (same params)
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM DSED.LACLAE
        ${whereClause}
      `;

      // Query principal con paginación (params + offset + limit)
      const dataQuery = `
        SELECT
          NUMERO_DOCUMENTO AS numeroDocumento,
          FECHA_ALBARAN AS fecha,
          CODIGO_CLIENTE_ALBARAN AS codigoCliente,
          NOMBRE_CLIENTE AS nombreCliente,
          CODIGO_ARTICULO AS codigoArticulo,
          DESCRIPCION AS descripcionArticulo,
          CANTIDAD AS cantidad,
          PRECIO_UNITARIO AS precioUnitario,
          IMPORTE_LINEA AS importeTotal,
          CODIGO_FILTRO AS categoria,
          CODIGO_COMERCIAL AS comercial
        FROM DSED.LACLAE
        ${whereClause}
        ORDER BY FECHA_ALBARAN DESC, NUMERO_DOCUMENTO DESC
        OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
      `;

      const [countResult, dataResult] = await Promise.all([
        odbcPool.query<any[]>(countQuery, queryParams),
        odbcPool.query<any[]>(dataQuery, [...queryParams, offset, limit]),
      ]);

      const total = countResult[0]?.TOTAL || 0;

      const data: VentaItem[] = dataResult.map((row: any) => ({
        numeroDocumento: toStr(row.NUMERODOCUMENTO),
        fecha: toStr(row.FECHA),
        codigoCliente: toStr(row.CODIGOCLIENTE),
        nombreCliente: toStr(row.NOMBRECLIENTE),
        codigoArticulo: toStr(row.CODIGOARTICULO),
        descripcionArticulo: toStr(row.DESCRIPCIONARTICULO),
        cantidad: toFloat(row.CANTIDAD),
        precioUnitario: toFloat(row.PRECIOUNITARIO),
        importeTotal: toFloat(row.IMPORTETOTAL),
        categoria: toStr(row.CATEGORIA),
        comercial: toStr(row.COMERCIAL),
      }));

      return {
        data,
        total,
        page: currentPage(offset, limit),
        pageSize: limit,
      };
    } catch (error) {
      logger.error('Error obteniendo histórico de ventas:', error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de ventas para gráficas
   */
  async getEstadisticas(params: EstadisticasParams): Promise<{
    resumen: {
      totalVentas: number;
      totalUnidades: number;
      promedioVenta: number;
      numeroOperaciones: number;
    };
    datos: EstadisticaItem[];
  }> {
    const cacheKey = `gmp:ventas:stats:${params.codigoCliente || ''}:${params.codigoProducto || ''}:${params.desde || ''}:${params.hasta || ''}:${params.comercial || ''}:${(params as any).agrupacion || ''}`;
    return queryCache.getOrSet(cacheKey, () => this._fetchEstadisticas(params), TTL.SHORT);
  }

  private async _fetchEstadisticas(params: EstadisticasParams): Promise<{
    resumen: {
      totalVentas: number;
      totalUnidades: number;
      promedioVenta: number;
      numeroOperaciones: number;
    };
    datos: EstadisticaItem[];
  }> {
    try {
      const { conditions, queryParams } = buildVentasConditions(params);

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      // Query de resumen general
      const resumenQuery = `
        SELECT
          COALESCE(SUM(IMPORTE_LINEA), 0) AS totalVentas,
          COALESCE(SUM(CANTIDAD), 0) AS totalUnidades,
          COALESCE(AVG(IMPORTE_LINEA), 0) AS promedioVenta,
          COUNT(DISTINCT NUMERO_DOCUMENTO) AS numeroOperaciones
        FROM DSED.LACLAE
        ${whereClause}
      `;

      // Query de agrupación según parámetro
      let groupByField: string;
      let labelField: string;

      switch (params.agrupacion) {
        case 'cliente':
          groupByField = 'CODIGO_CLIENTE_ALBARAN';
          labelField = 'NOMBRE_CLIENTE';
          break;
        case 'producto':
          groupByField = 'CODIGO_ARTICULO';
          labelField = 'DESCRIPCION';
          break;
        case 'categoria':
          groupByField = 'CODIGO_FILTRO';
          labelField = 'DESC_FILTRO';
          break;
        case 'comercial':
          groupByField = 'CODIGO_COMERCIAL';
          labelField = 'CODIGO_COMERCIAL';
          break;
        default:
          groupByField = 'FECHA_ALBARAN';
          labelField = 'FECHA_ALBARAN';
      }

      const groupByClause = labelField !== groupByField
        ? `GROUP BY ${groupByField}, ${labelField}`
        : `GROUP BY ${groupByField}`;

      const datosQuery = `
        SELECT
          ${labelField} AS etiqueta,
          COALESCE(SUM(IMPORTE_LINEA), 0) AS valor,
          COALESCE(SUM(CANTIDAD), 0) AS cantidad
        FROM DSED.LACLAE
        ${whereClause}
        ${groupByClause}
        ORDER BY valor DESC
        FETCH FIRST 20 ROWS ONLY
      `;

      // Both queries use the same params for the WHERE clause
      const [resumenResult, datosResult] = await Promise.all([
        odbcPool.query<any[]>(resumenQuery, queryParams),
        odbcPool.query<any[]>(datosQuery, [...queryParams]),
      ]);

      const resumen = {
        totalVentas: toFloat(resumenResult[0]?.TOTALVENTAS),
        totalUnidades: toFloat(resumenResult[0]?.TOTALUNIDADES),
        promedioVenta: toFloat(resumenResult[0]?.PROMEDIOVENTA),
        numeroOperaciones: toInt(resumenResult[0]?.NUMEROOPERACIONES),
      };

      // Calcular porcentajes
      const datos: EstadisticaItem[] = datosResult.map((row: any) => {
        const valor = toFloat(row.VALOR);
        return {
          etiqueta: toStr(row.ETIQUETA) || 'Sin categoría',
          valor,
          cantidad: toFloat(row.CANTIDAD),
          porcentaje: resumen.totalVentas > 0
            ? Math.round((valor / resumen.totalVentas) * 10000) / 100
            : 0,
        };
      });

      return { resumen, datos };
    } catch (error) {
      logger.error('Error obteniendo estadísticas de ventas:', error);
      throw error;
    }
  }

  /**
   * Obtiene las ventas por semanas (para gráficas de líneas)
   */
  async getVentasSemanales(params: {
    semanas?: number;
    codigoCliente?: string;
    comercial?: string;
  }): Promise<{
    semanas: Array<{
      semana: string;
      fechaInicio: string;
      fechaFin: string;
      totalVentas: number;
      totalUnidades: number;
      numeroOperaciones: number;
    }>;
  }> {
    const cacheKey = `gmp:ventas:semanales:${params.codigoCliente || ''}:${params.comercial || ''}:${params.semanas || 12}`;
    return queryCache.getOrSet(cacheKey, () => this._fetchVentasSemanales(params), TTL.MEDIUM);
  }

  private async _fetchVentasSemanales(params: {
    semanas?: number;
    codigoCliente?: string;
    comercial?: string;
  }): Promise<{
    semanas: Array<{
      semana: string;
      fechaInicio: string;
      fechaFin: string;
      totalVentas: number;
      totalUnidades: number;
      numeroOperaciones: number;
    }>;
  }> {
    try {
      const numSemanas = clampLimit(params.semanas, 12, 52);

      const conditions: string[] = [
        "TIPO_LINEA = 'T'",
        "CLASE_LINEA = 'VT'",
        'FECHA_ALBARAN >= CURRENT_DATE - ? DAYS',
      ];
      const queryParams: unknown[] = [numSemanas * 7];

      if (params.codigoCliente) {
        conditions.push('CODIGO_CLIENTE_ALBARAN = ?');
        queryParams.push(params.codigoCliente);
      }

      if (params.comercial) {
        conditions.push('CODIGO_COMERCIAL = ?');
        queryParams.push(params.comercial);
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const query = `
        SELECT
          WEEK(FECHA_ALBARAN) AS numSemana,
          MIN(FECHA_ALBARAN) AS fechaInicio,
          MAX(FECHA_ALBARAN) AS fechaFin,
          COALESCE(SUM(IMPORTE_LINEA), 0) AS totalVentas,
          COALESCE(SUM(CANTIDAD), 0) AS totalUnidades,
          COUNT(DISTINCT NUMERO_DOCUMENTO) AS numeroOperaciones
        FROM DSED.LACLAE
        ${whereClause}
        GROUP BY WEEK(FECHA_ALBARAN)
        ORDER BY numSemana DESC
        FETCH FIRST ? ROWS ONLY
      `;

      const result = await odbcPool.query<any[]>(query, [...queryParams, numSemanas]);

      const semanas = result.map((row: any) => ({
        semana: `Semana ${row.NUMSEMANA}`,
        fechaInicio: toStr(row.FECHAINICIO),
        fechaFin: toStr(row.FECHAFIN),
        totalVentas: toFloat(row.TOTALVENTAS),
        totalUnidades: toFloat(row.TOTALUNIDADES),
        numeroOperaciones: toInt(row.NUMEROOPERACIONES),
      }));

      return { semanas };
    } catch (error) {
      logger.error('Error obteniendo ventas semanales:', error);
      throw error;
    }
  }
}

export const ventasService = new VentasService();
