/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * SERVICIO DE GENERACIÓN DE NOTAS DE ENTREGA v2.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Genera PDF tipo ticket (80mm) con datos reales de DSEDAC
 * Formato: Similar al albarán físico de la empresa
 * v2.0 - Diseño mejorado con firmas, descripciones completas
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const logger = require('../../middleware/logger');
const { query } = require('../../config/db');

// Directorio para almacenar recibos temporales
const receiptsDir = path.join(__dirname, '../../uploads/receipts');
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
}

// Mapeo de código IVA a porcentaje real (actualizado)
const IVA_MAP = {
    '1': 10,   // Carnes, embutidos
    '2': 21,   // General
    '3': 4,    // Huevos, pan, leche
    '4': 0,    // Exento
    '5': 10,   // Igual que 1
};

/**
 * Formatear número con 2 decimales estilo español
 */
function fmt(num, decimals = 2) {
    return (num || 0).toFixed(decimals).replace('.', ',');
}

/**
 * Obtener líneas de albarán desde DSEDAC.LAC
 */
async function getAlbaranLines(ejercicio, serie, terminal, numero) {
    const sql = `
        SELECT
            LAC.SECUENCIA,
            TRIM(LAC.CODIGOARTICULO) as ARTICULO,
            TRIM(LAC.DESCRIPCION) as DESCRIPCION,
            TRIM(LAC.TIPOLINEA) as TIPOLINEA,
            LAC.CANTIDADENVASES as BULTOS,
            LAC.CANTIDADUNIDADES as UNIDADES,
            LAC.PRECIOVENTA as PRECIO,
            LAC.PORCENTAJEDESCUENTO as DTO,
            LAC.IMPORTEVENTA as IMPORTE,
            TRIM(LAC.CODIGOIVA) as COD_IVA
        FROM DSEDAC.LAC LAC
        WHERE LAC.EJERCICIOALBARAN = ${ejercicio}
          AND TRIM(LAC.SERIEALBARAN) = '${serie}'
          AND LAC.TERMINALALBARAN = ${terminal}
          AND LAC.NUMEROALBARAN = ${numero}
          AND TRIM(LAC.TIPOLINEA) != 'T'
          AND TRIM(LAC.CODIGOARTICULO) != ''
        ORDER BY LAC.SECUENCIA
    `;
    return await query(sql, false);
}

/**
 * Obtener cabecera CPC con totales IVA
 */
async function getAlbaranHeader(ejercicio, serie, terminal, numero) {
    const sql = `
        SELECT
            IMPORTEBASEIMPONIBLE1 as BI1, PORCENTAJEIVA1 as IVA1_PCT, IMPORTEIVA1 as IVA1_IMP,
            IMPORTEBASEIMPONIBLE2 as BI2, PORCENTAJEIVA2 as IVA2_PCT, IMPORTEIVA2 as IVA2_IMP,
            IMPORTEBASEIMPONIBLE3 as BI3, PORCENTAJEIVA3 as IVA3_PCT, IMPORTEIVA3 as IVA3_IMP,
            IMPORTEBRUTO, IMPORTETOTAL,
            NUMEROBULTOS,
            TRIM(CODIGOFORMAPAGO) as FORMA_PAGO,
            TRIM(CODIGOCLIENTEALBARAN) as CLIENTE,
            DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
        FROM DSEDAC.CPC
        WHERE EJERCICIOALBARAN = ${ejercicio}
          AND TRIM(SERIEALBARAN) = '${serie}'
          AND TERMINALALBARAN = ${terminal}
          AND NUMEROALBARAN = ${numero}
        FETCH FIRST 1 ROWS ONLY
    `;
    const rows = await query(sql, false);
    return rows[0] || null;
}

/**
 * Resolve signature - try file path, then base64
 * @returns {Buffer|null} signature image buffer
 */
function resolveSignatureBuffer(signaturePath, signatureBase64) {
    // 1. Try file path
    if (signaturePath) {
        // Direct file path
        if (fs.existsSync(signaturePath)) {
            try {
                return fs.readFileSync(signaturePath);
            } catch (e) {
                logger.warn(`[RECEIPT] Cannot read signature file: ${e.message}`);
            }
        }
        // Try relative paths under uploads
        const basePaths = [
            path.join(__dirname, '../../uploads'),
            path.join(__dirname, '../../uploads/photos')
        ];
        for (const basePath of basePaths) {
            const fullPath = path.join(basePath, signaturePath);
            if (fs.existsSync(fullPath)) {
                try {
                    return fs.readFileSync(fullPath);
                } catch (e) {
                    logger.warn(`[RECEIPT] Cannot read signature: ${e.message}`);
                }
            }
        }
    }

    // 2. Try base64
    if (signatureBase64) {
        try {
            const cleanBase64 = signatureBase64.replace(/^data:image\/\w+;base64,/, '');
            return Buffer.from(cleanBase64, 'base64');
        } catch (e) {
            logger.warn(`[RECEIPT] Cannot decode signature base64: ${e.message}`);
        }
    }

    return null;
}

