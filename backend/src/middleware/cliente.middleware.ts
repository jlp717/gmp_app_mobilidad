/**
 * MIDDLEWARE DE CLIENTE
 * Validación de estado del cliente para operaciones de cobros y pedidos
 * Bloquea operaciones si el cliente está "en rojo" (moroso)
 */

import { Request, Response, NextFunction } from 'express';
import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';

// Configuración de umbrales
const CONFIG = {
    DIAS_MORA_LIMITE: 30,
    UMBRAL_DEUDA_CRITICA: 10000 // €
};

export interface EstadoCliente {
    codigo: string;
    nombre: string;
    limiteCredito: number;
    totalPendiente: number;
    diasMora: number;
    estado: 'ACTIVO' | 'EN_ROJO' | 'BLOQUEADO';
    motivo?: string;
}

/**
 * Middleware que verifica que el cliente puede realizar operaciones
 * Bloquea si está "en rojo" (moroso)
 */
export function requireClienteActivo(req: Request, res: Response, next: NextFunction): void {
    const codigoCliente = req.params.codigoCliente || req.body.codigoCliente;

    if (!codigoCliente) {
        res.status(400).json({
            success: false,
            error: 'Código de cliente requerido',
            code: 'MISSING_CLIENT_CODE'
        });
        return;
    }

    verificarEstadoCliente(codigoCliente)
        .then(estado => {
            if (estado.estado === 'BLOQUEADO') {
                logger.warn(`[CLIENTE] Operación bloqueada para cliente ${codigoCliente}: ${estado.motivo}`);
                res.status(403).json({
                    success: false,
                    error: 'Cliente bloqueado para esta operación',
                    code: 'CLIENTE_BLOQUEADO',
                    motivo: estado.motivo,
                    estadoCliente: estado
                });
                return;
            }

            if (estado.estado === 'EN_ROJO') {
                logger.warn(`[CLIENTE] Cliente en rojo: ${codigoCliente}`);
                // Añadir advertencia pero permitir continuar
                (req as Request & { clienteEnRojo?: boolean; estadoCliente?: EstadoCliente }).clienteEnRojo = true;
                (req as Request & { estadoCliente?: EstadoCliente }).estadoCliente = estado;
            }

            next();
        })
        .catch(error => {
            logger.error('[CLIENTE] Error verificando estado:', error);
            // En caso de error, permitir continuar (fail open por seguridad operativa)
            next();
        });
}

/**
 * Middleware estricto - bloquea también clientes "en rojo"
 */
export function requireClienteActivoEstricto(req: Request, res: Response, next: NextFunction): void {
    const codigoCliente = req.params.codigoCliente || req.body.codigoCliente;

    if (!codigoCliente) {
        res.status(400).json({
            success: false,
            error: 'Código de cliente requerido',
            code: 'MISSING_CLIENT_CODE'
        });
        return;
    }

    verificarEstadoCliente(codigoCliente)
        .then(estado => {
            if (estado.estado !== 'ACTIVO') {
                logger.warn(`[CLIENTE] Operación bloqueada (estricto) para cliente ${codigoCliente}: ${estado.motivo}`);
                res.status(403).json({
                    success: false,
                    error: 'Cliente no puede realizar esta operación',
                    code: estado.estado === 'BLOQUEADO' ? 'CLIENTE_BLOQUEADO' : 'CLIENTE_EN_ROJO',
                    motivo: estado.motivo,
                    estadoCliente: estado
                });
                return;
            }

            next();
        })
        .catch(error => {
            logger.error('[CLIENTE] Error verificando estado:', error);
            next();
        });
}

/**
 * Verifica el estado de un cliente consultando la BD
 */
