/**
 * SERVICIO DE CLIENTES
 * Gestión de clientes y datos relacionados
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { sanitizeCode } from '../utils/validators';
import { toFloat, toInt, toStr, formatDateDMY, clampLimit, clampOffset, currentPage, totalPages } from '../utils/db-helpers';
import { queryCache, TTL } from '../utils/query-cache';
import type { Cliente, Factura, EstadisticasAnuales, TopProducto } from '../types/entities';

interface ClienteCompleto extends Cliente {
  email?: string;
  telefono?: string;
}

interface PerfilCliente {
  codigoCliente: string;
  nombre: string;
  empresa: string;
  direccion: {
    calle: string;
    poblacion: string;
    provincia: string;
    codigoPostal: string;
    completa: string;
  };
  contacto: {
    telefono: string;
    email: string;
  };
  nif: string;
}

interface ListarClientesParams {
  limit?: number;
  offset?: number;
  search?: string;
  diaVisita?: string;
}

interface ListarClientesResult {
  clientes: Cliente[];
  total: number;
  limit: number;
  offset: number;
}

interface PaginatedClienteFacturas {
  facturas: Factura[];
  total: number;
  paginacion: {
    pagina: number;
    limite: number;
    totalPaginas: number;
  };
}

interface PaginatedClienteRutero {
  clientes: ClienteCompleto[];
  total: number;
  paginacion: {
    pagina: number;
    limite: number;
    totalPaginas: number;
  };
}

class ClienteService {
  /**
   * Lista clientes con paginación y filtros
   * Endpoint principal para sincronización móvil
   */
  async listarClientes(params: ListarClientesParams): Promise<ListarClientesResult> {
    const cacheKey = `gmp:clientes:list:${params.limit || 500}:${params.offset || 0}:${params.search || ''}:${params.diaVisita || ''}`;
    return queryCache.getOrSet(cacheKey, () => this._fetchListarClientes(params), TTL.MEDIUM);
  }

  private async _fetchListarClientes(params: ListarClientesParams): Promise<ListarClientesResult> {
    try {
      const { limit = 500, offset = 0, search, diaVisita: _diaVisita } = params;
      
      let whereConditions = ['CLI.CODIGOCLIENTE IS NOT NULL', "CLI.CODIGOCLIENTE <> ''"];
      const queryParams: (string | number)[] = [];

      if (search) {
        whereConditions.push('(UPPER(CLI.NOMBRECLIENTE) LIKE ? OR UPPER(CLI.CODIGOCLIENTE) LIKE ?)');
        const searchPattern = `%${search.toUpperCase()}%`;
        queryParams.push(searchPattern, searchPattern);
      }

      const query = `
        SELECT
          TRIM(CLI.CODIGOCLIENTE) as CODIGO,
          TRIM(CLI.NOMBRECLIENTE) as NOMBRE,
          TRIM(CLI.NOMBREALTERNATIVO) as NOMBRE_ALTERNATIVO,
          TRIM(CLI.NIF) as NIF,
          TRIM(CLI.DIRECCION) as DIRECCION,
          TRIM(CLI.POBLACION) as POBLACION,
          TRIM(CLI.PROVINCIA) as PROVINCIA,
          TRIM(CLI.CODIGOPOSTAL) as CODIGO_POSTAL,
          TRIM(CLI.TELEFONO1) as TELEFONO1,
          TRIM(CLI.TELEFONO2) as TELEFONO2,
          TRIM(CLI.CODIGORUTA) as CODIGO_RUTA,
          CLI.RECARGOSN as RECARGO,
          CLI.EXENTOIVASN as EXENTO_IVA
        FROM DSEDAC.CLI CLI
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY CLI.NOMBRECLIENTE
        OFFSET ? ROWS
        FETCH FIRST ? ROWS ONLY
      `;

      // Ejecutar data + count en paralelo
      const countQuery = `
        SELECT COUNT(*) as TOTAL
        FROM DSEDAC.CLI CLI
        WHERE ${whereConditions.join(' AND ')}
      `;

      const [resultado, countResult] = await Promise.all([
        odbcPool.query<Record<string, unknown>[]>(query, [...queryParams, offset, limit]),
        odbcPool.query<Record<string, unknown>[]>(countQuery, queryParams),
      ]);
      const total = Number(countResult[0]?.TOTAL) || resultado.length;

      const clientes: Cliente[] = resultado.map((row) => ({
        codigo: toStr(row.CODIGO),
        nombre: toStr(row.NOMBRE),
        nombreAlternativo: toStr(row.NOMBRE_ALTERNATIVO) || undefined,
        nif: toStr(row.NIF),
        direccion: toStr(row.DIRECCION),
        poblacion: toStr(row.POBLACION),
        provincia: toStr(row.PROVINCIA),
        codigoPostal: toStr(row.CODIGO_POSTAL),
        telefono1: toStr(row.TELEFONO1),
        telefono2: toStr(row.TELEFONO2) || undefined,
        codigoRuta: toStr(row.CODIGO_RUTA) || undefined,
        recargo: row.RECARGO === 'S',
        exentoIva: row.EXENTO_IVA === 'S',
        activo: true,
      }));

      logger.info(`Clientes listados: ${clientes.length} de ${total}`);

      return { clientes, total, limit, offset };
    } catch (error) {
      logger.error('Error listando clientes:', error);
      throw error;
    }
  }

  /**
   * Obtiene un cliente por código
   */
  async obtenerCliente(codigoCliente: string): Promise<{ success: boolean; cliente?: Cliente; error?: string; code?: string }> {
    return queryCache.getOrSet(
      `gmp:clientes:detail:${codigoCliente}`,
      () => this._fetchObtenerCliente(codigoCliente),
      TTL.MEDIUM
    );
  }

  private async _fetchObtenerCliente(codigoCliente: string): Promise<{ success: boolean; cliente?: Cliente; error?: string; code?: string }> {
    try {
      const sanitizedCode = sanitizeCode(codigoCliente);
      
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          CODIGOCLIENTE, NOMBRECLIENTE, NIF, DIRECCION, POBLACION,
          PROVINCIA, CODIGOPOSTAL, TELEFONO1, TELEFONO2, NOMBREALTERNATIVO,
          RECARGOSN, EXENTOIVASN, CODIGORUTA, CODIGODELEGACION
        FROM DSEDAC.CLI
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROWS ONLY`,
        [sanitizedCode]
      );

      if (!resultado || resultado.length === 0) {
        return { success: false, error: 'Cliente no encontrado', code: 'NOT_FOUND' };
      }

      const row = resultado[0];
      const cliente: Cliente = {
        codigo: toStr(row.CODIGOCLIENTE),
        nombre: toStr(row.NOMBRECLIENTE),
        nombreAlternativo: toStr(row.NOMBREALTERNATIVO),
        nif: toStr(row.NIF),
        direccion: toStr(row.DIRECCION),
        poblacion: toStr(row.POBLACION),
        provincia: toStr(row.PROVINCIA),
        codigoPostal: toStr(row.CODIGOPOSTAL),
        telefono1: toStr(row.TELEFONO1),
        telefono2: toStr(row.TELEFONO2),
        recargo: row.RECARGOSN === 'S',
        exentoIva: row.EXENTOIVASN === 'S',
        codigoRuta: toStr(row.CODIGORUTA),
        activo: true,
      };

      return { success: true, cliente };
    } catch (error) {
      logger.error('Error obteniendo cliente:', error);
      return { success: false, error: 'Error obteniendo cliente', code: 'ERROR' };
    }
  }

  /**
   * Obtiene perfil completo del cliente
   */
  async obtenerPerfilCompleto(codigoCliente: string): Promise<PerfilCliente | null> {
    try {
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          TRIM(CODIGOCLIENTE) as CODIGO_CLIENTE,
          TRIM(NOMBRECLIENTE) as NOMBRE,
          TRIM(NOMBREALTERNATIVO) as EMPRESA,
          TRIM(DIRECCION) as DIRECCION,
          TRIM(POBLACION) as POBLACION,
          TRIM(PROVINCIA) as PROVINCIA,
          TRIM(CODIGOPOSTAL) as CODIGO_POSTAL,
          TRIM(TELEFONO1) as TELEFONO,
          TRIM(TELEFONO2) as EMAIL_RAW,
          TRIM(NIF) as NIF
        FROM DSEDAC.CLI
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROWS ONLY`,
        [sanitizeCode(codigoCliente)]
      );

      if (!resultado || resultado.length === 0) return null;

      const cliente = resultado[0];
      const emailValue = toStr(cliente.EMAIL_RAW);
      const isValidEmail = emailValue.includes('@') && emailValue.includes('.');

      const direccionCompleta = [
        cliente.DIRECCION,
        cliente.CODIGO_POSTAL && cliente.POBLACION
          ? `${cliente.CODIGO_POSTAL} ${cliente.POBLACION}`
          : cliente.POBLACION,
        cliente.PROVINCIA,
      ].filter(Boolean).join(', ');

      const telefonoLimpio = toStr(cliente.TELEFONO).replace(/\s+/g, '');
      const esMovilValido = telefonoLimpio.length >= 9 && telefonoLimpio.startsWith('6');

      return {
        codigoCliente: toStr(cliente.CODIGO_CLIENTE),
        nombre: toStr(cliente.NOMBRE),
        empresa: toStr(cliente.EMPRESA) || toStr(cliente.NOMBRE),
        direccion: {
          calle: toStr(cliente.DIRECCION),
          poblacion: toStr(cliente.POBLACION),
          provincia: toStr(cliente.PROVINCIA),
          codigoPostal: toStr(cliente.CODIGO_POSTAL),
          completa: direccionCompleta || 'Sin dirección registrada',
        },
        contacto: {
          telefono: esMovilValido ? telefonoLimpio : '',
          email: isValidEmail ? emailValue : '',
        },
        nif: toStr(cliente.NIF),
      };
    } catch (error) {
      logger.error('Error obteniendo perfil:', error);
      return null;
    }
  }

  /**
   * Obtiene facturas del cliente con paginación
   */
  async obtenerFacturas(codigoCliente: string, limit?: number, offset?: number): Promise<PaginatedClienteFacturas> {
    const lim = clampLimit(limit, 50, 500);
    const off = clampOffset(offset);
    return queryCache.getOrSet(
      `gmp:clientes:facturas:${codigoCliente}:${lim}:${off}`,
      () => this._fetchObtenerFacturas(codigoCliente, lim, off),
      TTL.SHORT
    );
  }

  private async _fetchObtenerFacturas(codigoCliente: string, limit: number, offset: number): Promise<PaginatedClienteFacturas> {
    try {
      const sanitized = sanitizeCode(codigoCliente);

      const whereClause = `TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
          AND CAC.NUMEROFACTURA > 0
          AND CAC.NUMEROALBARAN > 0`;

      const dataSql = `
        SELECT
          CAC.SUBEMPRESAALBARAN as SUBEMPRESA,
          CAC.EJERCICIOALBARAN as EJERCICIO,
          MIN(CAC.SERIEALBARAN) as SERIE,
          MIN(CAC.TERMINALALBARAN) as TERMINAL,
          MIN(CAC.NUMEROALBARAN) as NUMERO_ALBARAN,
          CAC.SERIEFACTURA,
          CAC.NUMEROFACTURA,
          MAX(CAC.ANODOCUMENTO) as ANODOCUMENTO,
          MAX(CAC.MESDOCUMENTO) as MESDOCUMENTO,
          MAX(CAC.DIADOCUMENTO) as DIADOCUMENTO,
          SUM(CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 + CAC.IMPORTEBASEIMPONIBLE4 + CAC.IMPORTEBASEIMPONIBLE5) as TOTAL_BASE,
          SUM(CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 + CAC.IMPORTEIVA4 + CAC.IMPORTEIVA5) as TOTAL_IVA,
          SUM(CAC.IMPORTETOTAL) as TOTAL_FACTURA,
          MIN(CAC.CODIGOFORMAPAGO) as CODIGOFORMAPAGO,
          COALESCE(MAX(CVC.IMPORTEPENDIENTE), SUM(CAC.IMPORTETOTAL)) as IMPORTE_PENDIENTE,
          MIN(CAC.CODIGOTIPOALBARAN) as TIPO_DOCUMENTO
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CVC
          ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
          AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
        WHERE ${whereClause}
        GROUP BY CAC.SERIEFACTURA, CAC.NUMEROFACTURA, CAC.SUBEMPRESAALBARAN, CAC.EJERCICIOALBARAN
        ORDER BY MAX(CAC.ANODOCUMENTO) DESC, MAX(CAC.MESDOCUMENTO) DESC, MAX(CAC.DIADOCUMENTO) DESC, CAC.NUMEROFACTURA DESC
        OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;

      const countSql = `
        SELECT COUNT(DISTINCT TRIM(CAC.SERIEFACTURA) || '-' || CAC.NUMEROFACTURA) as TOTAL
        FROM DSEDAC.CAC
        WHERE ${whereClause}`;

      const [resultado, countResult] = await Promise.all([
        odbcPool.query<Record<string, unknown>[]>(dataSql, [sanitized, offset, limit]),
        odbcPool.query<Record<string, unknown>[]>(countSql, [sanitized]),
      ]);

      const total = Number(countResult[0]?.TOTAL) || 0;

      const facturas = resultado.map((f) => {
        const totalFactura = toFloat(f.TOTAL_FACTURA);
        const importePendiente = toFloat(f.IMPORTE_PENDIENTE);

        return {
          subempresa: toStr(f.SUBEMPRESA),
          ejercicio: toInt(f.EJERCICIO),
          serie: toStr(f.SERIE),
          terminal: toInt(f.TERMINAL),
          numeroAlbaran: toInt(f.NUMERO_ALBARAN),
          serieFactura: toStr(f.SERIEFACTURA),
          numeroFactura: toInt(f.NUMEROFACTURA),
          tipoDocumento: toStr(f.TIPO_DOCUMENTO),
          fecha: formatDateDMY(f.DIADOCUMENTO, f.MESDOCUMENTO, f.ANODOCUMENTO),
          dia: toInt(f.DIADOCUMENTO),
          mes: toInt(f.MESDOCUMENTO),
          ano: toInt(f.ANODOCUMENTO),
          totalBase: toFloat(f.TOTAL_BASE),
          totalIVA: toFloat(f.TOTAL_IVA),
          totalFactura,
          importePendiente,
          estadoPago: importePendiente === 0 ? 'pagada' : 'pendiente',
          codigoFormaPago: toStr(f.CODIGOFORMAPAGO) || undefined,
        } as Factura;
      });

      return {
        facturas,
        total,
        paginacion: {
          pagina: currentPage(offset, limit),
          limite: limit,
          totalPaginas: totalPages(total, limit),
        },
      };
    } catch (error) {
      logger.error('Error obteniendo facturas:', error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de facturas por año
   */
  async obtenerEstadisticasFacturas(codigoCliente: string): Promise<EstadisticasAnuales[]> {
    return queryCache.getOrSet(
      `gmp:clientes:stats:${codigoCliente}`,
      () => this._fetchEstadisticasFacturas(codigoCliente),
      TTL.MEDIUM
    );
  }

  private async _fetchEstadisticasFacturas(codigoCliente: string): Promise<EstadisticasAnuales[]> {
    try {
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          CAC.ANODOCUMENTO as ANO,
          CASE
            WHEN COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) = 0 THEN 'pagada'
            WHEN COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0 THEN 'pendiente'
            ELSE 'desconocido'
          END as ESTADO,
          COUNT(DISTINCT CAC.NUMEROFACTURA) as CANTIDAD,
          SUM(CAC.IMPORTETOTAL) as TOTAL
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CVC 
          ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
          AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
        WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
          AND CAC.NUMEROFACTURA > 0
          AND CAC.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 5
        GROUP BY CAC.ANODOCUMENTO, 
          CASE
            WHEN COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) = 0 THEN 'pagada'
            WHEN COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0 THEN 'pendiente'
            ELSE 'desconocido'
          END
        ORDER BY ANO DESC, ESTADO`,
        [sanitizeCode(codigoCliente)]
      );

      const stats: Record<number, EstadisticasAnuales> = {};

      resultado.forEach((row) => {
        const year = Number(row.ANO);
        if (!stats[year]) {
          stats[year] = {
            year,
            total: 0,
            pagadas: 0,
            pendientes: 0,
            totalPagadas: 0,
            totalPendientes: 0,
            totalImporte: 0,
          };
        }

        if (row.ESTADO === 'pagada') {
          stats[year].pagadas = toInt(row.CANTIDAD);
          stats[year].totalPagadas = toFloat(row.TOTAL);
        } else if (row.ESTADO === 'pendiente') {
          stats[year].pendientes = toInt(row.CANTIDAD);
          stats[year].totalPendientes = toFloat(row.TOTAL);
        }

        stats[year].total = stats[year].pagadas + stats[year].pendientes;
        stats[year].totalImporte = stats[year].totalPagadas + stats[year].totalPendientes;
      });

      return Object.values(stats).sort((a, b) => b.year - a.year);
    } catch (error) {
      logger.error('Error obteniendo estadísticas:', error);
      throw error;
    }
  }

  /**
   * Obtiene top productos del cliente
   */
  async obtenerTopProductos(codigoCliente: string, limite = 10): Promise<TopProducto[]> {
    return queryCache.getOrSet(
      `gmp:clientes:topproductos:${codigoCliente}:${limite}`,
      () => this._fetchTopProductos(codigoCliente, limite),
      TTL.MEDIUM
    );
  }

  private async _fetchTopProductos(codigoCliente: string, limite: number): Promise<TopProducto[]> {
    try {
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          TRIM(LAC.CODIGOARTICULO) as CODIGO_PRODUCTO,
          TRIM(LAC.DESCRIPCION) as NOMBRE_PRODUCTO,
          SUM(LAC.CANTIDADUNIDADES) as TOTAL_CANTIDAD,
          SUM(LAC.IMPORTEVENTA) as TOTAL_IMPORTE,
          COUNT(DISTINCT LAC.NUMEROALBARAN) as NUM_PEDIDOS
        FROM DSEDAC.LAC LAC
        WHERE TRIM(LAC.CODIGOCLIENTEFACTURA) = ?
          AND LAC.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 2
        GROUP BY LAC.CODIGOARTICULO, LAC.DESCRIPCION
        ORDER BY TOTAL_IMPORTE DESC
        FETCH FIRST ? ROWS ONLY`,
        [sanitizeCode(codigoCliente), Math.min(50, Math.max(1, limite))]
      );

      return resultado.map((row) => ({
        codigo: toStr(row.CODIGO_PRODUCTO),
        nombre: toStr(row.NOMBRE_PRODUCTO) || toStr(row.CODIGO_PRODUCTO) || 'Producto sin nombre',
        cantidad: toInt(row.TOTAL_CANTIDAD),
        importe: toFloat(row.TOTAL_IMPORTE),
        pedidos: toInt(row.NUM_PEDIDOS),
      }));
    } catch (error) {
      logger.error('Error obteniendo top productos:', error);
      throw error;
    }
  }

  /**
   * Obtiene datos de contacto del cliente
   */
  async obtenerDatosContacto(codigoCliente: string): Promise<{ email: string | null; telefono: string | null }> {
    try {
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          TRIM(TELEFONO1) as TELEFONO,
          TRIM(TELEFONO2) as EMAIL
        FROM DSEDAC.CLI
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROWS ONLY`,
        [sanitizeCode(codigoCliente)]
      );

      if (!resultado || resultado.length === 0) {
        return { email: null, telefono: null };
      }

      const cliente = resultado[0];
      const emailValue = toStr(cliente.EMAIL);
      const isValidEmail = emailValue.includes('@') && emailValue.includes('.');

      return {
        telefono: toStr(cliente.TELEFONO) || null,
        email: isValidEmail ? emailValue : null,
      };
    } catch (error) {
      logger.error('Error obteniendo datos contacto:', error);
      throw error;
    }
  }

  /**
   * Actualiza datos de contacto del cliente
   */
  async actualizarDatosContacto(
    codigoCliente: string,
    datos: { email?: string; telefono?: string }
  ): Promise<boolean> {
    try {
      const updates: string[] = [];
      const params: string[] = [];

      if (datos.email !== undefined) {
        updates.push('TELEFONO2 = ?');
        params.push(datos.email);
      }

      if (datos.telefono !== undefined) {
        updates.push('TELEFONO1 = ?');
        params.push(datos.telefono);
      }

      if (updates.length === 0) return false;

      params.push(sanitizeCode(codigoCliente));

      await odbcPool.query(
        `UPDATE DSEDAC.CLI SET ${updates.join(', ')} WHERE TRIM(CODIGOCLIENTE) = ?`,
        params
      );

      return true;
    } catch (error) {
      logger.error('Error actualizando datos contacto:', error);
      throw error;
    }
  }

  /**
   * Obtiene clientes para el rutero con paginación
   */
  async obtenerClientesRutero(codigoRuta?: string, _diaVisita?: string, limit?: number, offset?: number): Promise<PaginatedClienteRutero> {
    const lim = clampLimit(limit, 100, 500);
    const off = clampOffset(offset);
    try {
      const whereConditions = ['CLI.CODIGOCLIENTE IS NOT NULL'];
      const queryParams: (string | number)[] = [];

      if (codigoRuta) {
        whereConditions.push('TRIM(CLI.CODIGORUTA) = ?');
        queryParams.push(codigoRuta);
      }

      const whereClause = whereConditions.join(' AND ');

      const dataSql = `
        SELECT
          TRIM(CODIGOCLIENTE) as CODIGO,
          TRIM(NOMBRECLIENTE) as NOMBRE,
          TRIM(DIRECCION) as DIRECCION,
          TRIM(POBLACION) as POBLACION,
          TRIM(PROVINCIA) as PROVINCIA,
          TRIM(CODIGOPOSTAL) as CODIGO_POSTAL,
          TRIM(TELEFONO1) as TELEFONO,
          TRIM(CODIGORUTA) as RUTA
        FROM DSEDAC.CLI CLI
        WHERE ${whereClause}
        ORDER BY CLI.CODIGORUTA, CLI.NOMBRECLIENTE
        OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;

      const countSql = `
        SELECT COUNT(*) as TOTAL
        FROM DSEDAC.CLI CLI
        WHERE ${whereClause}`;

      const [resultado, countResult] = await Promise.all([
        odbcPool.query<Record<string, unknown>[]>(dataSql, [...queryParams, off, lim]),
        odbcPool.query<Record<string, unknown>[]>(countSql, queryParams),
      ]);

      const total = Number(countResult[0]?.TOTAL) || 0;

      const clientes = resultado.map((row) => ({
        codigo: toStr(row.CODIGO),
        nombre: toStr(row.NOMBRE),
        nombreAlternativo: undefined,
        nif: '',
        direccion: toStr(row.DIRECCION),
        poblacion: toStr(row.POBLACION),
        provincia: toStr(row.PROVINCIA),
        codigoPostal: toStr(row.CODIGO_POSTAL),
        telefono1: toStr(row.TELEFONO),
        codigoRuta: toStr(row.RUTA),
        recargo: false,
        exentoIva: false,
        activo: true,
      }));

      return {
        clientes,
        total,
        paginacion: {
          pagina: currentPage(off, lim),
          limite: lim,
          totalPaginas: totalPages(total, lim),
        },
      };
    } catch (error) {
      logger.error('Error obteniendo clientes rutero:', error);
      throw error;
    }
  }

}

export const clienteService = new ClienteService();
export default clienteService;
