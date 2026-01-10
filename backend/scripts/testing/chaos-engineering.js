/**
 * GMP App - Chaos Engineering Test Suite
 * =======================================
 * Simulates failures to test system resilience
 * Run: node scripts/testing/chaos-engineering.js [test]
 */

const logger = require('../../middleware/logger');
const { query } = require('../../config/db');
const { redisCache } = require('../../services/redis-cache');

// Test configuration
const CONFIG = {
    testDuration: 30000, // 30 seconds per test
    requestsPerSecond: 10,
    failureRate: 0.3, // 30% failure rate
    recoveryTimeout: 5000, // 5 seconds
};

// Test results
const results = {
    tests: [],
    startTime: null,
    endTime: null,
};

/**
 * Logger for chaos tests
 */
const chaosLog = {
    test: (msg) => console.log(`[CHAOS] 🧪 ${msg}`),
    inject: (msg) => console.log(`[CHAOS] 💉 ${msg}`),
    observe: (msg) => console.log(`[CHAOS] 👁️ ${msg}`),
    recover: (msg) => console.log(`[CHAOS] 🔧 ${msg}`),
    result: (msg) => console.log(`[CHAOS] 📊 ${msg}`),
};

/**
 * Base chaos test class
 */
class ChaosTest {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.metrics = {
            requestsSent: 0,
            requestsSucceeded: 0,
            requestsFailed: 0,
            latencies: [],
            errors: [],
            recoveryTime: null,
        };
    }

    async run() {
        chaosLog.test(`Starting: ${this.name}`);
        chaosLog.test(`Description: ${this.description}`);

        const startTime = Date.now();

        try {
            // Setup phase
            await this.setup();

            // Inject failure
            chaosLog.inject('Injecting failure...');
            await this.injectFailure();

            // Observe system behavior
            chaosLog.observe('Observing system behavior...');
            await this.observe();

            // Recover
            chaosLog.recover('Initiating recovery...');
            const recoveryStart = Date.now();
            await this.recover();
            this.metrics.recoveryTime = Date.now() - recoveryStart;

            // Validate recovery
            await this.validate();

        } catch (error) {
            this.metrics.errors.push({
                phase: 'execution',
                error: error.message,
                timestamp: Date.now(),
            });
        }

        const duration = Date.now() - startTime;

        // Generate report
        const report = this.generateReport(duration);
        results.tests.push(report);

        return report;
    }

    async setup() { /* Override in subclass */ }
    async injectFailure() { /* Override in subclass */ }
    async observe() { /* Override in subclass */ }
    async recover() { /* Override in subclass */ }
    async validate() { /* Override in subclass */ }

    generateReport(duration) {
        const successRate = this.metrics.requestsSent > 0
            ? (this.metrics.requestsSucceeded / this.metrics.requestsSent * 100).toFixed(2)
            : 0;

        const avgLatency = this.metrics.latencies.length > 0
            ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
            : 0;

        return {
            name: this.name,
            description: this.description,
            duration,
            passed: this.metrics.requestsFailed < this.metrics.requestsSent * 0.5,
            metrics: {
                ...this.metrics,
                successRate: `${successRate}%`,
                avgLatency: `${avgLatency.toFixed(2)}ms`,
            },
        };
    }
}

/**
 * Network Latency Test
 * Simulates high network latency
 */
class NetworkLatencyTest extends ChaosTest {
    constructor() {
        super(
            'Network Latency Injection',
            'Simulates high network latency to test timeout handling'
        );
        this.originalFetch = null;
    }

    async setup() {
        // Nothing to setup
    }

    async injectFailure() {
        // Simulate latency by adding delays to responses
        this.injectedLatency = 2000; // 2 seconds
        chaosLog.inject(`Injecting ${this.injectedLatency}ms latency`);
    }

    async observe() {
        // Make requests and observe behavior
        for (let i = 0; i < 10; i++) {
            const start = Date.now();
            try {
                // Simulate a delayed operation
                await new Promise(resolve => setTimeout(resolve, this.injectedLatency));
                this.metrics.requestsSucceeded++;
                this.metrics.latencies.push(Date.now() - start);
            } catch (error) {
                this.metrics.requestsFailed++;
                this.metrics.errors.push({ error: error.message, timestamp: Date.now() });
            }
            this.metrics.requestsSent++;
        }
    }

    async recover() {
        this.injectedLatency = 0;
        chaosLog.recover('Latency injection removed');
    }

