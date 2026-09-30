'use strict';

// Proceso aparte: el pool del API devuelve SQLSTATE 22003 en la evolución
// del cliente y este mismo SQL responde en un node nuevo.
const { queryWithParams } = require('../middleware/db-timing');

function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (chunk) => chunks.push(chunk));
        process.stdin.on('error', reject);
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

readStdin()
    .then(async (raw) => {
        const { sql, params } = JSON.parse(raw);
        const rows = await queryWithParams(sql, params, false, false);
        process.stdout.write(JSON.stringify(rows || []), () => process.exit(0));
    })
    .catch((error) => {
        const state = (error?.odbcErrors || []).map((entry) => entry.state).find(Boolean) || '';
        process.stderr.write(`${state} ${error.message || error}`);
        process.exit(1);
    });
