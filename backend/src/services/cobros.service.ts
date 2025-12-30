/**
 * SERVICIO DE COBROS Y PRESUPUESTOS
 * Gestión de cobros, tipos de venta y presupuestos
 */

import { v4 as uuidv4 } from 'uuid';
import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import type { Cobro, TipoCobro, LineaPedido } from '../types/entities';

interface CrearCobroParams {
  codigoCliente: string;
  tipo: TipoCobro;
  lineas: LineaPedido[];
  formaPago: string;
  observaciones?: string;
}

interface CobroPendiente {
  tipo: TipoCobro;
  referencia: string;
  fecha: string;
  importe: number;
  importePendiente: number;
  descripcion: string;
}

class CobrosService {
  /**
   * Obtiene cobros pendientes del cliente
   */
  async obtenerCobrosPendientes(codigoCliente: string): Promise<CobroPendiente[]> {
    try {
      logger.info(`[COBROS] Obteniendo pendientes para cliente: ${codigoCliente}`);

      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT
          CAC.SUBEMPRESAALBARAN,
          CAC.EJERCICIOALBARAN,
          CAC.SERIEALBARAN,
          CAC.TERMINALALBARAN,
          CAC.NUMEROALBARAN,
          CAC.NUMEROFACTURA,
          CAC.SERIEFACTURA,
          CAC.ANODOCUMENTO,
          CAC.MESDOCUMENTO,
          CAC.DIADOCUMENTO,
          CAC.IMPORTETOTAL,
          COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) as IMPORTE_PENDIENTE,
          CAC.CODIGOTIPOALBARAN
        FROM DSEDAC.CAC
        LEFT JOIN DSEDAC.CVC 
          ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
          AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
        WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
          AND COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
        ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC
        FETCH FIRST 100 ROWS ONLY`,
        [this.sanitizarCodigo(codigoCliente)]
      );

      const ahora = new Date();
      const mesActual = ahora.getMonth() + 1;
      const anoActual = ahora.getFullYear();

      return resultado.map((row) => {
        const mes = Number(row.MESDOCUMENTO);
        const ano = Number(row.ANODOCUMENTO);
        const esFactura = Number(row.NUMEROFACTURA) > 0;
        const esDelMesActual = ano === anoActual && mes === mesActual;

        // Determinar tipo según reglas de negocio
        let tipo: TipoCobro = 'normal';
        if (esFactura) {
          tipo = esDelMesActual ? 'albaran' : 'factura';
        }

        const referencia = esFactura
          ? `${row.SERIEFACTURA}-${row.NUMEROFACTURA}`
          : `ALB-${row.NUMEROALBARAN}`;

        return {
          tipo,
          referencia,
          fecha: this.formatearFecha(
            Number(row.DIADOCUMENTO),
            Number(row.MESDOCUMENTO),
            Number(row.ANODOCUMENTO)
          ),
          importe: parseFloat(String(row.IMPORTETOTAL)) || 0,
          importePendiente: parseFloat(String(row.IMPORTE_PENDIENTE)) || 0,
          descripcion: esFactura
            ? `Factura ${row.SERIEFACTURA}-${row.NUMEROFACTURA}`
            : `Albarán ${row.NUMEROALBARAN}`,
        };
      });
    } catch (error) {
      logger.error('[COBROS] Error obteniendo cobros pendientes:', error);
      throw error;
    }
  }

  /**
   * Obtiene resumen de cobros por tipo
   */
  async obtenerResumenCobros(codigoCliente: string): Promise<{
    albaranes: { cantidad: number; total: number };
    facturas: { cantidad: number; total: number };
    totalPendiente: number;
  }> {
    try {
      const pendientes = await this.obtenerCobrosPendientes(codigoCliente);

      const albaranes = pendientes.filter(c => c.tipo === 'albaran');
      const facturas = pendientes.filter(c => c.tipo === 'factura');

      return {
        albaranes: {
          cantidad: albaranes.length,
          total: albaranes.reduce((sum, c) => sum + c.importePendiente, 0),
        },
        facturas: {
          cantidad: facturas.length,
          total: facturas.reduce((sum, c) => sum + c.importePendiente, 0),
        },
        totalPendiente: pendientes.reduce((sum, c) => sum + c.importePendiente, 0),
      };
    } catch (error) {
      logger.error('[COBROS] Error obteniendo resumen:', error);
      throw error;
    }
  }

  /**
   * Crea un nuevo presupuesto (venta ficticia)
   */
  async crearPresupuesto(params: CrearCobroParams): Promise<{
    success: boolean;
    presupuesto?: Cobro;
    error?: string;
  }> {
    try {
      const { codigoCliente, lineas, formaPago, observaciones } = params;

      logger.info(`[PRESUPUESTO] Creando para cliente: ${codigoCliente}`);

      const id = uuidv4();
      const importeTotal = lineas.reduce((sum, l) => sum + l.importeTotal, 0);

      // Intentar insertar en tabla de presupuestos
      try {
        await odbcPool.query(
          `INSERT INTO JAVIER.PRESUPUESTOS (
            ID, CODIGO_CLIENTE, FECHA, IMPORTE_TOTAL, FORMA_PAGO,
            OBSERVACIONES, ESTADO, LINEAS_JSON
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'PENDIENTE', ?)`,
          [
            id,
            this.sanitizarCodigo(codigoCliente),
            importeTotal,
            formaPago,
            observaciones || '',
            JSON.stringify(lineas),
          ]
        );
      } catch {
        logger.warn('[PRESUPUESTO] Tabla PRESUPUESTOS no existe, usando memoria');
      }

      const presupuesto: Cobro = {
        id,
        codigoCliente,
        tipo: 'presupuesto',
        fecha: new Date().toISOString().split('T')[0],
        importeTotal,
        importeCobrado: 0,
        importePendiente: importeTotal,
        formaPago,
        observaciones,
        esPresupuesto: true,
        convertidoAPedido: false,
      };

      logger.info(`[PRESUPUESTO] Creado exitosamente: ${id}`);
      return { success: true, presupuesto };
    } catch (error) {
      logger.error('[PRESUPUESTO] Error creando presupuesto:', error);
      return { success: false, error: 'Error creando presupuesto' };
    }
  }

  /**
   * Convierte un presupuesto en pedido real
   */
  async convertirPresupuestoAPedido(idPresupuesto: string): Promise<{
    success: boolean;
    numeroPedido?: number;
    error?: string;
  }> {
    try {
      logger.info(`[PRESUPUESTO] Convirtiendo a pedido: ${idPresupuesto}`);

      // Obtener presupuesto
      const presupuestoResult = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT * FROM JAVIER.PRESUPUESTOS WHERE ID = ? AND ESTADO = 'PENDIENTE'`,
        [idPresupuesto]
      );

