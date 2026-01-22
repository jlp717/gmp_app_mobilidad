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
const moment = require('moment'); // Ensure moment is available

// --- HELPER: Get Gamification Stats (Real DB) ---
async function getGamificationStats(repartidorId) {
    try {
        const currentYear = new Date().getFullYear();

        // 1. Level: Count total deliveries this year
        const levelSql = `
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CPC
            WHERE TRIM(CODIGOREPARTIDOR) = '${repartidorId}'
              AND ANODOCUMENTO = ${currentYear}
        `;
        const levelResult = await query(levelSql, false);
        const totalDeliveries = levelResult[0]?.TOTAL || 0;

        let level = 'BRONCE';
        let nextLevel = 'PLATA';
        let progress = 0.0;

        if (totalDeliveries < 100) {
            level = 'BRONCE';
            nextLevel = 'PLATA';
            progress = totalDeliveries / 100;
        } else if (totalDeliveries < 500) {
            level = 'PLATA';
            nextLevel = 'ORO';
            progress = (totalDeliveries - 100) / 400;
        } else if (totalDeliveries < 2000) {
            level = 'ORO';
            nextLevel = 'PLATINO';
            progress = (totalDeliveries - 500) / 1500;
        } else {
            level = 'PLATINO';
            nextLevel = 'DIAMANTE';
            progress = 1.0;
        }

        // 2. Streak: Check last 7 days activity
        const streakSql = `
            SELECT DISTINCT DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
            FROM DSEDAC.CPC
            WHERE TRIM(CODIGOREPARTIDOR) = '${repartidorId}'
              AND CONCAT(ANODOCUMENTO, CONCAT(RIGHT('0' || MESDOCUMENTO, 2), RIGHT('0' || DIADOCUMENTO, 2))) >= 
                  '${moment().subtract(7, 'days').format('YYYYMMDD')}'
        `;
        const streakResult = await query(streakSql, false);
        const streakDays = streakResult.length; // Approximate active days in last week

        return { level, nextLevel, progress, streakDays, totalDeliveries };
    } catch (e) {
        logger.error(`Error calculating gamification: ${e.message}`);
        return { level: 'BRONCE', nextLevel: 'PLATA', progress: 0, streakDays: 0, totalDeliveries: 0 };
    }
}

