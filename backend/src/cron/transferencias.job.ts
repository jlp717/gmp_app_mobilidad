/**
 * JOB CRON: TRANSFERENCIAS PROGRAMADAS
 * Procesa transferencias automáticas y alertas de CTR vencidos
 * 
 * Ejecuta diariamente a las 06:00 AM
 */

import schedule from 'node-schedule';
import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// CONFIGURACIÓN
// ============================================

const CONFIG = {
    // Hora de ejecución (06:00 AM)
    HORA_EJECUCION: '0 6 * * *',
    // Días de gracia para CTR
    DIAS_GRACIA_CTR: 3,
    // Habilitar/deshabilitar jobs
    ENABLED: process.env.CRON_ENABLED !== 'false'
};

// ============================================
// INTERFACES
// ============================================

interface TransferenciaProgramada {
    id: string;
    codigoCliente: string;
    diaMes: number;
    importe: number;
    estado: 'PENDIENTE' | 'PROCESADA' | 'ERROR';
}

interface CTRPendiente {
    cliente: string;
    nombreCliente: string;
    albaran: number;
    importe: number;
    diasPendiente: number;
}

// ============================================
// FUNCIONES DE PROCESAMIENTO
// ============================================

/**
 * Procesa transferencias programadas para el día actual
 */
async function procesarTransferenciasProgramadas(): Promise<void> {
    const diaActual = new Date().getDate();

    logger.info(`[CRON] Procesando transferencias programadas para día ${diaActual}`);

    try {
        // Buscar transferencias programadas para hoy
        const transferencias = await odbcPool.query<Record<string, unknown>[]>(
            `SELECT 
        ID, CODIGO_CLIENTE, DIA_MES, IMPORTE, ESTADO
      FROM JAVIER.TRANSFERENCIAS_PROGRAMADAS
      WHERE DIA_MES = ?
        AND ESTADO = 'PENDIENTE'`,
            [diaActual]
        );

        logger.info(`[CRON] Encontradas ${transferencias.length} transferencias para procesar`);

        for (const trans of transferencias) {
            try {
                // Crear registro de cobro por transferencia
                const cobroId = uuidv4();

                await odbcPool.query(
                    `INSERT INTO JAVIER.COBROS (
            ID, CODIGO_CLIENTE, REFERENCIA, IMPORTE, FORMA_PAGO,
            OBSERVACIONES, FECHA, ORIGEN
          ) VALUES (?, ?, ?, ?, 'TRANSFERENCIA', ?, CURRENT_TIMESTAMP, 'CRON')`,
                    [
                        cobroId,
                        trans.CODIGO_CLIENTE,
                        `TRANS-AUTO-${diaActual}`,
                        trans.IMPORTE,
                        `Transferencia automática programada día ${diaActual}`
                    ]
                );

                // Marcar transferencia como procesada
                await odbcPool.query(
                    `UPDATE JAVIER.TRANSFERENCIAS_PROGRAMADAS
           SET ESTADO = 'PROCESADA', FECHA_PROCESO = CURRENT_TIMESTAMP
           WHERE ID = ?`,
                    [trans.ID]
                );

                logger.info(`[CRON] Transferencia procesada: ${trans.ID} - Cliente: ${trans.CODIGO_CLIENTE}`);

            } catch (error) {
                logger.error(`[CRON] Error procesando transferencia ${trans.ID}:`, error);

                // Marcar como error
                try {
                    await odbcPool.query(
                        `UPDATE JAVIER.TRANSFERENCIAS_PROGRAMADAS
             SET ESTADO = 'ERROR', OBSERVACIONES = ?
             WHERE ID = ?`,
                        [`Error: ${error instanceof Error ? error.message : 'Desconocido'}`, trans.ID]
                    );
                } catch { /* ignore */ }
            }
        }

        logger.info(`[CRON] Proceso de transferencias completado`);

    } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
            logger.warn('[CRON] Tabla TRANSFERENCIAS_PROGRAMADAS no existe. Saltando...');
        } else {
            logger.error('[CRON] Error en procesarTransferenciasProgramadas:', error);
        }
    }
}

/**
 * Detecta y alerta sobre CTR vencidos
 */
