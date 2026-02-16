const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../routes/planner.js');
let content = fs.readFileSync(filePath, 'utf8');

const badBlock = `const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay,
    reloadRuteroConfig,
    getClientsForDay,
    reloadRuteroConfig,
    getClientCurrentDay,
    getNaturalOrder
} = require('../services/laclae');`;

const goodBlock = `const {
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientsForDay,
    reloadRuteroConfig,
    getClientCurrentDay,
    getNaturalOrder
} = require('../services/laclae');`;

if (content.includes(badBlock)) {
    content = content.replace(badBlock, goodBlock);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ Imports fixed.');
} else {
    // Try relaxed match (regex?)
    console.log('⚠️ Exact match failed. Using loose replacement...');
    content = content.replace(/getClientsForDay,\s+reloadRuteroConfig,\s+getClientsForDay,\s+reloadRuteroConfig,/g, 'getClientsForDay,\n    reloadRuteroConfig,');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ Imports fixed (loose).');
}