// --- HELPER: Get Heuristic AI Suggestions ---
function getSmartSuggestions(albaranes) {
    const suggestions = [];

    // 1. Cash Alert
    const totalCash = albaranes
        .filter(a => a.esCTR)
        .reduce((sum, a) => sum + (a.importe || 0), 0);

    if (totalCash > 1000) {
        suggestions.push(`⚠️ Llevas ${totalCash.toFixed(0)}€ en efectivo. Considera hacer un ingreso.`);
    } else if (totalCash > 500) {
        suggestions.push(`ℹ️ Acumulas ${totalCash.toFixed(0)}€ en cobros.`);
    }

    // 2. Urgent Deliveries
    const urgentCount = albaranes.filter(a => a.esCTR).length;
    if (urgentCount > 3) {
        suggestions.push(`🔥 Tienes ${urgentCount} clientes con cobro obligatorio prioritario.`);
    }

    // 3. Efficiency (Duplicate clients)
    const clientCounts = {};
    albaranes.forEach(a => {
        clientCounts[a.nombreCliente] = (clientCounts[a.nombreCliente] || 0) + 1;
    });
    const multiDrop = Object.entries(clientCounts).find(([_, count]) => count > 1);
    if (multiDrop) {
        suggestions.push(`📦 ${multiDrop[0]} tiene ${multiDrop[1]} entregas. ¡Agrúpalas!`);
    }

    return suggestions.length > 0 ? suggestions[0] : null; // Return top suggestion
}

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

        // Load payment conditions from JAVIER.PAYMENT_CONDITIONS table
        let paymentConditions = {};
        try {
            const pcRows = await query(`
                SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
                FROM JAVIER.PAYMENT_CONDITIONS
                WHERE ACTIVO = 'S'
            `, false);

            pcRows.forEach(pc => {
                const code = (pc.CODIGO || '').trim();
                paymentConditions[code] = {
                    desc: (pc.DESCRIPCION || '').trim(),
                    type: (pc.TIPO || 'CREDITO').trim(),
                    diasPago: pc.DIAS_PAGO || 0,
                    mustCollect: pc.DEBE_COBRAR === 'S',
                    canCollect: pc.PUEDE_COBRAR === 'S',
                    color: (pc.COLOR || 'green').trim()
                };
            });
            logger.info(`[ENTREGAS] Loaded ${Object.keys(paymentConditions).length} payment conditions from DB`);
        } catch (pcError) {
            logger.warn(`[ENTREGAS] Could not load PAYMENT_CONDITIONS: ${pcError.message}, using defaults`);
        }

        const DEFAULT_PAYMENT = { desc: 'CRÉDITO', type: 'CREDITO', diasPago: 30, mustCollect: false, canCollect: false, color: 'green' };

        // CORRECTO: Usar OPP → CPC → CAC para repartidores
        // OPP tiene CODIGOREPARTIDOR, CPC vincula con CAC
        // IMPORTANTE: Usar IMPORTEBRUTO (sin IVA) para cobros
        const sql = `
            SELECT 
              CAC.SUBEMPRESAALBARAN,
              CAC.EJERCICIOALBARAN,
              CAC.SERIEALBARAN,
              CAC.TERMINALALBARAN,
              CAC.NUMEROALBARAN,
              CAC.NUMEROFACTURA,
              CAC.SERIEFACTURA,
              TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
              TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, 'CLIENTE')) as NOMBRE_CLIENTE,
              TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
              TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
              TRIM(COALESCE(CLI.TELEFONO1, '')) as TELEFONO,
              CPC.IMPORTEBRUTO,
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
            const fp = (row.FORMA_PAGO || '').toUpperCase().trim();

            // Try robust matching
            let paymentInfo = paymentConditions[fp] || paymentConditions[parseInt(fp).toString()]; // Try '01' vs '1'
            if (!paymentInfo) paymentInfo = DEFAULT_PAYMENT;

            // Determine if repartidor MUST collect money
            // Fallback: If DB config is default/false, check string patterns (Legacy Logic)
            let esCTR = paymentInfo.mustCollect;
            let puedeCobrarse = paymentInfo.canCollect;

            // Debug specific rows to see why logic fails
            if (rows.length < 5 || Math.random() < 0.05) {
                logger.info(`[ENTREGAS_DEBUG] Albaran: ${row.NUMEROALBARAN}, FP: '${fp}', Info: ${JSON.stringify(paymentInfo)}, esCTR: ${esCTR}`);
            }

            if (!paymentInfo.mustCollect && !paymentInfo.canCollect && paymentInfo === DEFAULT_PAYMENT) {
                if (fp === 'CTR' || fp.includes('CONTADO') || fp.includes('METALICO')) {
                    esCTR = true;
                    puedeCobrarse = true;
                } else if (fp.includes('REP') || fp.includes('MENSUAL')) {
                    // Check specific logic? Assume optional for now or none
                }
            }
            // Ensure consistency
            if (esCTR) puedeCobrarse = true;

            const numeroFactura = row.NUMEROFACTURA || 0;
            const serieFactura = (row.SERIEFACTURA || '').trim();
            const esFactura = numeroFactura > 0;

            return {
                id: `${row.EJERCICIOALBARAN}-${row.SERIEALBARAN}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
                subempresa: row.SUBEMPRESAALBARAN,
                ejercicio: row.EJERCICIOALBARAN,
                serie: row.SERIEALBARAN?.trim() || '',
                terminal: row.TERMINALALBARAN,
                numero: row.NUMEROALBARAN,
                numeroFactura: numeroFactura,
                serieFactura: serieFactura,
                documentoTipo: esFactura ? 'FACTURA' : 'ALBARÁN',
                codigoCliente: row.CLIENTE?.trim(),
                nombreCliente: row.NOMBRE_CLIENTE?.trim(),
                direccion: row.DIRECCION?.trim(),
                poblacion: row.POBLACION?.trim(),
                telefono: row.TELEFONO?.trim(),
                importe: parseFloat(row.IMPORTEBRUTO) || 0,
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

        // --- FILTER BY PAYMENT TYPE ---
        const filterTipo = req.query.tipoPago || ''; // e.g., 'CONTADO', 'CREDITO', 'DOMICILIADO'
        if (filterTipo) {
            filteredAlbaranes = filteredAlbaranes.filter(a =>
                a.tipoPago?.toUpperCase() === filterTipo.toUpperCase()
            );
        }

        // --- FILTER BY COLLECTION STATUS ---
        const filterCobrar = req.query.debeCobrar; // 'S' or 'N'
        if (filterCobrar === 'S') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.esCTR === true);
        } else if (filterCobrar === 'N') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.esCTR === false);
        }

        // --- FILTER BY DOCUMENT TYPE (ALBARAN/FACTURA) ---
        const filterDocTipo = req.query.docTipo; // 'ALBARAN' or 'FACTURA'
        if (filterDocTipo === 'ALBARAN') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'ALBARÁN');
        } else if (filterDocTipo === 'FACTURA') {
            filteredAlbaranes = filteredAlbaranes.filter(a => a.documentoTipo === 'FACTURA');
        }

        // --- SORTING ---
        const sortBy = req.query.sortBy || 'default'; // 'default', 'importe_asc', 'importe_desc'
        if (sortBy === 'importe_desc') {
            filteredAlbaranes.sort((a, b) => b.importe - a.importe);
        } else if (sortBy === 'importe_asc') {
            filteredAlbaranes.sort((a, b) => a.importe - b.importe);
        }
        // 'default' keeps the original ORDER BY CAC.NUMEROALBARAN from SQL

        // Calculate totals for summary
        const totalBruto = filteredAlbaranes.reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalACobrar = filteredAlbaranes.filter(a => a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);
        const totalOpcional = filteredAlbaranes.filter(a => a.puedeCobrarse && !a.esCTR).reduce((sum, a) => sum + (a.importe || 0), 0);

        logger.info(`[ENTREGAS] Date=${targetDate.toISOString().split('T')[0]} Repartidor=${repartidorId} → albaranes=${filteredAlbaranes.length}, totalBruto=${totalBruto.toFixed(2)}, totalACobrar=${totalACobrar.toFixed(2)}, totalOpcional=${totalOpcional.toFixed(2)}`);

        res.json({
            success: true,
            albaranes: filteredAlbaranes,
            total: filteredAlbaranes.length,
            originalTotal: albaranes.length,
            resumen: {
                totalBruto: Math.round(totalBruto * 100) / 100,
                totalACobrar: Math.round(totalACobrar * 100) / 100,
                totalOpcional: Math.round(totalOpcional * 100) / 100
            },
            // --- NEW: Real Gamification & AI Data ---
            gamification: await getGamificationStats(repartidorId),
            aiSuggestion: getSmartSuggestions(filteredAlbaranes)
        });
    } catch (error) {
        logger.error(`Error in /pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /payment-conditions - List available payment conditions
// ===================================
router.get('/payment-conditions', async (req, res) => {
    try {
        const conditions = await query(`
            SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
            FROM JAVIER.PAYMENT_CONDITIONS
            WHERE ACTIVO = 'S'
            ORDER BY TIPO, CODIGO
        `, false);

        res.json({
            success: true,
            conditions: conditions.map(c => ({
                codigo: (c.CODIGO || '').trim(),
                descripcion: (c.DESCRIPCION || '').trim(),
                tipo: (c.TIPO || '').trim(),
                diasPago: c.DIAS_PAGO || 0,
                debeCobrar: c.DEBE_COBRAR === 'S',
                puedeCobrar: c.PUEDE_COBRAR === 'S',
                color: (c.COLOR || 'green').trim()
            }))
        });
    } catch (error) {
        logger.error(`Error in /payment-conditions: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===================================
// GET /albaran/:numero/:ejercicio
// ===================================
router.get('/albaran/:numero/:ejercicio', async (req, res) => {
    try {
        const { numero, ejercicio } = req.params;
        const serie = req.query.serie;
        const terminal = req.query.terminal;

        // 1. Build WHERE clause
        let whereClause = `CPC.NUMEROALBARAN = ${numero} AND CPC.EJERCICIOALBARAN = ${ejercicio}`;
        if (serie) whereClause += ` AND CPC.SERIEALBARAN = '${serie}'`;
        if (terminal) whereClause += ` AND CPC.TERMINALALBARAN = ${terminal}`;

        // 2. Get Header from CPC (consistent with list endpoint - uses IMPORTEBRUTO)
        const headerSql = `
            SELECT 
                CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.IMPORTEBRUTO as IMPORTE,
                CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as CLIENTE_NOM, 
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIR, 
                TRIM(COALESCE(CLI.POBLACION, '')) as POB,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA
            FROM DSEDAC.CPC CPC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE ${whereClause}
            FETCH FIRST 1 ROWS ONLY
        `;

        const headers = await query(headerSql, false);
        if (headers.length === 0) return res.status(404).json({ success: false, error: 'Albaran not found' });

        const header = headers[0];

        // 3. Get Items from LAC (Simplified for ODBC compatibility - NO ALIASES)
        let itemsSql = `
            SELECT 
                L.SECUENCIA,
                L.CODIGOARTICULO,
                L.DESCRIPCION,
                L.CANTIDADUNIDADES,
                L.CANTIDADCAJAS,
                L.UNIDADMEDIDA,
                L.IMPORTEVENTA
            FROM DSEDAC.LAC L
            WHERE L.NUMEROALBARAN = ${numero} AND L.EJERCICIOALBARAN = ${ejercicio}
        `;
        if (serie) itemsSql += ` AND L.SERIEALBARAN = '${serie}'`;
        if (terminal) itemsSql += ` AND L.TERMINALALBARAN = ${terminal}`;
        itemsSql += ` ORDER BY L.SECUENCIA`;

        const items = await query(itemsSql, false);

        const albaran = {
            id: `${header.EJERCICIOALBARAN}-${(header.SERIEALBARAN || '').trim()}-${header.TERMINALALBARAN}-${header.NUMEROALBARAN}`,
            numeroAlbaran: header.NUMEROALBARAN,
            ejercicio: header.EJERCICIOALBARAN,
            serie: (header.SERIEALBARAN || '').trim(),
            terminal: header.TERMINALALBARAN,
            codigoCliente: header.CLIENTE,
            nombreCliente: header.CLIENTE_NOM,
            direccion: header.DIR,
            poblacion: header.POB,
            numeroFactura: header.NUMEROFACTURA || 0,
            serieFactura: (header.SERIEFACTURA || '').trim(),
            documentoTipo: (header.NUMEROFACTURA || 0) > 0 ? 'FACTURA' : 'ALBARÁN',
            fecha: `${header.DIADOCUMENTO}/${header.MESDOCUMENTO}/${header.ANODOCUMENTO}`,
            importe: parseFloat(header.IMPORTE) || 0,
            formaPago: (header.FORMA_PAGO || '').trim(),
            items: items.map(i => ({
                itemId: i.SECUENCIA,
                codigoArticulo: i.CODIGOARTICULO,
                descripcion: i.DESCRIPCION,
                cantidadPedida: parseFloat(i.CANTIDADUNIDADES) || 0,
                cantidadCajas: parseFloat(i.CANTIDADCAJAS) || 0,
                totalLinea: parseFloat(i.IMPORTEVENTA) || 0,
                unidad: i.UNIDADMEDIDA,
                precioUnitario: (parseFloat(i.CANTIDADUNIDADES) || 0) !== 0 ? (parseFloat(i.IMPORTEVENTA) || 0) / parseFloat(i.CANTIDADUNIDADES) : 0,
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
