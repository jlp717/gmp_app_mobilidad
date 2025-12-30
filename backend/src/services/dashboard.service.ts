/**
 * SERVICIO DE DASHBOARD - Datos Reales del Vendedor
 * 
 * Proporciona datos reales desde la tabla CAC (cabecera albaranes/facturas)
 * filtrados por vendedor para mostrar en el dashboard de la app móvil
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';

export interface DashboardData {
  ventasHoy: {
    total: number;
    cantidad: number;
    margen: number;
  };
  ventasMes: {
    total: number;
    cantidad: number;
    margen: number;
    comparativaMesAnterior: number; // porcentaje
  };
  ventasAnio: {
    total: number;
    cantidad: number;
    margen: number;
  };
  clientesAtendidos: {
    hoy: number;
    mes: number;
    totalAsignados: number;
  };
  pedidosPendientes: number;
  ultimasVentas: Array<{
    fecha: string;
    cliente: string;
    importe: number;
    numeroAlbaran: string;
  }>;
}

export interface VentasMensuales {
  mes: string;
  mesNumero: number;
  anio: number;
  total: number;
  cantidad: number;
  margen: number;
}

export interface TopClientes {
  codigoCliente: string;
  nombreCliente: string;
  totalVentas: number;
  numeroOperaciones: number;
}

class DashboardService {
  /**
   * Obtiene todos los datos del dashboard para un vendedor
   */
  async getDashboardVendedor(codigoVendedor: string): Promise<DashboardData> {
    try {
      const now = new Date();
      const dia = now.getDate();
      const mes = now.getMonth() + 1;
      const anio = now.getFullYear();
      const mesAnterior = mes === 1 ? 12 : mes - 1;
      const anioMesAnterior = mes === 1 ? anio - 1 : anio;

      // Ejecutar todas las queries en paralelo
      const [
        ventasHoy,
        ventasMes,
        ventasMesAnterior,
        ventasAnio,
        clientesHoy,
        clientesMes,
        clientesAsignados,
        pedidosPendientes,
        ultimasVentas,
      ] = await Promise.all([
        // Ventas de hoy
        this.getVentasPeriodo(codigoVendedor, dia, mes, anio, dia, mes, anio),
        // Ventas del mes
        this.getVentasPeriodo(codigoVendedor, 1, mes, anio, dia, mes, anio),
        // Ventas del mes anterior (para comparativa)
        this.getVentasPeriodo(codigoVendedor, 1, mesAnterior, anioMesAnterior, 31, mesAnterior, anioMesAnterior),
        // Ventas del año
        this.getVentasPeriodo(codigoVendedor, 1, 1, anio, dia, mes, anio),
        // Clientes atendidos hoy
        this.getClientesAtendidos(codigoVendedor, dia, mes, anio, dia, mes, anio),
        // Clientes atendidos mes
        this.getClientesAtendidos(codigoVendedor, 1, mes, anio, dia, mes, anio),
        // Total clientes asignados
        this.getTotalClientesAsignados(codigoVendedor),
        // Pedidos pendientes
        this.getPedidosPendientes(codigoVendedor),
        // Últimas 5 ventas
        this.getUltimasVentas(codigoVendedor, 5),
      ]);

      // Calcular comparativa mes anterior
      const comparativaMesAnterior = ventasMesAnterior.total > 0
        ? Math.round(((ventasMes.total - ventasMesAnterior.total) / ventasMesAnterior.total) * 10000) / 100
        : 100;

      return {
        ventasHoy,
        ventasMes: {
          ...ventasMes,
          comparativaMesAnterior,
        },
        ventasAnio,
        clientesAtendidos: {
          hoy: clientesHoy,
          mes: clientesMes,
          totalAsignados: clientesAsignados,
        },
        pedidosPendientes,
        ultimasVentas,
      };
    } catch (error) {
      logger.error('Error obteniendo dashboard del vendedor:', error);
      throw error;
    }
  }

  /**
   * Obtiene ventas en un período para un vendedor
   * El vendedor puede estar en CODIGOPROMOTORPREVENTA o CODIGOVENDEDOR
   */
  private async getVentasPeriodo(
    codigoVendedor: string,
    diaDesde: number,
    mesDesde: number,
    anioDesde: number,
    diaHasta: number,
    mesHasta: number,
    anioHasta: number
  ): Promise<{ total: number; cantidad: number; margen: number }> {
    try {
      const query = `
        SELECT 
          COALESCE(SUM(IMPORTETOTAL), 0) AS total,
          COUNT(*) AS cantidad,
          COALESCE(SUM(IMPORTEMARGEN), 0) AS margen
        FROM DSEDAC.CAC
        WHERE (TRIM(CODIGOPROMOTORPREVENTA) = ? OR TRIM(CODIGOVENDEDOR) = ?)
          AND ELIMINADOSN <> 'S'
          AND (
            (ANODOCUMENTO > ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO > ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO >= ?)
          )
          AND (
            (ANODOCUMENTO < ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO < ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO <= ?)
          )
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [
        codigoVendedor, codigoVendedor,
        anioDesde, anioDesde, mesDesde, anioDesde, mesDesde, diaDesde,
        anioHasta, anioHasta, mesHasta, anioHasta, mesHasta, diaHasta,
      ]);

      if (!result || result.length === 0) {
        return { total: 0, cantidad: 0, margen: 0 };
      }

      const row = result[0];
      return {
        total: parseFloat(String(row.TOTAL || '0')),
        cantidad: parseInt(String(row.CANTIDAD || '0')),
        margen: parseFloat(String(row.MARGEN || '0')),
      };
    } catch (error) {
      logger.error('Error obteniendo ventas del período:', error);
      return { total: 0, cantidad: 0, margen: 0 };
    }
  }

  /**
   * Cuenta clientes atendidos en un período
   */
  private async getClientesAtendidos(
    codigoVendedor: string,
    diaDesde: number,
    mesDesde: number,
    anioDesde: number,
    diaHasta: number,
    mesHasta: number,
    anioHasta: number
  ): Promise<number> {
    try {
      const query = `
        SELECT COUNT(DISTINCT CODIGOCLIENTEALBARAN) AS total
        FROM DSEDAC.CAC
        WHERE (TRIM(CODIGOPROMOTORPREVENTA) = ? OR TRIM(CODIGOVENDEDOR) = ?)
          AND ELIMINADOSN <> 'S'
          AND (
            (ANODOCUMENTO > ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO > ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO >= ?)
          )
          AND (
            (ANODOCUMENTO < ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO < ?) OR
            (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO <= ?)
          )
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [
        codigoVendedor, codigoVendedor,
        anioDesde, anioDesde, mesDesde, anioDesde, mesDesde, diaDesde,
        anioHasta, anioHasta, mesHasta, anioHasta, mesHasta, diaHasta,
      ]);

      return parseInt(String(result[0]?.TOTAL || '0'));
    } catch (error) {
      logger.error('Error contando clientes atendidos:', error);
      return 0;
    }
  }

  /**
   * Obtiene total de clientes asignados a un vendedor
   */
  private async getTotalClientesAsignados(codigoVendedor: string): Promise<number> {
    try {
      // Buscar en CLI por vendedor asignado
      const query = `
        SELECT COUNT(*) AS total
        FROM DSEDAC.CLI
        WHERE TRIM(CODIGOVENDEDOR) = ?
          AND TRIM(FECHABAJA) = ''
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [codigoVendedor]);
      return parseInt(String(result[0]?.TOTAL || '0'));
    } catch (error) {
      logger.error('Error obteniendo clientes asignados:', error);
      return 0;
    }
  }

  /**
   * Cuenta pedidos pendientes de un vendedor
   */
  private async getPedidosPendientes(codigoVendedor: string): Promise<number> {
    try {
      // Pedidos no facturados del vendedor (SITUACIONALBARAN diferente de facturado)
      const query = `
        SELECT COUNT(*) AS total
        FROM DSEDAC.CAC
        WHERE (TRIM(CODIGOPROMOTORPREVENTA) = ? OR TRIM(CODIGOVENDEDOR) = ?)
          AND ELIMINADOSN <> 'S'
          AND (SITUACIONALBARAN = 'P' OR SITUACIONALBARAN = 'X')
          AND NUMEROFACTURA = 0
          AND EJERCICIOALBARAN >= ?
      `;

      const anioActual = new Date().getFullYear();
      const result = await odbcPool.query<Record<string, unknown>[]>(query, [
        codigoVendedor, codigoVendedor, anioActual
      ]);

      return parseInt(String(result[0]?.TOTAL || '0'));
    } catch (error) {
      logger.error('Error contando pedidos pendientes:', error);
      return 0;
    }
  }

  /**
   * Obtiene las últimas ventas del vendedor
   */
  private async getUltimasVentas(
    codigoVendedor: string,
    limite: number
  ): Promise<Array<{ fecha: string; cliente: string; importe: number; numeroAlbaran: string }>> {
    try {
      const query = `
        SELECT 
          DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
          CODIGOCLIENTEALBARAN,
          IMPORTETOTAL,
          SERIEALBARAN, NUMEROALBARAN
        FROM DSEDAC.CAC
        WHERE (TRIM(CODIGOPROMOTORPREVENTA) = ? OR TRIM(CODIGOVENDEDOR) = ?)
          AND ELIMINADOSN <> 'S'
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC, HORADOCUMENTO DESC
        FETCH FIRST ? ROWS ONLY
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [
        codigoVendedor, codigoVendedor, limite
      ]);

      // Obtener nombres de clientes
      const ventas = await Promise.all(
        result.map(async (row) => {
          const codigoCliente = String(row.CODIGOCLIENTEALBARAN || '').trim();
          const nombreCliente = await this.getNombreCliente(codigoCliente);

          return {
            fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
            cliente: nombreCliente || codigoCliente,
            importe: parseFloat(String(row.IMPORTETOTAL || '0')),
            numeroAlbaran: `${String(row.SERIEALBARAN || '').trim()}-${row.NUMEROALBARAN}`,
          };
        })
      );

      return ventas;
    } catch (error) {
      logger.error('Error obteniendo últimas ventas:', error);
      return [];
    }
  }

  /**
   * Helper para obtener nombre de cliente
   */
  private async getNombreCliente(codigoCliente: string): Promise<string> {
    try {
      const query = `
        SELECT TRIM(NOMBRECLIENTE) AS nombre
        FROM DSEDAC.CLI
        WHERE CODIGOCLIENTE = ?
        FETCH FIRST 1 ROWS ONLY
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [codigoCliente]);
      return String(result[0]?.NOMBRE || '');
    } catch (error) {
      return '';
    }
  }

  /**
   * Obtiene ventas mensuales del año para gráfico de evolución
   */
  async getVentasMensuales(codigoVendedor: string, anio?: number): Promise<VentasMensuales[]> {
    try {
      const anioConsulta = anio || new Date().getFullYear();

      const query = `
        SELECT 
          MESDOCUMENTO AS mes,
          COALESCE(SUM(IMPORTETOTAL), 0) AS total,
          COUNT(*) AS cantidad,
          COALESCE(SUM(IMPORTEMARGEN), 0) AS margen
        FROM DSEDAC.CAC
        WHERE (TRIM(CODIGOPROMOTORPREVENTA) = ? OR TRIM(CODIGOVENDEDOR) = ?)
          AND ANODOCUMENTO = ?
          AND ELIMINADOSN <> 'S'
        GROUP BY MESDOCUMENTO
        ORDER BY MESDOCUMENTO
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [
        codigoVendedor, codigoVendedor, anioConsulta
      ]);

      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

      return result.map((row) => {
        const mesNum = parseInt(String(row.MES || '1'));
        return {
          mes: meses[mesNum - 1] || 'N/A',
          mesNumero: mesNum,
          anio: anioConsulta,
          total: parseFloat(String(row.TOTAL || '0')),
          cantidad: parseInt(String(row.CANTIDAD || '0')),
          margen: parseFloat(String(row.MARGEN || '0')),
        };
      });
    } catch (error) {
      logger.error('Error obteniendo ventas mensuales:', error);
      return [];
    }
  }

  /**
   * Obtiene top clientes del vendedor
   */
  async getTopClientes(codigoVendedor: string, limite: number = 10): Promise<TopClientes[]> {
    try {
      const anioActual = new Date().getFullYear();

      const query = `
        SELECT 
          c.CODIGOCLIENTEALBARAN AS codigo,
          COALESCE(SUM(c.IMPORTETOTAL), 0) AS total,
          COUNT(*) AS operaciones
        FROM DSEDAC.CAC c
        WHERE (TRIM(c.CODIGOPROMOTORPREVENTA) = ? OR TRIM(c.CODIGOVENDEDOR) = ?)
          AND c.ANODOCUMENTO = ?
          AND c.ELIMINADOSN <> 'S'
        GROUP BY c.CODIGOCLIENTEALBARAN
        ORDER BY total DESC
        FETCH FIRST ? ROWS ONLY
      `;

      const result = await odbcPool.query<Record<string, unknown>[]>(query, [
        codigoVendedor, codigoVendedor, anioActual, limite
      ]);

      // Enriquecer con nombres de cliente
      const clientes = await Promise.all(
        result.map(async (row) => {
          const codigo = String(row.CODIGO || '').trim();
          const nombre = await this.getNombreCliente(codigo);

          return {
            codigoCliente: codigo,
            nombreCliente: nombre || codigo,
            totalVentas: parseFloat(String(row.TOTAL || '0')),
            numeroOperaciones: parseInt(String(row.OPERACIONES || '0')),
          };
        })
      );

      return clientes;
    } catch (error) {
      logger.error('Error obteniendo top clientes:', error);
      return [];
    }
  }
}

export const dashboardService = new DashboardService();
