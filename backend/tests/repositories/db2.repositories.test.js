'use strict';

const { RuteroRepository } = require('../../src/repositories/rutero.repository');
const { DashboardRepository } = require('../../src/repositories/dashboard.repository');
const { Db2ClientRepository } = require('../../src/modules/clients/infrastructure/db2-client-repository');

describe('repositories: parametrizacion SQL y seams', () => {
    test('RuteroRepository ERP: un placeholder por codigo + fecha como binds', async () => {
        const q = jest.fn(async () => [{ DELIVERED: '7' }]);
        const repo = new RuteroRepository({ queryWithParams: q });
        const n = await repo.fetchErpDeliveredCount(['A1', 'B2'], { dia: 25, mes: 8, ano: 2026 });
        expect(n).toBe(7);
        const [sql, params] = q.mock.calls[0];
        expect((sql.match(/\?/g) || []).length).toBe(5); // 2 codes + dia+mes+ano
        expect(params).toEqual(['A1', 'B2', 25, 8, 2026]);
        // Solo lectura: DSEDAC ERP
        expect(sql).toMatch(/DSEDAC\.OPP/);
    });

    test('RuteroRepository app: esquema nuevo usa IDEMPOTENCY_TOKEN/OPERADOR', async () => {
        const keys = [
            'NODE_ENV',
            'REPARTO_ENVIRONMENT',
            'REPARTO_TABLE_SET',
            'ODBC_DSN',
            'REPARTIDOR_FINANCE_READ_SCHEMA',
            'REPARTIDOR_FINANCE_APP_SCHEMA',
            'REPARTIDOR_FINANCE_ERP_SCHEMA',
            'REPARTO_WRITES_ENABLED',
            'REPARTO_EVIDENCE_PENDING_TTL_HOURS',
        ];
        const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
        Object.assign(process.env, {
            NODE_ENV: 'production',
            REPARTO_ENVIRONMENT: 'production',
            REPARTO_TABLE_SET: 'production',
            ODBC_DSN: 'GMP',
            REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
            REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
            REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
            REPARTO_WRITES_ENABLED: 'false',
            REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
        });
        jest.resetModules();
        try {
            const { RuteroRepository: ProductionRuteroRepository } =
                require('../../src/repositories/rutero.repository');
            const q = jest.fn(async () => [{ DELIVERED: '3' }]);
            const repo = new ProductionRuteroRepository({ queryWithParams: q });
            await repo.fetchAppDeliveredCount(['A1']);
            const [sql] = q.mock.calls[0];
            expect(sql).toContain('FROM JAVIER.DELIVERY_STATUS DS');
        } finally {
            jest.resetModules();
            for (const key of keys) {
                if (previous[key] === undefined) delete process.env[key];
                else process.env[key] = previous[key];
            }
        }
    });

    test('RuteroRepository no consulta estados cuando el runtime es invalido', async () => {
        const keys = [
            'NODE_ENV',
            'REPARTO_ENVIRONMENT',
            'REPARTO_TABLE_SET',
            'ODBC_DSN',
            'REPARTIDOR_FINANCE_READ_SCHEMA',
            'REPARTIDOR_FINANCE_APP_SCHEMA',
            'REPARTIDOR_FINANCE_ERP_SCHEMA',
            'REPARTO_WRITES_ENABLED',
            'REPARTO_EVIDENCE_PENDING_TTL_HOURS',
        ];
        const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
        Object.assign(process.env, {
            NODE_ENV: 'staging',
            REPARTO_ENVIRONMENT: 'staging',
            REPARTO_TABLE_SET: 'production',
            ODBC_DSN: 'GMP',
            REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
            REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
            REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
            REPARTO_WRITES_ENABLED: 'true',
            REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
        });
        jest.resetModules();
        try {
            const { RuteroRepository: InvalidRuteroRepository } =
                require('../../src/repositories/rutero.repository');
            const q = jest.fn();
            const repo = new InvalidRuteroRepository({ queryWithParams: q });
            await expect(repo.fetchAppDeliveredCount(['A1'])).resolves.toBe(0);
            expect(q).not.toHaveBeenCalled();
        } finally {
            jest.resetModules();
            for (const key of keys) {
                if (previous[key] === undefined) delete process.env[key];
                else process.env[key] = previous[key];
            }
        }
    });

    test('RuteroRepository app: isolated_test usa la tabla TEST del runtime', async () => {
        const keys = [
            'NODE_ENV',
            'REPARTO_ENVIRONMENT',
            'REPARTO_TABLE_SET',
            'ODBC_DSN',
            'REPARTIDOR_FINANCE_READ_SCHEMA',
            'REPARTIDOR_FINANCE_APP_SCHEMA',
            'REPARTIDOR_FINANCE_ERP_SCHEMA',
            'REPARTO_WRITES_ENABLED',
            'REPARTO_EVIDENCE_PENDING_TTL_HOURS',
        ];
        const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
        Object.assign(process.env, {
            NODE_ENV: 'staging',
            REPARTO_ENVIRONMENT: 'staging',
            REPARTO_TABLE_SET: 'isolated_test',
            ODBC_DSN: 'GMP',
            REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
            REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
            REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
            REPARTO_WRITES_ENABLED: 'true',
            REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
        });
        jest.resetModules();
        try {
            const { RuteroRepository: IsolatedRuteroRepository } =
                require('../../src/repositories/rutero.repository');
            const q = jest.fn(async () => [{ DELIVERED: '3' }]);
            const repo = new IsolatedRuteroRepository({ queryWithParams: q });
            await repo.fetchAppDeliveredCount(['A1']);
            const [sql] = q.mock.calls[0];
            expect(sql).toContain('FROM JAVIER.TEST_DELIVERY_STATUS DS');
            expect(sql).not.toContain('FROM JAVIER.DELIVERY_STATUS DS');
        } finally {
            jest.resetModules();
            for (const key of keys) {
                if (previous[key] === undefined) delete process.env[key];
                else process.env[key] = previous[key];
            }
        }
    });

    test('RuteroRepository fallback CDVI: sin codes no ejecuta SQL', async () => {
        const q = jest.fn();
        const repo = new RuteroRepository({ queryWithParams: q });
        const rows = await repo.fetchWeeklyVisitCounts([]);
        expect(rows).toEqual([]);
        expect(q).not.toHaveBeenCalled();
    });

    test('RuteroRepository fallback con codes: IN parametrizado sobre CODIGOVENDEDOR', async () => {
        const q = jest.fn(async () => [{ LUNES: '1' }]);
        const repo = new RuteroRepository({ queryWithParams: q });
        await repo.fetchWeeklyVisitCounts(['X9']);
        const [sql, params] = q.mock.calls[0];
        expect(sql).toMatch(/TRIM\(CODIGOVENDEDOR\) IN \(\?\)/);
        expect(params).toEqual(['X9']);
    });

    test('DashboardRepository.fetchPeriodAggregate delega en cachedQuery inyectado', async () => {
        const cachedQuery = jest.fn(async () => [{ SALES: '1' }]);
        const qfn = jest.fn();
        const repo = new DashboardRepository({ queryWithParams: qfn, cachedQuery });
        const out = await repo.fetchPeriodAggregate('SELECT 1', [5], 'k', 60);
        expect(out).toEqual([{ SALES: '1' }]);
        expect(cachedQuery).toHaveBeenCalledWith(qfn, 'SELECT 1', 'k', 60, [5]);
    });

    test('Db2ClientRepository.compare parametriza clientes, vendedores y ano', async () => {
        const executeParams = jest.fn(async () => []);
        const repo = new Db2ClientRepository({ executeParams });
        await repo.compare(['C001', 'C002'], '01,02', 2026);
        const [sql, params] = executeParams.mock.calls[0];
        expect((sql.match(/\?/g) || []).length).toBe(5);
        expect(sql).not.toContain("'01'");
        expect(params).toEqual(['C001', 'C002', '01', '02', 2026]);
    });

    test('clients cached scope keeps placeholder and bind order aligned', async () => {
        jest.resetModules();
        const queryWithParams = jest.fn(async () => []);
        const cachedQuery = jest.fn(async (queryFn, sql, _options, params) => queryFn(sql, params));
        jest.doMock('../../config/db', () => ({ query: jest.fn(), queryWithParams }));
        jest.doMock('../../services/query-optimizer', () => ({ cachedQuery }));
        jest.doMock('../../services/laclae', () => ({
            getClientDays: jest.fn(),
            getClientCodesFromCache: jest.fn(() => ['C001', 'C002']),
        }));
        jest.doMock('../../middleware/auth', () => ({ verifyToken: (_req, _res, next) => next() }));

        const router = require('../../routes/clients');
        const handler = router.stack.find(layer => layer.route?.path === '/').route.stack.at(-1).handle;
        const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
        await handler({
            query: { vendedorCodes: '01' },
            user: { role: 'ADMIN', isJefeVentas: true },
        }, res);

        const [sql, params] = queryWithParams.mock.calls[0];
        expect((sql.match(/\?/g) || []).length).toBe(params.length);
        expect(params).toEqual(['C001', 'C002', 'C001', 'C002']);
        jest.resetModules();
        jest.dontMock('../../config/db');
        jest.dontMock('../../services/query-optimizer');
        jest.dontMock('../../services/laclae');
        jest.dontMock('../../middleware/auth');
    });

    test.each([
        [
            { clientCode: 'C001', productSearch: 'abc', startDate: '2026-01-01', endDate: '2026-01-31' },
            ['C001', '%ABC%', '%ABC%', '%ABC%', 20260101, 20260131],
        ],
        [{}, []],
    ])('analytics optional filters keep placeholder and bind order aligned %#', async (query, expectedParams) => {
        jest.resetModules();
        const queryWithParams = jest.fn(async () => []);
        jest.doMock('../../config/db', () => ({ query: jest.fn(), queryWithParams }));
        jest.doMock('../../middleware/auth', () => ({ verifyToken: (_req, _res, next) => next() }));

        const router = require('../../routes/analytics');
        const handler = router.stack.find(layer => layer.route?.path === '/sales-history').route.stack.at(-1).handle;
        const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
        await handler({ query, user: { role: 'ADMIN' } }, res);

        const [sql, params] = queryWithParams.mock.calls[0];
        expect((sql.match(/\?/g) || []).length).toBe(params.length);
        expect(params).toEqual(expectedParams);
        jest.resetModules();
        jest.dontMock('../../config/db');
        jest.dontMock('../../middleware/auth');
    });

    test('circuit breaker counts only matching connection errors', async () => {
        const { CircuitBreaker, OPEN, CLOSED } = require('../../services/circuit-breaker');
        const breaker = new CircuitBreaker({
            name: 'db-test',
            failureThreshold: 1,
            throwOnFailure: true,
            shouldCountFailure: error => error.code === 'ETIMEDOUT',
        });

        await expect(breaker.execute(() => Promise.reject(Object.assign(new Error('bad SQL'), { code: '42000' }))))
            .rejects.toMatchObject({ code: '42000' });
        expect(breaker.state).toBe(CLOSED);
        expect(breaker.getMetrics().sampleSize).toBe(0);

        await expect(breaker.execute(() => Promise.reject(Object.assign(new Error('connection timeout'), { code: 'ETIMEDOUT' }))))
            .rejects.toMatchObject({ code: 'ETIMEDOUT' });
        expect(breaker.state).toBe(OPEN);
    });

    test('half-open circuit permits one probe and rejects concurrent calls', async () => {
        const { CircuitBreaker, CircuitOpenError, OPEN, HALF_OPEN, CLOSED } = require('../../services/circuit-breaker');
        const breaker = new CircuitBreaker({ name: 'db-test', successThreshold: 1, throwOnFailure: true });
        breaker.state = OPEN;
        breaker.nextAttempt = 0;
        let resolveProbe;
        const probe = breaker.execute(() => new Promise(resolve => { resolveProbe = resolve; }));
        await Promise.resolve();
        expect(breaker.state).toBe(HALF_OPEN);

        await expect(breaker.execute(() => Promise.resolve('second'))).rejects.toBeInstanceOf(CircuitOpenError);
        resolveProbe('healthy');
        await expect(probe).resolves.toBe('healthy');
        expect(breaker.state).toBe(CLOSED);
    });

    test('timeout rejects without awaiting best-effort cancellation', async () => {
        const { CircuitBreaker } = require('../../services/circuit-breaker');
        const breaker = new CircuitBreaker({ name: 'db-test', timeout: 10, throwOnFailure: true });
        const pending = breaker.execute(
            () => new Promise(() => {}),
            undefined,
            { timeout: 10, onTimeout: () => new Promise(() => {}) },
        );
        const outcome = await Promise.race([
            pending.then(() => 'resolved', error => error.code),
            new Promise(resolve => setTimeout(() => resolve('hung'), 100)),
        ]);
        expect(outcome).toBe('CIRCUIT_TIMEOUT');
    });

});
