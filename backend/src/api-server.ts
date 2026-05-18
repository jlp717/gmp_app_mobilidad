// ============================================================
// ⛔ DEPRECATED — DO NOT USE
// ============================================================
// This file is a prototype and is NOT imported or used anywhere.
// It contains insecure patterns (hardcoded credentials, SQL injection).
// All routes have been disabled. Use backend/routes/* and backend/server.js instead.
// ============================================================

import express from 'express';

const app = express();
const PORT = 3000;

app.use(express.json());

// All routes disabled — returns 501 Not Implemented
app.use('/api/*', (_req, res) => {
    res.status(501).json({
        error: 'Not Implemented',
        message: 'This prototype API server has been deprecated. Use backend/server.js instead.',
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('⛔ DEPRECATED api-server.ts — all routes return 501. Use backend/server.js instead.');
});
