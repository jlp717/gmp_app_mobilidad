'use strict';

const { getMadridDateParts, madridDateLike } = require('../../src/utils/dashboard-date');

describe('dashboard Europe/Madrid calendar', () => {
    test('advances the business date at Madrid midnight while host instant is previous UTC day', () => {
        expect(getMadridDateParts(new Date('2026-09-29T22:30:00.000Z'))).toMatchObject({
            year: 2026, month: 9, day: 30, dateKey: '2026-09-30',
        });
    });

    test.each([
        ['2026-01-15T23:30:00.000Z', '2026-01-16'],
        ['2026-07-15T22:30:00.000Z', '2026-07-16'],
        ['2026-10-25T22:30:00.000Z', '2026-10-25'],
    ])('handles winter/summer/DST instant %s', (instant, dateKey) => {
        expect(getMadridDateParts(new Date(instant)).dateKey).toBe(dateKey);
    });

    test('provides a date-like adapter for legacy period parsing', () => {
        const date = madridDateLike(new Date('2026-12-31T23:30:00.000Z'));
        expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2027, 1, 1]);
    });

    test('rejects invalid instants', () => {
        expect(() => getMadridDateParts(new Date('invalid'))).toThrow('DASHBOARD_INVALID_AS_OF');
    });
});
