'use strict';

const { commercialShareMessage, productSheetMessage } = require('../utils/documentShareMessage');

describe('document share message', () => {
    test('invoice names the client, the albaran and the VAT-inclusive total', () => {
        const text = commercialShareMessage({
            clientName: 'Panadería López',
            kind: 'factura',
            documentLabel: 'F-15-2296',
            albaranLabel: 'A-15-100',
            date: '2026-10-08',
            total: 1234.5,
            now: new Date('2026-10-08T08:00:00Z'),
        });
        expect(text).toContain('Buenos días, Panadería López,');
        expect(text).toContain('factura F-15-2296');
        expect(text).toContain('albarán A-15-100');
        expect(text).toContain('08/10/2026');
        expect(text).toContain('1.234,50 €');
        expect(text.toLowerCase()).not.toContain('iva');
        expect(text.toLowerCase()).not.toContain('base');
    });

    test('product sheet has no amount', () => {
        const text = productSheetMessage({
            clientName: 'Bar Sol',
            productName: 'Jamón ibérico',
            productCode: '12045',
            now: new Date('2026-10-08T20:00:00Z'),
        });
        expect(text).toContain('Buenas noches, Bar Sol,');
        expect(text).toContain('ficha técnica de Jamón ibérico, referencia 12045');
        expect(text).not.toContain('€');
    });
});
