const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

// 1. Remove SFM query block
const sfmQueryBlock = `      // Use SFM
      const subfamRows = await query(\`SELECT CODIGOSUBFAMILIA, DESCRIPCIONSUBFAMILIA FROM DSEDAC.SFM\`);
      subfamRows.forEach(r => { subfamilyNames[r.CODIGOSUBFAMILIA?.trim()] = r.DESCRIPCIONSUBFAMILIA?.trim() || r.CODIGOSUBFAMILIA?.trim(); });`;

const sfmQueryReplacement = `      // SFM Table is empty, rely on Codes or fallback
      // const subfamRows = await query(\`SELECT CODIGOSUBFAMILIA, DESCRIPCIONSUBFAMILIA FROM DSEDAC.SFM\`);
      // subfamRows.forEach(r => { subfamilyNames[r.CODIGOSUBFAMILIA?.trim()] = r.DESCRIPCIONSUBFAMILIA?.trim() || r.CODIGOSUBFAMILIA?.trim(); });`;

if (content.includes('SELECT CODIGOSUBFAMILIA, DESCRIPCIONSUBFAMILIA FROM DSEDAC.SFM')) {
    // We'll just comment it out to be safe or replace strictly
    content = content.replace("const subfamRows = await query(`SELECT CODIGOSUBFAMILIA, DESCRIPCIONSUBFAMILIA FROM DSEDAC.SFM`);", "// SFM Empty");
    content = content.replace("subfamRows.forEach(r => { subfamilyNames[r.CODIGOSUBFAMILIA?.trim()] = r.DESCRIPCIONSUBFAMILIA?.trim() || r.CODIGOSUBFAMILIA?.trim(); });", "");
}

// 2. Fix Subfamily SQL to avoid 'SIN_SUBFAM' and use 'General' if empty
// Old: COALESCE(A.CODIGOSUBFAMILIA, 'SIN_SUBFAM') as SUBFAMILY_CODE,
// New: COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as SUBFAMILY_CODE,
content = content.replace(
    "COALESCE(A.CODIGOSUBFAMILIA, 'SIN_SUBFAM') as SUBFAMILY_CODE",
    "COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as SUBFAMILY_CODE"
);
content = content.replace(
    "const subfamCode = row.SUBFAMILY_CODE?.trim() || 'SIN_SUBFAM';",
    "const subfamCode = row.SUBFAMILY_CODE?.trim() || 'General';"
);

// 3. Update Subfamily Name logic to use Code if Name missing (since SFM is empty)
// Old: name: subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode 
// New: name: (subfamilyNames[subfamCode] && subfamilyNames[subfamCode] !== subfamCode) ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode

// Actually, since SFM is empty, subfamilyNames will be empty. 
// We want to display just the Code if that's all we have.
// In the patch_matrix.js we used:
// name: subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode 
// This is already correct fallback (shows Code if name missing).
// But maybe we can try to fetch names from FAM? No, that's Family.
// Let's just ensures it falls back gracefully.

fs.writeFileSync(serverPath, content);
console.log('Server patched: SFM removed, fallback improved.');
