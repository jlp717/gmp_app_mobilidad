'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.cwd();
const files = new Map();
function load(name) {
  if (!files.has(name)) files.set(name, fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'));
  return files.get(name);
}
function replaceOnce(name, before, after) {
  const source = load(name);
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`bad anchor ${name}: ${before.slice(0, 70)}`);
  files.set(name, source.slice(0, at) + after + source.slice(at + before.length));
}

const finance = 'backend/routes/repartidor-finanzas.js';
replaceOnce(finance,
`const { verifyToken, requireRoles } = require('../middleware/auth');`,
`const { verifyToken } = require('../middleware/auth');`);
replaceOnce(finance,
`function requireLiquidacionAdjustmentRole(req, res, next) {
  if (hasFinanceListRole(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: 'LIQUIDACION_ADJUSTMENT_ROLE_REQUIRED',
    error: 'Solo JEFE_VENTAS o ADMIN puede crear ajustes',
  });
}`,
`function requireLiquidacionAdjustmentRole(req, res, next) {
  if (hasFinanceListRole(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: 'LIQUIDACION_ADJUSTMENT_ROLE_REQUIRED',
    error: 'Solo JEFE_VENTAS en Perfil Reparto o ADMIN puede crear ajustes',
  });
}

function requireFinanceManagementRole(req, res, next) {
  if (hasFinanceListRole(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: 'REPARTIDOR_FINANCE_ROLE_REQUIRED',
    error: 'Activa el Perfil Reparto para administrar finanzas',
  });
}`);
replaceOnce(finance,
`router.put('/commissions/tiers', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {`,
`router.put('/commissions/tiers', verifyToken, requireFinanceManagementRole, async (req, res) => {`);
replaceOnce(finance,
`router.delete('/test-cleanup/:idempotencyToken', verifyToken, requireRoles('JEFE_VENTAS', 'ADMIN'), async (req, res) => {`,
`router.delete('/test-cleanup/:idempotencyToken', verifyToken, requireFinanceManagementRole, async (req, res) => {`);
replaceOnce(finance,
`  if (role === 'ADMIN' || supervisor) {
    if (!target) {`,
`  if (role === 'ADMIN' || supervisor) {
    if (!target) {`);
replaceOnce(finance,
`    return target;
  }
  if (target && !codesMatch(authenticated, target)) {`,
`    if (role === 'ADMIN') return target;
    const visible = [
      ...(Array.isArray(req.user?.vendorCodes) ? req.user.vendorCodes : []),
      ...(Array.isArray(req.user?.vendedorCodes) ? req.user.vendedorCodes : []),
    ].map((code) => String(code || '').trim()).filter(Boolean);
    const selected = visible.find((code) => codesMatch(code, target));
    if (!selected) {
      throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);
    }
    return selected;
  }
  if (target && !codesMatch(authenticated, target)) {`);

const authRoute = 'backend/routes/auth.js';
replaceOnce(authRoute,
`const REPARTIDORES_CACHE_TTL = 5 * 60 * 1000;

router.get('/repartidores', verifyToken, async (req, res) => {`,
`const REPARTIDORES_CACHE_TTL = 5 * 60 * 1000;

function repartidoresAccess(user = {}) {
    const role = String(user.role || '').trim().toUpperCase();
    const activeMode = String(user.activeMode || '').trim().toUpperCase();
    if (role === 'REPARTIDOR') return 'SELF';
    if (role === 'ADMIN' || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR')) return 'FLEET';
    return 'DENIED';
}

router.get('/repartidores', verifyToken, async (req, res) => {`);
replaceOnce(authRoute,
`        const role = String(req.user?.role || '').trim().toUpperCase();
        const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();
        if (role === 'REPARTIDOR') {`,
`        const access = repartidoresAccess(req.user);
        if (access === 'SELF') {`);
replaceOnce(authRoute,
`        const canListFleet = role === 'ADMIN'
            || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');
        if (!canListFleet) {`,
`        if (access !== 'FLEET') {`);
replaceOnce(authRoute,
`module.exports = router;`,
`router.repartidoresAccess = repartidoresAccess;
module.exports = router;`);

