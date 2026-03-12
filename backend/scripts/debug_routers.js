const logger = require('../middleware/logger');
const express = require('express');
const app = express();

const routers = {
    auth: require('../routes/auth'),
    dashboard: require('../routes/dashboard'),
    analytics: require('../routes/analytics'),
    master: require('../routes/master'),
    clients: require('../routes/clients'),
    planner: require('../routes/planner'),
    objectives: require('../routes/objectives'),
    export: require('../routes/export'),
    chatbot: require('../routes/chatbot'),
    commissions: require('../routes/commissions').router,
    filters: require('../routes/filters'),
    entregas: require('../routes/entregas'),
    repartidor: require('../routes/repartidor'),
    userActions: require('../routes/user-actions'),
    facturas: require('../routes/facturas'),
    warehouse: require('../routes/warehouse'),
    kpi: require('../kpi').kpiRoutes
};

let hasError = false;

for (const [name, router] of Object.entries(routers)) {
    if (!router) {
        console.error(`\n❌ Router '${name}' is undefined or null!`);
        hasError = true;
    } else if (typeof router !== 'function' && typeof router !== 'object') {
        console.error(`\n❌ Router '${name}' is invalid type: ${typeof router}`);
        hasError = true;
    } else {
        try {
            app.use(`/${name}`, router);
            console.log(`✅ Router '${name}' mounts correctly.`);
        } catch (e) {
            console.error(`\n❌ Router '${name}' failed to mount: ${e.message}`);
            hasError = true;
        }
    }
}

if (!hasError) {
    console.log('\nAll routers loaded successfully.');
} else {
    console.log('\nFound issues with router injection.');
}
