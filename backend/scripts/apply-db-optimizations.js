const fs = require('fs');
const path = require('path');
const { initDb, query } = require('../config/db');

async function applyOptimizations() {
    console.log("🚀 Starting Database Optimization...");

    try {
        await initDb();
        console.log("✅ Database Connected");

        const sqlPath = path.join(__dirname, 'db', 'db-optimization-recommendations.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolon? Or just execute line by line if specific format?
        // DB2 might tolerate multiple statements or might not via ODBC.
        // Safer to split by semicolon, but comments might break it.
        // We will simple Use a regex to find CREATE INDEX statements.

        const statements = sqlContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 5); // Just filter empties

        console.log(`Found ${statements.length} statements to execute.`);

        for (const stmt of statements) {
            // Remove comments from statement
            const cleanStmt = stmt.split('\n').filter(line => !line.trim().startsWith('--')).join(' ').trim();
            if (!cleanStmt) continue;

            console.log(`\nRunning: ${cleanStmt.substring(0, 60)}...`);
            try {
                await query(cleanStmt);
                console.log("  ✅ Success");
            } catch (e) {
                if (e.message.includes('already exists') || e.message.includes('SQL0601N')) {
                    console.log("  ⚠️ Index already exists (Skipping)");
                } else {
                    console.error(`  ❌ Failed: ${e.message}`);
                }
            }
        }

        console.log("\n✨ Optimization Complete!");
        process.exit(0);

    } catch (e) {
        console.error(`Fatal Error: ${e.message}`);
        process.exit(1);
    }
}

applyOptimizations();
