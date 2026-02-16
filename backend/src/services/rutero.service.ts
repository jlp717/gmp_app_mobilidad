/**
 * SERVICIO DE RUTERO
 * 
 * Gestiona el rutero de visitas por día de la semana
 * Datos desde la vista LACLAE del IBM i
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { toInt, toStr } from '../utils/db-helpers';
import { queryCache, TTL } from '../utils/query-cache';

export interface ClienteRutero {
  codigo: string;
  nombre: string;
  direccion: string;
  poblacion: string;
  telefono: string;
  comercial: string;
  diasVisita: {
    lunes: boolean;
    martes: boolean;
    miercoles: boolean;
    jueves: boolean;
    viernes: boolean;
    sabado: boolean;
    domingo: boolean;
  };
  ultimaVisita?: string;
  proximaVisita?: string;
  coordenadas?: {
    lat: number;
    lng: number;
  };
}

export interface RuteroSemana {
  lunes: ClienteRutero[];
  martes: ClienteRutero[];
  miercoles: ClienteRutero[];
  jueves: ClienteRutero[];
  viernes: ClienteRutero[];
  sabado: ClienteRutero[];
  domingo: ClienteRutero[];
}

class RuteroService {
  /**
   * Obtiene los clientes del rutero para un día específico
   */
  async getRuteroDia(dia?: string): Promise<ClienteRutero[]> {
    const diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const diaKey = dia?.toLowerCase() || diasSemana[new Date().getDay()];
    return queryCache.getOrSet(
      `gmp:rutero:dia:${diaKey}`,
      () => this._fetchRuteroDia(dia),
      TTL.LONG
    );
  }

  private async _fetchRuteroDia(dia?: string): Promise<ClienteRutero[]> {
    try {
      // Determinar el día de la semana
      const diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
      const diaActual = dia?.toLowerCase() || diasSemana[new Date().getDay()];

      // Mapear día a campo de la tabla
      const diaField = this.getDiaField(diaActual);
      
      if (!diaField) {
        return [];
      }

      const query = `
        SELECT DISTINCT
          CLI.CODIGO_CLIENTE_ALBARAN AS codigo,
          CLI.NOMBRE_CLIENTE AS nombre,
          CLI.DIRECCION AS direccion,
          CLI.POBLACION AS poblacion,
          CLI.TELEFONO AS telefono,
          CLI.CODIGO_COMERCIAL AS comercial,
          CLI.R1_T8DIVL AS diaLunes,
          CLI.R1_T8DIVM AS diaMartes,
          CLI.R1_T8DIVX AS diaMiercoles,
          CLI.R1_T8DIVJ AS diaJueves,
          CLI.R1_T8DIVV AS diaViernes,
          CLI.R1_T8DIVS AS diaSabado,
          CLI.R1_T8DIVD AS diaDomingo
        FROM DSED.LACLAE CLI
        WHERE CLI.CODIGO_CLIENTE_ALBARAN IS NOT NULL
          AND CLI.CODIGO_CLIENTE_ALBARAN <> ''
          AND CLI.TIPO_LINEA = 'T'
          AND CLI.${diaField} = 'S'
        GROUP BY 
          CLI.CODIGO_CLIENTE_ALBARAN,
          CLI.NOMBRE_CLIENTE,
          CLI.DIRECCION,
          CLI.POBLACION,
          CLI.TELEFONO,
          CLI.CODIGO_COMERCIAL,
          CLI.R1_T8DIVL,
          CLI.R1_T8DIVM,
          CLI.R1_T8DIVX,
          CLI.R1_T8DIVJ,
          CLI.R1_T8DIVV,
          CLI.R1_T8DIVS,
          CLI.R1_T8DIVD
        ORDER BY CLI.NOMBRE_CLIENTE
        FETCH FIRST 200 ROWS ONLY
      `;

      const result = await odbcPool.query<any[]>(query);

      return result.map((row: any) => ({
        codigo: toStr(row.CODIGO),
        nombre: toStr(row.NOMBRE) || `Cliente ${row.CODIGO}`,
        direccion: toStr(row.DIRECCION),
        poblacion: toStr(row.POBLACION),
        telefono: toStr(row.TELEFONO),
        comercial: toStr(row.COMERCIAL),
        diasVisita: {
          lunes: row.DIALUNES === 'S',
          martes: row.DIAMARTES === 'S',
          miercoles: row.DIAMIERCOLES === 'S',
          jueves: row.DIAJUEVES === 'S',
          viernes: row.DIAVIERNES === 'S',
          sabado: row.DIASABADO === 'S',
          domingo: row.DIADOMINGO === 'S',
        },
      }));
    } catch (error) {
      logger.error('Error obteniendo rutero del día:', error);
      throw error;
    }
  }

  /**
   * Obtiene el rutero completo de la semana
   */
  async getRuteroSemana(): Promise<RuteroSemana> {
    return queryCache.getOrSet('gmp:rutero:semana', () => this._fetchRuteroSemana(), TTL.LONG);
  }

  private async _fetchRuteroSemana(): Promise<RuteroSemana> {
    try {
      const query = `
        SELECT DISTINCT
          CODIGO_CLIENTE_ALBARAN AS codigo,
          NOMBRE_CLIENTE AS nombre,
          DIRECCION AS direccion,
          POBLACION AS poblacion,
          TELEFONO AS telefono,
          CODIGO_COMERCIAL AS comercial,
          R1_T8DIVL AS diaLunes,
          R1_T8DIVM AS diaMartes,
          R1_T8DIVX AS diaMiercoles,
          R1_T8DIVJ AS diaJueves,
          R1_T8DIVV AS diaViernes,
          R1_T8DIVS AS diaSabado,
          R1_T8DIVD AS diaDomingo
        FROM DSED.LACLAE
        WHERE CODIGO_CLIENTE_ALBARAN IS NOT NULL
          AND CODIGO_CLIENTE_ALBARAN <> ''
          AND TIPO_LINEA = 'T'
          AND (R1_T8DIVL = 'S' OR R1_T8DIVM = 'S' OR R1_T8DIVX = 'S' 
               OR R1_T8DIVJ = 'S' OR R1_T8DIVV = 'S' OR R1_T8DIVS = 'S' 
               OR R1_T8DIVD = 'S')
        GROUP BY 
          CODIGO_CLIENTE_ALBARAN,
          NOMBRE_CLIENTE,
          DIRECCION,
          POBLACION,
          TELEFONO,
          CODIGO_COMERCIAL,
          R1_T8DIVL,
          R1_T8DIVM,
          R1_T8DIVX,
          R1_T8DIVJ,
          R1_T8DIVV,
          R1_T8DIVS,
          R1_T8DIVD
        ORDER BY NOMBRE_CLIENTE
        FETCH FIRST 500 ROWS ONLY
      `;

      const result = await odbcPool.query<any[]>(query);

      const rutero: RuteroSemana = {
        lunes: [],
        martes: [],
        miercoles: [],
        jueves: [],
        viernes: [],
        sabado: [],
        domingo: [],
      };

      for (const row of result) {
        const cliente: ClienteRutero = {
          codigo: toStr(row.CODIGO),
          nombre: toStr(row.NOMBRE) || `Cliente ${row.CODIGO}`,
          direccion: toStr(row.DIRECCION),
          poblacion: toStr(row.POBLACION),
          telefono: toStr(row.TELEFONO),
          comercial: toStr(row.COMERCIAL),
          diasVisita: {
            lunes: row.DIALUNES === 'S',
            martes: row.DIAMARTES === 'S',
            miercoles: row.DIAMIERCOLES === 'S',
            jueves: row.DIAJUEVES === 'S',
            viernes: row.DIAVIERNES === 'S',
            sabado: row.DIASABADO === 'S',
            domingo: row.DIADOMINGO === 'S',
          },
        };

        if (cliente.diasVisita.lunes) rutero.lunes.push(cliente);
        if (cliente.diasVisita.martes) rutero.martes.push(cliente);
        if (cliente.diasVisita.miercoles) rutero.miercoles.push(cliente);
        if (cliente.diasVisita.jueves) rutero.jueves.push(cliente);
        if (cliente.diasVisita.viernes) rutero.viernes.push(cliente);
        if (cliente.diasVisita.sabado) rutero.sabado.push(cliente);
        if (cliente.diasVisita.domingo) rutero.domingo.push(cliente);
      }

      return rutero;
    } catch (error) {
      logger.error('Error obteniendo rutero de la semana:', error);
      throw error;
    }
  }

  /**
   * Obtiene resumen del rutero (conteo por día)
   */
  async getResumenRutero(): Promise<{
    lunes: number; martes: number; miercoles: number; jueves: number;
    viernes: number; sabado: number; domingo: number; total: number;
  }> {
    return queryCache.getOrSet('gmp:rutero:resumen', () => this._fetchResumenRutero(), TTL.LONG);
  }

  private async _fetchResumenRutero(): Promise<{
    lunes: number;
    martes: number;
    miercoles: number;
    jueves: number;
    viernes: number;
    sabado: number;
    domingo: number;
    total: number;
  }> {
    try {
      const query = `
        SELECT 
          COUNT(CASE WHEN R1_T8DIVL = 'S' THEN 1 END) AS lunes,
          COUNT(CASE WHEN R1_T8DIVM = 'S' THEN 1 END) AS martes,
          COUNT(CASE WHEN R1_T8DIVX = 'S' THEN 1 END) AS miercoles,
          COUNT(CASE WHEN R1_T8DIVJ = 'S' THEN 1 END) AS jueves,
          COUNT(CASE WHEN R1_T8DIVV = 'S' THEN 1 END) AS viernes,
          COUNT(CASE WHEN R1_T8DIVS = 'S' THEN 1 END) AS sabado,
          COUNT(CASE WHEN R1_T8DIVD = 'S' THEN 1 END) AS domingo,
          COUNT(DISTINCT CODIGO_CLIENTE_ALBARAN) AS total
        FROM (
          SELECT DISTINCT 
            CODIGO_CLIENTE_ALBARAN,
            R1_T8DIVL, R1_T8DIVM, R1_T8DIVX, 
            R1_T8DIVJ, R1_T8DIVV, R1_T8DIVS, R1_T8DIVD
          FROM DSED.LACLAE
          WHERE CODIGO_CLIENTE_ALBARAN IS NOT NULL
            AND CODIGO_CLIENTE_ALBARAN <> ''
            AND TIPO_LINEA = 'T'
        ) AS clientes
      `;

      const result = await odbcPool.query<any[]>(query);
      const row = result[0] || {};

      return {
        lunes: toInt(row.LUNES),
        martes: toInt(row.MARTES),
        miercoles: toInt(row.MIERCOLES),
        jueves: toInt(row.JUEVES),
        viernes: toInt(row.VIERNES),
        sabado: toInt(row.SABADO),
        domingo: toInt(row.DOMINGO),
        total: toInt(row.TOTAL),
      };
    } catch (error) {
      logger.error('Error obteniendo resumen de rutero:', error);
      throw error;
    }
  }

  /**
   * Helper: Obtiene el campo de día correspondiente
   */
  private getDiaField(dia: string): string | null {
    const mapping: Record<string, string> = {
      lunes: 'R1_T8DIVL',
      martes: 'R1_T8DIVM',
      miercoles: 'R1_T8DIVX',
      miércoles: 'R1_T8DIVX',
      jueves: 'R1_T8DIVJ',
      viernes: 'R1_T8DIVV',
      sabado: 'R1_T8DIVS',
      sábado: 'R1_T8DIVS',
      domingo: 'R1_T8DIVD',
    };

    return mapping[dia] || null;
  }
}

export const ruteroService = new RuteroService();
