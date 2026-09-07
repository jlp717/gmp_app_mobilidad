'use strict';

const {
    buildMonthFilterParameterized,
    buildVendedorFilterParameterized,
    buildVendedorFilterLACLAEParameterized,
    resolveMatrixFetchLimit,
} = require('../src/utils/dashboardFilters');

describe('dashboardFilters', () => {
    describe('buildMonthFilterParameterized', () => {
        test('returns empty filter when months missing', () => {
            expect(buildMonthFilterParameterized()).toEqual({ filter: '', params: [] });
            expect(buildMonthFilterParameterized('')).toEqual({ filter: '', params: [] });
        });

        test('builds IN list for valid months', () => {
            const result = buildMonthFilterParameterized('1,3,12,3');
            expect(result.filter).toBe('AND L.LCMMDC IN (?,?,?)');
            expect(result.params).toEqual([1, 3, 12]);
        });

        test('drops invalid month tokens', () => {
            const result = buildMonthFilterParameterized('0,13,foo,2');
            expect(result.filter).toBe('AND L.LCMMDC IN (?)');
            expect(result.params).toEqual([2]);
        });

        test('never interpolates raw month tokens into SQL', () => {
            const injected = buildMonthFilterParameterized("1); DROP TABLE LAC;--,13,OR 1=1");
            expect(injected.filter).toBe('AND L.LCMMDC IN (?)');
            expect(injected.filter).not.toMatch(/DROP|OR 1=1/i);
            expect(injected.params).toEqual([1]);

            const allInvalid = buildMonthFilterParameterized('0,13,foo,=1');
            expect(allInvalid).toEqual({ filter: '', params: [] });
        });

        test('honours an explicit column without concatenating values', () => {
            const result = buildMonthFilterParameterized('9,9', 'M.MES');
            expect(result.filter).toBe('AND M.MES IN (?)');
            expect(result.params).toEqual([9]);
        });

        test('parses padded and spaced month tokens as integers', () => {
            const result = buildMonthFilterParameterized(' 08 , 09,08 ');
            expect(result.filter).toBe('AND L.LCMMDC IN (?,?)');
            expect(result.params).toEqual([8, 9]);
        });
    });

    describe('buildVendedorFilterParameterized', () => {
        test('ALL and empty skip the vendor predicate (never VENDEDOR=ALL)', () => {
            expect(buildVendedorFilterParameterized('ALL')).toEqual({ filter: '', params: [] });
            expect(buildVendedorFilterParameterized('')).toEqual({ filter: '', params: [] });
            expect(buildVendedorFilterParameterized()).toEqual({ filter: '', params: [] });
        });

        test('binds vendor codes instead of concatenating them', () => {
            const result = buildVendedorFilterParameterized('80,15');
            expect(result.filter).toBe('AND L.LCCDVD IN (?,?)');
            expect(result.params).toEqual(['80', '15']);
            expect(result.filter).not.toContain("'80'");
        });

        test('rejects unknown tokens instead of matching UNK literally', () => {
            expect(buildVendedorFilterParameterized('UNK')).toEqual({
                filter: 'AND 1=0',
                params: [],
            });
        });
    });

    describe('buildVendedorFilterLACLAEParameterized', () => {
        test('UNK matches null/empty vendor without binding the token', () => {
            const result = buildVendedorFilterLACLAEParameterized('80,UNK');
            expect(result.filter).toBe("AND (L.LCCDVD IN (?) OR (L.LCCDVD IS NULL OR L.LCCDVD = ''))");
            expect(result.params).toEqual(['80']);
        });
    });

    describe('resolveMatrixFetchLimit', () => {
        test('clamps client limit between 1 and 1000', () => {
            expect(resolveMatrixFetchLimit('vendor', '5000')).toBe(1000);
            expect(resolveMatrixFetchLimit('vendor', '0')).toBe(240);
            expect(resolveMatrixFetchLimit('vendor', '120')).toBe(120);
        });

        test('defaults by hierarchy depth when limit absent', () => {
            expect(resolveMatrixFetchLimit('vendor')).toBe(240);
            expect(resolveMatrixFetchLimit('vendor,client')).toBe(500);
            expect(resolveMatrixFetchLimit('vendor,client,product')).toBe(1000);
        });
    });
});
