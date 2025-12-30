const odbc = require('odbc');
const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        console.log('--- TIPODOCUMENTO ---');
        const docTypes = await conn.query(`SELECT TIPODOCUMENTO, COUNT(*) as CNT FROM DSEDAC.LINDTO WHERE ANODOCUMENTO = 2025 GROUP BY TIPODOCUMENTO`);
        console.log(docTypes.map(r => `${r.TIPODOCUMENTO}(${r.CNT})`).join(', '));

        console.log('--- TIPOVENTA ---');
        const salesTypes = await conn.query(`SELECT TIPOVENTA, COUNT(*) as CNT FROM DSEDAC.LINDTO WHERE ANODOCUMENTO = 2025 GROUP BY TIPOVENTA`);
        console.log(salesTypes.map(r => `${r.TIPOVENTA}(${r.CNT})`).join(', '));

        console.log('--- SERIEALBARAN ---');
        const series = await conn.query(`SELECT SERIEALBARAN, COUNT(*) as CNT FROM DSEDAC.LINDTO WHERE ANODOCUMENTO = 2025 GROUP BY SERIEALBARAN`);
        console.log(series.map(r => `${r.SERIEALBARAN}(${r.CNT})`).join(', '));

    } catch (e) { console.error(e); } finally { await conn.close(); }
}
main();
