const rateLimit = require('express-rate-limit');

// General rate limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000, // limit each IP to 2000 requests per windowMs
    message: { error: 'Demasiadas solicitudes, intente de nuevo más tarde' }
});

// STRICT rate limiter for login endpoint - prevent brute force attacks
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 login attempts per 15 minutes per IP
    message: { error: 'Demasiados intentos de login. Espera 15 minutos antes de intentar de nuevo.' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    globalLimiter,
    loginLimiter
};