const legacy = 'backend/__tests__/repartidor-legacy-read-security.test.js';
replaceOnce(legacy,
`    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual([8, 2026, '05']);`,
`    const collectionCalls = mockQueryWithParams.mock.calls
      .filter(([sql]) => String(sql).includes('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA'));
    expect(collectionCalls).toHaveLength(1);
    const [sql, params] = collectionCalls[0];
    expect(params).toEqual([8, 2026, '05']);`);
replaceOnce(legacy,
`    expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual([2026, 8, '05', '06']);`,
`    const collectionCalls = mockQueryWithParams.mock.calls
      .filter(([sql]) => String(sql).includes('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA'));
    expect(collectionCalls).toHaveLength(2);
    expect(collectionCalls[0][1]).toEqual([2026, 8, '05', '06']);`);
replaceOnce(legacy,
`  test('does not elevate an inconsistent privilege flag', async () => {`,
`  test('canonicalizes a one-digit own code before DB2', async () => {
    const response = await authenticatedGet('/repartidor/collections/summary/5')
      .query({ year: 2026, month: 8 });
    expect(response.status).toBe(200);
    const collectionCall = mockQueryWithParams.mock.calls
      .find(([sql]) => String(sql).includes('CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA'));
    expect(collectionCall[1]).toEqual([8, 2026, '05']);
  });

  test('JEFE outside Perfil Reparto is denied fleet access before DB2', async () => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', isJefeVentas: true };
    const response = await authenticatedGet('/repartidor/collections/daily/05,06')
      .query({ year: 2026, month: 8 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('REPARTIDOR_MODE_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('does not elevate an inconsistent privilege flag', async () => {`);
replaceOnce(legacy,
`  test('allows the exact owner and explicit privileged roles', async () => {`,
`  test.each([
    '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
    '/repartidor/entregas/123/firma',
    '/repartidor/history/legacy-signature/2026-A-0-1',
  ])('JEFE reparto signatures require a concrete owner before DB2: %s', async (path) => {
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    const response = await authenticatedGet(path);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('allows the exact owner and explicit privileged roles', async () => {`);
replaceOnce(legacy,
`describe('client pagination beyond the first 100', () => {`,
`describe('fleet client cards preserve a concrete owner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
  });

  test('same ERP client assigned to two drivers remains two isolated cards', async () => {
    mockQueryWithParams.mockResolvedValue([
      { ID: 'C1', NAME: 'Cliente', ADDRESS: 'Ruta 1', TOTAL_DOCS: 2, TOTAL_AMOUNT: 20, LAST_VISIT: 20260818, OWNER_ID: '5' },
      { ID: 'C1', NAME: 'Cliente', ADDRESS: 'Ruta 2', TOTAL_DOCS: 3, TOTAL_AMOUNT: 30, LAST_VISIT: 20260817, OWNER_ID: '06' },
    ]);
    const response = await authenticatedGet('/repartidor/history/clients/5,06');
    expect(response.status).toBe(200);
    expect(response.body.clients).toEqual([
      expect.objectContaining({ id: 'C1', repCode: '05', totalDocuments: 2 }),
      expect.objectContaining({ id: 'C1', repCode: '06', totalDocuments: 3 }),
    ]);
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/CODIGOREPARTIDOR[\\s\\S]*OWNER_ID/);
  });
});

describe('client pagination beyond the first 100', () => {`);

