/**
 * TESTS: REPARTIDOR SERVICE
 * Tests for collections, document history, historical objectives, config.
 */

// Mock ODBC pool
jest.mock('../config/database', () => ({
  odbcPool: {
    query: jest.fn(),
    initialize: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
  },
  initDatabase: jest.fn(),
  closeDatabase: jest.fn(),
}));

// Mock query-cache to pass through
jest.mock('../utils/query-cache', () => ({
  queryCache: {
    getOrSet: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    get: jest.fn(),
    set: jest.fn(),
    init: jest.fn(),
    close: jest.fn(),
    invalidatePattern: jest.fn(),
    getStats: jest.fn().mockReturnValue({}),
    hasRedis: false,
  },
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600, STATIC: 86400 },
}));

import { repartidorService } from '../services/repartidor.service';
import { odbcPool } from '../config/database';

const mockQuery = odbcPool.query as jest.Mock;

describe('RepartidorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // getConfig
  // ============================================
  describe('getConfig', () => {
    it('returns commission tier configuration', () => {
      const result = repartidorService.getConfig();

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
      expect((result.config as any).threshold).toBe(30.0);
      expect((result.config as any).tiers).toHaveLength(4);
      expect((result.config as any).tiers[0].min).toBe(100.01);
      expect((result.config as any).tiers[0].pct).toBe(1.0);
    });
  });

  // ============================================
  // getCollectionsSummary
  // ============================================
  describe('getCollectionsSummary', () => {
    it('returns empty summary for empty repartidor IDs', async () => {
      const result = await repartidorService.getCollectionsSummary({
        repartidorIds: '',
      });

      expect(result.success).toBe(true);
      expect((result.summary as any).totalCollectable).toBe(0);
      expect((result.summary as any).clientCount).toBe(0);
      expect(result.clients).toEqual([]);
    });

    it('returns collection data per client', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          CLIENTE: 'CLI001', NOMBRE_CLIENTE: 'Client 1',
          FORMA_PAGO: 'CTR', TOTAL_COBRABLE: 10000,
          TOTAL_COBRADO: 8000, NUM_DOCUMENTOS: 5,
        },
        {
          CLIENTE: 'CLI002', NOMBRE_CLIENTE: 'Client 2',
          FORMA_PAGO: 'REP', TOTAL_COBRABLE: 5000,
          TOTAL_COBRADO: 5500, NUM_DOCUMENTOS: 3,
        },
      ]);

      const result = await repartidorService.getCollectionsSummary({
        repartidorIds: '1', year: 2026, month: 2,
      });

      expect(result.success).toBe(true);
      expect((result.clients as any[]).length).toBe(2);

      const client1 = (result.clients as any[])[0];
      expect(client1.clientId).toBe('CLI001');
      expect(client1.collectable).toBe(10000);
      expect(client1.collected).toBe(8000);
      expect(client1.percentage).toBe(80);
      expect(client1.thresholdMet).toBe(true); // 80% >= 30%
      expect(client1.paymentType).toBe('Contado');

      const client2 = (result.clients as any[])[1];
      expect(client2.percentage).toBe(110);
      expect(client2.thresholdMet).toBe(true);
      expect(client2.paymentType).toBe('Reposición');
    });

    it('calculates commission when over 100%', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          CLIENTE: 'CLI001', NOMBRE_CLIENTE: 'Test',
          FORMA_PAGO: 'CTR', TOTAL_COBRABLE: 10000,
          TOTAL_COBRADO: 10500, NUM_DOCUMENTOS: 5,
        },
      ]);

      const result = await repartidorService.getCollectionsSummary({
        repartidorIds: '1', year: 2026, month: 2,
      });

      const client = (result.clients as any[])[0];
      expect(client.percentage).toBe(105);
      expect(client.thresholdMet).toBe(true);
      // 105% falls in tier 2 (103.01 to 106.00, 1.3%)
      expect(client.tier).toBe(2);
      expect(client.commission).toBeGreaterThan(0);
    });

    it('handles DB error gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection error'));

      const result = await repartidorService.getCollectionsSummary({
        repartidorIds: '1',
      });

      expect(result.success).toBe(true);
      expect((result.summary as any).totalCollectable).toBe(0);
      expect(result.warning).toBeDefined();
    });

    it('calculates summary totals correctly', async () => {
      mockQuery.mockResolvedValueOnce([
        { CLIENTE: 'C1', NOMBRE_CLIENTE: 'A', FORMA_PAGO: 'CTR', TOTAL_COBRABLE: 10000, TOTAL_COBRADO: 4000, NUM_DOCUMENTOS: 2 },
        { CLIENTE: 'C2', NOMBRE_CLIENTE: 'B', FORMA_PAGO: 'CTR', TOTAL_COBRABLE: 20000, TOTAL_COBRADO: 7000, NUM_DOCUMENTOS: 3 },
      ]);

      const result = await repartidorService.getCollectionsSummary({
        repartidorIds: '1',
      });

      const summary = result.summary as any;
      expect(summary.totalCollectable).toBe(30000);
      expect(summary.totalCollected).toBe(11000);
      expect(summary.clientCount).toBe(2);
      expect(summary.overallPercentage).toBeCloseTo(36.67, 1);
      expect(summary.thresholdMet).toBe(true); // 36.67% >= 30%
    });
  });

  // ============================================
  // getCollectionsDaily
  // ============================================
  describe('getCollectionsDaily', () => {
    it('returns daily collection data', async () => {
      mockQuery.mockResolvedValueOnce([
        { DIA: 1, TOTAL_COBRABLE: 5000, TOTAL_COBRADO: 4500 },
        { DIA: 2, TOTAL_COBRABLE: 3000, TOTAL_COBRADO: 3000 },
        { DIA: 5, TOTAL_COBRABLE: 7000, TOTAL_COBRADO: 6500 },
      ]);

      const result = await repartidorService.getCollectionsDaily({
        repartidorId: '1', year: 2026, month: 2,
      });

      expect(result.success).toBe(true);
      expect((result.daily as any[]).length).toBe(3);
      expect((result.daily as any[])[0].day).toBe(1);
      expect((result.daily as any[])[0].date).toBe('2026-02-01');
      expect((result.daily as any[])[0].collectable).toBe(5000);
      expect((result.daily as any[])[0].collected).toBe(4500);
    });

    it('handles DB error gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Timeout'));

      const result = await repartidorService.getCollectionsDaily({
        repartidorId: '1',
      });

      expect(result.success).toBe(true);
      expect(result.daily).toEqual([]);
    });
  });

  // ============================================
  // getDocumentHistory
  // ============================================
  describe('getDocumentHistory', () => {
    it('returns document history for a client', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
          TERMINALALBARAN: 1, NUMEROALBARAN: 100,
          ANO: 2026, MES: 2, DIA: 10,
          CODIGOCLIENTEALBARAN: 'CLI001', IMPORTETOTAL: 500,
          IMPORTE_PENDIENTE: 0, CONFORMADOSN: 'S',
          SITUACIONALBARAN: 'F', HORALLEGADA: 103000,
          DELIVERY_STATUS: null, FIRMA_PATH: null, OBSERVACIONES: null,
          NUMEROFACTURA: 50, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026,
          LEGACY_FIRMA_NOMBRE: '', LEGACY_ANO: null,
        },
      ]);

      const result = await repartidorService.getDocumentHistory({
        clientId: 'CLI001',
      });

      expect(result.success).toBe(true);
      expect(result.clientId).toBe('CLI001');
      expect((result.documents as any[]).length).toBe(1);

      const doc = (result.documents as any[])[0];
      expect(doc.type).toBe('factura');
      expect(doc.facturaNumber).toBe(50);
      expect(doc.date).toBe('2026-02-10');
      expect(doc.time).toBe('10:30');
      expect(doc.amount).toBe(500);
      expect(doc.pending).toBe(0);
      expect(doc.status).toBe('delivered');
    });

    it('deduplicates documents by factura key', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
          TERMINALALBARAN: 1, NUMEROALBARAN: 100,
          ANO: 2026, MES: 1, DIA: 5,
          CODIGOCLIENTEALBARAN: 'CLI001', IMPORTETOTAL: 200,
          IMPORTE_PENDIENTE: 0, CONFORMADOSN: 'S',
          SITUACIONALBARAN: 'F', HORALLEGADA: 0,
          DELIVERY_STATUS: null, FIRMA_PATH: null, OBSERVACIONES: null,
          NUMEROFACTURA: 50, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026,
          LEGACY_FIRMA_NOMBRE: '', LEGACY_ANO: null,
        },
        {
          SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
          TERMINALALBARAN: 1, NUMEROALBARAN: 101,
          ANO: 2026, MES: 1, DIA: 5,
          CODIGOCLIENTEALBARAN: 'CLI001', IMPORTETOTAL: 300,
          IMPORTE_PENDIENTE: 0, CONFORMADOSN: 'S',
          SITUACIONALBARAN: 'F', HORALLEGADA: 0,
          DELIVERY_STATUS: null, FIRMA_PATH: null, OBSERVACIONES: null,
          NUMEROFACTURA: 50, SERIEFACTURA: 'F', EJERCICIOFACTURA: 2026,
          LEGACY_FIRMA_NOMBRE: '', LEGACY_ANO: null,
        },
      ]);

      const result = await repartidorService.getDocumentHistory({
        clientId: 'CLI001',
      });

      // Both rows have same factura key (FAC-2026-F-50), should deduplicate
      expect((result.documents as any[]).length).toBe(1);
    });

    it('determines status correctly from delivery cascade', async () => {
      const makeRow = (overrides: Record<string, unknown>) => ({
        SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
        TERMINALALBARAN: 1, NUMEROALBARAN: 100,
        ANO: 2026, MES: 2, DIA: 10,
        CODIGOCLIENTEALBARAN: 'CLI001', IMPORTETOTAL: 500,
        IMPORTE_PENDIENTE: 0, CONFORMADOSN: 'N',
        SITUACIONALBARAN: '', HORALLEGADA: 0,
        DELIVERY_STATUS: null, FIRMA_PATH: null, OBSERVACIONES: null,
        NUMEROFACTURA: 0, SERIEFACTURA: '', EJERCICIOFACTURA: 0,
        LEGACY_FIRMA_NOMBRE: '', LEGACY_ANO: null,
        ...overrides,
      });

      // Test 1: App status overrides everything
      mockQuery.mockResolvedValueOnce([makeRow({
        DELIVERY_STATUS: 'delivered', SITUACIONALBARAN: '',
        NUMEROALBARAN: 200,
      })]);
      let result = await repartidorService.getDocumentHistory({ clientId: 'CLI001' });
      expect((result.documents as any[])[0].status).toBe('delivered');

      // Test 2: ERP status when no app status
      mockQuery.mockResolvedValueOnce([makeRow({
        DELIVERY_STATUS: null, SITUACIONALBARAN: 'F',
        NUMEROALBARAN: 201,
      })]);
      result = await repartidorService.getDocumentHistory({ clientId: 'CLI001' });
      expect((result.documents as any[])[0].status).toBe('delivered');

      // Test 3: Partial payment
      mockQuery.mockResolvedValueOnce([makeRow({
        DELIVERY_STATUS: 'delivered',
        IMPORTETOTAL: 500, IMPORTE_PENDIENTE: 200,
        NUMEROALBARAN: 202,
      })]);
      result = await repartidorService.getDocumentHistory({ clientId: 'CLI001' });
      expect((result.documents as any[])[0].status).toBe('partial');
    });
  });

  // ============================================
  // getHistoricalObjectives
  // ============================================
  describe('getHistoricalObjectives', () => {
    it('returns monthly threshold tracking data', async () => {
      mockQuery.mockResolvedValueOnce([
        { ANO: 2026, MES: 1, TOTAL_COBRABLE: 50000, TOTAL_COBRADO: 20000 },
        { ANO: 2026, MES: 2, TOTAL_COBRABLE: 60000, TOTAL_COBRADO: 45000 },
        { ANO: 2025, MES: 12, TOTAL_COBRABLE: 55000, TOTAL_COBRADO: 55000 },
      ]);

      const result = await repartidorService.getHistoricalObjectives({
        repartidorIds: '1',
      });

      expect(result.success).toBe(true);
      const objectives = result.objectives as any[];
      expect(objectives).toHaveLength(3);

      // January 2026: 20000/50000 = 40% >= 30%
      expect(objectives[0].percentage).toBe(40);
      expect(objectives[0].thresholdMet).toBe(true);
      expect(objectives[0].month).toContain('Enero');

      // February 2026: 45000/60000 = 75%
      expect(objectives[1].percentage).toBe(75);
      expect(objectives[1].thresholdMet).toBe(true);

      // December 2025: 55000/55000 = 100%
      expect(objectives[2].percentage).toBe(100);
      expect(objectives[2].thresholdMet).toBe(true);
    });

    it('filters by clientId when provided', async () => {
      mockQuery.mockResolvedValueOnce([
        { ANO: 2026, MES: 1, TOTAL_COBRABLE: 5000, TOTAL_COBRADO: 2000 },
      ]);

      const result = await repartidorService.getHistoricalObjectives({
        repartidorIds: '1',
        clientId: 'CLI001',
      });

      expect(result.success).toBe(true);

      // Verify the query included clientId filter
      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('TRIM(CPC.CODIGOCLIENTEALBARAN)');
      expect(call[1]).toContain('CLI001');
    });
  });
});
