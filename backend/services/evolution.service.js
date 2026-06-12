'use strict';

/**
 * EVOLUTION SERVICE
 * =================
 * Sales evolution data for the "Evolución" tab.
 * Reads from DSEDAC.LACLAE (ERP invoice lines) for real historical data.
 */

const { queryWithParams } = require('../config/db');
const { cachedQuery } = require('./query-optimizer');
const { redisCache, TTL } = require('./redis-cache');
const logger = require('../middleware/logger');
const { LACLAE_SALES_FILTER } = require('../utils/common');

/**
 * Get monthly sales evolution for a vendor (or ALL vendors).
 * Returns 24 months of data for YoY comparison.
 */
async function getSalesEvolution({ vendedorCodes, clientCode, months = 24 }) {
    const isAll = !vendedorCodes || vendedorCodes.trim().toUpperCase() === 'ALL';
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Calculate exact month window. "24 months" means current month plus the
    // previous 23, not every row since January two years ago.
    const startPeriod = new Date(currentYear, currentMonth - months, 1);
    const startYear = startPeriod.getFullYear();
    const startMonth = startPeriod.getMonth() + 1;
    const params = [startYear, startYear, startMonth];
    let vendorFilter = '';

    if (!isAll) {
        const vendors = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        if (vendors.length === 1) {
            vendorFilter = 'AND TRIM(L.LCCDVD) = ?';
            params.push(vendors[0]);
        } else if (vendors.length > 1 && vendors.length <= 20) {
            vendorFilter = `AND TRIM(L.LCCDVD) IN (${vendors.map(() => '?').join(',')})`;
            params.push(...vendors);
        }
    }

    let clientFilter = '';
    if (clientCode) {
        clientFilter = 'AND TRIM(L.LCCDCL) = ?';
        params.push(clientCode.trim());
    }

    const sql = `
        SELECT
            L.LCAADC AS ANO,
            L.LCMMDC AS MES,
            COUNT(DISTINCT L.LCCDCL) AS NUM_CLIENTES,
            COUNT(*) AS NUM_LINEAS,
            SUM(L.LCIMVT) AS TOTAL_VENTAS,
            SUM(L.LCIMCT) AS TOTAL_COSTO,
            SUM(L.LCIMVT - L.LCIMCT) AS TOTAL_MARGEN
        FROM DSED.LACLAE L
        WHERE (L.LCAADC > ? OR (L.LCAADC = ? AND L.LCMMDC >= ?))
          AND ${LACLAE_SALES_FILTER}
          ${vendorFilter}
          ${clientFilter}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC, L.LCMMDC`;

    const cacheKey = `evolution:monthly:${vendedorCodes || 'ALL'}:${clientCode || ''}:${months}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, params),
            sql,
            cacheKey,
            TTL.MEDIUM
        );

        const monthlyData = (rows || []).map(r => {
            const ventas = parseFloat(r.TOTAL_VENTAS) || 0;
            const costo = parseFloat(r.TOTAL_COSTO) || 0;
            const margen = parseFloat(r.TOTAL_MARGEN) || 0;
            return {
                year: parseInt(r.ANO),
                month: parseInt(r.MES),
                period: `${r.ANO}-${String(r.MES).padStart(2, '0')}`,
                numClientes: parseInt(r.NUM_CLIENTES) || 0,
                numLineas: parseInt(r.NUM_LINEAS) || 0,
                totalVentas: ventas,
                totalCosto: costo,
                totalMargen: margen,
                margenPct: ventas > 0 ? Math.round((margen / ventas) * 10000) / 100 : 0,
            };
        });

        // Build YoY comparison
        const thisYear = monthlyData.filter(d => d.year === currentYear);
        const lastYear = monthlyData.filter(d => d.year === currentYear - 1);
        const ytdVentas = thisYear.filter(d => d.month <= currentMonth).reduce((s, d) => s + d.totalVentas, 0);
        const ytdVentasPrev = lastYear.filter(d => d.month <= currentMonth).reduce((s, d) => s + d.totalVentas, 0);

        return {
            monthly: monthlyData,
            summary: {
                ytdVentas,
                ytdVentasPrev,
                yoyChange: ytdVentasPrev > 0 ? Math.round(((ytdVentas - ytdVentasPrev) / ytdVentasPrev) * 10000) / 100 : 0,
                currentMonth: thisYear.find(d => d.month === currentMonth) || null,
                prevYearSameMonth: lastYear.find(d => d.month === currentMonth) || null,
            }
        };
    } catch (error) {
        logger.error(`[EVOLUTION] getSalesEvolution error: ${error.message}`);
        throw error;
    }
}

/**
 * Top products evolution — which products are growing/declining
 */
async function getProductEvolution({ vendedorCodes, clientCode, limit = 20 }) {
    const isAll = !vendedorCodes || vendedorCodes.trim().toUpperCase() === 'ALL';
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;
    const params = [currentYear, prevYear];
    let vendorFilter = '';

    if (!isAll) {
        const vendors = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        if (vendors.length === 1) {
            vendorFilter = 'AND TRIM(L.LCCDVD) = ?';
            params.push(vendors[0]);
        }
    }

    let clientFilter = '';
    if (clientCode) {
        clientFilter = 'AND TRIM(L.LCCDCL) = ?';
        params.push(clientCode.trim());
    }

    params.push(limit);

    const sql = `
        SELECT
            TRIM(L.LCCDRF) AS CODE,
            TRIM(A.DESCRIPCIONARTICULO) AS NAME,
            TRIM(A.CODIGOFAMILIA) AS FAMILY,
            SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ACTUAL,
            SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ANTERIOR,
            SUM(L.LCIMVT) AS VENTAS_TOTAL
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.ART A ON TRIM(L.LCCDRF) = TRIM(A.CODIGOARTICULO)
        WHERE L.LCAADC IN (${currentYear}, ${prevYear})
          AND ${LACLAE_SALES_FILTER}
          ${vendorFilter}
          ${clientFilter}
        GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO), TRIM(A.CODIGOFAMILIA)
        ORDER BY VENTAS_TOTAL DESC
        FETCH FIRST ? ROWS ONLY`;

    try {
        const rows = await queryWithParams(sql, params);
        return (rows || []).map(r => {
            const actual = parseFloat(r.VENTAS_ACTUAL) || 0;
            const anterior = parseFloat(r.VENTAS_ANTERIOR) || 0;
            return {
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                family: (r.FAMILY || '').trim(),
                ventasActual: actual,
                ventasAnterior: anterior,
                yoyChange: anterior > 0 ? Math.round(((actual - anterior) / anterior) * 10000) / 100 : (actual > 0 ? 100 : 0),
                trend: actual > anterior ? 'UP' : actual < anterior ? 'DOWN' : 'FLAT',
            };
        });
    } catch (error) {
        logger.error(`[EVOLUTION] getProductEvolution error: ${error.message}`);
        throw error;
    }
}

/**
 * Client evolution — which clients are growing/declining
 */
async function getClientEvolution({ vendedorCodes, limit = 30 }) {
    const isAll = !vendedorCodes || vendedorCodes.trim().toUpperCase() === 'ALL';
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;
    const params = [currentYear, prevYear];
    let vendorFilter = '';

    if (!isAll) {
        const vendors = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        if (vendors.length === 1) {
            vendorFilter = 'AND TRIM(L.LCCDVD) = ?';
            params.push(vendors[0]);
        }
    }
    params.push(limit);

    const sql = `
        SELECT
            TRIM(L.LCCDCL) AS CODIGO_CLIENTE,
            MAX(TRIM(C.NOMBRECOMERCIAL)) AS NOMBRE,
            SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ACTUAL,
            SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ANTERIOR,
            COUNT(DISTINCT CASE WHEN L.LCAADC = ${currentYear} THEN L.LCCDRF END) AS PRODUCTOS_ACTUAL
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.CLI C ON TRIM(L.LCCDCL) = TRIM(C.CODIGOCLIENTE)
        WHERE L.LCAADC IN (${currentYear}, ${prevYear})
          AND ${LACLAE_SALES_FILTER}
          ${vendorFilter}
        GROUP BY TRIM(L.LCCDCL)
        ORDER BY VENTAS_ACTUAL DESC
        FETCH FIRST ? ROWS ONLY`;

    try {
        const rows = await queryWithParams(sql, params);
        return (rows || []).map(r => {
            const actual = parseFloat(r.VENTAS_ACTUAL) || 0;
            const anterior = parseFloat(r.VENTAS_ANTERIOR) || 0;
            return {
                codigoCliente: (r.CODIGO_CLIENTE || '').trim(),
                nombre: (r.NOMBRE || '').trim(),
                ventasActual: actual,
                ventasAnterior: anterior,
                productosActual: parseInt(r.PRODUCTOS_ACTUAL) || 0,
                yoyChange: anterior > 0 ? Math.round(((actual - anterior) / anterior) * 10000) / 100 : (actual > 0 ? 100 : 0),
                trend: actual > anterior ? 'UP' : actual < anterior ? 'DOWN' : 'FLAT',
            };
        });
    } catch (error) {
        logger.error(`[EVOLUTION] getClientEvolution error: ${error.message}`);
        throw error;
    }
}

module.exports = { getSalesEvolution, getProductEvolution, getClientEvolution };
