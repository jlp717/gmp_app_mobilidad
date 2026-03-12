require('dotenv').config();
const { globalLimiter } = require('../middleware/security');
const { auditMiddleware } = require('../middleware/audit');
const { networkOptimizer, responseCoalescing } = require('../middleware/network-optimizer');
const verifyToken = require('../middleware/auth');

console.log('Checking middlewares from server.js:');
console.log('globalLimiter:', typeof globalLimiter);
console.log('auditMiddleware:', typeof auditMiddleware);
console.log('networkOptimizer:', typeof networkOptimizer);
console.log('responseCoalescing:', typeof responseCoalescing);
console.log('verifyToken:', typeof verifyToken);

// The error is `TypeError: Router.use() requires a middleware function but got a undefined`
// This could also be a sub-router. Like `authRoutes` or `dashboardRoutes` inside an `app.use()`.
const express = require('express');
const app = express();

const attemptUse = (name, mw) => {
    try {
        app.use(mw);
        console.log(`✅ mount ${name} successful`);
    } catch (e) {
        console.error(`❌ mount ${name} failed: ${e.message}`);
    }
}

attemptUse('globalLimiter', globalLimiter);
attemptUse('auditMiddleware', auditMiddleware);
attemptUse('networkOptimizer', networkOptimizer);
attemptUse('responseCoalescing', responseCoalescing);
attemptUse('verifyToken', verifyToken);

