/**
 * CONTROLADOR DE ENTREGAS
 * Endpoints para repartidor - gestión de entregas, fotos y firmas
 */

import { Request, Response } from 'express';
import { entregasService, EstadoEntrega } from '../services/entregas.service';
import { asyncHandler } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

/**
 * GET /api/entregas/pendientes/:repartidorId
 * Obtener albaranes pendientes del repartidor
 */
export const obtenerEntregasPendientes = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
        const { repartidorId } = req.params;
        const { limit, offset } = req.query;

        logger.info(`[ENTREGAS] Obteniendo pendientes para repartidor: ${repartidorId}`);

        const result = await entregasService.obtenerAlbaranesPendientes(
            repartidorId,
            limit ? parseInt(limit as string, 10) : undefined,
            offset ? parseInt(offset as string, 10) : undefined,
        );

        res.json({
            success: true,
            albaranes: result.albaranes,
            total: result.total,
            paginacion: result.paginacion,
            fecha: new Date().toISOString().split('T')[0]
        });
    }
);

/**
 * GET /api/entregas/albaran/:numero/:ejercicio
 * Obtener detalle de un albarán con sus items
 */
export const obtenerAlbaran = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
        const { numero, ejercicio } = req.params;

        const albaran = await entregasService.obtenerAlbaran(
            parseInt(numero),
            parseInt(ejercicio)
        );

        if (!albaran) {
            res.status(404).json({
                success: false,
                error: 'Albarán no encontrado'
            });
            return;
        }

        res.json({
            success: true,
            albaran
        });
    }
);

/**
 * POST /api/entregas/update
 * Actualizar estado de una entrega (item o albarán)
 */
export const actualizarEntrega = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
        const {
            itemId,
            status,
            repartidorId,
            cantidadEntregada,
            observaciones,
            fotos,
            firma,
            latitud,
            longitud
        } = req.body;

        // Validar status
        const estadosValidos: EstadoEntrega[] = [
            'PENDIENTE', 'EN_RUTA', 'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO'
        ];

        if (!estadosValidos.includes(status)) {
            res.status(400).json({
                success: false,
                error: `Estado inválido. Valores permitidos: ${estadosValidos.join(', ')}`
            });
            return;
        }

        const resultado = await entregasService.actualizarEstadoEntrega({
            itemId,
            status,
            repartidorId: repartidorId || req.user?.codigoVendedor || 'UNKNOWN',
            cantidadEntregada,
            observaciones,
            fotos,
            firma,
            latitud,
            longitud
        });

        if (!resultado.success) {
            res.status(400).json(resultado);
            return;
        }

        res.status(200).json({
            success: true,
            mensaje: 'Entrega actualizada correctamente',
            registroId: resultado.registroId
        });
    }
);

/**
 * POST /api/uploads/photo
 * Subir foto de entrega (usar con multer)
 */
export const subirFoto = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
        const { entregaId } = req.body;
        const file = req.file;

        if (!file) {
            res.status(400).json({
                success: false,
                error: 'No se recibió ningún archivo'
            });
            return;
        }

        if (!entregaId) {
            res.status(400).json({
                success: false,
                error: 'entregaId es requerido'
            });
            return;
        }

        const resultado = await entregasService.registrarFoto(entregaId, file);

        if (!resultado.success) {
            res.status(400).json(resultado);
            return;
        }

        res.status(201).json({
            success: true,
            mensaje: 'Foto subida correctamente',
            path: resultado.path
        });
    }
);

/**
 * POST /api/uploads/signature
 * Guardar firma en base64
 */
export const guardarFirma = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
        const { entregaId, firma } = req.body;

        if (!entregaId || !firma) {
            res.status(400).json({
                success: false,
                error: 'entregaId y firma son requeridos'
            });
            return;
        }

        try {
            const path = await entregasService.guardarFirma(entregaId, firma);

            res.status(201).json({
                success: true,
                mensaje: 'Firma guardada correctamente',
                path
            });
        } catch (error) {
            logger.error('[ENTREGAS] Error guardando firma:', error);
            res.status(500).json({
                success: false,
                error: 'Error guardando firma'
            });
        }
    }
);

export default {
    obtenerEntregasPendientes,
    obtenerAlbaran,
    actualizarEntrega,
    subirFoto,
    guardarFirma
};
