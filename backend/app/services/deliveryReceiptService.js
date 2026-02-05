/**
 * SERVICIO DE GENERACIÓN DE NOTAS DE ENTREGA
 * Genera imagen/PDF compacto con firma del cliente
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const logger = require('../../config/logger');

// Directorio para almacenar recibos temporales
const receiptsDir = path.join(__dirname, '../../uploads/receipts');
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
}

/**
 * Formatear número con 2 decimales estilo español
 */
function formatMoney(num) {
    return (num || 0).toFixed(2).replace('.', ',');
}

/**
 * Generar nota de entrega PDF
 * @param {Object} deliveryData - Datos de la entrega
 * @param {string} signaturePath - Ruta a la imagen de firma
 * @returns {Promise<Buffer>} Buffer del PDF
 */
async function generateDeliveryReceipt(deliveryData, signaturePath) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: [226, 400], // Tamaño ticket (80mm aprox)
                margin: 10
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const {
                albaranNum,
                facturaNum,
                clientCode,
                clientName,
                fecha,
                items = [],
                subtotal = 0,
                iva = 0,
                total = 0,
                formaPago,
                repartidor
            } = deliveryData;

            // --- CABECERA ---
            doc.fontSize(10).font('Helvetica-Bold')
                .text('GRANJA MARI PEPA', { align: 'center' });
            doc.fontSize(7).font('Helvetica')
                .text('Pol. Ind. Saprelorca - D3', { align: 'center' })
                .text('30817 Lorca, Murcia', { align: 'center' })
                .text('CIF: B04008710', { align: 'center' });

            doc.moveDown(0.5);
            doc.strokeColor('#000').lineWidth(0.5)
                .moveTo(10, doc.y).lineTo(216, doc.y).stroke();
            doc.moveDown(0.3);

            // --- DATOS DOCUMENTO ---
            const docType = facturaNum ? 'FACTURA' : 'ALBARÁN';
            const docNum = facturaNum || albaranNum;

            doc.fontSize(9).font('Helvetica-Bold')
                .text(`${docType}: ${docNum}`, { align: 'center' });
            doc.fontSize(8).font('Helvetica')
                .text(`Fecha: ${fecha}`, { align: 'center' });

            doc.moveDown(0.3);
            doc.fontSize(7)
                .text(`Cliente: ${clientCode}`, { align: 'left' })
                .text(clientName, { align: 'left' });

            doc.moveDown(0.5);
            doc.strokeColor('#ccc').lineWidth(0.3)
                .moveTo(10, doc.y).lineTo(216, doc.y).stroke();
            doc.moveDown(0.3);

            // --- PRODUCTOS ---
            doc.fontSize(6).font('Helvetica-Bold')
                .text('Cant.', 10, doc.y, { width: 25 })
                .text('Descripción', 35, doc.y - 8, { width: 110 })
                .text('Precio', 145, doc.y - 8, { width: 30, align: 'right' })
                .text('Total', 175, doc.y - 8, { width: 35, align: 'right' });

            doc.moveDown(0.3);
            doc.font('Helvetica').fontSize(6);

            let bultos = 0;
            items.slice(0, 10).forEach(item => { // Max 10 items para espacio
                const qty = item.cantidad || item.QTY || 0;
                const desc = (item.descripcion || item.DESCRIPTION || '').substring(0, 25);
                const price = item.precio || item.PRICE || 0;
                const lineTotal = qty * price;
                bultos += qty;

                const y = doc.y;
                doc.text(qty.toString(), 10, y, { width: 25 })
                    .text(desc, 35, y, { width: 110 })
                    .text(formatMoney(price), 145, y, { width: 30, align: 'right' })
                    .text(formatMoney(lineTotal), 175, y, { width: 35, align: 'right' });
                doc.moveDown(0.4);
            });

            if (items.length > 10) {
                doc.text(`... y ${items.length - 10} más`, { align: 'center' });
            }

            doc.moveDown(0.5);
            doc.strokeColor('#000').lineWidth(0.5)
                .moveTo(10, doc.y).lineTo(216, doc.y).stroke();
            doc.moveDown(0.3);

            // --- TOTALES ---
            doc.fontSize(7).font('Helvetica');
            const totalsX = 120;
            const valuesX = 175;

            doc.text('Bultos:', totalsX, doc.y, { width: 50 })
                .text(bultos.toString(), valuesX, doc.y - 8, { width: 35, align: 'right' });
            doc.moveDown(0.3);

            doc.text('Base Imponible:', totalsX, doc.y, { width: 55 })
                .text(`${formatMoney(subtotal)} €`, valuesX, doc.y - 8, { width: 35, align: 'right' });
            doc.moveDown(0.3);

            doc.text('IVA:', totalsX, doc.y, { width: 50 })
                .text(`${formatMoney(iva)} €`, valuesX, doc.y - 8, { width: 35, align: 'right' });
            doc.moveDown(0.3);

            doc.font('Helvetica-Bold').fontSize(9)
                .text('TOTAL:', totalsX, doc.y, { width: 50 })
                .text(`${formatMoney(total)} €`, valuesX, doc.y - 10, { width: 35, align: 'right' });

            doc.moveDown(0.5);

            // --- FORMA DE PAGO ---
            if (formaPago) {
                doc.font('Helvetica').fontSize(6)
                    .text(`Forma pago: ${formaPago}`, { align: 'center' });
            }

            doc.moveDown(0.5);

            // --- FIRMA ---
            if (signaturePath && fs.existsSync(signaturePath)) {
                doc.fontSize(6).text('Firma del cliente:', { align: 'center' });
                doc.image(signaturePath, 50, doc.y, { width: 120, height: 50 });
                doc.moveDown(4);
            }

            // --- PIE ---
            doc.fontSize(5).font('Helvetica')
                .text('La posesión de esta factura NO implica el pago de la misma', { align: 'center' })
                .text('No se admiten devoluciones una vez aceptada la recepción', { align: 'center' });

            if (repartidor) {
                doc.moveDown(0.3)
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
