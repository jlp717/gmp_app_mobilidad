/**
 * GMP App - Flutter Test Runner (Node.js Orchestrator)
 * =====================================================
 * Orchestrates Flutter tests from Node.js with reporting
 * Run: node scripts/flutterTestRunner.js [options]
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    flutterProjectPath: path.resolve(__dirname, '../../..'),
    reportDir: path.join(__dirname, '../test-results'),
    coverageThreshold: 70,
    testTimeout: 300000, // 5 minutes
};

/**
 * Logger with timestamps
 */
const log = {
    info: (msg) => console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`),
    success: (msg) => console.log(`[${new Date().toISOString()}] ✅ ${msg}`),
    warn: (msg) => console.log(`[${new Date().toISOString()}] ⚠️  ${msg}`),
    error: (msg) => console.log(`[${new Date().toISOString()}] ❌ ${msg}`),
};

/**
 * Ensure report directory exists
 */
function ensureReportDir() {
    if (!fs.existsSync(CONFIG.reportDir)) {
        fs.mkdirSync(CONFIG.reportDir, { recursive: true });
    }
}

/**
 * Run Flutter tests with machine-readable output
 */
async function runFlutterTests(options = {}) {
    return new Promise((resolve, reject) => {
        const args = ['test'];

        // Add coverage if requested
        if (options.coverage) {
            args.push('--coverage');
        }

        // Machine-readable output for parsing
        args.push('--machine');

        // Add reporter for JUnit output
        if (options.junit) {
            args.push('--reporter=json');
        }

        // Specific test file if provided
        if (options.testFile) {
            args.push(options.testFile);
        }

        log.info(`Running: flutter ${args.join(' ')}`);
        log.info(`Working directory: ${CONFIG.flutterProjectPath}`);

        const testProcess = spawn('flutter', args, {
            cwd: CONFIG.flutterProjectPath,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        const results = {
            passed: 0,
            failed: 0,
            skipped: 0,
            errors: [],
            duration: 0,
        };

        const startTime = Date.now();

        testProcess.stdout.on('data', (data) => {
            stdout += data.toString();

            // Parse machine output for test results
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('{')) {
                    try {
                        const event = JSON.parse(line.trim());
                        if (event.type === 'testDone') {
                            if (event.result === 'success') {
                                results.passed++;
                            } else if (event.result === 'failure') {
                                results.failed++;
                                results.errors.push({
                                    test: event.testID,
                                    message: event.result,
                                });
                            } else if (event.skipped) {
                                results.skipped++;
                            }
                        }
                    } catch (e) {
                        // Not JSON, ignore
                    }
                }
            }
        });

        testProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        // Timeout handling
        const timeout = setTimeout(() => {
            testProcess.kill('SIGTERM');
            reject(new Error('Test timeout exceeded'));
        }, CONFIG.testTimeout);

        testProcess.on('close', (code) => {
            clearTimeout(timeout);
            results.duration = Date.now() - startTime;

            // Save raw output
            ensureReportDir();
            fs.writeFileSync(
                path.join(CONFIG.reportDir, 'flutter-test-output.txt'),
                `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
            );

            // Save results
            fs.writeFileSync(
                path.join(CONFIG.reportDir, 'flutter-test-results.json'),
                JSON.stringify(results, null, 2)
            );

            if (code === 0) {
                resolve(results);
            } else {
                // Still resolve with results, but mark as failed
                results.exitCode = code;
                resolve(results);
            }
        });

        testProcess.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

/**
 * Parse coverage report if available
 */
function parseCoverageReport() {
    const lcovPath = path.join(CONFIG.flutterProjectPath, 'coverage', 'lcov.info');

    if (!fs.existsSync(lcovPath)) {
        log.warn('No coverage report found');
        return null;
    }

    const lcov = fs.readFileSync(lcovPath, 'utf8');
    let totalLines = 0;
    let hitLines = 0;

    const lines = lcov.split('\n');
    for (const line of lines) {
        if (line.startsWith('LF:')) {
            totalLines += parseInt(line.substring(3), 10);
        } else if (line.startsWith('LH:')) {
            hitLines += parseInt(line.substring(3), 10);
        }
    }

    const coverage = totalLines > 0 ? (hitLines / totalLines) * 100 : 0;

    return {
        totalLines,
        hitLines,
        coverage: coverage.toFixed(2),
        meetsThreshold: coverage >= CONFIG.coverageThreshold,
    };
}

/**
 * Generate summary report
 */
function generateReport(results, coverage) {
    const report = {
        timestamp: new Date().toISOString(),
        testResults: results,
        coverage,
        summary: {
            totalTests: results.passed + results.failed + results.skipped,
            passRate: results.passed / (results.passed + results.failed) * 100 || 0,
            duration: `${(results.duration / 1000).toFixed(2)}s`,
        },
        status: results.failed === 0 ? 'PASSED' : 'FAILED',
    };

    ensureReportDir();
    fs.writeFileSync(
        path.join(CONFIG.reportDir, 'flutter-full-report.json'),
        JSON.stringify(report, null, 2)
    );

    return report;
}

/**
 * Print summary to console
 */
function printSummary(report) {
    console.log('\n' + '='.repeat(60));
    console.log('FLUTTER TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total Tests:  ${report.summary.totalTests}`);
    console.log(`  ✅ Passed:    ${report.testResults.passed}`);
    console.log(`  ❌ Failed:    ${report.testResults.failed}`);
    console.log(`  ⏭️  Skipped:   ${report.testResults.skipped}`);
    console.log(`  Duration:     ${report.summary.duration}`);
    console.log(`  Pass Rate:    ${report.summary.passRate.toFixed(2)}%`);

    if (report.coverage) {
        console.log('');
        console.log('COVERAGE');
        console.log(`  Line Coverage: ${report.coverage.coverage}%`);
        console.log(`  Threshold:     ${CONFIG.coverageThreshold}%`);
        console.log(`  Status:        ${report.coverage.meetsThreshold ? '✅ Met' : '❌ Below threshold'}`);
    }

    console.log('='.repeat(60));
    console.log(`STATUS: ${report.status}`);
    console.log('='.repeat(60) + '\n');
}

/**
 * Main entry point
 */
async function main() {
    const args = process.argv.slice(2);
    const options = {
        coverage: args.includes('--coverage'),
        junit: args.includes('--junit'),
        testFile: args.find(a => a.endsWith('.dart')),
    };

    log.info('Starting Flutter Test Runner');
    log.info(`Options: ${JSON.stringify(options)}`);

    try {
        // Run tests
        const results = await runFlutterTests(options);

        // Parse coverage if generated
        let coverage = null;
        if (options.coverage) {
            coverage = parseCoverageReport();
        }

        // Generate report
        const report = generateReport(results, coverage);

        // Print summary
        printSummary(report);

        // Exit with appropriate code
        if (report.status === 'FAILED') {
            log.error('Tests failed! Check report for details.');
            process.exit(1);
        } else {
            log.success('All tests passed!');
            process.exit(0);
        }
    } catch (error) {
        log.error(`Test runner error: ${error.message}`);
        process.exit(1);
    }
}

// Export for testing
module.exports = { runFlutterTests, parseCoverageReport, generateReport };

// Run if called directly
if (require.main === module) {
    main();
}
