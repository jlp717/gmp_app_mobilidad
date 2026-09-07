'use strict';

const { parsePage, paginationContract, db2OffsetFetch } = require('../src/utils/pagination');

describe('src/utils/pagination', () => {
  test('defaults limit 50 and offset 0', () => {
    expect(parsePage({})).toEqual({ limit: 50, offset: 0, page: 1 });
  });

  test('clamps limit and offset', () => {
    expect(parsePage({ limit: '9999', offset: '-4' }, { maxLimit: 200 })).toMatchObject({
      limit: 200,
      offset: 0,
      page: 1,
    });
  });

  test('page=3 with limit=25 becomes offset 50', () => {
    expect(parsePage({ page: '3', limit: '25' })).toEqual({
      limit: 25,
      offset: 50,
      page: 3,
    });
  });

  test('offset wins over page when both present', () => {
    expect(parsePage({ page: '9', offset: '10', limit: '10' })).toEqual({
      limit: 10,
      offset: 10,
      page: 2,
    });
  });

  test('invalid tokens fall back without interpolating injection', () => {
    const page = parsePage({ limit: '1; DROP TABLE X', offset: 'abc' });
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    expect(db2OffsetFetch(page)).toBe('OFFSET 0 ROWS FETCH FIRST 50 ROWS ONLY');
    expect(db2OffsetFetch(page)).not.toMatch(/DROP/i);
  });

  test('paginationContract marks hasMore when the page is full', () => {
    const page = { limit: 2, offset: 0, page: 1 };
    expect(paginationContract(page, [{}, {}])).toEqual({
      limit: 2,
      offset: 0,
      page: 1,
      returned: 2,
      hasMore: true,
    });
    expect(paginationContract(page, [{}]).hasMore).toBe(false);
  });
});
