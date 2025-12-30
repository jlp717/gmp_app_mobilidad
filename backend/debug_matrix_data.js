const odbc = require('odbc');

// Warning: connection string might differ if DSEDAC is in a different DSN or Library list.
// Assuming same connection can access DSEDAC if specified in query.
const connectionString = "DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;";

async function run() {
  try {
    const connection = await odbc.connect(connectionString);
    console.log("Connected to database.");

    // 1. Inspect DSEDAC.ART columns for Subfamily
    console.log("\n--- Checking DSEDAC.ART Columns (First Row) ---");
    const artCols = await connection.query(`SELECT * FROM DSEDAC.ART FETCH FIRST 1 ROWS ONLY`);
    if (artCols.length > 0) {
      console.log("ART Columns:", Object.keys(artCols[0]));
      // Check if we see anything like SUBFAM...
      const subfamCols = Object.keys(artCols[0]).filter(k => k.includes('SUB') || k.includes('FAM'));
      console.log("Potential Family/Subfamily Columns:", subfamCols);
    } else {
      console.log("No rows found in DSEDAC.ART");
    }

    // 2. Inspect DSEDAC.LAC columns for Price/Discount
    console.log("\n--- Checking DSEDAC.LAC Columns (First Row) ---");
    const lacCols = await connection.query(`SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROWS ONLY`);
    if (lacCols.length > 0) {
      console.log("LAC Columns:", Object.keys(lacCols[0]));
      // Check for Discount columns
      const discountCols = Object.keys(lacCols[0]).filter(k => k.includes('DTO') || k.includes('DESC') || k.includes('PRECIO'));
      console.log("Potential Price/Discount Columns:", discountCols);
    } else {
      console.log("No rows found in DSEDAC.LAC");
    }

    // 3. Check specific Subfamily values if column found (assuming CODIGOSUBFAMILIA or similar based on step 1 output, but let's try a guess)
    // We'll wait for step 1 output really, but let's try a standard guess if 'CODIGOSUBFAMILIA' exists
    // We can't query it if we don't know it. The previous error said "Column invalid", so let's stick to discovering columns first.

    await connection.close();
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
