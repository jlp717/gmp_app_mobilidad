'use strict';

describe('Email PDF Service', () => {
    const originalEnv = process.env;

    function loadService(sendMail = jest.fn().mockResolvedValue({ messageId: 'message-1' })) {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            SMTP_PDF_HOST: 'smtp.test.local',
            SMTP_PDF_PORT: '587',
            SMTP_PDF_USER: 'noreply@test.local',
            SMTP_PDF_PASS: 'secret',
            SMTP_PDF_TLS_SERVERNAME: 'smtp.test.local',
            SMTP_FROM: 'noreply@test.local'
        };

        jest.doMock('nodemailer', () => ({
            createTransport: jest.fn(() => ({
                sendMail,
                verify: jest.fn().mockResolvedValue(true),
                close: jest.fn()
            }))
        }));

        jest.doMock('../middleware/logger', () => ({
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn()
        }));

        const service = require('../services/emailPdfService');
        const nodemailer = require('nodemailer');

        return { service, nodemailer, sendMail };
    }

    afterEach(() => {
        process.env = originalEnv;
        jest.dontMock('nodemailer');
        jest.dontMock('../middleware/logger');
        jest.clearAllMocks();
    });

    test('configures nodemailer with a full logger adapter', async () => {
        const { service, nodemailer } = loadService();

        await service.sendEmailWithPdf({
            to: 'cliente@example.com',
            subject: 'Factura de prueba',
            htmlBody: '<p>Factura</p>',
            pdfBuffer: Buffer.from('%PDF-1.4'),
            pdfFilename: 'Factura_A_1_2026.pdf'
        });

        const smtpConfig = nodemailer.createTransport.mock.calls[0][0];
        expect(smtpConfig.logger).toEqual(expect.objectContaining({
            trace: expect.any(Function),
            debug: expect.any(Function),
            info: expect.any(Function),
            warn: expect.any(Function),
            error: expect.any(Function),
            fatal: expect.any(Function),
            log: expect.any(Function)
        }));
        expect(smtpConfig.debug).toBe(false);
        expect(smtpConfig.tls).toEqual(expect.objectContaining({
            rejectUnauthorized: true,
            servername: 'smtp.test.local',
        }));
    });

    test('sends a PDF attachment with the requested recipient and filename', async () => {
        const sendMail = jest.fn().mockResolvedValue({ messageId: 'message-2' });
        const { service } = loadService(sendMail);

        const result = await service.sendEmailWithPdf({
            to: 'cliente@example.com',
            subject: 'Factura A-1',
            htmlBody: '<p>Factura A-1</p>',
            pdfBuffer: Buffer.from('%PDF-1.4'),
            pdfFilename: 'Factura_A_1_2026.pdf'
        });

        expect(result).toEqual({ success: true, messageId: 'message-2' });
        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'cliente@example.com',
            subject: 'Factura A-1',
            replyTo: 'pedidos@mari-pepa.com',
            headers: expect.objectContaining({
                'List-Unsubscribe': expect.stringContaining('mailto:pedidos@mari-pepa.com'),
                Organization: 'Granja Mari Pepa',
            }),
            attachments: expect.arrayContaining([
                expect.objectContaining({
                    filename: 'Factura_A_1_2026.pdf',
                    contentType: 'application/pdf'
                })
            ])
        }));
    });

    test('delivery HTML includes corporate branding and escapes custom body', () => {
        const { service } = loadService();
        const withClient = service.generateDeliveryEmailHtml({
            numero: 12,
            serie: 'A',
            clienteNombre: 'Cliente <script>',
        });
        expect(withClient).toContain('Albarán A-12');
        expect(withClient).toContain('Cliente &lt;script&gt;');
        expect(withClient).toContain('pedidos@mari-pepa.com');
        expect(withClient).toContain('RGSEAA');
        expect(withClient).not.toContain('<script>');

        const withCustom = service.generateDeliveryEmailHtml({
            numero: 12,
            serie: 'A',
            customBody: 'Hola <b>x</b>',
        });
        expect(withCustom).toContain('Hola &lt;b&gt;x&lt;/b&gt;');
        expect(withCustom).not.toContain('<b>x</b>');
    });
    test('does not expose an unused logo as an attachment for custom HTML', async () => {
        const sendMail = jest.fn().mockResolvedValue({ messageId: 'message-3' });
        const { service } = loadService(sendMail);

        await service.sendEmailWithPdf({
            to: 'javier@example.com',
            subject: 'Recibo de cobro',
            htmlBody: '<p>Cobro registrado</p>',
            pdfBuffer: Buffer.from('%PDF-1.4'),
            pdfFilename: 'RECIBO_COBRO_81.pdf',
        });

        const attachments = sendMail.mock.calls[0][0].attachments;
        expect(attachments).toHaveLength(1);
        expect(attachments[0]).toEqual(expect.objectContaining({
            filename: 'RECIBO_COBRO_81.pdf',
            contentType: 'application/pdf',
        }));
    });
});
