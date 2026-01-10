/**
 * GMP App - Pre/Post Change Validator
 * ====================================
 * Compares API responses before and after changes to ensure zero-breakage
 * Run: node scripts/validation/pre-post-validator.js [action]
 * Actions: baseline | validate | compare
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const CONFIG = {
    baselineDir: path.join(__dirname, '../../.validation-baselines'),
    endpoints: [
        { method: 'GET', path: '/api/health', description: 'Health Check' },
        { method: 'GET', path: '/api/dashboard/metrics', auth: true, description: 'Dashboard Metrics' },
        { method: 'GET', path: '/api/clients', auth: true, description: 'Client List' },
        { method: 'GET', path: '/api/objectives', auth: true, description: 'Objectives' },
    ],
    serverUrl: process.env.VALIDATION_SERVER_URL || 'http://localhost:3334',
    toleranceMs: 500, // Response time tolerance
};

/**
 * Generate hash of response data (ignoring timestamps and dynamic fields)
 */
function hashResponse(data) {
    // Clone and remove dynamic fields
    const sanitized = JSON.parse(JSON.stringify(data));
    removeDynamicFields(sanitized);
    return crypto.createHash('sha256').update(JSON.stringify(sanitized)).digest('hex');
}

/**
 * Remove fields that change between requests
 */
function removeDynamicFields(obj) {
    const dynamicKeys = ['timestamp', 'createdAt', 'updatedAt', 'lastSync', 'requestId', 'duration'];

    if (Array.isArray(obj)) {
        obj.forEach(item => removeDynamicFields(item));
    } else if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            if (dynamicKeys.includes(key)) {
                delete obj[key];
            } else if (typeof obj[key] === 'object') {
                removeDynamicFields(obj[key]);
            }
        }
    }
}

/**
 * Fetch endpoint and return response data with timing
 */
async function fetchEndpoint(endpoint, authToken = null) {
    const startTime = Date.now();

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        if (endpoint.auth && authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(`${CONFIG.serverUrl}${endpoint.path}`, {
            method: endpoint.method,
            headers,
        });

        const responseTime = Date.now() - startTime;
        const data = await response.json();

        return {
            success: true,
            status: response.status,
            responseTime,
            data,
            hash: hashResponse(data),
            dataSize: JSON.stringify(data).length,
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            responseTime: Date.now() - startTime,
        };
    }
}

/**
 * Save baseline for all endpoints
 */
