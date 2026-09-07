'use strict';

const {
  madridCalendarParts,
  madridIsoDate,
  previousMadridIsoDate,
} = require('../utils/madrid-calendar');

describe('madrid calendar', () => {
  test('UTC late evening is the next civil day in Europe/Madrid (CEST)', () => {
    const at = new Date('2026-09-07T22:30:00.000Z');
    expect(madridCalendarParts(at)).toEqual({ year: 2026, month: 9, day: 8 });
    expect(madridIsoDate(at)).toBe('2026-09-08');
  });

  test('UTC late evening is the next civil day in Europe/Madrid (CET)', () => {
    const at = new Date('2026-01-07T23:30:00.000Z');
    expect(madridCalendarParts(at)).toEqual({ year: 2026, month: 1, day: 8 });
    expect(madridIsoDate(at)).toBe('2026-01-08');
  });

  test('midday UTC stays the same Madrid calendar day', () => {
    const at = new Date('2026-09-08T10:00:00.000Z');
    expect(madridIsoDate(at)).toBe('2026-09-08');
  });

  test('previousMadridIsoDate is the calendar day before Europe/Madrid today', () => {
    expect(previousMadridIsoDate(new Date('2026-08-18T06:30:00+02:00'))).toBe('2026-08-17');
    expect(previousMadridIsoDate(new Date('2026-08-18T00:15:00+02:00'))).toBe('2026-08-17');
  });
});
