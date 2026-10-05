'use strict';

const { matchesStopSearch } = require('../services/reparto-stop-search');

const stop = {
    nombreCliente: 'Heladería Norte',
    codigoCliente: 'C100',
    poblacion: 'Almería',
    serie: 'P',
    terminal: 15,
    numero: 2296,
    serieFactura: 'F',
    numeroFactura: 880,
    ordenPreparacion: 42,
};

describe('matchesStopSearch', () => {
    test('matches the full document series and the bare number', () => {
        expect(matchesStopSearch(stop, { searchAlbaran: 'P-15-2296' })).toBe(true);
        expect(matchesStopSearch(stop, { searchAlbaran: 'p152296' })).toBe(true);
        expect(matchesStopSearch(stop, { searchAlbaran: '2296' })).toBe(true);
        expect(matchesStopSearch(stop, { searchAlbaran: 'F-15-880' })).toBe(true);
    });

    test('a short terminal digit does not match every stop on that terminal', () => {
        expect(matchesStopSearch(stop, { searchAlbaran: '15' })).toBe(false);
    });

    test('matches preparation order and ignores other orders', () => {
        expect(matchesStopSearch(stop, { searchOrden: '42' })).toBe(true);
        expect(matchesStopSearch(stop, { searchOrden: '4' })).toBe(true);
        expect(matchesStopSearch(stop, { searchOrden: '7' })).toBe(false);
        expect(matchesStopSearch({ ...stop, ordenPreparacion: null }, { searchOrden: '42' })).toBe(false);
    });

    test('client search uses name, code and town', () => {
        expect(matchesStopSearch(stop, { searchClient: 'norte' })).toBe(true);
        expect(matchesStopSearch(stop, { searchClient: 'c100' })).toBe(true);
        expect(matchesStopSearch(stop, { searchClient: 'almería' })).toBe(true);
        expect(matchesStopSearch(stop, { searchClient: 'madrid' })).toBe(false);
    });

    test('generic search accepts client, series or order', () => {
        expect(matchesStopSearch(stop, { search: 'P-15-2296' })).toBe(true);
        expect(matchesStopSearch(stop, { search: '42' })).toBe(true);
        expect(matchesStopSearch(stop, { search: 'heladeria' })).toBe(true);
        expect(matchesStopSearch(stop, { search: 'madrid' })).toBe(false);
    });
});