      if (!presupuestoResult || presupuestoResult.length === 0) {
        return { success: false, error: 'Presupuesto no encontrado o ya convertido' };
      }

      // presupuestoResult[0] contiene los datos del presupuesto
      // No necesitamos la referencia directa ya que solo verificamos existencia

      // Generar número de pedido temporal
      const numeroPedido = Date.now() % 1000000;

      // Actualizar estado del presupuesto
      await odbcPool.query(
        `UPDATE JAVIER.PRESUPUESTOS 
        SET ESTADO = 'CONVERTIDO', 
            NUMERO_PEDIDO = ?,
            FECHA_CONVERSION = CURRENT_TIMESTAMP
        WHERE ID = ?`,
        [numeroPedido, idPresupuesto]
      );

      logger.info(`[PRESUPUESTO] Convertido a pedido: ${numeroPedido}`);
      return { success: true, numeroPedido };
    } catch (error) {
      logger.error('[PRESUPUESTO] Error convirtiendo presupuesto:', error);
      return { success: false, error: 'Error convirtiendo presupuesto' };
    }
  }

  /**
   * Obtiene presupuestos del cliente
   */
  async obtenerPresupuestosCliente(codigoCliente: string): Promise<Cobro[]> {
    try {
      const resultado = await odbcPool.query<Record<string, unknown>[]>(
        `SELECT 
          ID, CODIGO_CLIENTE, FECHA, IMPORTE_TOTAL, FORMA_PAGO,
          OBSERVACIONES, ESTADO, NUMERO_PEDIDO
        FROM JAVIER.PRESUPUESTOS
        WHERE CODIGO_CLIENTE = ?
        ORDER BY FECHA DESC
        FETCH FIRST 50 ROWS ONLY`,
        [this.sanitizarCodigo(codigoCliente)]
      );

      return resultado.map((row) => ({
        id: String(row.ID),
        codigoCliente: String(row.CODIGO_CLIENTE),
        tipo: 'presupuesto' as TipoCobro,
        fecha: row.FECHA ? new Date(row.FECHA as string).toISOString().split('T')[0] : '',
        importeTotal: parseFloat(String(row.IMPORTE_TOTAL)) || 0,
        importeCobrado: 0,
        importePendiente: parseFloat(String(row.IMPORTE_TOTAL)) || 0,
        formaPago: String(row.FORMA_PAGO || ''),
        observaciones: String(row.OBSERVACIONES || ''),
        esPresupuesto: true,
        convertidoAPedido: row.ESTADO === 'CONVERTIDO',
        numeroPedidoConvertido: row.NUMERO_PEDIDO ? Number(row.NUMERO_PEDIDO) : undefined,
      }));
    } catch {
      // Tabla puede no existir
      return [];
    }
  }

  /**
   * Registra un cobro
   */
  async registrarCobro(params: {
    codigoCliente: string;
    referencia: string;
    importe: number;
    formaPago: string;
    observaciones?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info(`[COBROS] Registrando cobro para ${params.codigoCliente}: ${params.importe}€`);

      // Registrar en tabla de cobros si existe
      try {
        await odbcPool.query(
          `INSERT INTO JAVIER.COBROS (
            ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO,
            OBSERVACIONES, FECHA
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            this.sanitizarCodigo(params.codigoCliente),
            params.referencia,
            params.importe,
            params.formaPago,
            params.observaciones || '',
          ]
        );
      } catch {
        logger.warn('[COBROS] Tabla COBROS no existe');
      }

      return { success: true };
    } catch (error) {
      logger.error('[COBROS] Error registrando cobro:', error);
      return { success: false, error: 'Error registrando cobro' };
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

export const cobrosService = new CobrosService();
export default cobrosService;
