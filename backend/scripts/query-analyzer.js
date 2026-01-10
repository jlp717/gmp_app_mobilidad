/**
 * GMP App - Query Analyzer Script
 * ================================
 * Analyzes query patterns and suggests optimizations
 * Run via PM2 cron or manually: node scripts/query-analyzer.js
 */

const logger = require('../middleware/logger');
const { createOptimizedQuery } = require('../services/query-optimizer');
const { query } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function analyzeQueries() {
    console.log('═'.repeat(50));
    console.log('  QUERY ANALYZER');
    console.log('═'.repeat(50));
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log('');

    try {
        const optimizedQuery = createOptimizedQuery(query);

        // Get slow queries
        const slowQueries = optimizedQuery.getSlowQueries(500);
        console.log(`  Slow Queries (>500ms): ${slowQueries.length}`);

        if (slowQueries.length > 0) {
            console.log('');
            for (const sq of slowQueries.slice(0, 10)) {
                console.log(`    SQL: ${sq.sql.substring(0, 60)}...`);
                console.log(`      Avg: ${sq.avgDuration}ms, Max: ${sq.maxDuration}ms, Count: ${sq.count}`);
                console.log('');
            }
        }

        // Get index suggestions
        const indexSuggestions = optimizedQuery.suggestIndexes();
        console.log(`  Index Suggestions: ${indexSuggestions.length}`);

        if (indexSuggestions.length > 0) {
            console.log('');
            for (const suggestion of indexSuggestions.slice(0, 5)) {
                console.log(`    Table columns: ${suggestion.suggestedColumns.join(', ')}`);
                console.log(`      Query: ${suggestion.sql.substring(0, 50)}...`);
                console.log('');
            }
        }

        // Get query stats
        const stats = optimizedQuery.getStats();
        console.log(`  Total Query Patterns: ${stats.length}`);

        // Save report
        const report = {
            timestamp: new Date().toISOString(),
            slowQueries,
            indexSuggestions,
            totalPatterns: stats.length,
            topQueries: stats.slice(0, 20),
        };

        const reportPath = path.join(__dirname, '../logs/query-analysis.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`  Report saved to: ${reportPath}`);

    } catch (error) {
        console.log(`  ❌ Analysis error: ${error.message}`);
        process.exit(1);
    }

    console.log('');
    console.log('═'.repeat(50));
    console.log(`  Finished: ${new Date().toISOString()}`);
    console.log('═'.repeat(50));
}

// Run if called directly
if (require.main === module) {
    analyzeQueries()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
}

module.exports = { analyzeQueries };