async function saveBaseline(authToken) {
    console.log('📊 Creating baseline snapshots...\n');

    // Ensure baseline directory exists
    if (!fs.existsSync(CONFIG.baselineDir)) {
        fs.mkdirSync(CONFIG.baselineDir, { recursive: true });
    }

    const baseline = {
        createdAt: new Date().toISOString(),
        serverUrl: CONFIG.serverUrl,
        endpoints: {},
    };

    for (const endpoint of CONFIG.endpoints) {
        console.log(`  Fetching ${endpoint.method} ${endpoint.path}...`);
        const result = await fetchEndpoint(endpoint, authToken);

        if (result.success) {
            baseline.endpoints[endpoint.path] = {
                method: endpoint.method,
                description: endpoint.description,
                status: result.status,
                responseTime: result.responseTime,
                hash: result.hash,
                dataSize: result.dataSize,
                sampleData: result.data, // Store sample for comparison
            };
            console.log(`    ✅ ${result.status} - ${result.responseTime}ms - ${result.dataSize} bytes`);
        } else {
            baseline.endpoints[endpoint.path] = {
                method: endpoint.method,
                description: endpoint.description,
                error: result.error,
            };
            console.log(`    ❌ Error: ${result.error}`);
        }
    }

    const baselinePath = path.join(CONFIG.baselineDir, 'baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

    console.log(`\n✅ Baseline saved to ${baselinePath}`);
    return baseline;
}

/**
 * Validate current responses against baseline
 */
async function validateAgainstBaseline(authToken) {
    console.log('🔍 Validating against baseline...\n');

    const baselinePath = path.join(CONFIG.baselineDir, 'baseline.json');

    if (!fs.existsSync(baselinePath)) {
        console.log('❌ No baseline found. Run with "baseline" action first.');
        process.exit(1);
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const results = {
        passed: 0,
        failed: 0,
        warnings: 0,
        details: [],
    };

    for (const endpoint of CONFIG.endpoints) {
        const baselineData = baseline.endpoints[endpoint.path];

        if (!baselineData || baselineData.error) {
            console.log(`  ⏭️  ${endpoint.path} - Skipped (no baseline)`);
            continue;
        }

        console.log(`  Testing ${endpoint.method} ${endpoint.path}...`);
        const result = await fetchEndpoint(endpoint, authToken);

        const comparison = {
            endpoint: endpoint.path,
            description: endpoint.description,
            checks: [],
        };

        // Check 1: Response success
        if (!result.success) {
            comparison.checks.push({ name: 'Response', status: 'FAIL', message: result.error });
            results.failed++;
        } else {
            // Check 2: Status code
            if (result.status === baselineData.status) {
                comparison.checks.push({ name: 'Status Code', status: 'PASS', message: `${result.status}` });
            } else {
                comparison.checks.push({ name: 'Status Code', status: 'FAIL', message: `Expected ${baselineData.status}, got ${result.status}` });
                results.failed++;
            }

            // Check 3: Data hash (content integrity)
            if (result.hash === baselineData.hash) {
                comparison.checks.push({ name: 'Data Integrity', status: 'PASS', message: 'Hash matches' });
                results.passed++;
            } else {
                comparison.checks.push({ name: 'Data Integrity', status: 'WARN', message: 'Data structure changed' });
                results.warnings++;
            }

            // Check 4: Response time
            const timeDiff = result.responseTime - baselineData.responseTime;
            if (timeDiff <= CONFIG.toleranceMs) {
                comparison.checks.push({ name: 'Response Time', status: 'PASS', message: `${result.responseTime}ms (baseline: ${baselineData.responseTime}ms)` });
                results.passed++;
            } else {
                comparison.checks.push({ name: 'Response Time', status: 'WARN', message: `${result.responseTime}ms (+${timeDiff}ms slower)` });
                results.warnings++;
            }
        }

        results.details.push(comparison);

        // Print check results
        for (const check of comparison.checks) {
            const icon = check.status === 'PASS' ? '✅' : check.status === 'WARN' ? '⚠️' : '❌';
            console.log(`    ${icon} ${check.name}: ${check.message}`);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`  ✅ Passed:   ${results.passed}`);
    console.log(`  ⚠️  Warnings: ${results.warnings}`);
    console.log(`  ❌ Failed:   ${results.failed}`);

    // Exit code based on results
    if (results.failed > 0) {
        console.log('\n❌ VALIDATION FAILED - Rollback recommended!');
        process.exit(1);
    } else if (results.warnings > 0) {
        console.log('\n⚠️  VALIDATION PASSED WITH WARNINGS');
        process.exit(0);
    } else {
        console.log('\n✅ ALL VALIDATIONS PASSED');
        process.exit(0);
    }
}

/**
 * Main entry point
 */
async function main() {
    const action = process.argv[2] || 'validate';
    const authToken = process.env.VALIDATION_AUTH_TOKEN || null;

    console.log('='.repeat(60));
    console.log('GMP APP - PRE/POST CHANGE VALIDATOR');
    console.log('='.repeat(60));
    console.log(`Action: ${action}`);
    console.log(`Server: ${CONFIG.serverUrl}`);
    console.log(`Auth:   ${authToken ? 'Provided' : 'None'}`);
    console.log('='.repeat(60) + '\n');

    switch (action) {
        case 'baseline':
            await saveBaseline(authToken);
            break;
        case 'validate':
            await validateAgainstBaseline(authToken);
            break;
        default:
            console.log('Usage: node pre-post-validator.js [baseline|validate]');
            process.exit(1);
    }
}

// Export for testing
module.exports = { hashResponse, removeDynamicFields, fetchEndpoint };

// Run if called directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