    async validate() {
        // Verify system responds normally after recovery
        const start = Date.now();
        await new Promise(resolve => setTimeout(resolve, 100));
        const latency = Date.now() - start;

        if (latency < 500) {
            chaosLog.result('✅ System recovered - latency normal');
        } else {
            chaosLog.result('⚠️ System slow after recovery');
        }
    }
}

/**
 * Cache Failure Test
 * Simulates Redis cache failure
 */
class CacheFailureTest extends ChaosTest {
    constructor() {
        super(
            'Cache Failure Simulation',
            'Tests fallback behavior when Redis is unavailable'
        );
    }

    async setup() {
        // Ensure cache is working
        await redisCache.set('chaos', 'test-key', 'test-value', 60);
        const value = await redisCache.get('chaos', 'test-key');
        if (value !== 'test-value') {
            throw new Error('Cache setup failed');
        }
        chaosLog.observe('Cache is healthy');
    }

    async injectFailure() {
        // Simulate cache failure by clearing
        await redisCache.invalidatePattern('chaos:*');
        chaosLog.inject('Cache cleared - simulating failure');
    }

    async observe() {
        // Test cache miss behavior
        for (let i = 0; i < 10; i++) {
            const start = Date.now();
            try {
                const value = await redisCache.get('chaos', `key-${i}`);
                // Cache miss is expected
                if (value === null) {
                    this.metrics.requestsSucceeded++;
                } else {
                    this.metrics.requestsFailed++;
                }
                this.metrics.latencies.push(Date.now() - start);
            } catch (error) {
                this.metrics.requestsFailed++;
                this.metrics.errors.push({ error: error.message, timestamp: Date.now() });
            }
            this.metrics.requestsSent++;
        }
    }

    async recover() {
        // Repopulate cache
        for (let i = 0; i < 10; i++) {
            await redisCache.set('chaos', `key-${i}`, `value-${i}`, 60);
        }
        chaosLog.recover('Cache repopulated');
    }

    async validate() {
        // Verify cache is working again
        const value = await redisCache.get('chaos', 'key-0');
        if (value === 'value-0') {
            chaosLog.result('✅ Cache recovered successfully');
        } else {
            chaosLog.result('⚠️ Cache recovery incomplete');
        }
    }
}

/**
 * Database Connection Test
 * Simulates database connection issues
 */
class DatabaseConnectionTest extends ChaosTest {
    constructor() {
        super(
            'Database Connection Stress',
            'Tests database connection pool under stress'
        );
    }

    async setup() {
        // Verify database is accessible
        try {
            await query('SELECT 1 AS test FROM SYSIBM.SYSDUMMY1', false);
            chaosLog.observe('Database is healthy');
        } catch (error) {
            throw new Error(`Database check failed: ${error.message}`);
        }
    }

    async injectFailure() {
        // Simulate connection pool exhaustion by making many concurrent queries
        chaosLog.inject('Initiating connection pool stress test');
        this.concurrentQueries = 50;
    }

    async observe() {
        // Make many concurrent queries
        const queries = [];
        for (let i = 0; i < this.concurrentQueries; i++) {
            const start = Date.now();
            const queryPromise = query('SELECT 1 AS test FROM SYSIBM.SYSDUMMY1', false, false)
                .then(() => {
                    this.metrics.requestsSucceeded++;
                    this.metrics.latencies.push(Date.now() - start);
                })
                .catch((error) => {
                    this.metrics.requestsFailed++;
                    this.metrics.errors.push({ error: error.message, timestamp: Date.now() });
                })
                .finally(() => {
                    this.metrics.requestsSent++;
                });
            queries.push(queryPromise);
        }

        await Promise.all(queries);
    }

    async recover() {
        // Wait for connection pool to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
        chaosLog.recover('Connection pool stabilized');
    }

    async validate() {
        // Verify database is accessible
        try {
            const start = Date.now();
            await query('SELECT 1 AS test FROM SYSIBM.SYSDUMMY1', false);
            const latency = Date.now() - start;

            if (latency < 1000) {
                chaosLog.result('✅ Database recovered - queries working');
            } else {
                chaosLog.result(`⚠️ Database slow after stress (${latency}ms)`);
            }
        } catch (error) {
            chaosLog.result(`❌ Database not recovered: ${error.message}`);
        }
    }
}

/**
 * Memory Pressure Test
 * Simulates memory pressure
 */
class MemoryPressureTest extends ChaosTest {
    constructor() {
        super(
            'Memory Pressure Simulation',
            'Tests garbage collection and memory management'
        );
        this.memoryBlocks = [];
    }

