'use strict';

const { crossQueryTools } = require('../src/chatbot/chatbot_tools');

describe('chatbot evaluation tools', () => {
  test('getClientEvaluation denies client outside vendor scope', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CLI CLI')) {
          return [];
        }
        return [];
      }),
    };

    const result = await crossQueryTools.getClientEvaluation(
      conn,
      'CLI-9',
      '80',
      false,
      ['80']
    );

    expect(result.error).toMatch(/no encontrado o sin permiso/i);
    expect(conn.query).toHaveBeenCalled();
  });

  test('getClientEvaluation returns monthly sales, top products and returns', async () => {
    const baseQuery = jest.fn(async (sql) => {
      if (sql.includes('FROM DSEDAC.CLI CLI')) {
        return [{ OK: 1 }];
      }
      if (sql.includes("L.LCSRAB = 'D'") || sql.includes("L.LCTPVT = 'DV'")) {
        return [
          {
            YEAR: 2026,
            MONTH: 5,
            PRODUCT_CODE: 'ART-2',
            PRODUCT_NAME: 'Devolucion',
            UNITS: 2,
            AMOUNT: -10,
          },
        ];
      }
      if (sql.includes('SUM(L.LCIMVT)') && sql.includes('GROUP BY L.LCAADC, L.LCMMDC')) {
        return [
          { YEAR: 2026, MONTH: 5, SALES: 500, UNITS: 40 },
          { YEAR: 2026, MONTH: 4, SALES: 300, UNITS: 20 },
        ];
      }
      if (sql.includes('GROUP BY TRIM(L.LCCDRF)')) {
        return [
          {
            CODE: 'ART-1',
            NAME: 'Huevos XL',
            TOTAL_SALES: 400,
            TOTAL_UNITS: 30,
          },
        ];
      }
      return [];
    });
    const conn = { query: baseQuery };

    const result = await crossQueryTools.getClientEvaluation(
      conn,
      'CLI-1',
      '80',
      false,
      ['80']
    );

    expect(result.error).toBeUndefined();
    expect(result.clientCode).toBe('CLI-1');
    expect(result.appSection).toBe('Pedidos > Evolución');
    expect(result.monthlySales).toHaveLength(2);
    expect(result.topProducts[0].code).toBe('ART-1');
    expect(result.returns[0].productCode).toBe('ART-2');
  });

  test('getClientEvaluation returns empty arrays when client in scope but no LACLAE rows', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CLI CLI')) {
          return [{ OK: 1 }];
        }
        return [];
      }),
    };

    const result = await crossQueryTools.getClientEvaluation(
      conn,
      'CLI-EMPTY',
      '80',
      false,
      ['80']
    );

    expect(result.error).toBeUndefined();
    expect(result.clientCode).toBe('CLI-EMPTY');
    expect(result.monthlySales).toEqual([]);
    expect(result.topProducts).toEqual([]);
    expect(result.returns).toEqual([]);
  });

  test('getClientEvaluation skips vendor filter for JEFE_VENTAS', async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM DSEDAC.CLI CLI')) {
          return [{ OK: 1 }];
        }
        if (sql.includes('LCCDVD IN')) {
          throw new Error('vendor filter should not run for supervisor');
        }
        if (sql.includes('SUM(L.LCIMVT)')) {
          return [{ YEAR: 2026, MONTH: 6, SALES: 100, UNITS: 5 }];
        }
        if (sql.includes('GROUP BY TRIM(L.LCCDRF)')) {
          return [];
        }
        if (sql.includes("L.LCSRAB = 'D'") || sql.includes("L.LCTPVT = 'DV'")) {
          return [];
        }
        return [];
      }),
    };

    const result = await crossQueryTools.getClientEvaluation(
      conn,
      'CLI-BOSS',
      '01',
      true,
      ['ALL']
    );

    expect(result.error).toBeUndefined();
    expect(result.monthlySales).toHaveLength(1);
  });
});
