'use strict';

const express = require('express');
const request = require('supertest');

const mockSaveReceipt = jest.fn();
const mockSendEmailWithPdf = jest.fn();
const mockGenerateDeliveryEmailHtml = jest.fn();
const mockSendDeliveryReceipt = jest.fn();

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn()
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

    test('uses the shared PDF email sender for delivery receipts', async () => {
        const res = await request(makeApp())
            .post('/receipt/2026-A-0-3113/email')
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

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            success: true,
            messageId: 'message-1'
        }));
        expect(mockSendDeliveryReceipt).not.toHaveBeenCalled();
        expect(mockSendEmailWithPdf).toHaveBeenCalledWith(expect.objectContaining({
            to: 'cliente@example.com',
            subject: 'Nota de entrega personalizada',
            htmlBody: '<p>Nota de entrega</p>',
            textBody: 'Adjunto comprobante.',
            pdfBuffer: expect.any(Buffer),
            pdfFilename: 'Nota_Entrega_A-0-3113.pdf'
        }));
    });
});
