/**
 * SERVICIO DE PROMOCIONES
 * Gestión de promociones simples y compuestas
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import type { Promocion, CondicionPromocion, ResultadoPromocion } from '../types/entities';

interface PromocionBD {
  CODIGO_PROMOCION: string;
  NOMBRE: string;
  DESCRIPCION?: string;
  TIPO: string;
  TIPO_APLICACION: string;
  FECHA_DESDE: Date;
  FECHA_HASTA: Date;
  ACTIVA: string;
  PRIORIDAD: number;
  CONDICIONES?: string;
  RESULTADO?: string;
  CLIENTES_APLICABLES?: string;
}

class PromocionesService {
  /**
   * Obtiene todas las promociones activas
   */
  async obtenerPromocionesActivas(): Promise<Promocion[]> {
    try {
      logger.info('[PROMOCIONES] Obteniendo promociones activas');

      // Intentar obtener de tabla de promociones si existe
      const promocionesDB = await this.obtenerPromocionesDB();
      
      if (promocionesDB.length > 0) {
        return promocionesDB;
      }

      // Si no hay tabla de promociones, devolver promociones por defecto
      return this.obtenerPromocionesDefecto();
    } catch (error) {
      logger.error('[PROMOCIONES] Error obteniendo promociones:', error);
      return this.obtenerPromocionesDefecto();
    }
  }

  /**
   * Obtiene promociones aplicables a un cliente específico
   */
  async obtenerPromocionesCliente(codigoCliente: string): Promise<Promocion[]> {
    try {
      const todasPromociones = await this.obtenerPromocionesActivas();
      
      return todasPromociones.filter(promo => {
        // Promociones generales aplican a todos
        if (promo.tipoAplicacion === 'general') return true;
        
        // Promociones específicas solo al cliente indicado
        if (promo.clientesAplicables?.includes(codigoCliente)) return true;
        
        return false;
      });
    } catch (error) {
      logger.error('[PROMOCIONES] Error obteniendo promociones cliente:', error);
      return [];
    }
  }

  /**
   * Verifica si una promoción aplica a un producto específico
   */
  async verificarPromocionProducto(
    codigoPromocion: string,
    codigoProducto: string,
    cantidad: number
  ): Promise<{ aplica: boolean; resultado?: ResultadoPromocion }> {
    try {
      const promociones = await this.obtenerPromocionesActivas();
      const promocion = promociones.find(p => p.codigo === codigoPromocion);

      if (!promocion || !promocion.activa) {
        return { aplica: false };
      }

      // Verificar vigencia
      const ahora = new Date();
      if (ahora < promocion.fechaDesde || ahora > promocion.fechaHasta) {
        return { aplica: false };
      }

      // Verificar condiciones
      const cumpleCondiciones = this.verificarCondiciones(
        promocion.condiciones,
        codigoProducto,
        cantidad
      );

      if (!cumpleCondiciones) {
        return { aplica: false };
      }

      return { aplica: true, resultado: promocion.resultado };
    } catch (error) {
      logger.error('[PROMOCIONES] Error verificando promoción:', error);
      return { aplica: false };
    }
  }

  /**
   * Calcula el resultado de aplicar una promoción
   */
  calcularResultadoPromocion(
    precioOriginal: number,
    cantidad: number,
    resultado: ResultadoPromocion
  ): { precioFinal: number; descuentoAplicado: number; productoGratis?: string } {
    switch (resultado.tipo) {
      case 'descuento_porcentaje':
        const descuentoPct = (precioOriginal * cantidad) * (resultado.valor / 100);
        return {
          precioFinal: (precioOriginal * cantidad) - descuentoPct,
          descuentoAplicado: descuentoPct,
        };

      case 'descuento_fijo':
        return {
          precioFinal: Math.max(0, (precioOriginal * cantidad) - resultado.valor),
          descuentoAplicado: resultado.valor,
        };

      case 'producto_gratis':
        return {
          precioFinal: precioOriginal * cantidad,
          descuentoAplicado: 0,
          productoGratis: resultado.productoGratis,
        };

      case 'precio_especial':
        const nuevoPrecio = resultado.valor * cantidad;
        return {
          precioFinal: nuevoPrecio,
          descuentoAplicado: (precioOriginal * cantidad) - nuevoPrecio,
        };

      default:
        return {
          precioFinal: precioOriginal * cantidad,
          descuentoAplicado: 0,
        };
    }
  }

  /**
   * Crea o actualiza una promoción
   */
  async crearPromocion(promocion: Omit<Promocion, 'id'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const id = `PROMO_${Date.now()}`;
      
      // Intentar insertar en BD
      await odbcPool.query(
        `INSERT INTO JAVIER.PROMOCIONES (
          CODIGO_PROMOCION, NOMBRE, DESCRIPCION, TIPO, TIPO_APLICACION,
          FECHA_DESDE, FECHA_HASTA, ACTIVA, PRIORIDAD, CONDICIONES, RESULTADO
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          promocion.codigo,
          promocion.nombre,
          promocion.descripcion || '',
          promocion.tipo,
          promocion.tipoAplicacion,
          promocion.fechaDesde,
          promocion.fechaHasta,
          promocion.activa ? 'S' : 'N',
          promocion.prioridad,
          JSON.stringify(promocion.condiciones),
          JSON.stringify(promocion.resultado),
        ]
      );

      logger.info(`[PROMOCIONES] Promoción creada: ${id}`);
      return { success: true, id };
    } catch (error) {
      logger.error('[PROMOCIONES] Error creando promoción:', error);
      return { success: false, error: 'Error creando promoción' };
    }
  }

  // ============================================
  // MÉTODOS PRIVADOS
  // ============================================

  private async obtenerPromocionesDB(): Promise<Promocion[]> {
    try {
      const resultado = await odbcPool.query<PromocionBD[]>(
        `SELECT 
          CODIGO_PROMOCION, NOMBRE, DESCRIPCION, TIPO, TIPO_APLICACION,
          FECHA_DESDE, FECHA_HASTA, ACTIVA, PRIORIDAD, CONDICIONES, RESULTADO,
          CLIENTES_APLICABLES
        FROM JAVIER.PROMOCIONES
        WHERE ACTIVA = 'S'
          AND FECHA_DESDE <= CURRENT_DATE
          AND FECHA_HASTA >= CURRENT_DATE
        ORDER BY PRIORIDAD DESC`
      );

      return resultado.map(row => this.mapearPromocionDB(row));
    } catch {
      // Tabla puede no existir
      return [];
    }
  }

  private mapearPromocionDB(row: PromocionBD): Promocion {
    let condiciones: CondicionPromocion[] = [];
    let resultado: ResultadoPromocion = { tipo: 'descuento_porcentaje', valor: 0 };

    try {
      if (row.CONDICIONES) {
        condiciones = JSON.parse(row.CONDICIONES);
      }
      if (row.RESULTADO) {
        resultado = JSON.parse(row.RESULTADO);
      }
    } catch {
      logger.warn('[PROMOCIONES] Error parseando JSON de promoción');
    }

    return {
      id: row.CODIGO_PROMOCION,
      codigo: row.CODIGO_PROMOCION,
      nombre: row.NOMBRE,
      descripcion: row.DESCRIPCION,
      tipo: row.TIPO as 'simple' | 'compuesta',
      tipoAplicacion: row.TIPO_APLICACION as 'cliente_especifico' | 'general',
      fechaDesde: new Date(row.FECHA_DESDE),
      fechaHasta: new Date(row.FECHA_HASTA),
      activa: row.ACTIVA === 'S',
      prioridad: row.PRIORIDAD,
      condiciones,
      resultado,
      clientesAplicables: row.CLIENTES_APLICABLES?.split(',').map(c => c.trim()),
    };
  }

  private obtenerPromocionesDefecto(): Promocion[] {
    const ahora = new Date();
    const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);

    return [
      {
        id: 'PROMO_3X2',
        codigo: '3X2',
        nombre: '3x2 en helados',
        descripcion: 'Llévate 3 y paga 2 en helados seleccionados',
        tipo: 'simple',
        tipoAplicacion: 'general',
        fechaDesde: ahora,
        fechaHasta: finMes,
        activa: true,
        prioridad: 10,
        condiciones: [
          { tipo: 'cantidad_minima', valor: 3 },
          { tipo: 'familia', valor: 'HELADOS', codigoFamilia: 'HELADOS' },
        ],
        resultado: {
          tipo: 'producto_gratis',
          valor: 1,
          cantidadGratis: 1,
        },
      },
      {
        id: 'PROMO_10PCT',
        codigo: '10PCT',
        nombre: '10% de descuento',
        descripcion: '10% de descuento en compras superiores a 100€',
        tipo: 'simple',
        tipoAplicacion: 'general',
        fechaDesde: ahora,
        fechaHasta: finMes,
        activa: true,
        prioridad: 5,
        condiciones: [
          { tipo: 'importe_minimo', valor: 100 },
        ],
        resultado: {
          tipo: 'descuento_porcentaje',
          valor: 10,
        },
      },
    ];
  }

  private verificarCondiciones(
    condiciones: CondicionPromocion[],
    codigoProducto: string,
    cantidad: number
  ): boolean {
    for (const condicion of condiciones) {
      switch (condicion.tipo) {
        case 'cantidad_minima':
          if (cantidad < Number(condicion.valor)) return false;
          break;
        case 'producto_especifico':
          if (condicion.codigoProducto !== codigoProducto) return false;
          break;
        // Otros tipos de condiciones
      }
    }
    return true;
  }

  /**
   * Obtiene una promoción específica por código
   */
  async obtenerPromocion(codigo: string): Promise<Promocion | null> {
    try {
      const promociones = await this.obtenerPromocionesActivas();
      return promociones.find(p => p.codigo === codigo) || null;
    } catch (error) {
      logger.error('[PROMOCIONES] Error obteniendo promoción:', error);
      return null;
    }
  }

  /**
   * Aplica una promoción a un conjunto de líneas
   */
  async aplicarPromocion(
    codigoPromocion: string,
    lineas: Array<{ codigoProducto: string; cantidad: number; precioUnitario: number }>,
    codigoCliente: string
  ): Promise<{
    aplicable: boolean;
    mensaje: string;
    descuentoTotal?: number;
    lineasModificadas?: any[];
  }> {
    try {
      const promocion = await this.obtenerPromocion(codigoPromocion);

      if (!promocion) {
        return { aplicable: false, mensaje: 'Promoción no encontrada' };
      }

      if (!promocion.activa) {
        return { aplicable: false, mensaje: 'Promoción no activa' };
      }

      // Verificar vigencia
      const ahora = new Date();
      if (ahora < promocion.fechaDesde || ahora > promocion.fechaHasta) {
        return { aplicable: false, mensaje: 'Promoción fuera de vigencia' };
      }

      // Verificar si aplica al cliente
      if (promocion.tipoAplicacion === 'cliente_especifico') {
        if (!promocion.clientesAplicables?.includes(codigoCliente)) {
          return { aplicable: false, mensaje: 'Promoción no aplicable a este cliente' };
        }
      }

      // Calcular descuentos
      let descuentoTotal = 0;
      const lineasModificadas = lineas.map(linea => {
        const resultado = this.calcularResultadoPromocion(
          linea.precioUnitario,
          linea.cantidad,
          promocion.resultado
        );
        descuentoTotal += resultado.descuentoAplicado;
        return {
          ...linea,
          precioFinal: resultado.precioFinal,
          descuento: resultado.descuentoAplicado,
          promocionAplicada: codigoPromocion,
        };
      });

      return {
        aplicable: true,
        mensaje: 'Promoción aplicada correctamente',
        descuentoTotal,
        lineasModificadas,
      };
    } catch (error) {
      logger.error('[PROMOCIONES] Error aplicando promoción:', error);
      return { aplicable: false, mensaje: 'Error al aplicar promoción' };
    }
  }

  /**
   * Calcula todas las promociones aplicables a un conjunto de líneas
   */
  async calcularPromocionesAplicables(
    lineas: Array<{ codigoProducto: string; cantidad: number; precioUnitario: number; familia?: string }>,
    codigoCliente: string
  ): Promise<Array<{
    promocion: Promocion;
    descuentoEstimado: number;
    aplicable: boolean;
    razon?: string;
  }>> {
    try {
      const promocionesCliente = await this.obtenerPromocionesCliente(codigoCliente);
      const resultados: Array<{
        promocion: Promocion;
        descuentoEstimado: number;
        aplicable: boolean;
        razon?: string;
      }> = [];

      for (const promocion of promocionesCliente) {
        let aplicable = true;
        let razon = '';
        let descuentoEstimado = 0;

        // Verificar vigencia
        const ahora = new Date();
        if (ahora < promocion.fechaDesde || ahora > promocion.fechaHasta) {
          aplicable = false;
          razon = 'Fuera de vigencia';
        }

        // Verificar condiciones
        if (aplicable) {
          for (const condicion of promocion.condiciones) {
            if (condicion.tipo === 'importe_minimo') {
              const importeTotal = lineas.reduce((sum, l) => sum + l.precioUnitario * l.cantidad, 0);
              if (importeTotal < Number(condicion.valor)) {
                aplicable = false;
                razon = `Importe mínimo: ${condicion.valor}€`;
              }
            }
            if (condicion.tipo === 'cantidad_minima') {
              const cantidadTotal = lineas.reduce((sum, l) => sum + l.cantidad, 0);
              if (cantidadTotal < Number(condicion.valor)) {
                aplicable = false;
                razon = `Cantidad mínima: ${condicion.valor} unidades`;
              }
            }
          }
        }

        // Estimar descuento
        if (aplicable) {
          for (const linea of lineas) {
            const resultado = this.calcularResultadoPromocion(
              linea.precioUnitario,
              linea.cantidad,
              promocion.resultado
            );
            descuentoEstimado += resultado.descuentoAplicado;
          }
        }

        resultados.push({
          promocion,
          descuentoEstimado,
          aplicable,
          razon: aplicable ? undefined : razon,
        });
      }

      // Ordenar por prioridad y descuento
      return resultados.sort((a, b) => {
        if (a.aplicable !== b.aplicable) return a.aplicable ? -1 : 1;
        return b.descuentoEstimado - a.descuentoEstimado;
      });
    } catch (error) {
      logger.error('[PROMOCIONES] Error calculando promociones:', error);
      return [];
    }
  }
}

export const promocionesService = new PromocionesService();
export default promocionesService;
