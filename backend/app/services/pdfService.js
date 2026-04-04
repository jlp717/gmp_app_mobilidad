/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🏢 GMP APP MOBILIDAD - SERVICIO DE GENERACIÓN DE PDFs v2.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Genera PDFs de facturas con diseño PROFESIONAL y ELEGANTE
 * ✨ Diseño único e inigualable para Granja Mari Pepa
 * 🎨 Visual, rápido y fácil de leer para el cliente
 * ✅ Datos 100% precisos y verificados
 *
 * @version 2.0 - Rediseño profesional completo
 * @author Claude Code - Sistema de Facturación Mari Pepa (Ported)
 * @date 2025-12-15
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const PDFDocument = require('pdfkit');
const logger = require('../../middleware/logger');
const path = require('path');
const fs = require('fs');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURACIÓN Y CONSTANTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HEADER_PATH = path.join(__dirname, '../../assets/header.webp');
const HEADER_PNG_PATH = path.join(__dirname, '../../assets/header.png');

// Paleta de colores corporativos Mari Pepa - Elegante y Profesional
const COLORS = {
    primary: '#003d7a',        // Azul corporativo principal
    secondary: '#1a5490',      // Azul secundario para headers
    accent: '#28a745',         // Verde para totales y elementos positivos
    success: '#28a745',        // Verde success
    darkGray: '#2c3e50',       // Gris oscuro para texto principal
    mediumGray: '#6c757d',     // Gris medio para texto secundario
    lightGray: '#E8E8E8',      // Gris claro para fondos y bordes
    ultraLight: '#f8f9fa',     // Gris ultra claro para fondos sutiles
    border: '#dee2e6',         // Color de bordes suaves
    white: '#FFFFFF'           // Blanco puro
};

// Información de la empresa
const EMPRESA = {
    nombre: 'MARI PEPA',
    slogan: 'Food & Frozen',
    descripcion: 'Congelados y refrigerados para hostelería',
    web: 'www.mari-pepa.com',
    registro: 'Inscrita en el registro mercantil de Murcia. Libro 140, Sección 3ª, Folio 142, Hoja 5657, Inscripción 2ª. CIF: B04008710'
};

// Mapeo de código IVA a porcentaje real
const IVA_MAP = {
    '1': 10,   // Carnes, embutidos
    '2': 21,   // General
    '3': 4,    // Huevos, pan, leche
    '4': 0,    // Exento
    '5': 10,   // Igual que 1
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCIONES AUXILIARES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Formatear número estilo español (1234.56 → 1.234,56)
 */
function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '0,00';
    const fixed = Math.abs(num).toFixed(decimals);
    const parts = fixed.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const result = parts[1] ? integerPart + ',' + parts[1] : integerPart;
    return num < 0 ? '-' + result : result;
}

/**
 * Formatear fecha DD/MM/YYYY
 */
function formatDate(dia, mes, ano) {
    const d = String(dia || '').padStart(2, '0');
    const m = String(mes || '').padStart(2, '0');
    const a = ano || '';
    return `${d}/${m}/${a}`;
}

/**
 * Dibujar header corporativo profesional
 */
