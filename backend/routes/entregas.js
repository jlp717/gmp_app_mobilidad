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
              CAC.TERMINALALBARAN,
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

        // Payment type mapping based on FOP table knowledge
        // 01=CONTADO, 02=CRÉDITO, C2/C5=CONTADO variants, D1-D9=RECIBO DOMICILIADO, T0=TRANSFERENCIA, etc.
        const PAYMENT_TYPES = {
            '01': { desc: 'CONTADO', type: 'CONTADO', diasPago: 0, mustCollect: true, color: 'red' },
            'C2': { desc: 'CONTADO', type: 'CONTADO', diasPago: 0, mustCollect: true, color: 'red' },
            'C5': { desc: 'CONTADO', type: 'CONTADO', diasPago: 0, mustCollect: true, color: 'red' },
            '02': { desc: 'CRÉDITO', type: 'CREDITO', diasPago: 30, mustCollect: false, color: 'green' },
            'D1': { desc: 'RECIBO DOMICILIADO 0 DÍAS', type: 'DOMICILIADO', diasPago: 2, mustCollect: false, color: 'green' },
            'D2': { desc: 'RECIBO DOMICILIADO 15 DÍAS', type: 'DOMICILIADO', diasPago: 15, mustCollect: false, color: 'green' },
            'D3': { desc: 'RECIBO DOMICILIADO 30 DÍAS', type: 'DOMICILIADO', diasPago: 30, mustCollect: false, color: 'green' },
            'D4': { desc: 'RECIBO DOMICILIADO 45 DÍAS', type: 'DOMICILIADO', diasPago: 45, mustCollect: false, color: 'green' },
            'D6': { desc: 'RECIBO DOMICILIADO 60 DÍAS', type: 'DOMICILIADO', diasPago: 60, mustCollect: false, color: 'green' },
            'D8': { desc: 'RECIBO DOMICILIADO 80 DÍAS', type: 'DOMICILIADO', diasPago: 80, mustCollect: false, color: 'green' },
            'D9': { desc: 'RECIBO DOMICILIADO 90 DÍAS', type: 'DOMICILIADO', diasPago: 90, mustCollect: false, color: 'green' },
            'DA': { desc: 'RECIBO DOMICILIADO 120 DÍAS', type: 'DOMICILIADO', diasPago: 120, mustCollect: false, color: 'green' },
            'T0': { desc: 'TRANSFERENCIA', type: 'TRANSFERENCIA', diasPago: 30, mustCollect: false, canCollect: true, color: 'orange' },
            'G1': { desc: 'GIRO 30 DÍAS', type: 'GIRO', diasPago: 30, mustCollect: false, color: 'green' },
            'G6': { desc: 'GIRO 60 DÍAS', type: 'GIRO', diasPago: 60, mustCollect: false, color: 'green' },
            'PG': { desc: 'PAGARÉ', type: 'PAGARE', diasPago: 30, mustCollect: false, color: 'green' },
            'P1': { desc: 'PAGARÉ 30 DÍAS', type: 'PAGARE', diasPago: 30, mustCollect: false, color: 'green' },
            'RP': { desc: 'REPOSICIÓN', type: 'REPOSICION', diasPago: 7, mustCollect: true, color: 'red' },
        };
        const DEFAULT_PAYMENT = { desc: 'CRÉDITO', type: 'CREDITO', diasPago: 30, mustCollect: false, color: 'green' };

        // Process rows
        const albaranes = rows.map(row => {
            const fp = (row.FORMA_PAGO || '').toUpperCase().trim();
            const paymentInfo = PAYMENT_TYPES[fp] || DEFAULT_PAYMENT;

            // Determine if repartidor MUST collect money
            const esCTR = paymentInfo.mustCollect;
            // Can optionally collect (e.g., transferencia clients paying cash)
            const puedeCobrarse = paymentInfo.canCollect || esCTR;

            return {
                id: `${row.EJERCICIOALBARAN}-${row.SERIEALBARAN}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
                subempresa: row.SUBEMPRESAALBARAN,
                ejercicio: row.EJERCICIOALBARAN,
                serie: row.SERIEALBARAN?.trim() || '',
                terminal: row.TERMINALALBARAN,
                numero: row.NUMEROALBARAN,
                codigoCliente: row.CLIENTE?.trim(),
                nombreCliente: row.NOMBRE_CLIENTE?.trim(),
                direccion: row.DIRECCION?.trim(),
                poblacion: row.POBLACION?.trim(),
                telefono: row.TELEFONO?.trim(),
                importe: parseFloat(row.IMPORTE),
                formaPago: fp,
                formaPagoDesc: paymentInfo.desc,
                tipoPago: paymentInfo.type,
                diasPago: paymentInfo.diasPago,
                esCTR: esCTR,
                puedeCobrarse: puedeCobrarse,
                colorEstado: paymentInfo.color,
                fecha: `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`,
                ruta: row.RUTA?.trim(),
                estado: 'PENDIENTE'
            };
        });

        // --- FILTERING: Search by client name or code ---
        const searchQuery = req.query.search?.toLowerCase().trim() || '';
        let filteredAlbaranes = albaranes;
        if (searchQuery) {
            filteredAlbaranes = albaranes.filter(a =>
                a.nombreCliente?.toLowerCase().includes(searchQuery) ||
                a.codigoCliente?.toLowerCase().includes(searchQuery)
            );
        }

        // --- SORTING ---
        const sortBy = req.query.sortBy || 'default'; // 'default', 'importe_asc', 'importe_desc'
        if (sortBy === 'importe_desc') {
            filteredAlbaranes.sort((a, b) => b.importe - a.importe);
        } else if (sortBy === 'importe_asc') {
            filteredAlbaranes.sort((a, b) => a.importe - b.importe);
        }
        // 'default' keeps the original ORDER BY CAC.NUMEROALBARAN from SQL

        res.json({
            success: true,
            albaranes: filteredAlbaranes,
            total: filteredAlbaranes.length,
            originalTotal: albaranes.length
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
        const serie = req.query.serie; // Optional series filter

        // 1. Get Header - FIX: usar columnas correctas de CLI
        let headerSql = `
            SELECT CAC.*, 
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as CLIENTE_NOM, 
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIR, 
                TRIM(COALESCE(CLI.POBLACION, '')) as POB
            FROM DSEDAC.CAC
            LEFT JOIN DSEDAC.CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEFACTURA)
            WHERE CAC.NUMEROALBARAN = ${numero} AND CAC.EJERCICIOALBARAN = ${ejercicio}
        `;

        if (serie) {
            headerSql += ` AND CAC.SERIEALBARAN = '${serie}'`;
        }

        if (req.query.terminal) {
            headerSql += ` AND CAC.TERMINALALBARAN = ${req.query.terminal}`;
        }

        headerSql += ` FETCH FIRST 1 ROWS ONLY`;

        const headers = await query(headerSql, false);
        if (headers.length === 0) return res.status(404).json({ success: false, error: 'Albaran not found' });

        const header = headers[0];

        // 2. Get Items
        let itemsSql = `
            SELECT 
                L.SECUENCIA as ITEM_ID,
                TRIM(L.CODIGOARTICULO) as CODIGO,
                TRIM(L.DESCRIPCION) as DESC,
                L.CANTIDADUNIDADES as QTY,
                TRIM(L.UNIDADMEDIDA) as UNIT,
                CASE 
                    WHEN L.CANTIDADUNIDADES <> 0 THEN ROUND(L.IMPORTEVENTA / L.CANTIDADUNIDADES, 4) 
                    ELSE 0 
                END as PRICE
            FROM DSEDAC.LAC L
            WHERE L.NUMEROALBARAN = ${numero} AND L.EJERCICIOALBARAN = ${ejercicio}
        `;

        if (serie) {
            itemsSql += ` AND L.SERIEALBARAN = '${serie}'`;
        }

        if (req.query.terminal) {
            itemsSql += ` AND L.TERMINALALBARAN = ${req.query.terminal}`;
        }

        itemsSql += ` ORDER BY L.SECUENCIA`;

        const items = await query(itemsSql, false);

        const albaran = {
            id: `${header.EJERCICIOALBARAN} -${header.SERIEALBARAN || ''} -${header.NUMEROALBARAN} `,
            numeroAlbaran: header.NUMEROALBARAN,
            ejercicio: header.EJERCICIOALBARAN,
            numeroFactura: header.NUMEROFACTURA || 0,
            serieFactura: (header.SERIEFACTURA || '').trim(),
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
                unit: i.UNIT,
                precioUnitario: parseFloat(i.PRICE || 0),
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
