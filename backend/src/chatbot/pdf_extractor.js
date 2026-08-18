/**
 * Asistente GMP — PDF text extraction (self-hosted, pdf-parse)
 * Generates PDFs via existing services and extracts text for LLM context.
 * In-memory cache avoids re-parsing the same document.
 */

const {
    CHATBOT_LOG_EVENTS,
    emitChatbotLog,
} = require('./chatbot_log');
const facturasService = require('../../services/facturas.service');
const pdfService = require('../../services/pdf.service');
const { getCachedPdf, cachePdf } = require('../../services/emailPdfService');

const TEXT_CACHE = new Map();
const TEXT_CACHE_TTL_MS = 15 * 60 * 1000;
const TEXT_CACHE_MAX = 200;

function cacheText(key, text) {
    if (TEXT_CACHE.size >= TEXT_CACHE_MAX) {
        const oldest = TEXT_CACHE.keys().next().value;
        TEXT_CACHE.delete(oldest);
    }
    TEXT_CACHE.set(key, { text, expires: Date.now() + TEXT_CACHE_TTL_MS });
}

function getCachedText(key) {
    const entry = TEXT_CACHE.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        TEXT_CACHE.delete(key);
        return null;
    }
    return entry.text;
}

async function extractTextFromBuffer(buffer) {
    if (!buffer || buffer.length < 10) {
        return { text: '', charCount: 0, method: 'empty' };
    }
    try {
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(buffer);
        const text = String(parsed.text || '').replace(/\s+/g, ' ').trim();
        return {
            text: text.slice(0, 12000),
            charCount: text.length,
            pages: parsed.numpages || 0,
            method: 'pdf-parse',
        };
    } catch (error) {
        emitChatbotLog('warn', CHATBOT_LOG_EVENTS.pdfExtractionFailed);
        return { text: '', charCount: 0, method: 'failed', errorCode: 'PDF_EXTRACTION_FAILED' };
    }
}

function parseFieldsFromText(text) {
    if (!text) return {};
    const fields = {};

    const amountMatch = text.match(/(?:total|importe)[:\s]*([\d.,]+)\s*€?/i);
    if (amountMatch) {
        fields.importeDetectado = parseFloat(amountMatch[1].replace(/\./g, '').replace(',', '.')) || null;
    }

    const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dateMatch) {
        fields.fechaDetectada = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
    }

    const clientMatch = text.match(/cliente[:\s]+([A-Z0-9][\w\s.-]{2,40})/i);
    if (clientMatch) {
        fields.clienteDetectado = clientMatch[1].trim();
    }

    return fields;
}

async function getFacturaPdfBuffer(serie, numero, ejercicio) {
    const cacheKey = `factura_${serie}_${numero}_${ejercicio}:chatbot-v1`;
    let buffer = getCachedPdf(cacheKey);
    if (buffer) return buffer;

    const factura = await facturasService.getFacturaDetail(serie, parseInt(numero, 10), parseInt(ejercicio, 10));
    if (!factura) return null;

    buffer = await pdfService.generateInvoicePDF(factura);
    if (buffer) cachePdf(cacheKey, buffer);
    return buffer;
}

async function extractInvoicePdfContent(conn, invoiceTools, invoiceNumber) {
    const info = await invoiceTools.getInvoicePdfInfo(conn, invoiceNumber);
    if (info.error) return info;

    const details = await invoiceTools.getInvoiceDetails(conn, invoiceNumber);
    const textCacheKey = `factura-text:${info.invoiceNumber}`;
    let extracted = getCachedText(textCacheKey);

    if (!extracted) {
        const buffer = await getFacturaPdfBuffer(info.serie, info.numero, info.ejercicio);
        if (buffer) {
            extracted = await extractTextFromBuffer(buffer);
            cacheText(textCacheKey, extracted);
        } else {
            extracted = { text: '', charCount: 0, method: 'db-only' };
        }
    }

    const parsedFields = parseFieldsFromText(extracted.text);

    return {
        documentType: 'factura',
        reference: info.invoiceNumber,
        clientCode: info.clientCode,
        amount: info.amount,
        issueDate: info.issueDate,
        pdfPath: info.pdfPath,
        structured: details.error ? null : {
            lineCount: details.lineCount,
            lines: (details.lines || []).slice(0, 30),
            pendingAmount: details.pendingAmount,
        },
        pdfText: extracted.text || '',
        pdfPages: extracted.pages || 0,
        extractionMethod: extracted.method,
        parsedFromText: parsedFields,
        hint: extracted.charCount > 50
            ? 'Texto extraido del PDF generado por el ERP.'
            : 'Datos estructurados desde DB2 (PDF sin texto extraible).',
    };
}

async function extractAlbaranPdfContent(invoiceTools, conn, albaranNumber, structuredLines) {
    const info = await invoiceTools.getAlbaranPdfInfo(conn, albaranNumber);
    if (info.error) return info;

    const lines = structuredLines || [];
    const normalizedLines = lines.map((line) => ({
        productCode: line.productCode || line.CODIGO,
        description: line.description || (line.DESCRIPCION ? String(line.DESCRIPCION).trim() : ''),
        quantity: parseFloat(line.quantity != null ? line.quantity : line.CANTIDAD) || 0,
        unitPrice: parseFloat(line.unitPrice != null ? line.unitPrice : line.PRECIO) || 0,
        amount: parseFloat(line.amount != null ? line.amount : line.IMPORTE) || 0,
    }));

    const syntheticText = [
        `Albaran ${info.albaranNumber}`,
        `Cliente ${info.clientCode}`,
        `Fecha ${info.issueDate}`,
        `Importe ${info.amount}`,
        ...normalizedLines.map((l) => `${l.description} ${l.quantity} x ${l.unitPrice} = ${l.amount}`),
    ].join('\n');

    return {
        documentType: 'albaran',
        reference: info.albaranNumber,
        clientCode: info.clientCode,
        amount: info.amount,
        issueDate: info.issueDate,
        pdfPath: info.pdfPath,
        structured: { lineCount: normalizedLines.length, lines: normalizedLines },
        pdfText: syntheticText.slice(0, 12000),
        extractionMethod: 'db-lines',
        parsedFromText: parseFieldsFromText(syntheticText),
        hint: 'Lineas desde DB2/LAC. Para PDF escaneado, OCR no activo (opcional tesseract.js).',
    };
}

async function extractPdfContent(conn, invoiceTools, { documentType, reference, albaranLines }) {
    const type = String(documentType || 'factura').toLowerCase();
    if (type === 'albaran') {
        return extractAlbaranPdfContent(invoiceTools, conn, reference, albaranLines);
    }
    return extractInvoicePdfContent(conn, invoiceTools, reference);
}

module.exports = {
    extractPdfContent,
    extractTextFromBuffer,
    parseFieldsFromText,
    getCachedText,
    cacheText,
};
