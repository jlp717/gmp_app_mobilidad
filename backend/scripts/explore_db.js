require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function exploreData() {
    try {
        console.log('--- EXPLORATION START ---');

        // 1. Get ALL Columns to find potential time/status fields
        console.log('\n--- FINDING COLUMNS ---');
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
            ORDER BY COLUMN_NAME
        `);
        // Filter for interesting keywords
        const interestingCols = cols.filter(c => {
            const name = c.COLUMN_NAME.toUpperCase();
            return name.includes('HORA') ||
                name.includes('TIME') ||
                name.includes('FECHA') ||
                name.includes('DIA') ||
                name.includes('ESTADO') ||
                name.includes('SITUACION') ||
                name.includes('CONFORMA') ||
                name.includes('STATUS');
        });
        console.error('--- COLUMNS ---');
        console.error(JSON.stringify(interestingCols.map(c => c.COLUMN_NAME), null, 2));

        // 2. Analyze SITUACIONALBARAN distribution
        console.log('\n--- SITUACIONALBARAN DISTRIBUTION ---');

        // 2026 (Active)
        const stats2026 = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN, COUNT(*) as CNT
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2026 AND MESDOCUMENTO=2
            GROUP BY SITUACIONALBARAN, CONFORMADOSN
            ORDER BY CNT DESC
        `);
        console.error('--- 2026 STATS ---');
        console.error(JSON.stringify(stats2026, null, 2));

        // 2025 (History - Full year or Feb)
        const stats2025 = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN, COUNT(*) as CNT
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2
            GROUP BY SITUACIONALBARAN, CONFORMADOSN
            ORDER BY CNT DESC
        `);
        console.error('--- 2025 STATS ---');
        console.error(JSON.stringify(stats2025, null, 2));

        // 3. Sample Data for 'X', 'R', 'F' to compare times
        console.log('\n--- SAMPLE DATA COMPARISON ---');
        const samples = await query(`
            SELECT SITUACIONALBARAN, CONFORMADOSN, 
                   DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                   DIALLEGADA, MESLLEGADA, ANOLLEGADA, HORALLEGADA,
                   DIACREACION, HORACREACION
            FROM DSEDAC.CPC 
            WHERE ANODOCUMENTO=2025 AND MESDOCUMENTO=2
            AND SITUACIONALBARAN IN ('F', 'R', 'X')
            FETCH FIRST 10 ROWS ONLY
        `);
        console.error('--- SAMPLES ---');
        console.error(JSON.stringify(samples, null, 2));
        const output = {
            interestingColumns: interestingCols.map(c => ({
                name: c.COLUMN_NAME,
                type: c.DATA_TYPE,
                text: c.COLUMN_TEXT
            })),
            stats2026: stats2026,
            stats2025: stats2025,
            samples: samples
        };

        require('fs').writeFileSync('explore_output.json', JSON.stringify(output, null, 2));
        console.log('SUCCESS: Written to explore_output.json');

    } catch (e) {
        console.error('FATAL CLG ERROR:', e);
        require('fs').writeFileSync('explore_error.txt', e.toString());
    }
}

// Redirect formatting
const originalLog = console.log;
console.log = function (...args) {
    console.error(...args);
    originalLog.apply(console, args);
};

exploreData();