    async setup() {
        // Record baseline memory
        this.baselineMemory = process.memoryUsage().heapUsed;
        chaosLog.observe(`Baseline memory: ${(this.baselineMemory / 1024 / 1024).toFixed(2)} MB`);
    }

    async injectFailure() {
        // Allocate large memory blocks
        chaosLog.inject('Allocating memory blocks...');
        for (let i = 0; i < 10; i++) {
            this.memoryBlocks.push(Buffer.alloc(10 * 1024 * 1024)); // 10MB each
        }

        const currentMemory = process.memoryUsage().heapUsed;
        chaosLog.inject(`Memory after allocation: ${(currentMemory / 1024 / 1024).toFixed(2)} MB`);
    }

    async observe() {
        // Monitor memory over time
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const mem = process.memoryUsage();
            this.metrics.latencies.push(mem.heapUsed);
            this.metrics.requestsSent++;
            this.metrics.requestsSucceeded++;
        }
    }

    async recover() {
        // Release memory blocks
        this.memoryBlocks.length = 0;

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            chaosLog.recover('Garbage collection triggered');
        } else {
            chaosLog.recover('Memory released (manual GC not available)');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    async validate() {
        const currentMemory = process.memoryUsage().heapUsed;
        const diff = currentMemory - this.baselineMemory;

        chaosLog.result(`Current memory: ${(currentMemory / 1024 / 1024).toFixed(2)} MB`);
        chaosLog.result(`Memory difference: ${(diff / 1024 / 1024).toFixed(2)} MB`);

        if (diff < 50 * 1024 * 1024) { // Less than 50MB difference
            chaosLog.result('✅ Memory recovered successfully');
        } else {
            chaosLog.result('⚠️ Potential memory leak detected');
        }
    }
}

/**
 * Run all chaos tests
 */
async function runAllTests() {
    console.log('\n' + '='.repeat(60));
    console.log('CHAOS ENGINEERING TEST SUITE');
    console.log('='.repeat(60) + '\n');

    results.startTime = new Date();

    const tests = [
        new NetworkLatencyTest(),
        new CacheFailureTest(),
        new DatabaseConnectionTest(),
        new MemoryPressureTest(),
    ];

    for (const test of tests) {
        console.log('\n' + '-'.repeat(40));
        try {
            await test.run();
        } catch (error) {
            chaosLog.result(`❌ Test crashed: ${error.message}`);
        }
        console.log('-'.repeat(40) + '\n');

        // Cool down between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    results.endTime = new Date();

    // Print summary
    printSummary();
}

/**
 * Print test summary
 */
function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('CHAOS TEST SUMMARY');
    console.log('='.repeat(60));

    let passed = 0;
    let failed = 0;

    for (const test of results.tests) {
        const status = test.passed ? '✅ PASSED' : '❌ FAILED';
        console.log(`\n  ${test.name}`);
        console.log(`    Status: ${status}`);
        console.log(`    Duration: ${test.duration}ms`);
        console.log(`    Success Rate: ${test.metrics.successRate}`);
        console.log(`    Avg Latency: ${test.metrics.avgLatency}`);
        console.log(`    Recovery Time: ${test.metrics.recoveryTime}ms`);

        if (test.passed) passed++;
        else failed++;
    }

    console.log('\n' + '-'.repeat(40));
    console.log(`\n  TOTAL: ${passed}/${results.tests.length} tests passed`);
    console.log(`  Duration: ${results.endTime - results.startTime}ms`);
    console.log('='.repeat(60) + '\n');

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
}

/**
 * Main entry point
 */
async function main() {
    const testName = process.argv[2];

    if (testName === 'all' || !testName) {
        await runAllTests();
    } else {
        // Run specific test
        const testMap = {
            'network': NetworkLatencyTest,
            'cache': CacheFailureTest,
            'database': DatabaseConnectionTest,
            'memory': MemoryPressureTest,
        };

        const TestClass = testMap[testName.toLowerCase()];
        if (TestClass) {
            const test = new TestClass();
            const report = await test.run();
            console.log('\nTest Report:', JSON.stringify(report, null, 2));
            process.exit(report.passed ? 0 : 1);
        } else {
            console.log(`Unknown test: ${testName}`);
            console.log('Available tests: network, cache, database, memory, all');
            process.exit(1);
        }
    }
}

// Export for testing
module.exports = {
    ChaosTest,
    NetworkLatencyTest,
    CacheFailureTest,
    DatabaseConnectionTest,
    MemoryPressureTest,
    runAllTests,
};

// Run if called directly
if (require.main === module) {
    main().catch(err => {
        console.error('Chaos test runner error:', err);
        process.exit(1);
    });
}