export async function verificarEstadoCliente(codigoCliente: string): Promise<EstadoCliente> {
    try {
        // Obtener datos del cliente
        const [clienteRow] = await odbcPool.query<Record<string, unknown>[]>(
            `SELECT 
        CLI.CODCLI,
        CLI.NOMCLI,
        COALESCE(CLI.LIMCRECLI, 0) as LIMITE_CREDITO
      FROM DSEDAC.CLI CLI
      WHERE TRIM(CLI.CODCLI) = ?
      FETCH FIRST 1 ROWS ONLY`,
            [codigoCliente.trim().toUpperCase()]
        );

        if (!clienteRow) {
            return {
                codigo: codigoCliente,
                nombre: 'Desconocido',
                limiteCredito: 0,
                totalPendiente: 0,
                diasMora: 0,
                estado: 'ACTIVO'
            };
        }

        // Obtener total pendiente y días de mora
        const [pendienteRow] = await odbcPool.query<Record<string, unknown>[]>(
            `SELECT
        COALESCE(SUM(COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL)), 0) as TOTAL_PENDIENTE,
        COALESCE(
          DAYS(CURRENT_DATE) - DAYS(
            MIN(DATE(
              CAC.ANODOCUMENTO || '-' ||
              LPAD(CAST(CAC.MESDOCUMENTO AS VARCHAR(2)), 2, '0') || '-' ||
              LPAD(CAST(CAC.DIADOCUMENTO AS VARCHAR(2)), 2, '0')
            ))
          ),
          0
        ) as DIAS_MORA
      FROM DSEDAC.CAC
      LEFT JOIN DSEDAC.CVC 
        ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
        AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
        AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
      WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
        AND COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0`,
            [codigoCliente.trim().toUpperCase()]
        );

        const limiteCredito = parseFloat(String(clienteRow.LIMITE_CREDITO)) || 0;
        const totalPendiente = parseFloat(String(pendienteRow?.TOTAL_PENDIENTE)) || 0;
        const diasMora = parseInt(String(pendienteRow?.DIAS_MORA)) || 0;

        // Determinar estado
        let estado: 'ACTIVO' | 'EN_ROJO' | 'BLOQUEADO' = 'ACTIVO';
        let motivo: string | undefined;

        if (totalPendiente > CONFIG.UMBRAL_DEUDA_CRITICA && diasMora > 90) {
            estado = 'BLOQUEADO';
            motivo = `Deuda crítica de ${totalPendiente.toFixed(2)}€ con ${diasMora} días de mora`;
        } else if (limiteCredito > 0 && totalPendiente > limiteCredito) {
            estado = 'EN_ROJO';
            motivo = `Excede límite de crédito (${totalPendiente.toFixed(2)}€ > ${limiteCredito.toFixed(2)}€)`;
        } else if (diasMora > CONFIG.DIAS_MORA_LIMITE) {
            estado = 'EN_ROJO';
            motivo = `Mora excesiva: ${diasMora} días (límite: ${CONFIG.DIAS_MORA_LIMITE})`;
        }

        return {
            codigo: String(clienteRow.CODCLI).trim(),
            nombre: String(clienteRow.NOMCLI).trim(),
            limiteCredito,
            totalPendiente,
            diasMora,
            estado,
            motivo
        };

    } catch (error) {
        logger.error('[CLIENTE] Error en verificarEstadoCliente:', error);
        // En caso de error, devolver estado activo para no bloquear operaciones
        return {
            codigo: codigoCliente,
            nombre: 'Error consultando',
            limiteCredito: 0,
            totalPendiente: 0,
            diasMora: 0,
            estado: 'ACTIVO'
        };
    }
}

/**
 * Handler para obtener estado de un cliente
 */
export async function getEstadoCliente(req: Request, res: Response): Promise<void> {
    try {
        const { codigoCliente } = req.params;
        const estado = await verificarEstadoCliente(codigoCliente);

        res.json({
            success: true,
            estadoCliente: estado
        });
    } catch (error) {
        logger.error('[CLIENTE] Error obteniendo estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo estado del cliente'
        });
    }
}

export default {
    requireClienteActivo,
    requireClienteActivoEstricto,
    verificarEstadoCliente,
    getEstadoCliente
};
