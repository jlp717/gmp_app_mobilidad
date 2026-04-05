/**
 * RUTAS DE ENTREGAS - REPARTIDOR
 * Endpoints para gestión de entregas, fotos y firmas
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import * as entregasController from '../controllers/entregas.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/security.middleware';

const router = Router();

// Configuración de multer para fotos
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, path.join(__dirname, '../../uploads/photos'));
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `entrega-${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no permitido. Solo JPEG, PNG y WebP.'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
        files: 5 // máximo 5 fotos por request
    }
});

// ============================================
// RUTAS DE ENTREGAS
// ============================================

// Obtener albaranes pendientes del repartidor
router.get(
    '/pendientes/:repartidorId',
    requireAuth,
    generalLimiter,
    entregasController.obtenerEntregasPendientes
);

// Obtener detalle de un albarán
router.get(
    '/albaran/:numero/:ejercicio',
    requireAuth,
    generalLimiter,
    entregasController.obtenerAlbaran
);

// Actualizar estado de entrega
router.post(
    '/update',
    requireAuth,
    generalLimiter,
    entregasController.actualizarEntrega
);

// ============================================
// RUTAS DE UPLOADS
// ============================================

// Subir foto de entrega
router.post(
    '/uploads/photo',
    requireAuth,
    generalLimiter,
    upload.single('photo'),
    entregasController.subirFoto
);

// Subir múltiples fotos
router.post(
    '/uploads/photos',
    requireAuth,
    generalLimiter,
    upload.array('photos', 5),
    async (req, res) => {
        const files = req.files as Express.Multer.File[];
        res.json({
            success: true,
            mensaje: `${files?.length || 0} fotos subidas`,
            paths: files?.map(f => f.path) || []
        });
    }
);

// Guardar firma
router.post(
    '/uploads/signature',
    requireAuth,
    generalLimiter,
    entregasController.guardarFirma
);

export default router;
