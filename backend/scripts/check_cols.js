/**
 * Quick check: columns in ART and ARTX tables
 */
const { query, initDb } = require('../config/db');

async function checkCols() {
    await initDb();
    
    // Get a sample row from ART to see columns
    console.log('=== SAMPLE ROW FROM ART ===');
    const artRow = await query(`SELECT * FROM DSEDAC.ART FETCH FIRST 1 ROW ONLY`, false, false);
    if (artRow[0]) {
        console.log('ART columns:', Object.keys(artRow[0]).join(', '));
    }
    
    console.log('\n=== SAMPLE ROW FROM ARTX ===');
    const artxRow = await query(`SELECT * FROM DSEDAC.ARTX FETCH FIRST 1 ROW ONLY`, false, false);
    if (artxRow[0]) {
        console.log('ARTX columns:', Object.keys(artxRow[0]).join(', '));
    }
    
    // Check LACLAE to see product code column
    console.log('\n=== SAMPLE ROW FROM LACLAE (ventas) ===');
    const lacRow = await query(`SELECT * FROM DSED.LACLAE FETCH FIRST 1 ROW ONLY`, false, false);
    if (lacRow[0]) {
        console.log('LACLAE columns:', Object.keys(lacRow[0]).join(', '));
    }
    
    process.exit(0);
}
checkCols();
