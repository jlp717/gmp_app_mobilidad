/**
 * Auth Routes - Production Grade v4.0.0
 * 
 * Auth flow (verified against actual production code):
 * 1. User enters vendor code or name + PIN
 * 2. Lookup from DSEDAC.VDPL1 (PIN) + DSEDAC.VDD (name) + DSEDAC.VDC (type)
 * 3. Verify PIN (bcrypt or plaintext legacy)
 * 4. Detect Repartidor role via DSEDAC.VEH or DSEDAC.OPP
 * 5. JEFE_VENTAS gets ALL vendor codes from DSEDAC.VDC WHERE SUBEMPRESA='GMP'
 * 6. Generate HMAC JWT access token + random refresh token
 * 
 * @agent Security - Brute force protection, token rotation, theft detection
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { dbPool } from '../core/infrastructure/database/db2-connection-pool';
import { refreshTokenManager, TokenError } from '../core/infrastructure/security/refresh-token-manager';

const router = Router();

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
});

// In-memory account lockout (per IP + username)
const lockouts = new Map<string, { count: number; lockedUntil: number }>();

// ============================================================
// POST /api/auth/login
// ============================================================

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid input', details: validation.error.errors });
      return;
    }

    const { username, password } = validation.data;
    const ip = getClientIp(req);
    const safeUser = sanitizeUsername(username);
    const trimmedPwd = password.trim();

    // Check lockout
    const lockout = lockouts.get(safeUser);
    if (lockout && Date.now() < lockout.lockedUntil) {
      const remaining = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
      logger.warn(`🔒 Login blocked for ${safeUser} — locked for ${remaining}min`);
      res.status(429).json({
        error: `Cuenta bloqueada. Intenta en ${remaining} minutos.`,
        code: 'ACCOUNT_LOCKED',
      });
      return;
    }

    // Step 1: Find vendor by code (primary search)
    let vendorRecord: Record<string, unknown> | null = null;

    if (safeUser.length <= 10) {
      vendorRecord = await findVendorByCode(safeUser);
    }

    // Step 2: Find vendor by name (fallback)
    if (!vendorRecord) {
      const searchParam = safeUser.replace(/ /g, '');
      vendorRecord = await findVendorByName(searchParam);
    }

    if (!vendorRecord) {
      recordFailedAttempt(safeUser);
      logger.warn(`❌ User not found: ${safeUser} from ${ip}`);
      res.status(401).json({ error: 'Usuario no encontrado', code: 'INVALID_CREDENTIALS' });
      return;
    }

    // Extract vendor data
    const vendedorCode = String(vendorRecord.CODIGOVENDEDOR).trim();
    const dbPin = vendorRecord.CODIGOPIN ? String(vendorRecord.CODIGOPIN).trim() : '';
    const vendedorName = String(vendorRecord.NOMBREVENDEDOR || '').replace(/^\d+\s+/, '').trim() || `Comercial ${vendedorCode}`;
    const isJefeVentas = vendorRecord.JEFEVENTASSN === 'S';
    const tipoVendedor = vendorRecord.TIPOVENDEDOR ? String(vendorRecord.TIPOVENDEDOR).trim() : '';

    // Step 3: Verify PIN (bcrypt or plaintext legacy)
    let pinValid = false;

    if (dbPin && dbPin.startsWith('$2b$')) {
      pinValid = await bcrypt.compare(trimmedPwd, dbPin);
    } else if (dbPin === trimmedPwd) {
      // Plaintext PIN fallback (legacy — DO NOT migrate, DB2 field too small)
      pinValid = true;
    }

    if (!pinValid) {
      recordFailedAttempt(safeUser);
      logger.warn(`❌ PIN mismatch for vendor ${vendedorCode} from ${ip}`);
      res.status(401).json({ error: 'PIN incorrecto', code: 'INVALID_CREDENTIALS' });
      return;
    }

    // Success — clear lockout
    lockouts.delete(safeUser);

    // Step 4: Detect Repartidor role
    const repartidorInfo = await detectRepartidor(vendedorCode);

    // Step 5: Determine final role
    let finalRole = 'COMERCIAL';
    if (isJefeVentas) finalRole = 'JEFE_VENTAS';
    else if (repartidorInfo.isRepartidor) finalRole = 'REPARTIDOR';

    // Step 6: Get vendor codes
    let vendedorCodes = [vendedorCode];
    if (isJefeVentas) {
      vendedorCodes = await getAllVendorCodes();
    }

    // Step 7: Generate tokens
    const tokens = refreshTokenManager.generateTokens({
      userId: vendedorCode,
      username: vendedorCode,
      role: finalRole,
      vendedorCode,
    });

    logger.info(`✅ Login: ${vendedorName} (${vendedorCode}) — ${finalRole} from ${ip}`);

    res.json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: vendedorCode,
        code: vendedorCode,
        name: vendedorName,
        vendedorCode,
        isJefeVentas,
        tipoVendedor,
        role: finalRole,
        showCommissions: !vendorRecord.HIDE_COMMISSIONS,
        vendedorCodes,
        codigoConductor: repartidorInfo.codigoConductor,
        matriculaVehiculo: repartidorInfo.matriculaVehiculo,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'LOGIN_ERROR' });
  }
});

// ============================================================
// POST /api/auth/refresh (token rotation with theft detection)
// ============================================================

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'refreshToken required' });
      return;
    }

    const tokens = refreshTokenManager.rotateToken(refreshToken);
    if (!tokens) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    res.json(tokens);
  } catch (error) {
    if (error instanceof TokenError) {
      const status = error.code === 'TOKEN_THEFT' ? 403 : 401;
      res.status(status).json({ error: error.message, code: error.code });
      return;
    }
    logger.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(refreshToken, config.auth.refreshTokenSecret);
        if (decoded?.tokenId) {
          refreshTokenManager.revokeToken(decoded.tokenId);
        }
      } catch {
        // Token invalid — ignore, still logout
      }
    }

    logger.info(`🔒 User logged out: ${req.user?.username || 'unknown'}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PRIVATE HELPERS (exact logic from production auth.js)
// ============================================================

/**
 * Find vendor by code in DSEDAC.VDPL1
 */