/**
 * Generar nota de entrega PDF - formato ticket 80mm
 * Consulta datos reales de DSEDAC
 * v2.0 - Diseño mejorado con descripciones completas y mejor firma
 */
async function generateDeliveryReceipt(deliveryData, signaturePath) {
    const {
        ejercicio, serie, terminal, numero,
        albaranNum, facturaNum,
        clientCode, clientName,
        fecha, formaPago, repartidor,
        signatureBase64: inputSigBase64,
        firmante: inputFirmante
    } = deliveryData;

    // Intentar obtener líneas de la BD
    let lines = [];
    let header = null;

    if (ejercicio && serie !== undefined && terminal !== undefined && numero) {
        try {
            lines = await getAlbaranLines(ejercicio, serie, terminal, numero);
            header = await getAlbaranHeader(ejercicio, serie, terminal, numero);
            logger.info(`[RECEIPT] Loaded ${lines.length} lines from DSEDAC for ${ejercicio}-${serie}-${terminal}-${numero}`);
        } catch (e) {
            logger.warn(`[RECEIPT] Could not load from DSEDAC: ${e.message}, using provided data`);
        }
    }

    // Fallback: si no hay líneas de BD, usar las proporcionadas
    if (lines.length === 0 && deliveryData.items && deliveryData.items.length > 0) {
        lines = deliveryData.items.map((item, i) => ({
            SECUENCIA: i + 1,
            ARTICULO: item.codigoArticulo || '',
            DESCRIPCION: item.descripcion || item.DESCRIPTION || '',
            BULTOS: item.bultos || item.cantidad || 0,
            UNIDADES: item.unidades || item.cantidad || 0,
            PRECIO: item.precio || item.PRICE || 0,
            DTO: item.descuento || 0,
            IMPORTE: item.importe || (item.cantidad * item.precio) || 0,
            COD_IVA: '1'
        }));
    }

    // Calcular totales
    let totalBultos = 0;
    let baseImponible = 0;
    let totalIVA = 0;
    const gruposIVA = {};

    lines.forEach(line => {
        totalBultos += Math.abs(line.BULTOS || 0);
        const importe = parseFloat(line.IMPORTE) || 0;
        const codIva = (line.COD_IVA || '1').trim();
        const pctIva = IVA_MAP[codIva] || 10;

        if (!gruposIVA[pctIva]) {
            gruposIVA[pctIva] = { base: 0, iva: 0 };
        }
        gruposIVA[pctIva].base += importe;
        gruposIVA[pctIva].iva += importe * (pctIva / 100);
    });

    // Si hay header de CPC, usar totales oficiales
    if (header) {
        baseImponible = parseFloat(header.IMPORTEBRUTO) || 0;
        const total = parseFloat(header.IMPORTETOTAL) || 0;
        totalIVA = total - baseImponible;

        // Recalcular grupos IVA desde header si disponible
        if (header.BI1 > 0 || header.BI2 > 0 || header.BI3 > 0) {
            Object.keys(gruposIVA).forEach(k => delete gruposIVA[k]);
            for (let i = 1; i <= 3; i++) {
                const bi = parseFloat(header[`BI${i}`]) || 0;
                const pct = parseFloat(header[`IVA${i}_PCT`]) || 0;
                const imp = parseFloat(header[`IVA${i}_IMP`]) || 0;
                if (bi > 0 && pct > 0) {
                    gruposIVA[pct] = { base: bi, iva: imp };
                }
            }
        }
    } else {
        Object.values(gruposIVA).forEach(g => {
            baseImponible += g.base;
            totalIVA += g.iva;
        });
    }

    const importeTotal = baseImponible + totalIVA;

    // Resolve signature buffer (supports file path + base64)
    const sigBuffer = resolveSignatureBuffer(signaturePath, inputSigBase64);
    const hasSignature = !!sigBuffer;

    return new Promise((resolve, reject) => {
        try {
            // Calcular altura dinámica con más espacio para cada elemento
            const lineHeight = 11; // More spacing between product lines
            const headerHeight = 120;
            const footerHeight = hasSignature ? 150 : 70; // More space for signature
            const ivaGroups = Object.keys(gruposIVA).length;
            const minHeight = headerHeight + (lines.length * lineHeight) + (ivaGroups * 14) + footerHeight + 100;
            const docHeight = Math.max(400, Math.min(900, minHeight));

            const doc = new PDFDocument({
                size: [226, docHeight],
                margin: 8
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const W = 210; // ancho útil
            const L = 8;   // margen izq

            // ═══════════════ CABECERA EMPRESA ═══════════════
            doc.fontSize(10).font('Helvetica-Bold')
                .text('GRANJA MARI PEPA S.L.', { align: 'center' });
            doc.fontSize(6).font('Helvetica')
                .text('Pol. Ind. Saprelorca - Parcela D3', { align: 'center' })
                .text('30817 Lorca (Murcia)', { align: 'center' })
                .text('CIF: B04008710 · Tel: 968 47 08 80', { align: 'center' });

            doc.moveDown(0.5);

            // Línea separadora doble
            doc.strokeColor('#000').lineWidth(0.8)
                .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.1);
            doc.strokeColor('#000').lineWidth(0.3)
                .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.4);

            // ═══════════════ TIPO DOCUMENTO + NÚMERO ═══════════════
            const docType = facturaNum ? 'FACTURA' : 'ALBARÁN';
            const docNum = facturaNum || albaranNum || `${ejercicio}/${serie}${String(terminal).padStart(2, '0')}/${numero}`;

            doc.fontSize(11).font('Helvetica-Bold')
                .text(`${docType}: ${docNum}`, L, doc.y, { width: W, align: 'center' });

            const fechaStr = fecha || (header ? `${String(header.DIADOCUMENTO).padStart(2, '0')}/${String(header.MESDOCUMENTO).padStart(2, '0')}/${header.ANODOCUMENTO}` : '');
            doc.fontSize(7).font('Helvetica')
                .text(`Fecha: ${fechaStr}`, { align: 'center' });

            doc.moveDown(0.3);

            // Info cliente con mejor formato
            doc.fontSize(6.5).font('Helvetica-Bold')
                .text(`Cliente: ${clientCode || (header ? header.CLIENTE : '')}`, L);
            doc.fontSize(6.5).font('Helvetica')
                .text(clientName || '', L);

            if (formaPago || (header && header.FORMA_PAGO)) {
                doc.fontSize(5.5).font('Helvetica')
                    .text(`Forma de pago: ${formaPago || header.FORMA_PAGO || ''}`, L);
            }

            doc.moveDown(0.4);
            doc.strokeColor('#555').lineWidth(0.3)
                .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.3);

            // ═══════════════ CABECERA TABLA PRODUCTOS ═══════════════
            const colPart = L;           // Partida
            const colDesc = L + 18;      // Descripción  
            const colBult = L + 140;     // Bultos (moved right for wider desc)
            const colImp = L + 165;      // Importe Neto

            doc.fontSize(5.5).font('Helvetica-Bold')
                .text('Ptda', colPart, doc.y, { width: 16 })
                .text('Artículo / Descripción', colDesc, doc.y - 7, { width: 120 })
                .text('Bultos', colBult, doc.y - 7, { width: 24, align: 'right' })
                .text('Imp.Neto', colImp, doc.y - 7, { width: 38, align: 'right' });

            doc.moveDown(0.2);
            doc.strokeColor('#999').lineWidth(0.3)
                .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.2);

            // ═══════════════ LÍNEAS DE PRODUCTOS ═══════════════
            doc.font('Helvetica').fontSize(5.5);

            lines.forEach((line, idx) => {
                const importe = parseFloat(line.IMPORTE) || 0;
                if (importe === 0 && !line.ARTICULO) return; // Skip empty lines

                const y = doc.y;
                const partida = line.SECUENCIA || (idx + 1);
                const articulo = (line.ARTICULO || '').trim();
                // Wider description - up to 45 chars instead of 30
                const desc = (line.DESCRIPCION || '').trim().substring(0, 45);
                const bultos = line.BULTOS || 0;

                // Partida number
                doc.text(String(partida), colPart, y, { width: 16 });

                // Artículo + descripción 
                if (articulo) {
                    doc.fontSize(4.5).text(articulo, colDesc, y, { width: 120 });
                    doc.fontSize(5.5).text(desc, colDesc, doc.y, { width: 120 });
                } else {
                    doc.text(desc, colDesc, y, { width: 120 });
                }

                // Bultos
                const bultosDisplay = bultos > 0 ? String(bultos) : '-';
                doc.text(bultosDisplay, colBult, y, { width: 24, align: 'right' });

                // Importe neto
                doc.text(fmt(importe) + ' €', colImp, y, { width: 38, align: 'right' });

                // Move to next line considering possible 2-line description
                if (doc.y < y + lineHeight) {
                    doc.y = y + lineHeight;
                }
                doc.moveDown(0.1);
            });

            doc.moveDown(0.3);
            doc.strokeColor('#000').lineWidth(0.5)
                .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.4);

            // ═══════════════ TOTALES ═══════════════
            const totLabelX = L + 90;
            const totValX = L + 165;
            const totW = 38;

            // Bultos total
            doc.fontSize(6).font('Helvetica')
                .text('Bultos:', totLabelX, doc.y, { width: 70 })
                .text(String(totalBultos || header?.NUMEROBULTOS || 0), totValX, doc.y - 7, { width: totW, align: 'right' });
            doc.moveDown(0.3);

            // Importe Neto (base imponible)
            doc.text('Importe Neto:', totLabelX, doc.y, { width: 70 })
                .text(fmt(baseImponible) + ' €', totValX, doc.y - 7, { width: totW, align: 'right' });
            doc.moveDown(0.3);

            // Desglose IVA por tipo
            const sortedIva = Object.entries(gruposIVA).sort((a, b) => Number(a[0]) - Number(b[0]));
            sortedIva.forEach(([pct, data]) => {
                if (data.base > 0) {
                    doc.text(`IVA ${pct}%:`, totLabelX, doc.y, { width: 70 })
                        .text(fmt(data.iva) + ' €', totValX, doc.y - 7, { width: totW, align: 'right' });
                    doc.moveDown(0.2);
                }
            });
            doc.moveDown(0.2);

            // TOTAL - línea separadora + total destacado
            doc.strokeColor('#000').lineWidth(0.5)
                .moveTo(totLabelX, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.3);

            doc.font('Helvetica-Bold').fontSize(10)
                .text('TOTAL:', totLabelX, doc.y, { width: 65 })
                .text(fmt(importeTotal) + ' €', totValX, doc.y - 11, { width: totW, align: 'right' });

            doc.moveDown(0.6);

            // ═══════════════ FIRMA DEL CLIENTE ═══════════════
            if (hasSignature) {
                doc.strokeColor('#999').lineWidth(0.3)
                    .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
                doc.moveDown(0.3);

                doc.fontSize(6).font('Helvetica-Bold')
                    .text('Firma del cliente:', L, doc.y);
                doc.moveDown(0.2);

                try {
                    // Larger signature area for better visibility
                    doc.image(sigBuffer, 30, doc.y, {
                        width: 166,
                        height: 70,
                        fit: [166, 70],
                        align: 'center',
                        valign: 'center'
                    });
                    doc.y += 72;
                } catch (imgErr) {
                    logger.warn(`[RECEIPT] Could not embed signature image: ${imgErr.message}`);
                    doc.fontSize(6).font('Helvetica')
                        .text('[Firma registrada digitalmente]', { align: 'center' });
                    doc.moveDown(0.5);
                }

                // Firmante name and date
                if (inputFirmante) {
                    doc.fontSize(5.5).font('Helvetica')
                        .text(`Firmante: ${inputFirmante}`, { align: 'center' });
                }

                const now = new Date();
                doc.fontSize(5).font('Helvetica')
                    .text(`Fecha firma: ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, { align: 'center' });

                doc.moveDown(0.4);
            }

            // ═══════════════ PIE DE DOCUMENTO ═══════════════
            doc.strokeColor('#999').lineWidth(0.3)
                .moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
            doc.moveDown(0.3);

            doc.fontSize(4.5).font('Helvetica')
                .text('La posesión de este documento NO implica el pago de la misma', { align: 'center' })
                .text('No se admiten devoluciones una vez aceptada la recepción', { align: 'center' });

            if (repartidor) {
                doc.moveDown(0.2)
                    .fontSize(5.5).font('Helvetica')
                    .text(`Entregado por: ${repartidor}`, { align: 'center' });
            }

            doc.end();

        } catch (error) {
            logger.error('[RECEIPT] Error generating PDF', { error: error.message });
            reject(error);
        }
    });
}

/**
 * Guardar recibo como archivo
 */
async function saveReceipt(deliveryData, signaturePath) {
    const buffer = await generateDeliveryReceipt(deliveryData, signaturePath);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    const dir = path.join(receiptsDir, year.toString(), month);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const docId = deliveryData.facturaNum || deliveryData.albaranNum || 'unknown';
    const fileName = `RECIBO_${year}-${month}-${String(now.getDate()).padStart(2, '0')}_${docId}_${Date.now()}.pdf`;
    const filePath = path.join(dir, fileName);

    fs.writeFileSync(filePath, buffer);
    logger.info('[RECEIPT] Saved receipt', { filePath });

    return { buffer, filePath, relativePath: `${year}/${month}/${fileName}` };
}

module.exports = {
    generateDeliveryReceipt,
    saveReceipt
};
