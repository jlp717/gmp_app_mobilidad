/**
 * SERVICIO DE VENTAS - Histórico y Estadísticas
 * 
 * Maneja consultas de histórico de ventas y estadísticas
 * desde la vista LACLAE del IBM i
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';

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
    try {
      const conditions: string[] = [
        "TIPO_LINEA = 'T'",
        "CLASE_LINEA = 'VT'",
      ];

      if (params.codigoCliente) {
        conditions.push(`CODIGO_CLIENTE_ALBARAN = '${params.codigoCliente}'`);
      }

      if (params.codigoProducto) {
        conditions.push(`CODIGO_ARTICULO = '${params.codigoProducto}'`);
      }

      if (params.desde) {
        conditions.push(`FECHA_ALBARAN >= '${params.desde}'`);
      }

      if (params.hasta) {
        conditions.push(`FECHA_ALBARAN <= '${params.hasta}'`);
      }

      if (params.comercial) {
        conditions.push(`CODIGO_COMERCIAL = '${params.comercial}'`);
      }

      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';

      const limit = params.limit || 50;
      const offset = params.offset || 0;

      // Query para contar total
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM DSED.LACLAE
        ${whereClause}
      `;

      // Query principal con paginación
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
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `;

      const [countResult, dataResult] = await Promise.all([
        odbcPool.query<any[]>(countQuery),
        odbcPool.query<any[]>(dataQuery),
      ]);

      const total = countResult[0]?.TOTAL || 0;

      const data: VentaItem[] = dataResult.map((row: any) => ({
        numeroDocumento: row.NUMERODOCUMENTO || '',
        fecha: row.FECHA || '',
        codigoCliente: row.CODIGOCLIENTE || '',
        nombreCliente: row.NOMBRECLIENTE || '',
        codigoArticulo: row.CODIGOARTICULO || '',
        descripcionArticulo: row.DESCRIPCIONARTICULO || '',
        cantidad: parseFloat(row.CANTIDAD) || 0,
        precioUnitario: parseFloat(row.PRECIOUNITARIO) || 0,
        importeTotal: parseFloat(row.IMPORTETOTAL) || 0,
        categoria: row.CATEGORIA || '',
        comercial: row.COMERCIAL || '',
      }));

      return {
        data,
        total,
        page: Math.floor(offset / limit) + 1,
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
    try {
      const conditions: string[] = [
        "TIPO_LINEA = 'T'",
        "CLASE_LINEA = 'VT'",
      ];

      if (params.codigoCliente) {
        conditions.push(`CODIGO_CLIENTE_ALBARAN = '${params.codigoCliente}'`);
      }

      if (params.codigoProducto) {
        conditions.push(`CODIGO_ARTICULO = '${params.codigoProducto}'`);
      }

      if (params.desde) {
        conditions.push(`FECHA_ALBARAN >= '${params.desde}'`);
      }

      if (params.hasta) {
        conditions.push(`FECHA_ALBARAN <= '${params.hasta}'`);
      }

      if (params.comercial) {
        conditions.push(`CODIGO_COMERCIAL = '${params.comercial}'`);
      }

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

      const [resumenResult, datosResult] = await Promise.all([
        odbcPool.query<any[]>(resumenQuery),
        odbcPool.query<any[]>(datosQuery),
      ]);

      const resumen = {
        totalVentas: parseFloat(resumenResult[0]?.TOTALVENTAS) || 0,
        totalUnidades: parseFloat(resumenResult[0]?.TOTALUNIDADES) || 0,
        promedioVenta: parseFloat(resumenResult[0]?.PROMEDIOVENTA) || 0,
        numeroOperaciones: parseInt(resumenResult[0]?.NUMEROOPERACIONES) || 0,
      };

      // Calcular porcentajes
      const datos: EstadisticaItem[] = datosResult.map((row: any) => {
        const valor = parseFloat(row.VALOR) || 0;
        return {
          etiqueta: row.ETIQUETA || 'Sin categoría',
          valor,
          cantidad: parseFloat(row.CANTIDAD) || 0,
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
    try {
      const numSemanas = params.semanas || 12;
      const conditions: string[] = [
        "TIPO_LINEA = 'T'",
        "CLASE_LINEA = 'VT'",
        `FECHA_ALBARAN >= CURRENT_DATE - ${numSemanas * 7} DAYS`,
      ];

      if (params.codigoCliente) {
        conditions.push(`CODIGO_CLIENTE_ALBARAN = '${params.codigoCliente}'`);
      }

      if (params.comercial) {
        conditions.push(`CODIGO_COMERCIAL = '${params.comercial}'`);
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
        FETCH FIRST ${numSemanas} ROWS ONLY
      `;

      const result = await odbcPool.query<any[]>(query);

      const semanas = result.map((row: any) => ({
        semana: `Semana ${row.NUMSEMANA}`,
        fechaInicio: row.FECHAINICIO || '',
        fechaFin: row.FECHAFIN || '',
        totalVentas: parseFloat(row.TOTALVENTAS) || 0,
        totalUnidades: parseFloat(row.TOTALUNIDADES) || 0,
        numeroOperaciones: parseInt(row.NUMEROOPERACIONES) || 0,
      }));

      return { semanas };
    } catch (error) {
      logger.error('Error obteniendo ventas semanales:', error);
      throw error;
    }
  }
}

export const ventasService = new VentasService();