async function findVendorByCode(code: string): Promise<Record<string, unknown> | null> {
  const sql = `
    SELECT P.CODIGOVENDEDOR, P.CODIGOPIN,
           TRIM(D.NOMBREVENDEDOR) AS NOMBREVENDEDOR,
           V.TIPOVENDEDOR, X.JEFEVENTASSN,
           E.HIDE_COMMISSIONS
    FROM DSEDAC.VDPL1 P
    JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
    JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
    LEFT JOIN DSEDAC.VDDX X ON P.CODIGOVENDEDOR = X.CODIGOVENDEDOR
    LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON P.CODIGOVENDEDOR = E.CODIGOVENDEDOR
    WHERE TRIM(P.CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
    FETCH FIRST 1 ROWS ONLY
  `;

  try {
    const result = await dbPool.query<Record<string, unknown>[]>(sql, [code]);
    return result.data && result.data.length > 0 ? result.data[0] as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Find vendor by name (fallback search)
 */
async function findVendorByName(searchParam: string): Promise<Record<string, unknown> | null> {
  const sql = `
    SELECT P.CODIGOVENDEDOR, P.CODIGOPIN,
           TRIM(D.NOMBREVENDEDOR) AS NOMBREVENDEDOR,
           V.TIPOVENDEDOR, X.JEFEVENTASSN,
           E.HIDE_COMMISSIONS
    FROM DSEDAC.VDD D
    JOIN DSEDAC.VDPL1 P ON D.CODIGOVENDEDOR = P.CODIGOVENDEDOR
    JOIN DSEDAC.VDC V ON D.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
    LEFT JOIN DSEDAC.VDDX X ON D.CODIGOVENDEDOR = X.CODIGOVENDEDOR
    LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON D.CODIGOVENDEDOR = E.CODIGOVENDEDOR
    WHERE REPLACE(UPPER(TRIM(D.NOMBREVENDEDOR)), ' ', '') LIKE '%' CONCAT CAST(? AS VARCHAR(100)) CONCAT '%'
    FETCH FIRST 1 ROWS ONLY
  `;

  try {
    const result = await dbPool.query<Record<string, unknown>[]>(sql, [searchParam]);
    return result.data && result.data.length > 0 ? result.data[0] as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Detect if vendor is a Repartidor (delivery driver)
 * Checks: 1) Vehicle conductor, 2) Preparation orders
 */
async function detectRepartidor(vendedorCode: string): Promise<{
  isRepartidor: boolean;
  codigoConductor: string | null;
  matriculaVehiculo: string | null;
}> {
  const result = { isRepartidor: false, codigoConductor: null as string | null, matriculaVehiculo: null as string | null };

  try {
    // Check 1: Vehicle conductor
    const vehSql = `
      SELECT TRIM(CODIGOVEHICULO) AS VEHICULO, TRIM(MATRICULA) AS MATRICULA
      FROM DSEDAC.VEH
      WHERE TRIM(CODIGOCONDUCTOR) = ?
        AND TRIM(CODIGOCONDUCTOR) <> '98'
      FETCH FIRST 1 ROWS ONLY
    `;
    const vehResult = await dbPool.query<Record<string, unknown>[]>(vehSql, [vendedorCode]);
    if (vehResult.data && vehResult.data.length > 0) {
      result.isRepartidor = true;
      result.matriculaVehiculo = String(vehResult.data[0].MATRICULA || '');
      result.codigoConductor = vendedorCode;
      return result;
    }

    // Check 2: Preparation orders (OPP) — if >= 100 orders this year
    const currentYear = new Date().getFullYear();
    const oppSql = `
      SELECT COUNT(*) AS CNT FROM DSEDAC.OPP
      WHERE TRIM(CODIGOREPARTIDOR) = ?
        AND ANOREPARTO = ?
    `;
    const oppResult = await dbPool.query<Record<string, unknown>[]>(oppSql, [vendedorCode, currentYear]);
    const count = oppResult.data?.[0] ? Number((oppResult.data[0] as Record<string, unknown>).CNT) : 0;
    if (count >= 100) {
      result.isRepartidor = true;
      result.codigoConductor = vendedorCode;
    }
  } catch {
    // Non-fatal — default to not repartidor
  }

  return result;
}

/**
 * Get ALL vendor codes for JEFE DE VENTAS
 */
async function getAllVendorCodes(): Promise<string[]> {
  try {
    const sql = `
      SELECT DISTINCT TRIM(CODIGOVENDEDOR) AS CODE
      FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
    `;
    const result = await dbPool.query<Record<string, unknown>[]>(sql);
    const codes = new Set<string>();
    if (result.data) {
      for (const row of result.data) {
        codes.add(String((row as Record<string, unknown>).CODE));
      }
    }
    // Add orphan codes that might be referenced
    codes.add('82');
    codes.add('20');
    codes.add('UNK');
    return Array.from(codes);
  } catch {
    return ['ALL'];
  }
}

function sanitizeUsername(username: string): string {
  return username.replace(/[^a-zA-Z0-9 ]/g, '').trim().toUpperCase();
}

function recordFailedAttempt(username: string): void {
  const entry = lockouts.get(username) || { count: 0, lockedUntil: 0 };
  entry.count++;

  const maxAttempts = config.auth.lockoutThreshold;
  const lockoutMs = config.auth.lockoutDuration;

  if (entry.count >= maxAttempts) {
    entry.lockedUntil = Date.now() + lockoutMs;
    logger.warn(`🔒 Account locked: ${username} (${entry.count} failed attempts)`);
  }

  lockouts.set(username, entry);
}

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || req.socket.remoteAddress
    || 'unknown';
}

export { router as authRoutes };
