'use strict';

jest.mock('../src/chatbot/chatbot_tools', () => {
  const actual = jest.requireActual('../src/chatbot/chatbot_tools');
  return {
    ...actual,
    commissionTools: {
      ...actual.commissionTools,
      getCommissions: jest.fn(async (conn, userCode, isJefeVentas, month, year) => ({
        month,
        year,
        sales: month * 1000,
        commission: month * 100,
        commissionPercent: 10,
        activeClients: month,
        operations: month * 2,
      })),
      getCommissionConfig: jest.fn(async () => ({
        ipc: 3,
        tiers: [{ min: 100.01, max: 103, pct: 1 }],
      })),
    },
    objectivesTools: {
      ...actual.objectivesTools,
      getObjectives: jest.fn(async (conn, userCode, isJefeVentas, month, year) => ({
        month,
        year,
        target: month * 1000,
        achieved: month * 800,
        remaining: month * 200,
        achievementPercent: 80,
      })),
      getObjectivesByFamily: jest.fn(async () => ({
        month: 3,
        year: 2026,
        families: [
          { family: 'AVES', achieved: 1000, target: 1200, achievementPercent: 83.3 },
        ],
      })),
    },
    repartidorTools: {
      ...actual.repartidorTools,
      getRepartidorDeliveries: jest.fn(async () => ({
        year: 2026,
        month: 6,
        day: 24,
        totalDeliveries: 8,
        totalLines: 42,
        completed: 6,
        pending: 2,
        deliveries: [],
      })),
      getRepartidorCommissions: jest.fn(async () => ({
        month: 6,
        year: 2026,
        collected: 1200,
        collectable: 1500,
        percentage: 80,
        thresholdMet: true,
        commission: 24,
      })),
    },
  };
});

const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const {
  commissionTools,
  objectivesTools,
  repartidorTools,
} = require('../src/chatbot/chatbot_tools');

describe('chatbot coverage intents', () => {
  const conn = { query: jest.fn(async () => []) };
  const context = {
    userCode: '80',
    role: 'JEFE_VENTAS',
    isJefeVentas: true,
    vendorScope: ['ALL'],
    richResponses: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('answers accumulated commission over recent months', async () => {
    const response = await handleChatMessage(
      conn,
      'mi comision generada en ultimos 3 meses',
      ['ALL'],
      null,
      context
    );

    expect(commissionTools.getCommissions).toHaveBeenCalledTimes(3);
    expect(response.text).toMatch(/Comision acumulada/i);
    expect(response.metadata.deepLink.tab).toBe('Comisiones');
    expect(response.metadata.chartData).toHaveLength(3);
    expect(response.metadata.exportable.filename).toBe('comisiones-acumuladas.csv');
  });

  test('answers accumulated objectives over explicit month range', async () => {
    const response = await handleChatMessage(
      conn,
      'objetivo acumulado de enero a marzo 2026',
      ['ALL'],
      null,
      context
    );

    const calls = objectivesTools.getObjectives.mock.calls.map((call) => ({
      month: call[3],
      year: call[4],
    }));
    expect(calls).toEqual([
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
      { month: 3, year: 2026 },
    ]);
    expect(response.text).toMatch(/Objetivo acumulado/i);
    expect(response.metadata.deepLink.tab).toBe('Objetivos');
    expect(response.metadata.kpis.some((kpi) => kpi.label === 'Cumplimiento')).toBe(true);
  });

  test('normalizes rough commercial abbreviations before routing', async () => {
    const response = await handleChatMessage(
      conn,
      'obj acum ene mar 2026',
      ['ALL'],
      null,
      context
    );

    expect(objectivesTools.getObjectives).toHaveBeenCalledTimes(3);
    expect(response.text).toMatch(/Objetivo acumulado/i);
    expect(response.metadata.deepLink.tab).toBe('Objetivos');
  });

  test('explains coverage across visible app tabs', async () => {
    const response = await handleChatMessage(
      conn,
      'que puedes hacer por pestanas',
      ['ALL'],
      null,
      context
    );

    expect(response.text).toMatch(/Clientes/i);
    expect(response.text).toMatch(/Facturas/i);
    expect(response.text).toMatch(/Glacius/i);
    expect(response.text).toMatch(/PDF/i);
    expect(response.metadata.deepLink.tab).toBe('Chat IA');
    expect(response.metadata.suggestedFollowUps.length).toBeGreaterThan(0);
  });

  test('routes rutero questions to repartidor deliveries', async () => {
    const response = await handleChatMessage(
      conn,
      'mi ruta hoy',
      ['80'],
      null,
      { ...context, userCode: '80', vendorScope: ['80'], isJefeVentas: false, role: 'REPARTIDOR' }
    );

    expect(repartidorTools.getRepartidorDeliveries).toHaveBeenCalled();
    expect(response.text).toMatch(/Ruta repartidor/i);
    expect(response.metadata.deepLink.tab).toBe('Ruta');
  });

  test('returns guided fallback with follow-up actions', async () => {
    const response = await handleChatMessage(
      conn,
      'esto no se entiende nada',
      ['ALL'],
      null,
      context
    );

    expect(response.text).toMatch(/pista mas concreta/i);
    expect(response.text).toMatch(/Facturas\/PDF/i);
    expect(response.metadata.deepLink.tab).toBe('Chat IA');
    expect(response.metadata.suggestedFollowUps).toContain('Que puedes hacer por pestanas');
  });
});