const financeTest = 'backend/__tests__/repartidor-finanzas-http-gap-coverage.test.js';
replaceOnce(financeTest,
`  test('commission tier writes delegate only with a permitted role and valid body', async () => {`,
`  test('JEFE finance privilege requires active reparto mode and ignores inconsistent boolean flags', async () => {
    const summary = jest.spyOn(financeService, 'getSummary');
    mockAuthUser = { id: '94', code: '94', role: 'REPARTIDOR', isJefeVentas: true };
    let response = await request(server).get('/finanzas/summary/95');
    expect(response.status).toBe(403);
    expect(summary).not.toHaveBeenCalled();

    const save = jest.spyOn(financeService, 'saveCommissionTiers').mockResolvedValue(validTiers().tiers);
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
    response = await request(server).put('/finanzas/commissions/tiers').send(validTiers());
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();

    mockAuthUser.activeMode = 'REPARTIDOR';
    response = await request(server).put('/finanzas/commissions/tiers').send(validTiers());
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('vencimiento detail rejects ALL and CSV before service access', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    const detail = jest.spyOn(financeService, 'getDetalleVencimiento');
    for (const selector of ['ALL', '94,95']) {
      const response = await request(server)
        .get('/finanzas/vencimientos/' + selector + '/ALB-2026-S-10-404-1/detalle');
      expect(response.status).toBe(422);
    }
    expect(detail).not.toHaveBeenCalled();
  });

  test('commission tier writes delegate only with a permitted role and valid body', async () => {`);

const evidenceTest = 'backend/__tests__/reparto-evidence-route.test.js';
replaceOnce(evidenceTest,
`  test('stages signature as an opaque ID and returns 201/200 for create/retry', async () => {`,
`  test.each([
    ['signature', undefined], ['signature', 'ALL'], ['signature', '94,95'],
    ['photo', undefined], ['photo', 'ALL'], ['photo', '94,95'],
  ])('JEFE evidence %s rejects non-concrete selector %s before storage', async (kind, repartidorId) => {
    const stageSignature = jest.fn();
    const stagePhoto = jest.fn();
    injectEvidence({ stageSignature, stagePhoto, retrieve: jest.fn() });
    mockUser = {
      id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR',
      vendorCodes: ['94', '95'],
    };
    const base = { documentId: '2026-S-10-404-4300009479' };
    const response = kind === 'signature'
      ? await request(app()).post('/finanzas/rutero/evidence/signature').send({
        ...base, ...(repartidorId ? { repartidorId } : {}),
        signature: 'data:image/png;base64,' + PNG.toString('base64'),
      })
      : await request(app()).post('/finanzas/rutero/evidence/photo')
        .field('documentId', base.documentId)
        .field('repartidorId', repartidorId || '')
        .attach('photo', PNG, { filename: 'proof.png', contentType: 'image/png' });
    expect(response.status).toBe(422);
    expect(stageSignature).not.toHaveBeenCalled();
    expect(stagePhoto).not.toHaveBeenCalled();
  });

  test.each(['signature', 'photo'])('JEFE evidence %s rejects foreign and wrong mode before storage', async (kind) => {
    const stageSignature = jest.fn();
    const stagePhoto = jest.fn();
    injectEvidence({ stageSignature, stagePhoto, retrieve: jest.fn() });
    const send = async (repartidorId) => kind === 'signature'
      ? request(app()).post('/finanzas/rutero/evidence/signature').send({
        documentId: '2026-S-10-404-4300009479', repartidorId,
        signature: 'data:image/png;base64,' + PNG.toString('base64'),
      })
      : request(app()).post('/finanzas/rutero/evidence/photo')
        .field('documentId', '2026-S-10-404-4300009479')
        .field('repartidorId', repartidorId)
        .attach('photo', PNG, { filename: 'proof.png', contentType: 'image/png' });

    mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', vendorCodes: ['94'] };
    expect((await send('95')).status).toBe(403);
    mockUser = { ...mockUser, activeMode: 'COMERCIAL' };
    expect((await send('94')).status).toBe(403);
    expect(stageSignature).not.toHaveBeenCalled();
    expect(stagePhoto).not.toHaveBeenCalled();
  });

  test('stages signature as an opaque ID and returns 201/200 for create/retry', async () => {`);