async function alertarCTRVencidos(): Promise<void> {
    logger.info('[CRON] Verificando CTR vencidos...');

    try {
        // Buscar albaranes CTR con más de X días sin cobrar
        const ctrPendientes = await odbcPool.query<Record<string, unknown>[]>(
            `SELECT
        CAC.CODIGOCLIENTEFACTURA as CLIENTE,
        CLI.NOMCLI as NOMBRE_CLIENTE,
        CAC.NUMEROALBARAN,
        COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) as IMPORTE,
        DAYS(CURRENT_DATE) - DAYS(
          DATE(
            CAC.ANODOCUMENTO || '-' ||
            LPAD(CAST(CAC.MESDOCUMENTO AS VARCHAR(2)), 2, '0') || '-' ||
            LPAD(CAST(CAC.DIADOCUMENTO AS VARCHAR(2)), 2, '0')
          )
        ) as DIAS_PENDIENTE
      FROM DSEDAC.CAC
      LEFT JOIN DSEDAC.CVC 
        ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
        AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
        AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
      LEFT JOIN DSEDAC.CLI ON TRIM(CLI.CODCLI) = TRIM(CAC.CODIGOCLIENTEFACTURA)
      WHERE (
        UPPER(TRIM(CAC.CODIGOFORMAPAGO)) LIKE '%CTR%'
        OR UPPER(TRIM(CAC.CODIGOFORMAPAGO)) LIKE '%REEMB%'
      )
      AND COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
      AND DAYS(CURRENT_DATE) - DAYS(
        DATE(
          CAC.ANODOCUMENTO || '-' ||
          LPAD(CAST(CAC.MESDOCUMENTO AS VARCHAR(2)), 2, '0') || '-' ||
          LPAD(CAST(CAC.DIADOCUMENTO AS VARCHAR(2)), 2, '0')
        )
      ) > ?
      ORDER BY DIAS_PENDIENTE DESC
      FETCH FIRST 50 ROWS ONLY`,
            [CONFIG.DIAS_GRACIA_CTR]
        );

        if (ctrPendientes.length > 0) {
            logger.warn(`[CRON] ⚠️ ALERTA: ${ctrPendientes.length} CTR vencidos encontrados`);

            const alertas: CTRPendiente[] = ctrPendientes.map(row => ({
                cliente: String(row.CLIENTE).trim(),
                nombreCliente: String(row.NOMBRE_CLIENTE || '').trim(),
                albaran: Number(row.NUMEROALBARAN),
                importe: parseFloat(String(row.IMPORTE)) || 0,
                diasPendiente: Number(row.DIAS_PENDIENTE)
            }));

            // Log de alertas
            alertas.forEach(ctr => {
                logger.warn(
                    `[CTR VENCIDO] Cliente: ${ctr.cliente} (${ctr.nombreCliente}) - ` +
                    `Albarán: ${ctr.albaran} - Importe: ${ctr.importe.toFixed(2)}€ - ` +
                    `Días: ${ctr.diasPendiente}`
                );
            });

            // TODO: Aquí se podría integrar envío de email o notificación
            // await enviarNotificacionCTR(alertas);

            // Registrar alerta en tabla (si existe)
            try {
                await odbcPool.query(
                    `INSERT INTO JAVIER.ALERTAS_COBROS (
            ID, TIPO, FECHA, DETALLE
          ) VALUES (?, 'CTR_VENCIDO', CURRENT_TIMESTAMP, ?)`,
                    [uuidv4(), JSON.stringify(alertas)]
                );
            } catch { /* tabla puede no existir */ }
        } else {
            logger.info('[CRON] No hay CTR vencidos');
        }

    } catch (error) {
        logger.error('[CRON] Error en alertarCTRVencidos:', error);
    }
}

/**
 * Reconcilia reposicionamientos pendientes
 */
async function reconciliarReposicionamientos(): Promise<void> {
    logger.info('[CRON] Reconciliando reposicionamientos...');

    try {
        // Buscar clientes con reposicionamiento activo
        // Este es un placeholder - ajustar según lógica de negocio real
        const reposiciones = await odbcPool.query<Record<string, unknown>[]>(
            `SELECT 
        CODIGO_CLIENTE, TIPO_REPOSICION, FRECUENCIA_DIAS
      FROM JAVIER.REPOSICIONAMIENTOS
      WHERE ESTADO = 'ACTIVO'
        AND PROXIMA_FECHA <= CURRENT_DATE`
        );

        logger.info(`[CRON] ${reposiciones.length} reposicionamientos a procesar`);

        // Procesar cada reposicionamiento
        for (const repo of reposiciones) {
            logger.info(`[CRON] Procesando reposicionamiento: ${repo.CODIGO_CLIENTE}`);
            // TODO: Implementar lógica de reposicionamiento según necesidades
        }

    } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
            logger.debug('[CRON] Tabla REPOSICIONAMIENTOS no existe. Saltando...');
        } else {
            logger.error('[CRON] Error en reconciliarReposicionamientos:', error);
        }
    }
}

// ============================================
// INICIALIZACIÓN DEL JOB
// ============================================

/**
 * Inicializa los jobs cron
 */
export function iniciarJobsCobros(): void {
    if (!CONFIG.ENABLED) {
        logger.info('[CRON] Jobs de cobros deshabilitados por configuración');
        return;
    }

    logger.info('[CRON] Iniciando jobs de cobros...');

    // Job principal: 06:00 AM cada día
    schedule.scheduleJob('cobros-diario', CONFIG.HORA_EJECUCION, async () => {
        logger.info('[CRON] ═══════════════════════════════════════');
        logger.info('[CRON] Iniciando proceso diario de cobros...');
        logger.info('[CRON] ═══════════════════════════════════════');

        try {
            await procesarTransferenciasProgramadas();
            await alertarCTRVencidos();
            await reconciliarReposicionamientos();

            logger.info('[CRON] ═══════════════════════════════════════');
            logger.info('[CRON] Proceso diario completado exitosamente');
            logger.info('[CRON] ═══════════════════════════════════════');

        } catch (error) {
            logger.error('[CRON] Error en proceso diario:', error);
        }
    });

    logger.info(`[CRON] Job programado: cobros-diario (${CONFIG.HORA_EJECUCION})`);
}

/**
 * Detiene los jobs cron
 */
export function detenerJobsCobros(): void {
    const job = schedule.scheduledJobs['cobros-diario'];
    if (job) {
        job.cancel();
        logger.info('[CRON] Job cobros-diario cancelado');
    }
}

/**
 * Ejecuta el proceso manualmente (para testing)
 */
export async function ejecutarProcesoManual(): Promise<void> {
    logger.info('[CRON] Ejecutando proceso manual...');
    await procesarTransferenciasProgramadas();
    await alertarCTRVencidos();
    await reconciliarReposicionamientos();
    logger.info('[CRON] Proceso manual completado');
}

export default {
    iniciarJobsCobros,
    detenerJobsCobros,
    ejecutarProcesoManual
};