function drawHeader(doc, yStart = 10) {
    let yPos = yStart;

    // Franja superior de marca (moderna y delgada)
    doc.rect(0, 0, 595.28, 5)
        .fillAndStroke(COLORS.secondary, COLORS.secondary);

    yPos += 5;

    // Intentar cargar el logo
    let logoLoaded = false;

    if (fs.existsSync(HEADER_PNG_PATH)) {
        try {
            // Hacer el header más alto para evitar aspecto aplanado
            doc.image(HEADER_PNG_PATH, 40, yPos, { width: 515, height: 140 });
            logoLoaded = true;
            return yPos + 150;
        } catch (e) {
            logger.warn('⚠️ No se pudo cargar header.png');
        }
    }

    if (!logoLoaded && fs.existsSync(HEADER_PATH)) {
        try {
            doc.image(HEADER_PATH, 40, yPos, { width: 515, height: 140 });
            logoLoaded = true;
            return yPos + 150;
        } catch (e) {
            logger.warn('⚠️ No se pudo cargar header.webp');
        }
    }

    // Si no hay logo, crear header de texto elegante
    if (!logoLoaded) {
        // Fondo sutil (más alto)
        doc.rect(40, yPos, 515, 120)
            .fillAndStroke(COLORS.ultraLight, COLORS.lightGray);

        yPos += 18;

        // Nombre de la empresa - GRANDE Y DESTACADO
        doc.fontSize(36)
            .font('Helvetica-Bold')
            .fillColor(COLORS.primary)
            .text(EMPRESA.nombre, 50, yPos);

        yPos += 45;

        // Slogan
        doc.fontSize(14)
            .fillColor(COLORS.darkGray)
            .font('Helvetica')
            .text(EMPRESA.slogan.toUpperCase(), 50, yPos);

        yPos += 18;

        // Descripción y web
        doc.fontSize(9)
            .fillColor(COLORS.mediumGray)
            .text(EMPRESA.descripcion, 50, yPos);

        doc.fontSize(9)
            .fillColor(COLORS.secondary)
            .text(EMPRESA.web, 450, yPos, { align: 'right', width: 95 });

        yPos += 10;
    }

    return yPos + 5;
}

/**
 * Dibujar footer corporativo
 */