const chatbotTest = 'backend/__tests__/chatbot_reparto_scope.test.js';
replaceOnce(chatbotTest,
`  test('scope request requires the actual JEFE reparto mode', () => {`,
`  test('reparto profiles require an explicit selector', () => {
    expect(authorizeChatbotRepartoScope({ code: '08', role: 'REPARTIDOR' }, null))
      .toMatchObject({ allowed: false, code: 'REPARTO_SCOPE_REQUIRED' });
    expect(authorizeChatbotRepartoScope({ code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' }, null))
      .toMatchObject({ allowed: false, code: 'REPARTO_SCOPE_REQUIRED' });
  });

  test('canonicalizes selected codes to the visible code', () => {
    expect(authorizeChatbotRepartoScope({
      code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', vendorCodes: ['08'],
    }, '8')).toMatchObject({ allowed: true, driverCodes: ['08'] });
  });

  test('scope request requires the actual JEFE reparto mode', () => {`);
replaceOnce(chatbotTest,
`  test('foreign BOLA scope is denied before a connection is opened', async () => {`,
`  test.each([
    [{ code: '08', role: 'REPARTIDOR' }],
    [{ code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', vendorCodes: ['08'] }],
  ])('missing reparto selector is denied before a connection opens', async (user) => {
    const result = await processMessage({ message: 'entregas de hoy', user });
    expect(result).toMatchObject({ success: false, statusCode: 422, error: 'REPARTO_SCOPE_REQUIRED' });
    expect(getPool).not.toHaveBeenCalled();
    expect(handleChatMessage).not.toHaveBeenCalled();
  });

  test('foreign BOLA scope is denied before a connection is opened', async () => {`);

const authTest = 'backend/__tests__/auth.test.js';
replaceOnce(authTest,
`    describe('Active Sessions Management', () => {`,
`    describe('Repartidores fleet authorization', () => {
        test('derives authority from role and reparto mode, never a boolean flag', () => {
            expect(authRoutes.repartidoresAccess({ role: 'REPARTIDOR', isJefeVentas: true })).toBe('SELF');
            expect(authRoutes.repartidoresAccess({ role: 'JEFE_VENTAS', isJefeVentas: true })).toBe('DENIED');
            expect(authRoutes.repartidoresAccess({ role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' })).toBe('FLEET');
            expect(authRoutes.repartidoresAccess({ role: 'ADMIN' })).toBe('FLEET');
        });
    });

    describe('Active Sessions Management', () => {`);

const middlewareTest = 'backend/__tests__/middleware/auth-middleware.test.js';
replaceOnce(middlewareTest,
`    test('should preserve isJefeVentas flag', async () => {`,
`    test('signed inconsistent REPARTIDOR boolean is projected without jefe privilege', async () => {
        const token = signAccessToken(validAccessPayload({
            role: 'REPARTIDOR', isJefeVentas: true, isRepartidor: true,
        }));
        const req = createMockReq({ headers: { authorization: 'Bearer ' + token } });
        const res = createMockRes();
        const next = jest.fn();
        await verifyToken(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject({ role: 'REPARTIDOR', isJefeVentas: false });
    });

    test('should preserve isJefeVentas flag', async () => {`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-phase-j3-'));
for (const [name, modified] of files) {
  const oldPath = path.join(tmp, 'old', name);
  const newPath = path.join(tmp, 'new', name);
  fs.mkdirSync(path.dirname(oldPath), { recursive: true });
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.copyFileSync(path.join(root, name), oldPath);
  fs.writeFileSync(newPath, modified, 'utf8');
}
const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', 'old', 'new'], {
  cwd: tmp, encoding: 'utf8', maxBuffer: 15 * 1024 * 1024,
});
if (![0, 1].includes(diff.status)) throw new Error(diff.stderr);
const output = diff.stdout.replaceAll('a/old/', 'a/').replaceAll('b/new/', 'b/');
fs.writeFileSync(path.join(root, '.codex/graph-runs/20260818-reparto-remediation/phase-j3-coverage.generated.patch'), output, 'utf8');
console.log(`generated ${files.size} files, ${output.length} bytes`);
