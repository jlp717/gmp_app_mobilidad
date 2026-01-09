/**
 * FILTERS ROUTES - Filtros jerárquicos FI1-FI5 para artículos
 * 
 * Estructura de jerarquía:
 * - FI1: Categoría principal (ej: PRODUCTOS DEL MAR, CARNE CONGELADA, PAN)
 * - FI2: Subcategoría (ej: LANGOSTINO, GAMBA, PULPO) - depende de FI1
 * - FI3: Atributo adicional (poco usado)
 * - FI4: Características especiales (SIN GLUTEN, VEGANO)
 * - FI5: Tipo de conservación/sección (CONGELADO, HELADO, CARNE FRESCA)
 * 
 * Las relaciones se obtienen de la tabla ARTX que contiene FILTRO01-04 para cada artículo
 */
const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');

// Cache para los filtros (se refresca cada 5 minutos)
let filtersCache = {
    fi1: null,
    fi2All: null,
    fi3All: null,
    fi4All: null,
    fi5: null,
    lastUpdated: null
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Helper: Normaliza resultado de query DB2 (maneja case-sensitivity de aliases)
 * DB2 iSeries devuelve los aliases en mayúsculas por defecto
 */
function normalizeRow(row) {
    const normalized = {};
    for (const key in row) {
        normalized[key.toLowerCase()] = row[key];
    }
    return normalized;
}

/**
 * Refresca la caché de filtros si es necesario
 */
async function refreshCacheIfNeeded() {
    const now = Date.now();
    if (filtersCache.lastUpdated && (now - filtersCache.lastUpdated) < CACHE_TTL) {
        return; // Cache still valid
    }

    logger.info('📦 Refrescando caché de filtros FI...');

    try {
        // FI1 - Categorías principales
        const fi1Sql = `SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI1 ORDER BY ORDEN, DESCRIPCIONFILTRO`;
        const fi1Result = await query(fi1Sql, true, true);
        logger.info(`🔍 FI1 raw result: ${fi1Result.length} rows, sample keys: ${fi1Result[0] ? Object.keys(fi1Result[0]).join(', ') : 'empty'}`);
        
        filtersCache.fi1 = fi1Result.map(f => {
            // DB2 devuelve nombres de columna originales (no aliases)
            const code = (f.CODIGOFILTRO || f.codigofiltro || '').toString().trim();
            const name = (f.DESCRIPCIONFILTRO || f.descripcionfiltro || '').toString().trim();
            const orden = f.ORDEN || f.orden || 0;
            return { code, name, orden, count: 0 };
        }).filter(f => f.code && f.code.length > 0);

        // FI2 - Subcategorías
        const fi2Sql = `SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI2 ORDER BY ORDEN, DESCRIPCIONFILTRO`;
        const fi2Result = await query(fi2Sql, true, true);
        logger.info(`🔍 FI2 raw result: ${fi2Result.length} rows`);
        
        filtersCache.fi2All = fi2Result.map(f => {
            const code = (f.CODIGOFILTRO || f.codigofiltro || '').toString().trim();
            const name = (f.DESCRIPCIONFILTRO || f.descripcionfiltro || '').toString().trim();
            const orden = f.ORDEN || f.orden || 0;
            return { code, name, orden };
        }).filter(f => f.code && f.code.length > 0);

        // FI3 - Atributos adicionales
        const fi3Sql = `SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI3 ORDER BY ORDEN, DESCRIPCIONFILTRO`;
        const fi3Result = await query(fi3Sql, true, true);
        logger.info(`🔍 FI3 raw result: ${fi3Result.length} rows`);
        
        filtersCache.fi3All = fi3Result.map(f => {
            const code = (f.CODIGOFILTRO || f.codigofiltro || '').toString().trim();
            const name = (f.DESCRIPCIONFILTRO || f.descripcionfiltro || '').toString().trim();
            const orden = f.ORDEN || f.orden || 0;
            return { code, name, orden };
        }).filter(f => f.code && f.code.length > 0);

        // FI4 - Características especiales
        const fi4Sql = `SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI4 ORDER BY ORDEN, DESCRIPCIONFILTRO`;
        const fi4Result = await query(fi4Sql, true, true);
        logger.info(`🔍 FI4 raw result: ${fi4Result.length} rows`);
        
        filtersCache.fi4All = fi4Result.map(f => {
            const code = (f.CODIGOFILTRO || f.codigofiltro || '').toString().trim();
            const name = (f.DESCRIPCIONFILTRO || f.descripcionfiltro || '').toString().trim();
            const orden = f.ORDEN || f.orden || 0;
            return { code, name, orden };
        }).filter(f => f.code && f.code.length > 0);

        // FI5 - Secciones/Tipo conservación
        const fi5Sql = `SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI5 ORDER BY ORDEN, DESCRIPCIONFILTRO`;
        const fi5Result = await query(fi5Sql, true, true);
        logger.info(`🔍 FI5 raw result: ${fi5Result.length} rows`);
        
        filtersCache.fi5 = fi5Result.map(f => {
            const code = (f.CODIGOFILTRO || f.codigofiltro || '').toString().trim();
            const name = (f.DESCRIPCIONFILTRO || f.descripcionfiltro || '').toString().trim();
            const orden = f.ORDEN || f.orden || 0;
            return { code, name, orden };
        }).filter(f => f.code && f.code.length > 0);

        filtersCache.lastUpdated = now;
        logger.info(`✅ Caché FI actualizada: ${filtersCache.fi1.length} FI1, ${filtersCache.fi2All.length} FI2, ${filtersCache.fi3All.length} FI3, ${filtersCache.fi4All.length} FI4, ${filtersCache.fi5.length} FI5`);

        // Si alguno está vacío, logueamos advertencia
        if (filtersCache.fi1.length === 0) {
            logger.warn('⚠️ FI1 vacío - verificar tabla DSEDAC.FI1');
        }
        if (filtersCache.fi2All.length === 0) {
            logger.warn('⚠️ FI2 vacío - verificar tabla DSEDAC.FI2');
        }

    } catch (err) {
        logger.error('❌ Error refrescando caché FI:', err.message, err.stack);
        // Mantener caché anterior si existe
        if (!filtersCache.lastUpdated) {
            // Primera carga fallida - inicializar con arrays vacíos
            filtersCache.fi1 = [];
            filtersCache.fi2All = [];
            filtersCache.fi3All = [];
            filtersCache.fi4All = [];
            filtersCache.fi5 = [];
        }
    }
}

// =============================================================================
// GET /api/filters/fi1 - Obtener categorías principales (FI1)
// =============================================================================
router.get('/fi1', async (req, res) => {
    try {
        await refreshCacheIfNeeded();

        res.json({
            success: true,
            filters: filtersCache.fi1 || [],
            total: (filtersCache.fi1 || []).length
        });

    } catch (error) {
        logger.error(`FI1 filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo filtros FI1' });
    }
});

// =============================================================================
// GET /api/filters/fi2 - Obtener subcategorías (FI2)
// Puede filtrar por FI1 parent code
// =============================================================================
router.get('/fi2', async (req, res) => {
    try {
        const { fi1Code } = req.query;
        await refreshCacheIfNeeded();

        let result = [];

        if (fi1Code) {
            // Obtener FI2 que realmente existen para artículos con ese FI1
            const fi2Sql = `
                SELECT DISTINCT FILTRO02
                FROM DSEDAC.ARTX x
                INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO AND a.BLOQUEADOSN <> 'S'
                WHERE x.FILTRO01 = '${fi1Code.trim().padEnd(10)}'
                AND x.FILTRO02 IS NOT NULL 
                AND TRIM(x.FILTRO02) <> ''
            `;
            const fi2ForFi1 = await query(fi2Sql, true, true);
            logger.info(`🔍 FI2 para FI1=${fi1Code}: ${fi2ForFi1.length} códigos encontrados`);

            // Mapear los códigos encontrados con los datos del cache
            // DB2 devuelve el nombre de columna original (FILTRO02), no el alias
            const codesInUse = new Set(
                fi2ForFi1.map(r => (r.FILTRO02 || r.filtro02 || '').toString().trim())
                         .filter(c => c && c.length > 0)
            );
            result = (filtersCache.fi2All || []).filter(f => codesInUse.has(f.code));
            logger.info(`🔍 FI2 mapeados: ${result.length} de ${codesInUse.size} códigos en uso`);

        } else {
            // Devolver todos los FI2
            result = filtersCache.fi2All || [];
        }

        res.json({
            success: true,
            filters: result,
            total: result.length,
            parentFilter: fi1Code || null
        });

    } catch (error) {
        logger.error(`FI2 filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo filtros FI2' });
    }
});

// =============================================================================
// GET /api/filters/fi3 - Obtener atributos adicionales (FI3)
// Puede filtrar por FI2 parent code
// =============================================================================
router.get('/fi3', async (req, res) => {
    try {
        const { fi1Code, fi2Code } = req.query;
        await refreshCacheIfNeeded();

        let result = [];

        if (fi2Code || fi1Code) {
            // Construir condición dinámica
            let whereConditions = [];
            if (fi1Code) whereConditions.push(`x.FILTRO01 = '${fi1Code.trim().padEnd(10)}'`);
            if (fi2Code) whereConditions.push(`x.FILTRO02 = '${fi2Code.trim().padEnd(10)}'`);

            const fi3Sql = `
                SELECT DISTINCT FILTRO03
                FROM DSEDAC.ARTX x
                INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO AND a.BLOQUEADOSN <> 'S'
                WHERE ${whereConditions.join(' AND ')}
                AND x.FILTRO03 IS NOT NULL 
                AND TRIM(x.FILTRO03) <> ''
            `;
            const fi3Filtered = await query(fi3Sql, true, true);
            logger.info(`🔍 FI3 filtrados: ${fi3Filtered.length} códigos`);

            const codesInUse = new Set(
                fi3Filtered.map(r => (r.FILTRO03 || r.filtro03 || '').toString().trim())
                           .filter(c => c && c.length > 0)
            );
            result = (filtersCache.fi3All || []).filter(f => codesInUse.has(f.code));

        } else {
            result = filtersCache.fi3All || [];
        }

        res.json({
            success: true,
            filters: result,
            total: result.length
        });

    } catch (error) {
        logger.error(`FI3 filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo filtros FI3' });
    }
});

// =============================================================================
// GET /api/filters/fi4 - Obtener características especiales (FI4)
// =============================================================================
router.get('/fi4', async (req, res) => {
    try {
        const { fi1Code, fi2Code, fi3Code } = req.query;
        await refreshCacheIfNeeded();

        let result = [];

        if (fi1Code || fi2Code || fi3Code) {
            let whereConditions = [];
            if (fi1Code) whereConditions.push(`x.FILTRO01 = '${fi1Code.trim().padEnd(10)}'`);
            if (fi2Code) whereConditions.push(`x.FILTRO02 = '${fi2Code.trim().padEnd(10)}'`);
            if (fi3Code) whereConditions.push(`x.FILTRO03 = '${fi3Code.trim().padEnd(10)}'`);

            const fi4Sql = `
                SELECT DISTINCT FILTRO04
                FROM DSEDAC.ARTX x
                INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO AND a.BLOQUEADOSN <> 'S'
                WHERE ${whereConditions.join(' AND ')}
                AND x.FILTRO04 IS NOT NULL 
                AND TRIM(x.FILTRO04) <> ''
            `;
            const fi4Filtered = await query(fi4Sql, true, true);
            logger.info(`🔍 FI4 filtrados: ${fi4Filtered.length} códigos`);

            const codesInUse = new Set(
                fi4Filtered.map(r => (r.FILTRO04 || r.filtro04 || '').toString().trim())
                           .filter(c => c && c.length > 0)
            );
            result = (filtersCache.fi4All || []).filter(f => codesInUse.has(f.code));

        } else {
            result = filtersCache.fi4All || [];
        }

        res.json({
            success: true,
            filters: result,
            total: result.length
        });

    } catch (error) {
        logger.error(`FI4 filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo filtros FI4' });
    }
});

// =============================================================================
// GET /api/filters/fi5 - Obtener secciones/tipo conservación (FI5)
// =============================================================================
router.get('/fi5', async (req, res) => {
    try {
        await refreshCacheIfNeeded();

        res.json({
            success: true,
            filters: filtersCache.fi5 || [],
            total: (filtersCache.fi5 || []).length
        });

    } catch (error) {
        logger.error(`FI5 filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo filtros FI5' });
    }
});

// =============================================================================
// GET /api/filters/all - Obtener todos los filtros FI de una vez (para carga inicial)
// =============================================================================
router.get('/all', async (req, res) => {
    try {
        await refreshCacheIfNeeded();

        res.json({
            success: true,
            fi1: filtersCache.fi1 || [],
            fi2: filtersCache.fi2All || [],
            fi3: filtersCache.fi3All || [],
            fi4: filtersCache.fi4All || [],
            fi5: filtersCache.fi5 || [],
            cacheAge: filtersCache.lastUpdated ? Date.now() - filtersCache.lastUpdated : null
        });

    } catch (error) {
        logger.error(`All filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo filtros' });
    }
});

// =============================================================================
// GET /api/filters/articles - Buscar artículos filtrados por FI1-FI5
// =============================================================================
router.get('/articles', async (req, res) => {
    try {
        const { fi1, fi2, fi3, fi4, fi5, search, limit = 100, offset = 0 } = req.query;

        let whereConditions = ["a.BLOQUEADOSN <> 'S'"];

        if (fi1) whereConditions.push(`TRIM(x.FILTRO01) = '${fi1.trim()}'`);
        if (fi2) whereConditions.push(`TRIM(x.FILTRO02) = '${fi2.trim()}'`);
        if (fi3) whereConditions.push(`TRIM(x.FILTRO03) = '${fi3.trim()}'`);
        if (fi4) whereConditions.push(`TRIM(x.FILTRO04) = '${fi4.trim()}'`);
        if (fi5) whereConditions.push(`TRIM(a.CODIGOSECCIONLARGA) = '${fi5.trim()}'`);

        if (search) {
            const term = search.toUpperCase().replace(/'/g, "''").trim();
            whereConditions.push(`(UPPER(a.DESCRIPCIONARTICULO) LIKE '%${term}%' OR a.CODIGOARTICULO LIKE '%${term}%')`);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Contar total
        const countResult = await query(`
            SELECT COUNT(DISTINCT a.CODIGOARTICULO) as total
            FROM DSEDAC.ART a
            INNER JOIN DSEDAC.ARTX x ON a.CODIGOARTICULO = x.CODIGOARTICULO
            ${whereClause}
        `);

        const total = countResult[0]?.total || 0;

        // Obtener artículos
        const articles = await query(`
            SELECT 
                TRIM(a.CODIGOARTICULO) as code,
                TRIM(a.DESCRIPCIONARTICULO) as name,
                TRIM(x.FILTRO01) as fi1Code,
                TRIM(x.FILTRO02) as fi2Code,
                TRIM(x.FILTRO03) as fi3Code,
                TRIM(x.FILTRO04) as fi4Code,
                TRIM(a.CODIGOSECCIONLARGA) as fi5Code,
                TRIM(a.CODIGOMARCA) as brand,
                a.PESO as weight
            FROM DSEDAC.ART a
            INNER JOIN DSEDAC.ARTX x ON a.CODIGOARTICULO = x.CODIGOARTICULO
            ${whereClause}
            ORDER BY a.DESCRIPCIONARTICULO
            OFFSET ${parseInt(offset)} ROWS
            FETCH NEXT ${parseInt(limit)} ROWS ONLY
        `);

        res.json({
            success: true,
            articles: articles,
            total: total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            filters: { fi1, fi2, fi3, fi4, fi5, search }
        });

    } catch (error) {
        logger.error(`Filter articles error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error filtrando artículos' });
    }
});

// =============================================================================
// GET /api/filters/cascade - Endpoint optimizado para carga en cascada
// Devuelve FI2, FI3, FI4 disponibles según los filtros seleccionados
// =============================================================================
router.get('/cascade', async (req, res) => {
    try {
        const { fi1, fi2, fi3 } = req.query;

        const result = {
            fi2Options: [],
            fi3Options: [],
            fi4Options: [],
            articleCount: 0
        };

        let baseConditions = ["a.BLOQUEADOSN <> 'S'"];
        if (fi1) baseConditions.push(`TRIM(x.FILTRO01) = '${fi1.trim()}'`);
        if (fi2) baseConditions.push(`TRIM(x.FILTRO02) = '${fi2.trim()}'`);
        if (fi3) baseConditions.push(`TRIM(x.FILTRO03) = '${fi3.trim()}'`);

        const baseWhere = 'WHERE ' + baseConditions.join(' AND ');

        // FI2 options (solo si hay FI1)
        if (fi1) {
            const fi2Result = await query(`
                SELECT DISTINCT
                    TRIM(x.FILTRO02) as code,
                    COALESCE(TRIM(f.DESCRIPCIONFILTRO), TRIM(x.FILTRO02)) as name,
                    COUNT(DISTINCT x.CODIGOARTICULO) as count
                FROM DSEDAC.ARTX x
                INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO
                LEFT JOIN DSEDAC.FI2 f ON TRIM(x.FILTRO02) = TRIM(f.CODIGOFILTRO)
                WHERE a.BLOQUEADOSN <> 'S'
                AND TRIM(x.FILTRO01) = '${fi1.trim()}'
                AND x.FILTRO02 IS NOT NULL AND TRIM(x.FILTRO02) <> ''
                GROUP BY TRIM(x.FILTRO02), f.DESCRIPCIONFILTRO
                ORDER BY name
            `);
            result.fi2Options = fi2Result.filter(f => f.code?.trim());
        }

        // FI3 options (si hay FI1 o FI2)
        if (fi1 || fi2) {
            let fi3Conditions = ["a.BLOQUEADOSN <> 'S'"];
            if (fi1) fi3Conditions.push(`TRIM(x.FILTRO01) = '${fi1.trim()}'`);
            if (fi2) fi3Conditions.push(`TRIM(x.FILTRO02) = '${fi2.trim()}'`);

            const fi3Result = await query(`
                SELECT DISTINCT
                    TRIM(x.FILTRO03) as code,
                    COALESCE(TRIM(f.DESCRIPCIONFILTRO), TRIM(x.FILTRO03)) as name,
                    COUNT(DISTINCT x.CODIGOARTICULO) as count
                FROM DSEDAC.ARTX x
                INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO
                LEFT JOIN DSEDAC.FI3 f ON TRIM(x.FILTRO03) = TRIM(f.CODIGOFILTRO)
                WHERE ${fi3Conditions.join(' AND ')}
                AND x.FILTRO03 IS NOT NULL AND TRIM(x.FILTRO03) <> ''
                GROUP BY TRIM(x.FILTRO03), f.DESCRIPCIONFILTRO
                ORDER BY name
            `);
            result.fi3Options = fi3Result.filter(f => f.code?.trim());
        }

        // FI4 options
        if (fi1 || fi2 || fi3) {
            const fi4Result = await query(`
                SELECT DISTINCT
                    TRIM(x.FILTRO04) as code,
                    COALESCE(TRIM(f.DESCRIPCIONFILTRO), TRIM(x.FILTRO04)) as name,
                    COUNT(DISTINCT x.CODIGOARTICULO) as count
                FROM DSEDAC.ARTX x
                INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO
                LEFT JOIN DSEDAC.FI4 f ON TRIM(x.FILTRO04) = TRIM(f.CODIGOFILTRO)
                ${baseWhere}
                AND x.FILTRO04 IS NOT NULL AND TRIM(x.FILTRO04) <> ''
                GROUP BY TRIM(x.FILTRO04), f.DESCRIPCIONFILTRO
                ORDER BY name
            `);
            result.fi4Options = fi4Result.filter(f => f.code?.trim());
        }

        // Count matching articles
        const countResult = await query(`
            SELECT COUNT(DISTINCT x.CODIGOARTICULO) as total
            FROM DSEDAC.ARTX x
            INNER JOIN DSEDAC.ART a ON x.CODIGOARTICULO = a.CODIGOARTICULO
            ${baseWhere}
        `);
        result.articleCount = countResult[0]?.total || 0;

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        logger.error(`Cascade filters error: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo opciones en cascada' });
    }
});

module.exports = router;
