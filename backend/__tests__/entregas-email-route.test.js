'use strict';

const express = require('express');
const request = require('supertest');

const mockSaveReceipt = jest.fn();
const mockSendEmailWithPdf = jest.fn();
const mockQueryWithParams = jest.fn();
const mockGenerateDeliveryEmailHtml = jest.fn();
const mockSendDeliveryReceipt = jest.fn();

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: (...args) => mockQueryWithParams(...args)
}));

jest.mock('../services/query-optimizer', () => ({
    cachedQuery: jest.fn()
}));

jest.mock('../services/redis-cache', () => ({
    TTL: { SHORT: 60, MEDIUM: 300 }
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../middleware/auth', () => ({
    verifyToken: (req, _res, next) => {
        req.user = { id: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
        next();
    }
}));

jest.mock('../utils/delivery-status-check', () => ({
    isDeliveryStatusAvailable: jest.fn(() => false),
    isDeliveryStatusNewSchema: jest.fn(() => false),
    getDeliveryStatusJoin: jest.fn(() => '')
}));

jest.mock('../app/services/deliveryReceiptService', () => ({
    saveReceipt: (...args) => mockSaveReceipt(...args),
    generateDeliveryReceipt: jest.fn()
}));

jest.mock('../services/emailPdfService', () => ({
    sendEmailWithPdf: (...args) => mockSendEmailWithPdf(...args),
    generateDeliveryEmailHtml: (...args) => mockGenerateDeliveryEmailHtml(...args),
    cachePdf: jest.fn(),
    getCachedPdf: jest.fn()
}));

jest.mock('../app/services/emailService', () => ({
    sendDeliveryReceipt: (...args) => mockSendDeliveryReceipt(...args)
}));

const entregasRoutes = require('../routes/entregas');

        mockQueryWithParams
            .mockResolvedValueOnce([{ CODIGO_REPARTIDOR: '94' }])
            .mockResolvedValueOnce([{
                ID: 'CONF-3113',
                DOCUMENT_ID: '2026-A-0-3113-4300009479',
                REPARTIDOR_ID: '94',
                CLIENTE_CODIGO: '4300009479',
                CLIENTE_NOMBRE: 'Cliente real',
                DOCUMENTO_SERIE: 'A',
                DOCUMENTO_TERMINAL: 0,
                DOCUMENTO_NUMERO: 3113,
                OCCURRED_AT: '2026-04-28T09:00:00.000Z',
                CONFIRMED_AT: '2026-04-28T09:05:00.000Z',
                RECEPTOR_NOMBRE: 'Persona',
                RECEPTOR_APELLIDOS: 'Real',
                RECEPTOR_DNI: '12345678Z',
                FIRMA_EVIDENCE_ID: null
            }])
            .mockResolvedValueOnce([{
                LINEA_ID: 'LINE-1', CODIGO_ARTICULO: 'ART-1', DESCRIPCION: 'Producto',
                CANTIDAD_PEDIDA: 1, CANTIDAD_ENTREGADA: 1, CANTIDAD_RECHAZADA: 0,
                CANTIDAD_PENDIENTE: 0, PRECIO_UNITARIO: 42.5
            }]);
function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', entregasRoutes);
    return app;
}

describe('Entregas receipt email route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSaveReceipt.mockResolvedValue({
            buffer: Buffer.from('%PDF-1.4'),
            filePath: 'Nota_Entrega_A-1.pdf',
            relativePath: 'Nota_Entrega_A-1.pdf'
        });
        mockGenerateDeliveryEmailHtml.mockReturnValue('<p>Nota de entrega</p>');
        mockSendEmailWithPdf.mockResolvedValue({ success: true, messageId: 'message-1' });
        mockSendDeliveryReceipt.mockResolvedValue({ success: true, messageId: 'legacy-message' });
    });

    test('fails closed instead of sending to a request-provided recipient', async () => {
        const res = await request(makeApp())
            .post('/receipt/2026-A-0-3113-4300009479/email')
            .send({
                email: 'cliente@example.com',
                subject: 'Nota de entrega personalizada',
                body: 'Adjunto comprobante.',
                clientName: 'Cliente Test',
                albaranNum: 'A-0-3113',
                fecha: '2026-04-28',
                total: 42.5,
                repartidor: '50 JAVIER',
                items: [
                    { cantidad: 1, descripcion: 'Producto', precio: 42.5 }
                ]
            });

        expect(res.status).toBe(410);
        expect(res.body).toEqual(expect.objectContaining({
            success: false,
            code: 'REPARTO_CANONICAL_RECEIPT_ENDPOINT_REQUIRED',
            canonicalEndpoint: '/api/repartidor-finanzas/rutero/confirmations/:confirmationId/receipt'
        }));
        expect(mockQueryWithParams).not.toHaveBeenCalled();
        expect(mockSaveReceipt).not.toHaveBeenCalled();
        expect(mockSendDeliveryReceipt).not.toHaveBeenCalled();
        expect(mockSendEmailWithPdf).not.toHaveBeenCalled();
        expect(mockGenerateDeliveryEmailHtml).not.toHaveBeenCalled();
    });
});