function drawFooter(doc, pageNum, totalPages) {
    const footerY = 770;

    // Línea separadora elegante
    doc.moveTo(40, footerY)
        .lineTo(555, footerY)
        .strokeColor(COLORS.lightGray)
        .lineWidth(0.5)
        .stroke();

    // Registro mercantil
    doc.fontSize(6)
        .font('Helvetica')
        .fillColor(COLORS.mediumGray)
        .text(EMPRESA.registro, 40, footerY + 5, {
            align: 'center',
            width: 515
        });

    // Número de página
    doc.fontSize(7)
        .fillColor(COLORS.mediumGray)
        .text(`Página ${pageNum} de ${totalPages}`, 40, footerY + 13, {
            align: 'center',
            width: 515
        });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCIÓN PRINCIPAL DE GENERACIÓN DE PDF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Generar PDF de factura con diseño profesional
 * @param {Object} facturaData - {header, lines, payments}
 * @returns {Promise<Buffer>} PDF generado
 */
async function generateInvoicePDF(facturaData) {
    try {
        const header = facturaData.header || {};
        const lines = facturaData.lines || [];
        const ivaBreakdown = header.IVA_BREAKDOWN || null;

        // AUDIT FIX: Guard against corrupted/sentinel data reaching PDF
        const checkTotal = parseFloat(header.TOTALFACTURA || header.IMPORTETOTAL || 0);
        if (Math.abs(checkTotal) >= 900000) {
            logger.warn(`⚠️ PDF blocked: sentinel total ${checkTotal}`);
            throw new Error('Documento con datos anómalos — importe no válido');
        }

        // Detect document type: albaran vs factura
        const isAlbaran = facturaData.documentType === 'albaran' || 
            (!facturaData.documentType && (!header.NUMEROFACTURA || parseInt(header.NUMEROFACTURA) === 0));
        const docTypeLabel = isAlbaran ? 'ALBAR\u00c1N' : 'FACTURA';
        const docSerie = isAlbaran 
            ? (header.SERIEALBARAN || '').toString().trim()
            : (header.SERIEFACTURA || header.SERIEALBARAN || '').toString().trim();
        const docNumber = isAlbaran
            ? (header.NUMEROALBARAN || '')
            : (header.NUMEROFACTURA || header.NUMEROALBARAN || '');
        const docEjercicio = isAlbaran
            ? (header.EJERCICIOALBARAN || '')
            : (header.EJERCICIOFACTURA || header.EJERCICIOALBARAN || '');

        logger.info(`\uD83D\uDCC4 Generando PDF ${docTypeLabel} ${docSerie}-${docNumber} - Dise\u00f1o Profesional v2.0`);

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                bufferPages: true,
                info: {
                    Title: `${docTypeLabel} ${docSerie}-${docNumber}`,
                    Author: `${EMPRESA.nombre} ${EMPRESA.slogan}`,
                    Subject: `${docTypeLabel} para ${header.NOMBRECLIENTEFACTURA}`,
                    Keywords: `${docTypeLabel}, Mari Pepa, Food & Frozen, Hosteler\u00eda`
                }
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HEADER CORPORATIVO
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            let y = drawHeader(doc, 10);
            y += 10;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // T\u00cdTULO DE DOCUMENTO - BANNER DESTACADO
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            doc.rect(40, y, 515, 32)
                .fillAndStroke(COLORS.secondary, COLORS.secondary);

            doc.fontSize(18)
                .font('Helvetica-Bold')
                .fillColor(COLORS.white)
                .text(docTypeLabel, 50, y + 10);

            const numDoc = `${docSerie}-${docNumber}`;
            doc.fontSize(16)
                .text(numDoc, 400, y + 10, { width: 145, align: 'right' });

            y += 38;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // INFORMACIÓN DE FACTURA (FECHA Y EJERCICIO)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            const fecha = formatDate(header.DIAFACTURA, header.MESFACTURA, header.ANOFACTURA);

            // Caja izquierda: Código Cliente
            doc.rect(40, y, 160, 20)
                .fillAndStroke(COLORS.lightGray, COLORS.border);

            doc.fontSize(7)
                .font('Helvetica-Bold')
                .fillColor(COLORS.mediumGray)
                .text('CÓDIGO CLIENTE', 45, y + 5);

            doc.fontSize(10)
                .font('Helvetica-Bold')
                .fillColor(COLORS.darkGray)
                .text(header.CODIGOCLIENTEFACTURA || '', 45, y + 13);

            // Caja centro: Fecha
            doc.rect(205, y, 180, 20)
                .fillAndStroke(COLORS.lightGray, COLORS.border);

            doc.fontSize(7)
                .font('Helvetica-Bold')
                .fillColor(COLORS.mediumGray)
                .text('FECHA', 210, y + 5);

            doc.fontSize(10)
                .font('Helvetica-Bold')
                .fillColor(COLORS.darkGray)
                .text(fecha, 210, y + 13);

            // Caja derecha: Ejercicio
            doc.rect(390, y, 165, 20)
                .fillAndStroke(COLORS.lightGray, COLORS.border);

            doc.fontSize(7)
                .font('Helvetica-Bold')
                .fillColor(COLORS.mediumGray)
                .text('EJERCICIO FISCAL', 395, y + 5);

            doc.fontSize(10)
                .font('Helvetica-Bold')
                .fillColor(COLORS.darkGray)
                .text(String(docEjercicio), 395, y + 13);

            y += 26;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // INFORMACIÓN DEL CLIENTE - TARJETA ELEGANTE
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            const clienteBoxStartY = y;

            // Fondo de la tarjeta
            doc.rect(40, y, 515, 85)
                .fillAndStroke(COLORS.ultraLight, COLORS.lightGray)
                .lineWidth(1);

            y += 8;

            // Etiqueta
            doc.fontSize(8)
                .font('Helvetica-Bold')
                .fillColor(COLORS.secondary)
                .text('FACTURAR A', 45, y);

            y += 15;

            // Nombre del cliente - DESTACADO
            doc.fontSize(12)
                .font('Helvetica-Bold')
                .fillColor(COLORS.darkGray)
                .text((header.NOMBRECLIENTEFACTURA || '').toUpperCase(), 45, y, {
                    width: 500
                });

            y += 18;

            // Dirección
            doc.fontSize(9)
                .font('Helvetica')
                .fillColor(COLORS.darkGray);

            if (header.DIRECCIONCLIENTEFACTURA) {
                doc.text(header.DIRECCIONCLIENTEFACTURA, 45, y);
                y += 12;
            }

            // CP, Población y Provincia
            if (header.CPCLIENTEFACTURA || header.POBLACIONCLIENTEFACTURA) {
                let localidad = '';
                if (header.CPCLIENTEFACTURA) localidad += header.CPCLIENTEFACTURA + ' ';
                if (header.POBLACIONCLIENTEFACTURA) localidad += header.POBLACIONCLIENTEFACTURA;
                if (header.PROVINCIACLIENTEFACTURA) localidad += ' (' + header.PROVINCIACLIENTEFACTURA + ')';

                doc.text(localidad.trim(), 45, y);
                y += 12;
            }

            // NIF/CIF
            if (header.CIFCLIENTEFACTURA) {
                doc.fontSize(9)
                    .font('Helvetica-Bold')
                    .text(`NIF/CIF: ${header.CIFCLIENTEFACTURA}`, 45, y);
            }

            y = clienteBoxStartY + 93;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // TABLA DE PRODUCTOS - CABECERA
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            doc.rect(40, y, 515, 16)
                .fillAndStroke(COLORS.secondary, COLORS.secondary);

            doc.fontSize(7)
                .font('Helvetica-Bold')
                .fillColor(COLORS.white);

            // Columnas de la tabla - layout depends on document type
            if (isAlbaran) {
                // Simpler layout for delivery notes: wide description
                doc.text('Ptda', 42, y + 5, { width: 28 });
                doc.text('Artículo / Descripción', 72, y + 5, { width: 275 });
                doc.text('Bultos', 350, y + 5, { width: 55, align: 'right' });
                doc.text('Imp.Neto', 500, y + 5, { width: 55, align: 'right' });
            } else {
                doc.text('CÓDIGO', 42, y + 5, { width: 50 });
                doc.text('DESCRIPCIÓN', 95, y + 5, { width: 170 });
                doc.text('LOTE', 270, y + 5, { width: 45 });
                doc.text('CAJAS', 320, y + 5, { width: 35, align: 'right' });
                doc.text('CANT.', 360, y + 5, { width: 38, align: 'right' });
                doc.text('PRECIO', 403, y + 5, { width: 42, align: 'right' });
                doc.text('% DTO', 450, y + 5, { width: 30, align: 'center' });
                doc.text('% IVA', 485, y + 5, { width: 25, align: 'center' });
                doc.text('IMPORTE', 515, y + 5, { width: 40, align: 'right' });
            }

            y += 18;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // LÍNEAS DE PRODUCTOS
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            doc.fontSize(7)
                .font('Helvetica')
                .fillColor(COLORS.darkGray);

            let alternateRow = true;

            lines.forEach((line, index) => {
                const descripcion = isAlbaran
                    ? (line.DESCRIPCIONARTICULO || '').trim()
                    : (line.DESCRIPCIONARTICULO || '').substring(0, 50);
                const descWidth = isAlbaran ? 275 : 170;
                const descHeight = doc.heightOfString(descripcion, { width: descWidth });
                const rowHeight = isAlbaran
                    ? Math.max(28, descHeight + 18)
                    : Math.max(20, descHeight + 12);

                // Comprobar si necesitamos una nueva página con la nueva altura
                if (y + rowHeight > 700) {
                    doc.addPage();
                    y = drawHeader(doc, 10) + 10;

                    // Repetir cabecera de tabla
                    doc.rect(40, y, 515, 16)
                        .fillAndStroke(COLORS.secondary, COLORS.secondary);

                    doc.fontSize(7)
                        .font('Helvetica-Bold')
                        .fillColor(COLORS.white);

                    if (isAlbaran) {
                        doc.text('Ptda', 42, y + 5, { width: 28 });
                        doc.text('Artículo / Descripción', 72, y + 5, { width: 275 });
                        doc.text('Bultos', 350, y + 5, { width: 55, align: 'right' });
                        doc.text('Imp.Neto', 500, y + 5, { width: 55, align: 'right' });
                    } else {
                        doc.text('CÓDIGO', 42, y + 5, { width: 50 });
                        doc.text('DESCRIPCIÓN', 95, y + 5, { width: 170 });
                        doc.text('LOTE', 270, y + 5, { width: 45 });
                        doc.text('CAJAS', 320, y + 5, { width: 35, align: 'right' });
                        doc.text('CANT.', 360, y + 5, { width: 38, align: 'right' });
                        doc.text('PRECIO', 403, y + 5, { width: 42, align: 'right' });
                        doc.text('% DTO', 450, y + 5, { width: 30, align: 'center' });
                        doc.text('% IVA', 485, y + 5, { width: 25, align: 'center' });
                        doc.text('IMPORTE', 515, y + 5, { width: 40, align: 'right' });
                    }

                    y += 18;
                    alternateRow = true;
                }

                // Datos del producto
                doc.fontSize(7)
                    .font('Helvetica')
                    .fillColor(COLORS.darkGray);

                if (isAlbaran) {
                    // Albaran layout: Ptda | Code+Desc | Bultos | Imp.Neto
                    doc.font('Helvetica-Bold');
                    doc.text(String(index + 1), 44, y + 8, { width: 25 });

                    const codigo = (line.CODIGOARTICULO || '').trim();
                    doc.fontSize(7).font('Helvetica-Bold');
                    doc.text(codigo, 72, y + 3, { width: 275 });
                    doc.fontSize(7).font('Helvetica');
                    doc.text(descripcion, 72, y + 13, { width: 275 });

                    const bultos = parseFloat(line.CAJASARTICULO || line.CANTIDADARTICULO || 0);
                    doc.text(bultos > 0 ? formatNumber(bultos, 2) : '-', 350, y + 8, { width: 55, align: 'right' });

                    const importe = parseFloat(line.IMPORTENETOARTICULO || 0);
                    doc.font('Helvetica-Bold');
                    doc.text(formatNumber(importe, 2) + ' €', 500, y + 8, { width: 55, align: 'right' });
                    doc.font('Helvetica');
                } else {
                    const codigo = (line.CODIGOARTICULO || '').substring(0, 12);
                    doc.text(codigo, 42, y + 3, { width: 50 });

                    doc.text(descripcion, 95, y + 3, { width: 170 });

                    // COLUMNA LOTE
                    const lote = (line.LOTEARTICULO || line.LOTE || '').substring(0, 10);
                    doc.text(lote || '-', 270, y + 3, { width: 45 });

                    // COLUMNA CAJAS
                    const cajas = line.CAJASARTICULO ?? line.NUMEROCAJAS ?? 0;
                    const cajasDisplay = Number(cajas) === 0 ? '-' : formatNumber(cajas, 0);
                    doc.text(cajasDisplay, 320, y + 3, { width: 35, align: 'right' });

                    const cantidad = line.CANTIDADARTICULO || 0;
                    doc.text(formatNumber(cantidad, 3), 360, y + 3, { width: 38, align: 'right' });

                    const precio = line.PRECIOARTICULO || 0;
                    doc.text(formatNumber(precio, 3) + ' €', 403, y + 3, { width: 42, align: 'right' });

                    const dto = line.PORCENTAJEDESCUENTOARTICULO || 0;
                    doc.text(dto > 0 ? formatNumber(dto, 2) : '-', 450, y + 3, { width: 30, align: 'center' });

                    const iva = line.CODIGOIVA ? (IVA_MAP[line.CODIGOIVA.trim()] || 0) : (parseFloat(line.PORCENTAJEIVAARTICULO) || 0);
                    doc.text(formatNumber(iva, 2), 485, y + 3, { width: 25, align: 'center' });

                    const importe = line.IMPORTENETOARTICULO || 0;
                    doc.font('Helvetica-Bold');
                    doc.text(formatNumber(importe, 2) + ' €', 515, y + 3, { width: 40, align: 'right' });
                    doc.font('Helvetica');
                }

                // Incrementar Y dinámicamente
                y += rowHeight;
                alternateRow = !alternateRow;
            });

            // Línea final de productos
            doc.moveTo(40, y)
                .lineTo(555, y)
                .strokeColor(COLORS.lightGray)
                .lineWidth(1)
                .stroke();

            y += 12;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // TABLA DE TOTALES POR TIPO DE IVA
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            // Build IVA groups from CPC header-level data (LAC has no IVA columns)
            const grupos = [];
            if (ivaBreakdown) {
                // CPC stores up to 3 IVA tiers
                for (let i = 1; i <= 3; i++) {
                    const bi = parseFloat(ivaBreakdown[`BI${i}`]) || 0;
                    const pct = parseFloat(ivaBreakdown[`IVA${i}_PCT`]) || 0;
                    const imp = parseFloat(ivaBreakdown[`IVA${i}_IMP`]) || 0;
                    if (bi !== 0 || imp !== 0) {
                        grupos.push({
                            porcIVA: pct,
                            porcRec: 0,
                            baseImponible: bi,
                            iva: imp,
                            recargo: 0
                        });
                    }
                }
            }

            // Fallback: if no IVA breakdown from CPC, compute from lines
            if (grupos.length === 0) {
                const gruposIVA = {};
                lines.forEach(line => {
                    const porcIVA = line.CODIGOIVA ? (IVA_MAP[(line.CODIGOIVA || '').trim()] || 0) : 0;
                    const key = `${porcIVA.toFixed(2)}`;
                    if (!gruposIVA[key]) {
                        gruposIVA[key] = { porcIVA, porcRec: 0, baseImponible: 0, iva: 0, recargo: 0 };
                    }
                    const importe = parseFloat(line.IMPORTENETOARTICULO) || 0;
                    gruposIVA[key].baseImponible += importe;
                    gruposIVA[key].iva += importe * (porcIVA / 100);
                });
                grupos.push(...Object.values(gruposIVA));
            }

            if (grupos.length > 0) {
                const numFilas = Math.max(grupos.length, 1);
                const alturaTabla = 16 + (numFilas * 14);

                doc.rect(40, y, 515, alturaTabla)
                    .strokeColor(COLORS.border)
                    .lineWidth(1)
                    .stroke();

                [110, 200, 290, 360, 430, 490].forEach(x => {
                    doc.moveTo(x, y).lineTo(x, y + alturaTabla).stroke();
                });

                doc.moveTo(40, y + 16).lineTo(555, y + 16).stroke();

                doc.rect(40, y, 515, 16)
                    .fillAndStroke(COLORS.lightGray, COLORS.border);

                doc.fontSize(7)
                    .font('Helvetica-Bold')
                    .fillColor(COLORS.darkGray);

                doc.text('Base Imponible', 42, y + 5, { width: 65, align: 'center' });
                doc.text('% I.V.A.', 112, y + 5, { width: 85, align: 'center' });
                doc.text('Importe I.V.A.', 202, y + 5, { width: 85, align: 'center' });
                doc.text('% Recargo', 292, y + 5, { width: 65, align: 'center' });
                doc.text('Importe Rec.', 362, y + 5, { width: 65, align: 'center' });
                doc.text('Total', 432, y + 5, { width: 55, align: 'center' });

                let yValor = y + 20;

                doc.fontSize(8)
                    .font('Helvetica');

                grupos.forEach(grupo => {
                    const totalGrupo = grupo.baseImponible + grupo.iva + grupo.recargo;

                    doc.text(formatNumber(grupo.baseImponible, 2) + ' €', 42, yValor, { width: 65, align: 'right' });
                    doc.text(formatNumber(grupo.porcIVA, 2) + ' %', 112, yValor, { width: 85, align: 'center' });
                    doc.text(formatNumber(grupo.iva, 2) + ' €', 202, yValor, { width: 85, align: 'right' });

                    doc.text(grupo.porcRec > 0.001 ? formatNumber(grupo.porcRec, 2) + ' %' : '0,00 %', 292, yValor, { width: 65, align: 'center' });
                    doc.text(grupo.recargo > 0.001 ? formatNumber(grupo.recargo, 2) + ' €' : '0,00 €', 362, yValor, { width: 65, align: 'right' });

                    doc.font('Helvetica-Bold');
                    doc.text(formatNumber(totalGrupo, 2) + ' €', 432, yValor, { width: 115, align: 'right' });
                    doc.font('Helvetica');

                    yValor += 14;
                });

                y += alturaTabla + 18;
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // TOTALES FINALES - DISEÑO ELEGANTE
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            const totalBase = grupos.reduce((sum, g) => sum + g.baseImponible, 0);
            const totalIVA = grupos.reduce((sum, g) => sum + g.iva, 0);
            const totalRecargo = grupos.reduce((sum, g) => sum + g.recargo, 0);
            const totalConIVA = totalBase + totalIVA + totalRecargo;

            // TOTAL SIN IVA
            doc.rect(350, y, 205, 22)
                .strokeColor(COLORS.border)
                .lineWidth(1)
                .stroke();

            doc.fontSize(10)
                .font('Helvetica')
                .fillColor(COLORS.darkGray)
                .text('TOTAL SIN IVA', 360, y + 7);

            doc.fontSize(12)
                .font('Helvetica-Bold')
                .fillColor(COLORS.darkGray)
                .text(formatNumber(totalBase, 2) + ' €', 450, y + 6, {
                    width: 100,
                    align: 'right'
                });

            y += 24;

            // TOTAL CON IVA - DESTACADO EN VERDE
            doc.rect(350, y, 205, 28)
                .fillAndStroke(COLORS.success, COLORS.success)
                .lineWidth(2);

            doc.fontSize(12)
                .font('Helvetica-Bold')
                .fillColor(COLORS.white)
                .text('TOTAL CON IVA', 360, y + 9);

            doc.fontSize(18)
                .font('Helvetica-Bold')
                .fillColor(COLORS.white)
                .text(formatNumber(totalConIVA, 2) + ' €', 450, y + 6, {
                    width: 100,
                    align: 'right'
                });

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // FIRMA DEL CLIENTE + COPIA LABEL
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            y += 45;

            // Check if we need a new page
            if (y + 120 > 700) {
                doc.addPage();
                y = drawHeader(doc, 10) + 20;
            }

            if (facturaData.signatureBase64) {
                // Use dark background for ALL signatures to ensure visibility
                // (legacy CACFIRMAS have white strokes, older app captures may also have white strokes)

                // Signature box (right side, like the physical paper)
                doc.rect(300, y, 255, 100)
                    .fillAndStroke('#2A2D35', COLORS.border)
                    .lineWidth(1);

                doc.fontSize(9)
                    .font('Helvetica-Bold')
                    .fillColor('#FFFFFF')
                    .text('Recibí Conforme', 305, y + 5);

                // Embed signature image
                try {
                    const sigBuffer = Buffer.from(facturaData.signatureBase64, 'base64');
                    doc.image(sigBuffer, 310, y + 18, {
                        width: 235,
                        height: 65,
                        fit: [235, 65],
                        align: 'center',
                        valign: 'center'
                    });
                } catch (sigErr) {
                    doc.fontSize(8)
                        .font('Helvetica')
                        .fillColor(COLORS.mediumGray)
                        .text('Firma digital registrada', 310, y + 45);
                }

                // Date label under signature
                doc.fontSize(7)
                    .font('Helvetica')
                    .fillColor('#AAAAAA')
                    .text('Fecha: ' + new Date().toLocaleDateString('es-ES'), 305, y + 88);
            }

            // "COPIA" watermark label (left side, like the physical paper)
            doc.fontSize(36)
                .font('Helvetica-Bold')
                .fillColor('#E0E0E0')
                .text('COPIA', 50, y + 25);

            y += 110;

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // FOOTER - PIE DE PÁGINA ELEGANTE
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            const range = doc.bufferedPageRange();
            for (let i = 0; i < range.count; i++) {
                doc.switchToPage(i);
                drawFooter(doc, i + 1, range.count);
            }

            doc.end();
        });

    } catch (error) {
        logger.error('❌ Error generando PDF factura', error);
        throw error;
    }
}

module.exports = {
    generateInvoicePDF
};
