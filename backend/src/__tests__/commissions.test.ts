/**
 * TESTS: COMMISSIONS SERVICE
 * Tests for commission calculation, excluded vendors, payment recording.
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

import { commissionsService } from '../services/commissions.service';
import { odbcPool } from '../config/database';

const mockQuery = odbcPool.query as jest.Mock;

describe('CommissionsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // getExcludedVendors
  // ============================================
  describe('getExcludedVendors', () => {
    it('returns default excluded vendors when DB is empty', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await commissionsService.getExcludedVendors();

      expect(result).toEqual(expect.arrayContaining(['3', '13', '93', '80']));
    });

    it('returns merged list when DB has exclusions', async () => {
      mockQuery.mockResolvedValue([
        { CODE: '25' },
        { CODE: '50' },
      ]);

      const result = await commissionsService.getExcludedVendors();

      expect(result).toContain('3');
      expect(result).toContain('25');
      expect(result).toContain('50');
    });

    it('handles DB error gracefully', async () => {
      mockQuery.mockRejectedValue(new Error('DB offline'));

      const result = await commissionsService.getExcludedVendors();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // verifyAdminAuth
  // ============================================
  describe('verifyAdminAuth', () => {
    it('returns false for empty admin code', async () => {
      const result = await commissionsService.verifyAdminAuth('');
      expect(result).toBe(false);
    });

    it('returns true for vendor type ADMIN', async () => {
      mockQuery.mockResolvedValue([{ TIPOVENDEDOR: 'ADMIN' }]);

      const result = await commissionsService.verifyAdminAuth('5');
      expect(result).toBe(true);
    });

    it('returns true for vendor code 98 (normalized)', async () => {
      mockQuery.mockResolvedValue([{ TIPOVENDEDOR: 'COMERCIAL' }]);

      const result = await commissionsService.verifyAdminAuth('98');
      expect(result).toBe(true);
    });

    it('returns false for non-admin vendor', async () => {
      mockQuery.mockResolvedValue([{ TIPOVENDEDOR: 'COMERCIAL' }]);

      const result = await commissionsService.verifyAdminAuth('5');
      expect(result).toBe(false);
    });

    it('returns false on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('Connection lost'));

      const result = await commissionsService.verifyAdminAuth('5');
      expect(result).toBe(false);
    });
  });

  // ============================================
  // recordPayment
  // ============================================
  describe('recordPayment', () => {
    it('records a payment successfully', async () => {
      // Mock excluded vendors
      mockQuery.mockResolvedValueOnce([]);
      // Mock sales query
      mockQuery.mockResolvedValueOnce([{ SALES: 5000 }]);
      // Mock B-sales
      mockQuery.mockResolvedValueOnce([]);
      // Mock INSERT
      mockQuery.mockResolvedValueOnce([]);

      const result = await commissionsService.recordPayment({
        vendedorCode: '5', year: 2026, month: 1,
        amount: 100, generatedAmount: 100,
        observaciones: 'Test payment', adminCode: '98',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('registrado');
    });

    it('requires observaciones when amount < generatedAmount', async () => {
      await expect(
        commissionsService.recordPayment({
          vendedorCode: '5', year: 2026, month: 1,
          amount: 50, generatedAmount: 100,
          observaciones: '', adminCode: '98',
        }),
      ).rejects.toThrow('observación');
    });
  });

  // ============================================
  // getSummary
  // ============================================
  describe('getSummary', () => {
    it('returns commission summary for a single vendor', async () => {
      // Mock excluded vendors
      mockQuery.mockResolvedValueOnce([]);
      // Mock commission config
      mockQuery.mockResolvedValueOnce([]);
      // Mock active days
      mockQuery.mockResolvedValueOnce([]);
      // Mock fixed commission base
      mockQuery.mockResolvedValueOnce([]);
      // Mock B-sales current year
      mockQuery.mockResolvedValueOnce([]);
      // Mock B-sales prev year
      mockQuery.mockResolvedValueOnce([]);
      // Mock LACLAE sales
      mockQuery.mockResolvedValueOnce([
        { YEAR: 2025, MONTH: 1, SALES: 10000 },
        { YEAR: 2026, MONTH: 1, SALES: 11000 },
      ]);
      // Mock vendor name
      mockQuery.mockResolvedValueOnce([{ NAME: 'Test Vendor' }]);
      // Mock payments
      mockQuery.mockResolvedValueOnce([]);

      const result = await commissionsService.getSummary('5', [2026]);

      expect(result).toBeDefined();
      expect(result.config).toBeDefined();
      expect(result.months).toBeDefined();
      expect(result.months).toHaveLength(12);
      expect(result.quarters).toBeDefined();
      expect(typeof result.grandTotalCommission).toBe('number');
    });

    it('returns aggregated data for ALL vendors', async () => {
      // Mock excluded vendors
      mockQuery.mockResolvedValueOnce([]);
      // Mock commission config
      mockQuery.mockResolvedValueOnce([]);
      // Mock distinct vendors
      mockQuery.mockResolvedValueOnce([{ VENDOR_CODE: '5' }]);
      // Mock for vendor '5': active days, fixed base, B-sales x2, sales, name, payments
      mockQuery.mockResolvedValueOnce([]);  // active days
      mockQuery.mockResolvedValueOnce([]);  // fixed commission base
      mockQuery.mockResolvedValueOnce([]);  // B-sales curr
      mockQuery.mockResolvedValueOnce([]);  // B-sales prev
      mockQuery.mockResolvedValueOnce([]);  // LACLAE sales
      mockQuery.mockResolvedValueOnce([{ NAME: 'Vendor 5' }]); // name
      mockQuery.mockResolvedValueOnce([]); // payments

      const result = await commissionsService.getSummary('ALL', [2026]);

      expect(result).toBeDefined();
      expect(result.breakdown).toBeDefined();
      expect(Array.isArray(result.breakdown)).toBe(true);
    });
  });
});
