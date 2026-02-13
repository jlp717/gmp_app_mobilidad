/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🏢 GMP APP MOBILIDAD - SERVICIO DE GENERACIÓN DE PDFs
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Genera PDFs de facturas con diseño PROFESIONAL y ELEGANTE
 * Ported from backend/app/services/pdfService.js for backend/services/
 */

const PDFDocument = require('pdfkit');
const logger = require('../middleware/logger');
const path = require('path');
const fs = require('fs');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURACIÓN Y CONSTANTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HEADER_PNG_PATH = path.join(__dirname, '../assets/header.png');

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCIONES AUXILIARES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '0,00';
    const fixed = Math.abs(num).toFixed(decimals);
    const parts = fixed.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const result = parts[1] ? integerPart + ',' + parts[1] : integerPart;
    return num < 0 ? '-' + result : result;
}

function formatDate(dia, mes, ano) {
    const d = String(dia || '').padStart(2, '0');
    const m = String(mes || '').padStart(2, '0');
    const a = ano || '';
    return `${d}/${m}/${a}`;
}

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
/**
 * Generar PDF de factura con diseño profesional
 * @param {Object} facturaData - {header, lines} (clean object from service)
 * @returns {Promise<Buffer>} PDF generado
 */
async function generateInvoicePDF(facturaData) {
    try {
        const header = facturaData.header || {};
        const lines = facturaData.lines || [];

        logger.info(`📄 Generando PDF factura - Diseño Profesional v2.0 para ${header.serie}-${header.numero}`);

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                bufferPages: true,
                info: {
                    Title: `Factura ${header.serie}-${header.numero}`,
                    Author: `${EMPRESA.nombre} ${EMPRESA.slogan}`,
                    Subject: `Factura para ${header.clienteNombre}`,
                    Keywords: 'Factura, Mari Pepa, Food & Frozen, Hostelería'
                }
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            let y = drawHeader(doc, 10);
            y += 10;

            // TÍTULO DE FACTURA
            doc.rect(40, y, 515, 32)
                .fillAndStroke(COLORS.secondary, COLORS.secondary);

            doc.fontSize(18)
                .font('Helvetica-Bold')
                .fillColor(COLORS.white)
                .text('FACTURA', 50, y + 10);

            const numFactura = `${header.serie}-${header.numero}`;
            doc.fontSize(16)
                .text(numFactura, 400, y + 10, { width: 145, align: 'right' });

            y += 38;

            // INFORMACIÓN DE FACTURA
            // header.fecha is already formatted "DD/MM/YYYY"
            const fecha = header.fecha || '';

            // Código Cliente
            doc.rect(40, y, 160, 20)
                .fillAndStroke(COLORS.lightGray, COLORS.border);
            doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.mediumGray).text('CÓDIGO CLIENTE', 45, y + 5);
            doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.darkGray).text(header.clienteId || '', 45, y + 13);

            // Fecha
            doc.rect(205, y, 180, 20)
                .fillAndStroke(COLORS.lightGray, COLORS.border);
            doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.mediumGray).text('FECHA', 210, y + 5);
            doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.darkGray).text(fecha, 210, y + 13);

            // Ejercicio
            doc.rect(390, y, 165, 20)
                .fillAndStroke(COLORS.lightGray, COLORS.border);
            doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.mediumGray).text('EJERCICIO FISCAL', 395, y + 5);
            doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.darkGray).text(header.ejercicio || '', 395, y + 13);

            y += 26;

            // INFORMACIÓN DEL CLIENTE
            const clienteBoxStartY = y;
            doc.rect(40, y, 515, 85)
                .fillAndStroke(COLORS.ultraLight, COLORS.lightGray)
                .lineWidth(1);

            y += 8;
            doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.secondary).text('FACTURAR A', 45, y);
            y += 15;

            doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.darkGray)
                .text((header.clienteNombre || '').toUpperCase(), 45, y, { width: 500 });
            y += 18;

            doc.fontSize(9).font('Helvetica').fillColor(COLORS.darkGray);
            if (header.clienteDireccion) {
                doc.text(header.clienteDireccion, 45, y);
                y += 12;
            }

            if (header.clientePoblacion) {
                doc.text(header.clientePoblacion, 45, y);
                y += 12;
            }

            if (header.clienteNif) {
                doc.fontSize(9).font('Helvetica-Bold').text(`NIF/CIF: ${header.clienteNif}`, 45, y);
            }

            y = clienteBoxStartY + 93;

            // TABLA DE PRODUCTOS
            doc.rect(40, y, 515, 16).fillAndStroke(COLORS.secondary, COLORS.secondary);
            doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.white);

            doc.text('CÓDIGO', 42, y + 5, { width: 50 });
            doc.text('DESCRIPCIÓN', 95, y + 5, { width: 170 });
            doc.text('CAJAS', 320, y + 5, { width: 35, align: 'right' });
            doc.text('CANT.', 360, y + 5, { width: 38, align: 'right' });
            doc.text('PRECIO', 403, y + 5, { width: 42, align: 'right' });
            doc.text('% DTO', 450, y + 5, { width: 30, align: 'center' });
            doc.text('IMPORTE', 515, y + 5, { width: 40, align: 'right' });

            y += 18;

            doc.fontSize(7).font('Helvetica').fillColor(COLORS.darkGray);
            let alternateRow = true;

            lines.forEach((line) => {
                const descripcion = (line.descripcion || '').substring(0, 50);
                const descHeight = doc.heightOfString(descripcion, { width: 170 });
                const rowHeight = Math.max(20, descHeight + 12);

                if (y + rowHeight > 700) {
                    doc.addPage();
                    y = drawHeader(doc, 10) + 10;
                    doc.rect(40, y, 515, 16).fillAndStroke(COLORS.secondary, COLORS.secondary);
                    // Re-draw headers
                    doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.white);
                    doc.text('CÓDIGO', 42, y + 5, { width: 50 });
                    doc.text('DESCRIPCIÓN', 95, y + 5, { width: 170 });
                    doc.text('CAJAS', 320, y + 5, { width: 35, align: 'right' });
                    doc.text('CANT.', 360, y + 5, { width: 38, align: 'right' });
                    doc.text('PRECIO', 403, y + 5, { width: 42, align: 'right' });
                    doc.text('% DTO', 450, y + 5, { width: 30, align: 'center' });
                    doc.text('IMPORTE', 515, y + 5, { width: 40, align: 'right' });
                    y += 18;
                    alternateRow = true;
                    doc.fontSize(7).font('Helvetica').fillColor(COLORS.darkGray);
                }

                const codigo = (line.codigo || '').substring(0, 12);
                doc.text(codigo, 42, y + 3, { width: 50 });
                doc.text(descripcion, 95, y + 3, { width: 170 });

                // Cajas not in clean line object? facturas.service.js map doesn't include boxes.
                // We'll ignore boxes or map it if needed. 
                // For now, render '-'
                doc.text('-', 320, y + 3, { width: 35, align: 'right' });

                const cantidad = parseFloat(line.cantidad) || 0;
                doc.text(formatNumber(cantidad, 3), 360, y + 3, { width: 38, align: 'right' });

                const precio = parseFloat(line.precio) || 0;
                doc.text(formatNumber(precio, 3) + ' €', 403, y + 3, { width: 42, align: 'right' });

                const dto = parseFloat(line.descuento) || 0;
                doc.text(dto > 0 ? formatNumber(dto, 2) : '-', 450, y + 3, { width: 30, align: 'center' });

                const importe = parseFloat(line.importe) || 0;
                doc.font('Helvetica-Bold');
                doc.text(formatNumber(importe, 2) + ' €', 515, y + 3, { width: 40, align: 'right' });
                doc.font('Helvetica');

                y += rowHeight;
                alternateRow = !alternateRow;
            });

            doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.lightGray).lineWidth(1).stroke();
            y += 12;

            // TOTALES usando header.bases
            const bases = header.bases || [];

            if (bases.length > 0) {
                const numFilas = Math.max(bases.length, 1);
                const alturaTabla = 16 + (numFilas * 14);

                doc.rect(40, y, 515, alturaTabla).strokeColor(COLORS.border).lineWidth(1).stroke();
                // Vertical lines
                doc.moveTo(200, y).lineTo(200, y + alturaTabla).stroke(); // After Base
                doc.moveTo(350, y).lineTo(350, y + alturaTabla).stroke(); // After IVA %
                doc.moveTo(555, y).lineTo(555, y + alturaTabla).stroke(); // End

                doc.moveTo(40, y + 16).lineTo(555, y + 16).stroke();
                doc.rect(40, y, 515, 16).fillAndStroke(COLORS.lightGray, COLORS.border);

                doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.darkGray);
                doc.text('Base Imponible', 42, y + 5, { width: 150, align: 'center' });
                doc.text('% I.V.A.', 200, y + 5, { width: 140, align: 'center' });
                doc.text('Importe I.V.A.', 350, y + 5, { width: 200, align: 'center' });

                let yValor = y + 20;
                doc.fontSize(8).font('Helvetica');

                bases.forEach(base => {
                    const b = parseFloat(base.base) || 0;
                    const pct = parseFloat(base.pct) || 0;
                    const iva = parseFloat(base.iva) || 0;

                    doc.text(formatNumber(b, 2) + ' €', 42, yValor, { width: 150, align: 'center' });
                    doc.text(formatNumber(pct, 2) + ' %', 200, yValor, { width: 140, align: 'center' });
                    doc.text(formatNumber(iva, 2) + ' €', 350, yValor, { width: 200, align: 'center' });
                    yValor += 14;
                });

                y += alturaTabla + 18;
            }

            const total = parseFloat(header.total) || 0;
            // Calculate base total from bases
            const totalBase = bases.reduce((sum, b) => sum + (parseFloat(b.base) || 0), 0);

            doc.rect(350, y, 205, 22).strokeColor(COLORS.border).lineWidth(1).stroke();
            doc.fontSize(10).font('Helvetica').fillColor(COLORS.darkGray).text('TOTAL NETO', 360, y + 7);
            doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.darkGray).text(formatNumber(totalBase, 2) + ' €', 450, y + 6, { width: 100, align: 'right' });

            y += 24;

            doc.rect(350, y, 205, 28).fillAndStroke(COLORS.success, COLORS.success).lineWidth(2);
            doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.white).text('TOTAL FACTURA', 360, y + 9);
            doc.fontSize(18).font('Helvetica-Bold').fillColor(COLORS.white).text(formatNumber(total, 2) + ' €', 450, y + 6, { width: 100, align: 'right' });

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
