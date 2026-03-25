const db = require('./config/db');

async function checkColumns() {
  try {
    const res = await db.query('SELECT * FROM DSEDAC.ART FETCH FIRST 1 ROW ONLY');
    if (res.length > 0) {
      console.log(Object.keys(res[0]).filter(k => k.includes('EAN') || k.includes('BARRAS')));
      console.log(Object.keys(res[0]).slice(0, 30)); // just to see
    }
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
checkColumns();
