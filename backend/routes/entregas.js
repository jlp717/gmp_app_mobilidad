const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

// Ensure directories exist
const photosDir = path.join(__dirname, '../../uploads/photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, photosDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `entrega-${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ storage: storage });

// ===================================
// GET /pendientes/:repartidorId
// ===================================
router.get('/pendientes/:repartidorId', async (req, res) => {
    try {
        const { repartidorId } = req.params;
        const { date } = req.query; // Support ?date=YYYY-MM-DD

        let targetDate = new Date();
        if (date) {
            targetDate = new Date(date);
        }

        const dia = targetDate.getDate();
        const mes = targetDate.getMonth() + 1;
        const ano = targetDate.getFullYear();

        logger.info(`[ENTREGAS] Getting pending deliveries for repartidor ${repartidorId} (${dia}/${mes}/${ano})`);

        // Handle multiple IDs (comma separated) case
        const ids = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');

        // CORRECTO: Usar OPP → CPC → CAC para repartidores
        // OPP tiene CODIGOREPARTIDOR, CPC vincula con CAC
        const sql = `
            SELECT 
              CAC.SUBEMPRESAALBARAN,
              CAC.EJERCICIOALBARAN,
              CAC.SERIEALBARAN,
              CAC.NUMEROALBARAN,
              TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
              TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, 'CLIENTE')) as NOMBRE_CLIENTE,
              TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
              TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
              TRIM(COALESCE(CLI.TELEFONO1, '')) as TELEFONO,
              CPC.IMPORTETOTAL as IMPORTE,
              TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
              CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
              TRIM(CPC.CODIGORUTA) as RUTA
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
              ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) IN (${ids})
              AND OPP.DIAREPARTO = ${dia}
              AND OPP.MESREPARTO = ${mes}
              AND OPP.ANOREPARTO = ${ano}
            ORDER BY CAC.NUMEROALBARAN
        `;

        let rows = [];
        try {
            rows = await query(sql, false) || [];
        } catch (queryError) {
            logger.error(`[ENTREGAS] Query error in pendientes: ${queryError.message}`);
            return res.json({ success: true, albaranes: [], total: 0 });
        }

        // Process rows
        const albaranes = rows.map(row => {
            // Simple logic for CTR (Cash/Reimbursement)
            const fp = (row.FORMA_PAGO || '').toUpperCase();
            const esCTR = fp.includes('CONTADO') || fp.includes('EFECTIVO') || fp.includes('CTR') || fp === '01';

            return {
                id: `${row.EJERCICIOALBARAN}-${row.SERIEALBARAN}-${row.NUMEROALBARAN}`,
                subempresa: row.SUBEMPRESAALBARAN,
                ejercicio: row.EJERCICIOALBARAN,
                serie: row.SERIEALBARAN?.trim() || '',
                numero: row.NUMEROALBARAN,
                codigoCliente: row.CLIENTE?.trim(),
                nombreCliente: row.NOMBRE_CLIENTE?.trim(),
                direccion: row.DIRECCION?.trim(),
                poblacion: row.POBLACION?.trim(),
                telefono: row.TELEFONO?.trim(),
                importe: parseFloat(row.IMPORTE),
                formaPago: fp,
                esCTR: esCTR,
                fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
                ruta: row.RUTA?.trim(),
                estado: 'PENDIENTE' // Default to pending as we don't have tracking table linked yet in this simple version
            };
        });

        res.json({
            success: true,
            albaranes,
            total: albaranes.length
        });
    } catch (error) {
        logger.error(`Error in /pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /albaran/:numero/:ejercicio
// ===================================
router.get('/albaran/:numero/:ejercicio', async (req, res) => {
    try {
        const { numero, ejercicio } = req.params;

        // 1. Get Header - FIX: usar columnas correctas de CLI
        const headerSql = `
            SELECT CAC.*, 
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as CLIENTE_NOM, 
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIR, 
                TRIM(COALESCE(CLI.POBLACION, '')) as POB
            FROM DSEDAC.CAC
            LEFT JOIN DSEDAC.CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
            WHERE CAC.NUMEROALBARAN = ${numero} AND CAC.EJERCICIOALBARAN = ${ejercicio}
            FETCH FIRST 1 ROWS ONLY
        `;
        const headers = await query(headerSql, false);
        if (headers.length === 0) return res.status(404).json({ success: false, error: 'Albaran not found' });

        const header = headers[0];

        // 2. Get Items
        const itemsSql = `
            SELECT 
                L.SECUENCIA as ITEM_ID,
                TRIM(L.CODIGOARTICULO) as CODIGO,
                TRIM(L.DESCRIPCION) as DESC,
                L.CANTIDADUNIDADES as QTY,
                TRIM(L.UNIDADMEDIDA) as UNIT
            FROM DSEDAC.LAC L
            WHERE L.NUMEROALBARAN = ${numero} AND L.EJERCICIOALBARAN = ${ejercicio}
            ORDER BY L.SECUENCIA
        `;
        const items = await query(itemsSql, false);

        const albaran = {
            id: `${header.EJERCICIOALBARAN} -${header.SERIEALBARAN || ''} -${header.NUMEROALBARAN} `,
            numeroAlbaran: header.NUMEROALBARAN,
            ejercicio: header.EJERCICIOALBARAN,
            nombreCliente: header.CLIENTE_NOM?.trim(),
            direccion: header.DIR?.trim(),
            poblacion: header.POB?.trim(),
            fecha: `${header.DIADOCUMENTO} /${header.MESDOCUMENTO}/${header.ANODOCUMENTO} `,
            importe: parseFloat(header.IMPORTETOTAL),
            items: items.map(i => ({
                itemId: i.ITEM_ID,
                codigoArticulo: i.CODIGO,
                descripcion: i.DESC,
                cantidadPedida: parseFloat(i.QTY),
                cantidadEntregada: 0,
                estado: 'PENDIENTE'
            })),
            estado: 'PENDIENTE'
        };

        res.json({ success: true, albaran });
    } catch (error) {
        logger.error(`Error in /albaran: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /update (Mock implementation for now)
// ===================================
router.post('/update', async (req, res) => {
    try {
        const { itemId, status, repartidorId, observaciones } = req.body;
        logger.info(`[ENTREGAS] Updating ${itemId} to ${status} by ${repartidorId}`);
        // Here you would update a tracking table. For now just success.
        res.json({ success: true, message: 'Status updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// POST /uploads/photo
// ===================================
router.post('/uploads/photo', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
    res.json({ success: true, path: req.file.path });
});

// ===================================
// POST /uploads/signature
// ===================================
router.post('/uploads/signature', async (req, res) => {
    try {
        const { entregaId, firma } = req.body; // firma is base64
        if (!firma) return res.status(400).json({ success: false, error: 'No signature' });

        // Save base64 to file
        const base64Data = firma.replace(/^data:image\/png;base64,/, "");
        const fileName = `sig-${entregaId}-${Date.now()}.png`;
        const filePath = path.join(photosDir, fileName);

        require('fs').writeFileSync(filePath, base64Data, 'base64');

        res.json({ success: true, path: filePath });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
