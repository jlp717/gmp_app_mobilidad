'use strict';

const fs = require('fs');
const path = require('path');
const cors = require('cors');
const express = require('express');
const request = require('supertest');

const serverPath = path.resolve(__dirname, '..', 'server.js');

function loadServerSource() {
  return fs.readFileSync(serverPath, 'utf8');
}

function countOccurrences(source, fragment) {
  return source.split(fragment).length - 1;
}

function configuredAllowedHeaders(source) {
  const match = /allowedHeaders:\s*\[([^\]]+)\]/.exec(source);
  if (!match) throw new Error('server CORS allowedHeaders not found');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('canonical reparto server mounts', () => {
  test('allows Idempotency-Key in a credentialed confirmation preflight', async () => {
    const source = loadServerSource();
    const allowedHeaders = configuredAllowedHeaders(source);
    const preflightApp = express();
    preflightApp.use(cors({
      origin: ['https://gmp.test'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders,
      credentials: true,
      maxAge: 86400,
    }));

    const response = await request(preflightApp)
      .options('/api/repartidor-finanzas/rutero/confirmaciones')
      .set('Origin', 'https://gmp.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key,authorization');

    const responseHeaders = String(response.headers['access-control-allow-headers'] || '')
      .split(',')
      .map((header) => header.trim().toLowerCase());
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://gmp.test');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(responseHeaders).toEqual(expect.arrayContaining([
      'content-type', 'idempotency-key', 'authorization',
    ]));
    expect(allowedHeaders.filter((header) => header.toLowerCase() === 'idempotency-key'))
      .toEqual(['Idempotency-Key']);
  });

  test('uses the legacy Flutter contracts exactly once in both JavaScript modes', () => {
    const source = loadServerSource();
    const plannerMount = "app.use('/api', plannerRoutes);";
    const entregasMount = "app.use('/api/entregas', entregasRoutes);";
    const dddBranch = source.indexOf('if (USE_DDD_ROUTES) {', source.indexOf(plannerMount));

    expect(countOccurrences(source, plannerMount)).toBe(1);
    expect(countOccurrences(source, entregasMount)).toBe(1);
    expect(source.indexOf(plannerMount)).toBeGreaterThan(0);
    expect(source.indexOf(entregasMount)).toBeGreaterThan(source.indexOf(plannerMount));
    expect(source.indexOf(entregasMount)).toBeLessThan(dddBranch);
  });

  test('does not apply the reparto write toggle to planner rutero routes', () => {
    const source = loadServerSource();
    const plannerMount = "app.use('/api', plannerRoutes);";

    expect(source).not.toContain("app.use('/api/rutero', verifyToken, repartoWriteGuard);");
    expect(countOccurrences(source, plannerMount)).toBe(1);
    expect(source.indexOf(plannerMount)).toBeGreaterThan(0);
    expect(source).toContain("app.use('/api/repartidor-finanzas', verifyToken, repartoFinanzasWriteGuard, canonicalRepartidorFinanzasRoutes);");
    expect(source).toContain("app.use('/api/repartidor', verifyToken, repartoFamilyWriteGuard);");
    expect(source).toContain("app.use('/api/entregas', verifyToken, repartoConfirmationWriteGuard);");
  });

  test('does not instantiate or mount parallel DDD reparto contracts', () => {
    const source = loadServerSource();

    expect(source).not.toContain('createEntregasRoutes()');
    expect(source).not.toContain('createRuteroRoutes()');
    expect(source).not.toContain('dddEntregasRoutes');
    expect(source).not.toContain('dddRuteroRoutes');
  });

  test('mounts DDD auth only in public routes and preserves legacy fallback', () => {
    const source = loadServerSource();
    const dddAuthMount = "app.use('/api/auth', dddAuthRoutes);";
    const legacyAuthMount = "app.use('/api/auth', authRoutes);";
    const protectedRoutes = source.indexOf('// PROTECTED ROUTES (Token Required)');

    expect(countOccurrences(source, dddAuthMount)).toBe(1);
    expect(source.indexOf(dddAuthMount)).toBeLessThan(protectedRoutes);
    expect(countOccurrences(source, legacyAuthMount)).toBe(2);
    expect(source.indexOf(legacyAuthMount)).toBeLessThan(protectedRoutes);
  });

  test('mounts the canonical finance router exactly once before family selection', () => {
    const source = loadServerSource();
    const financeMount = "app.use('/api/repartidor-finanzas', verifyToken, repartoFinanzasWriteGuard, canonicalRepartidorFinanzasRoutes);";
    const firstFamilyBranch = source.indexOf('if (USE_TS_ROUTES && global.__TS_APP__)');

    expect(countOccurrences(source, financeMount)).toBe(1);
    expect(source.indexOf(financeMount)).toBeGreaterThan(0);
    expect(source.indexOf(financeMount)).toBeLessThan(firstFamilyBranch);
  });
});
