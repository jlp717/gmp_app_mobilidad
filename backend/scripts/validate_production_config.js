/**
 * GMP App - Production Configuration Validator
 * ==========================================
 * Valida que la configuración sea segura para producción
 * Run: node scripts/validate_production_config.js
 * O: node -r dotenv/config scripts/validate_production_config.js
 */

'use strict';

// Auto-load dotenv if available
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not installed, continue anyway
}

const logger = console;

const REQUIRED_PRODUCTION_VARS = [
    { name: 'JWT_ACCESS_SECRET', minLen: 32, critical: true },
    { name: 'JWT_REFRESH_SECRET', minLen: 32, critical: true },
    { name: 'ODBC_UID', minLen: 1, critical: true },
    { name: 'ODBC_PWD', minLen: 1, critical: true },
    { name: 'SMTP_HOST', minLen: 1, critical: true },
    { name: 'SMTP_USER', minLen: 1, critical: true },
    { name: 'SMTP_PASS', minLen: 1, critical: true },  // Tu archivo usa SMTP_PASS
];

const WARNING_PRODUCTION_VARS = [
    { name: 'NODE_ENV', expect: 'production' },
    { name: 'CORS_ORIGIN', expectNot: '*' },
    { name: 'CORS_ORIGIN', expectNot: 'true' },
    { name: 'RATE_LIMIT_MAX_REQUESTS', min: 100 },
    { name: 'LOGIN_RATE_LIMIT', max: 10 },
];

function validateProductionConfig() {
    let errors = 0;
    let warnings = 0;
    const isProduction = process.env.NODE_ENV === 'production';

    logger.info('═'.repeat(60));
    logger.info('🔒 GMP App - Production Configuration Validator');
    logger.info('═'.repeat(60));

    if (!isProduction) {
        logger.warn('⚠️  NODE_ENV is not "production" - skipping strict validation');
    }

    // Check required variables
    logger.info('\n📋 Checking required variables...');
    for (const varDef of REQUIRED_PRODUCTION_VARS) {
        const value = process.env[varDef.name];
        if (!value || value.startsWith('<') || value.length < varDef.minLen) {
            if (varDef.critical && isProduction) {
                logger.error(`❌ ${varDef.name}: CRITICAL - ${varDef.name} not set or too short`);
                errors++;
            } else {
                logger.warn(`⚠️  ${varDef.name}: Not configured`);
                warnings++;
            }
        } else {
            logger.info(`✅ ${varDef.name}: Configured`);
        }
    }

    // Check for security issues
    logger.info('\n🔐 Checking security settings...');
    
    // JWT secrets
    const jwtAccess = process.env.JWT_ACCESS_SECRET || '';
    const jwtRefresh = process.env.JWT_REFRESH_SECRET || '';
    
    if (jwtAccess.length < 32) {
        logger.error('❌ JWT_ACCESS_SECRET too short (min 32 chars)');
        errors++;
    } else if (jwtAccess.includes(' ') || jwtAccess.includes('<') || jwtAccess.includes('EXAMPLE')) {
        logger.error('❌ JWT_ACCESS_SECRET contains invalid characters');
        errors++;
    } else {
        logger.info('✅ JWT_ACCESS_SECRET: Strong');
    }

    if (jwtRefresh.length < 32) {
        logger.error('❌ JWT_REFRESH_SECRET too short (min 32 chars)');
        errors++;
    } else if (jwtRefresh.includes(' ') || jwtRefresh.includes('<') || jwtRefresh.includes('EXAMPLE')) {
        logger.error('❌ JWT_REFRESH_SECRET contains invalid characters');
        errors++;
    } else {
        logger.info('✅ JWT_REFRESH_SECRET: Strong');
    }

    // CORS - WARNING only, not error (allow 'true' in production with warning)
    const corsOrigin = process.env.CORS_ORIGIN || '';
    if (corsOrigin === '*') {
        logger.error('❌ CORS_ORIGIN: Wildcard (*) NOT allowed in production!');
        errors++;
    } else if (corsOrigin === 'true') {
        logger.warn('⚠️  CORS_ORIGIN=true: Allows all origins (OK for dev, WARN for prod)');
    } else if (corsOrigin && !corsOrigin.includes('*')) {
        logger.info(`✅ CORS_ORIGIN: ${corsOrigin}`);
    }

    // Rate limiting
    const rateLimit = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '0', 10);
    const loginRateLimit = parseInt(process.env.LOGIN_RATE_LIMIT || '0', 10);
    
    if (rateLimit > 0 && rateLimit < 100) {
        logger.error('❌ RATE_LIMIT_MAX_REQUESTS too low (min 100)');
        errors++;
    } else if (rateLimit > 0) {
        logger.info(`✅ RATE_LIMIT_MAX_REQUESTS: ${rateLimit}`);
    }

    if (loginRateLimit > 10) {
        logger.error('❌ LOGIN_RATE_LIMIT too high (max 10)');
        errors++;
    } else if (loginRateLimit > 0) {
        logger.info(`✅ LOGIN_RATE_LIMIT: ${loginRateLimit}`);
    }

    // Summary
    logger.info('\n' + '═'.repeat(60));
    logger.info('📊 Validation Summary:');
    logger.info(`   Errors: ${errors}`);
    logger.info(`   Warnings: ${warnings}`);
    logger.info('═'.repeat(60));

    if (errors > 0) {
        logger.error('\n❌ Configuration NOT ready for production!');
        process.exit(1);
    }

    if (warnings > 0) {
        logger.warn('\n⚠️  Configuration ready but has warnings');
    }

    logger.info('\n✅ Configuration ready for production!');
    process.exit(0);
}

if (require.main === module) {
    validateProductionConfig();
}

module.exports = { validateProductionConfig };