/**
 * SERVICIO DE CLIENTES
 * Gestión de clientes y datos relacionados
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
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

class ClienteService {
  /**
   * Lista clientes con paginación y filtros
   * Endpoint principal para sincronización móvil
   */
  async listarClientes(params: ListarClientesParams): Promise<ListarClientesResult> {
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
        OFFSET ${offset} ROWS
        FETCH FIRST ${limit} ROWS ONLY
      `;

      const resultado = await odbcPool.query<Record<string, unknown>[]>(query, queryParams);

      // Contar total (sin paginación)
      const countQuery = `
        SELECT COUNT(*) as TOTAL
        FROM DSEDAC.CLI CLI
        WHERE ${whereConditions.join(' AND ')}
      `;
      const countResult = await odbcPool.query<Record<string, unknown>[]>(countQuery, queryParams);
      const total = Number(countResult[0]?.TOTAL) || resultado.length;

      const clientes: Cliente[] = resultado.map((row) => ({
        codigo: String(row.CODIGO || '').trim(),
        nombre: String(row.NOMBRE || '').trim(),
        nombreAlternativo: String(row.NOMBRE_ALTERNATIVO || '').trim() || undefined,
        nif: String(row.NIF || '').trim(),
        direccion: String(row.DIRECCION || '').trim(),
        poblacion: String(row.POBLACION || '').trim(),
        provincia: String(row.PROVINCIA || '').trim(),
        codigoPostal: String(row.CODIGO_POSTAL || '').trim(),
        telefono1: String(row.TELEFONO1 || '').trim(),
        telefono2: String(row.TELEFONO2 || '').trim() || undefined,
        codigoRuta: String(row.CODIGO_RUTA || '').trim() || undefined,
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
    try {
      const sanitizedCode = this.sanitizarCodigo(codigoCliente);
      
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
        codigo: String(row.CODIGOCLIENTE || '').trim(),
        nombre: String(row.NOMBRECLIENTE || '').trim(),
        nombreAlternativo: String(row.NOMBREALTERNATIVO || '').trim(),
        nif: String(row.NIF || '').trim(),
        direccion: String(row.DIRECCION || '').trim(),
        poblacion: String(row.POBLACION || '').trim(),
        provincia: String(row.PROVINCIA || '').trim(),
        codigoPostal: String(row.CODIGOPOSTAL || '').trim(),
        telefono1: String(row.TELEFONO1 || '').trim(),
        telefono2: String(row.TELEFONO2 || '').trim(),
        recargo: row.RECARGOSN === 'S',
        exentoIva: row.EXENTOIVASN === 'S',
        codigoRuta: String(row.CODIGORUTA || '').trim(),
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
        [this.sanitizarCodigo(codigoCliente)]
      );

      if (!resultado || resultado.length === 0) return null;

      const cliente = resultado[0];
      const emailValue = String(cliente.EMAIL_RAW || '');
      const isValidEmail = emailValue.includes('@') && emailValue.includes('.');

      const direccionCompleta = [
        cliente.DIRECCION,
        cliente.CODIGO_POSTAL && cliente.POBLACION 
          ? `${cliente.CODIGO_POSTAL} ${cliente.POBLACION}` 
          : cliente.POBLACION,
        cliente.PROVINCIA,
      ].filter(Boolean).join(', ');

      const telefonoRaw = String(cliente.TELEFONO || '');
      const telefonoLimpio = telefonoRaw.replace(/\s+/g, '');
      const esMovilValido = telefonoLimpio.length >= 9 && telefonoLimpio.startsWith('6');

      return {
        codigoCliente: String(cliente.CODIGO_CLIENTE || ''),
        nombre: String(cliente.NOMBRE || ''),
        empresa: String(cliente.EMPRESA || cliente.NOMBRE || ''),
        direccion: {
          calle: String(cliente.DIRECCION || ''),
          poblacion: String(cliente.POBLACION || ''),
          provincia: String(cliente.PROVINCIA || ''),
          codigoPostal: String(cliente.CODIGO_POSTAL || ''),
          completa: direccionCompleta || 'Sin dirección registrada',
        },
        contacto: {
          telefono: esMovilValido ? telefonoLimpio : '',
          email: isValidEmail ? emailValue : '',
        },
        nif: String(cliente.NIF || ''),
      };
    } catch (error) {
      logger.error('Error obteniendo perfil:', error);
      return null;
    }
  }

  /**
   * Obtiene facturas del cliente
   */
  async obtenerFacturas(codigoCliente: string): Promise<Factura[]> {
    try {
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
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
        WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
          AND CAC.NUMEROFACTURA > 0
          AND CAC.NUMEROALBARAN > 0
        GROUP BY CAC.SERIEFACTURA, CAC.NUMEROFACTURA, CAC.SUBEMPRESAALBARAN, CAC.EJERCICIOALBARAN
        ORDER BY MAX(CAC.ANODOCUMENTO) DESC, MAX(CAC.MESDOCUMENTO) DESC, MAX(CAC.DIADOCUMENTO) DESC, CAC.NUMEROFACTURA DESC`,
        [this.sanitizarCodigo(codigoCliente)]
      );

      return resultado.map((f) => {
        const totalFactura = parseFloat(String(f.TOTAL_FACTURA)) || 0;
        const importePendiente = parseFloat(String(f.IMPORTE_PENDIENTE)) || 0;

        return {
          subempresa: String(f.SUBEMPRESA || '').trim(),
          ejercicio: Number(f.EJERCICIO) || 0,
          serie: String(f.SERIE || '').trim(),
          terminal: Number(f.TERMINAL) || 0,
          numeroAlbaran: Number(f.NUMERO_ALBARAN) || 0,
          serieFactura: String(f.SERIEFACTURA || '').trim(),
          numeroFactura: Number(f.NUMEROFACTURA) || 0,
          tipoDocumento: String(f.TIPO_DOCUMENTO || '').trim(),
          fecha: this.formatearFecha(
            Number(f.DIADOCUMENTO),
            Number(f.MESDOCUMENTO),
            Number(f.ANODOCUMENTO)
          ),
          dia: Number(f.DIADOCUMENTO) || 0,
          mes: Number(f.MESDOCUMENTO) || 0,
          ano: Number(f.ANODOCUMENTO) || 0,
          totalBase: parseFloat(String(f.TOTAL_BASE)) || 0,
          totalIVA: parseFloat(String(f.TOTAL_IVA)) || 0,
          totalFactura,
          importePendiente,
          estadoPago: importePendiente === 0 ? 'pagada' : 'pendiente',
          codigoFormaPago: f.CODIGOFORMAPAGO ? String(f.CODIGOFORMAPAGO).trim() : undefined,
        };
      });
    } catch (error) {
      logger.error('Error obteniendo facturas:', error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de facturas por año
   */
  async obtenerEstadisticasFacturas(codigoCliente: string): Promise<EstadisticasAnuales[]> {
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
        [this.sanitizarCodigo(codigoCliente)]
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
          stats[year].pagadas = Number(row.CANTIDAD);
          stats[year].totalPagadas = parseFloat(String(row.TOTAL)) || 0;
        } else if (row.ESTADO === 'pendiente') {
          stats[year].pendientes = Number(row.CANTIDAD);
          stats[year].totalPendientes = parseFloat(String(row.TOTAL)) || 0;
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
        FETCH FIRST ${limite} ROWS ONLY`,
        [this.sanitizarCodigo(codigoCliente)]
      );

      return resultado.map((row) => ({
        codigo: String(row.CODIGO_PRODUCTO || ''),
        nombre: String(row.NOMBRE_PRODUCTO || row.CODIGO_PRODUCTO || 'Producto sin nombre'),
        cantidad: parseInt(String(row.TOTAL_CANTIDAD)) || 0,
        importe: parseFloat(String(row.TOTAL_IMPORTE)) || 0,
        pedidos: parseInt(String(row.NUM_PEDIDOS)) || 0,
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
        [this.sanitizarCodigo(codigoCliente)]
      );

      if (!resultado || resultado.length === 0) {
        return { email: null, telefono: null };
      }

      const cliente = resultado[0];
      const emailValue = String(cliente.EMAIL || '');
      const isValidEmail = emailValue.includes('@') && emailValue.includes('.');

      return {
        telefono: String(cliente.TELEFONO || '') || null,
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

      params.push(this.sanitizarCodigo(codigoCliente));

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
   * Obtiene clientes para el rutero
   */
  async obtenerClientesRutero(codigoRuta?: string, _diaVisita?: string): Promise<ClienteCompleto[]> {
    try {
      let whereConditions = ['CLI.CODIGOCLIENTE IS NOT NULL'];
      const params: string[] = [];

      if (codigoRuta) {
        whereConditions.push('TRIM(CLI.CODIGORUTA) = ?');
        params.push(codigoRuta);
      }

      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          TRIM(CODIGOCLIENTE) as CODIGO,
          TRIM(NOMBRECLIENTE) as NOMBRE,
          TRIM(DIRECCION) as DIRECCION,
          TRIM(POBLACION) as POBLACION,
          TRIM(PROVINCIA) as PROVINCIA,
          TRIM(CODIGOPOSTAL) as CODIGO_POSTAL,
          TRIM(TELEFONO1) as TELEFONO,
          TRIM(CODIGORUTA) as RUTA
        FROM DSEDAC.CLI CLI
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY CLI.CODIGORUTA, CLI.NOMBRECLIENTE
        FETCH FIRST 500 ROWS ONLY`,
        params
      );

      return resultado.map((row) => ({
        codigo: String(row.CODIGO || ''),
        nombre: String(row.NOMBRE || ''),
        nombreAlternativo: undefined,
        nif: '',
        direccion: String(row.DIRECCION || ''),
        poblacion: String(row.POBLACION || ''),
        provincia: String(row.PROVINCIA || ''),
        codigoPostal: String(row.CODIGO_POSTAL || ''),
        telefono1: String(row.TELEFONO || ''),
        codigoRuta: String(row.RUTA || ''),
        recargo: false,
        exentoIva: false,
        activo: true,
      }));
    } catch (error) {
      logger.error('Error obteniendo clientes rutero:', error);
      throw error;
    }
  }

  // ============================================
  // UTILIDADES
  // ============================================

  private sanitizarCodigo(codigo: string): string {
    return String(codigo)
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .substring(0, 10);
  }

  private formatearFecha(dia: number, mes: number, ano: number): string {
    if (!dia || !mes || !ano) return '';
    return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
  }
}

export const clienteService = new ClienteService();
export default clienteService;
