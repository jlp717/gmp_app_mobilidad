// similarity.js — split verbatim de services/pedidos/index.js (lote 2026-09-28): productos complementarios y similitud inteligente.
// Contenido movido tal cual, sin cambios de logica. index.js actua como fachada.
const { queryWithParams } = require('../../config/db');
const { db2AppTable } = require('../../utils/db2-schemas');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const logger = require('../../middleware/logger');
const { cachedQuery } = require('../query-optimizer');
const { TTL } = require('../redis-cache');
const { truncate } = require('./_shared');
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');
const PEDIDOS_STOCK_RESERVE_TABLE = db2AppTable('PEDIDOS_STOCK_RESERVE');
const DRAFT_STOCK_RESERVATION_HOURS = 24;
const DRAFT_STOCK_RESERVATION_STATES_SQL = "'BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION', 'CONFIRMANDO'";
const ACTIVE_STOCK_RESERVATION_CONDITION = `
(
    TRIM(C.ESTADO) = 'CONFIRMADO'
    OR (
        TRIM(C.ESTADO) IN (${DRAFT_STOCK_RESERVATION_STATES_SQL})
        AND SR.CREATED_AT >= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS
    )
)`;
async function getComplementaryProducts(productCodes, clientCode) {
    const { applyConfiguredPricingToProducts } = require('./index'); // puente split: def vive en index
    if (!productCodes || productCodes.length === 0) return [];

    const trimmedCodes = productCodes.map(c => c.trim());
    const placeholders = trimmedCodes.map(() => '?').join(',');
    const trimClient = clientCode ? truncate(clientCode, 10) : '';
    const cacheKey = `pedidos:complementary:${trimClient || 'no-client'}:${productCodes.sort().join(',')}`;

    const sql = `
        SELECT TRIM(L2.CODIGOARTICULO) AS code,
               TRIM(A.DESCRIPCIONARTICULO) AS NAME,
               COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) AS cooccurrences,
               COALESCE(T.PRECIOTARIFA, 0) AS price,
               A.UNIDADESCAJA AS unitsPerBox,
               COALESCE(S.ENVASES_DISP, 0) AS stockEnvases,
               COALESCE(S.UNIDADES_DISP, 0) AS stockUnidades
        FROM ${comercialErpTable('LINDTO')} L1
        JOIN ${comercialErpTable('LINDTO')} L2
            ON L2.CODIGOCLIENTEALBARAN = L1.CODIGOCLIENTEALBARAN
            AND L2.ANODOCUMENTO = L1.ANODOCUMENTO
            AND L2.NUMERODOCUMENTO = L1.NUMERODOCUMENTO
            AND TRIM(L2.CODIGOARTICULO) NOT IN (${placeholders})
        JOIN ${comercialErpTable('ART')} A ON TRIM(A.CODIGOARTICULO) = TRIM(L2.CODIGOARTICULO)
        LEFT JOIN ${comercialErpTable('ARA')} T ON TRIM(L2.CODIGOARTICULO) = TRIM(T.CODIGOARTICULO) AND T.CODIGOTARIFA = 1
        LEFT JOIN (
            SELECT CODIGOARTICULO,
                SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM ${comercialErpTable('ARO')} WHERE CODIGOALMACEN = 1
            GROUP BY CODIGOARTICULO
        ) S ON TRIM(L2.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
        WHERE TRIM(L1.CODIGOARTICULO) IN (${placeholders})
          AND L1.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L1.TIPOVENTA IN ('CC','VC')
          AND L1.CLASELINEA IN ('AB','VT')
          AND L2.CLASELINEA IN ('AB','VT')
          AND A.ANOBAJA = 0
        GROUP BY L2.CODIGOARTICULO, A.DESCRIPCIONARTICULO, T.PRECIOTARIFA, A.UNIDADESCAJA, S.ENVASES_DISP, S.UNIDADES_DISP
        HAVING COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) >= 3
        ORDER BY cooccurrences DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    const params = [...trimmedCodes, ...trimmedCodes];

    try {
        const rows = await cachedQuery(
            (s) => queryWithParams(s, params),
            sql, cacheKey, TTL.MEDIUM
        );
        const products = rows.map(r => {
            const price = parseFloat(r.PRICE) || 0;
            return {
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            cooccurrences: parseInt(r.COOCCURRENCES) || 0,
            price,
            precioTarifa1: price,
            precioTarifaCliente: price,
            precioCliente: 0,
            unitsPerBox: parseFloat(r.UNITSPERBOX) || 1,
            stockEnvases: parseFloat(r.STOCKENVASES) || 0,
            stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
            source: 'complementary',
            };
        });
        const pricedProducts = await applyConfiguredPricingToProducts(products, trimClient);
        return pricedProducts.map(product => ({
            ...product,
            price: product.precioTarifaCliente || product.precioCliente || product.price,
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getComplementaryProducts error: ${error.message}`);
        return [];
    }
}

// =============================================================================
// INTELLIGENT SIMILAR PRODUCTS (3-Level Algorithm - Production Ready)
// =============================================================================

/**
 * Intelligent product analysis - extracts the "essence" of a product
 * Returns: { category, isProcessed, format, mainIngredient, qualifiers }
 */
function analyzeProductEssence(name) {
    const text = (name || '').toLowerCase().trim();
    const words = text.split(/\s+/).filter(w => w.length > 2);
    
    // ========================================
    // CATEGORY DETECTION (what type of product)
    // ========================================
    const categoryPatterns = {
        'carne': ['pollo', 'cerdo', 'vacuno', 'ternera', 'cordero', 'cabrito', 'lacon', 'jamon', 'iberico', 'paleta', 'panceta', 'tocino', 'chuleta', 'costilla', 'filete', 'solomillo', 'pechuga', 'muslo', 'pierna', 'brazo', 'hamburguesa', 'butifarra', 'morcilla', 'chorizo', 'salami', 'salchicha', 'bacon', 'lomo', 'presunto', 'cecina', 'fuet', 'sobrasada'],
        'pescado': ['pescado', 'salmon', 'merluza', 'bacalao', 'atun', 'bonito', 'sardina', 'caballa', 'bacoreta', 'dorada', 'lubina', 'rape', 'rodaballo', 'lenguado', 'trucha', 'carpa', 'tenca', 'anguila', 'palometa', 'chicharro', 'jurel', 'estornino', 'melva', 'coco', 'marrajo', 'congrio', 'anchoa', 'boqueron'],
        'marisco': ['marisco', 'gamba', 'langostino', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'centollo', 'necora', 'navaja', 'vieira', 'mejillon', 'almeja', 'berberecho', 'ostra', 'caracol', 'calamar', 'pulpo', 'sepia', 'volande', 'burga', 'chocho'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'pimiento', 'cebolla', 'ajo', 'zanahoria', 'calabacin', 'berenjena', 'alcachofa', 'esparrago', 'esparragos', 'guisante', 'judia', 'habichuela', 'brocoli', 'coliflor', 'col', 'repollo', 'acelga', 'espinaca', 'berro', 'canonigo', 'rucula', 'endibia', 'escarola', 'apio', 'nabo', 'rabano', 'remolacha', 'batata', 'boniato'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'platano', 'limon', 'pomelo', 'mandarina', 'kiwi', 'uva', 'sandia', 'melon', 'fresa', 'frambuesa', 'mora', 'arandano', 'cereza', 'ciruela', 'melocoton', 'albaricoque', 'nectarina', 'higo', 'granada', 'mango', 'papaya', 'pina', 'aguacate', 'coco', 'calabaza'],
        'lacteo': ['leche', 'lacteo', 'lacteos', 'queso', 'yogur', 'yogurt', 'mantequilla', 'nata', 'crema', 'cuajada', 'requeson', 'ricotta', 'mascarpone', 'parmesano', 'gruyere', 'emmental', 'cheddar', 'brie', 'camembert', 'roquefort', 'cabrales', 'gorgonzola', 'manchego', 'tierno', 'semicurado', 'curado', 'viejo', 'fresco'],
        'huevo': ['huevo', 'huevos', 'clara', 'yema', 'yemas'],
        'panaderia': ['pan', 'panaderia', 'baguette', 'brioche', 'croissant', 'mollete', 'chapata', 'pita', 'naan', 'tortilla', 'panecillo', 'bollo'],
        'precocinado': ['precocinado', 'pre-cocinado', 'cocido', 'hervido', 'asado', 'horneado', 'caliente'],
        'congelado': ['congelado', 'ultracongelado', 'congelad', 'frozen', 'ice'],
    };
    
    // ========================================
    // FORMAT DETECTION (how it's presented)
    // ========================================
    const formatPatterns = {
        'entero': ['entero', 'entera', 'enters', 'enteras', 'completo', 'completa', 'sin partir', 'sin cortar', 'integro'],
        'mitad': ['mitad', 'medio', 'media', 'half', 'mitades'],
        'cuarto': ['cuarto', 'cuartos', 'quarter', 'quarters', '4 partes'],
        'dados': ['dado', 'dados', 'cubos', 'cubo', 'dice', 'dices', 'cuadritos', 'cuadrado'],
        'rodajas': ['rodaja', 'rodajas', 'slice', 'slices', 'tira', 'tiras', 'bandeja'],
        'lonchas': ['loncha', 'lonchas', 'lamina', 'laminas', 'flete', 'fletes'],
        'filetes': ['filete', 'filetes', 'filet', 'steak', 'steaks', 'bistec', 'bistecs'],
        'trozos': ['trozo', 'trozos', 'pedazo', 'pedazos', 'porcion', 'porciones', 'portion', 'portions', 'troceado', 'trocead', 'picado', 'picad'],
        'deshuesado': ['deshuesado', 'deshuesad', 'sin hueso', 'deshuesar', 'hueso', 'bone', 'boneless'],
        'pelado': ['pelado', 'pelad', 'sin piel', 'pelar', 'skin', 'skinned', 'mondado'],
        'vacio': ['vacio', 'vacia', 'al vacio', 'vaciar', 'vacuum'],
        'vivo': ['vivo', 'viva', 'vivoa', 'vivas'],
        'fresco': ['fresco', 'fresca', 'refrigerado', 'refrigerad', 'nevera', 'cold'],
        'envasado': ['envasado', 'pack', 'paquete', 'bolsa', 'bandeja', 'caja', 'tarro', 'bote'],
    };
    
    // ========================================
    // PROCESSED/RAW DETECTION
    // ========================================
    const processedPatterns = [
        'empanadilla', 'empanada', 'empanad', 'cocido', 'hervido', 'asado', 'horneado',
        'albondiga', 'albondigas', 'nugget', 'nuggets', 'croqueta', 'croquetas',
        'fileteado', 'filetead', 'rebanado', 'rebanad', 'preparado', 'preparad', 
        'receta', 'listo', 'cocinar', 'gourmet', 'cocinado', 'procesad',
        'salami', 'chorizo', 'iberico', 'jamon', 'paleta',
        'lacon', 'panceta', 'cecina', 'fuet', 'sobrasada', 'mortadela',
        'pate', 'foie', 'butifarra', 'morcilla', 'longaniza', 'cheddar',
        'manchego', 'queso', 'hamburguesa', 'salchicha', 'guiso', 'estofado',
        'carneada', 'cecina', 'beicon', 'tocino', 'salazon',
    ];
    
    // ========================================
    // MAIN INGREDIENT DETECTION (what's the base)
    // ========================================
    const ingredientPatterns = {
        'pollo': ['pollo', 'gallina', 'capon', 'pavo', 'codorniz'],
        'cerdo': ['cerdo', 'porcino', 'cochino', 'gorrino', 'iberico'],
        'vacuno': ['vacuno', 'ternera', 'res', 'buey', 'vaca', 'buey'],
        'cordero': ['cordero', 'cabra', 'cabrito'],
        'pescado_blanco': ['merluza', 'bacalao', 'lubina', 'dorada', 'rape', 'lenguado', 'rodaballo', 'pescada'],
        'pescado_azul': ['salmon', 'atun', 'bonito', 'sardina', 'caballa', 'jurel', 'chicharro'],
        'marisco': ['gamba', 'langostino', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'mejillon', 'almeja', 'pulpo', 'calamar', 'sepia'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'cebolla', 'ajo', 'zanahoria', 'pimiento', 'berenjena', 'calabacin', 'alcachofa', 'esparrago', 'esparragos', 'guisante', 'judia', 'habichuela', 'brocoli'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'platano', 'limon', 'kiwi', 'uva', 'sandia', 'melon', 'fresa'],
        'aguacate': ['aguacate', 'palta'],
    };
    
    // ========================================
    // EXECUTE DETECTION
    // ========================================
    let detectedCategory = 'otro';
    let detectedFormat = 'formato_estandar';
    let isProcessed = false;
    let mainIngredient = null;
    const textLower = text;
    
    // Detect category
    for (const [cat, keywords] of Object.entries(categoryPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            detectedCategory = cat;
            break;
        }
    }
    
    // Detect format
    for (const [fmt, keywords] of Object.entries(formatPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            detectedFormat = fmt;
            break;
        }
    }
    
    // Detect if processed
    if (processedPatterns.some(kw => textLower.includes(kw))) {
        isProcessed = true;
    }
    
    // Also check for raw indicators (if has these, likely NOT processed)
    const rawIndicators = ['fresco', 'entero', 'crudo', 'natural', 'vivo', 'sin elaborar'];
    const hasRawIndicator = rawIndicators.some(ind => textLower.includes(ind));
    if (hasRawIndicator && !isProcessed) {
        isProcessed = false;
    } else if (hasRawIndicator && processedPatterns.some(kw => textLower.includes(kw))) {
        // If has BOTH processed AND raw indicators, check context
        // "Pollo fresco" = raw, "Empanadillas de pollo" = processed
        const rawIndex = rawIndicators.findIndex(ind => textLower.includes(ind));
        const processedIndex = processedPatterns.findIndex(kw => textLower.includes(kw));
        // If raw comes first, likely raw product
        if (rawIndex < processedIndex && rawIndex >= 0) {
            isProcessed = false;
        }
    }
    
    // Detect main ingredient (useful for detecting "pollo" in "empanadillas de pollo")
    for (const [ing, keywords] of Object.entries(ingredientPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            mainIngredient = ing;
            break;
        }
    }
    
    return {
        category: detectedCategory,
        format: detectedFormat,
        isProcessed: isProcessed,
        mainIngredient: mainIngredient,
        originalText: name,
        words: words
    };
}

/**
 * Calculates semantic compatibility score between two products
 * Uses intelligent 3-level matching: Family > Attributes > Format
 */
function calculateSemanticScore(origProduct, candidate) {
    let score = 0;
    const reasons = [];

    const origName = (origProduct.NAME || '').trim();
    const candName = (candidate.NAME || '').trim();

    // Analyze product essences
    const origEssence = analyzeProductEssence(origName);
    const candEssence = analyzeProductEssence(candName);

    // ========================================
    // LEVEL 3: ADVANCED - Semantic Compatibility Check
    // ========================================

    // BONUS: If original is processed and candidate has the same main ingredient
    // Example: "Empanadillas de pollo" -> "Pollo entero" is a GOOD recommendation
    if (origEssence.isProcessed && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 50;
        reasons.push(`Ingrediente principal compatible: ${candEssence.mainIngredient}`);
    }

    // Check category incompatibility
    if (origEssence.category !== 'otro' && candEssence.category !== 'otro' &&
        origEssence.category !== candEssence.category) {

        // If both have categories but they're different, moderate penalty
        // But allow some category crossovers
        const allowedCrossovers = [
            ['carne', 'precocinado'],
            ['pescado', 'precocinado'],
            ['marisco', 'precocinado'],
            ['verdura', 'congelado'],
            ['fruta', 'congelado'],
            ['carne', 'congelado'],
            ['pescado', 'congelado'],
        ];

        const isAllowed = allowedCrossovers.some(([a, b]) =>
            (origEssence.category === a && candEssence.category === b) ||
            (origEssence.category === b && candEssence.category === a)
        );

        if (!isAllowed) {
            score -= 30;
            reasons.push(`Categoria diferente: ${candEssence.category}`);
        } else {
            score += 15;
            reasons.push(`Categoria compatible: ${origEssence.category} -> ${candEssence.category}`);
        }
    }

    // Raw vs Processed relationship (IMPORTANT: they can be complementary!)
    // If looking for PROCESSED and candidate is RAW with same ingredient -> GOOD MATCH
    if (origEssence.isProcessed && !candEssence.isProcessed &&
        origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 40;
        reasons.push(`Ingrediente base para producto elaborado`);
    }

    // If looking for RAW but candidate is PROCESSED with same ingredient -> also good
    if (!origEssence.isProcessed && candEssence.isProcessed &&
        origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 30;
        reasons.push(`Producto elaborado con mismo ingrediente`);
    }

    // Only penalize if formats are completely incompatible
    if (origEssence.format === 'vivo' && candEssence.format !== 'vivo' &&
        (!origEssence.mainIngredient || !candEssence.mainIngredient ||
         origEssence.mainIngredient !== candEssence.mainIngredient)) {
        score -= 40;
        reasons.push('Formato incompatible');
    }

    // ========================================
    // LEVEL 2: FORMAT COMPATIBILITY
    // ========================================
    if (origEssence.format === candEssence.format) {
        score += 30;
        reasons.push(`Mismo formato: ${origEssence.format}`);
    } else if (origEssence.format !== 'formato_estandar' && candEssence.format !== 'formato_estandar') {
        // Different but both have specific formats
        // Check if formats are compatible
        const compatibleFormats = [
            ['entero', 'mitad'],
            ['entero', 'cuarto'],
            ['mitad', 'cuarto'],
            ['dados', 'trozos'],
            ['filetes', 'trozos'],
            ['rodajas', 'lonchas'],
        ];
        
        const isCompatible = compatibleFormats.some(([a, b]) => 
            (origEssence.format === a && candEssence.format === b) ||
            (origEssence.format === b && candEssence.format === a)
        );
        
        if (isCompatible) {
            score += 15;
            reasons.push(`Formato compatible: ${origEssence.format} -> ${candEssence.format}`);
        } else {
            score -= 5;
            reasons.push(`Formato diferente: ${origEssence.format} vs ${candEssence.format}`);
        }
    }
    
    // ========================================
    // LEVEL 1: FAMILY HIERARCHY
    // ========================================
    if (candidate.FAMILIA === origProduct.FAMILIA) {
        score += 25;
        reasons.push('Misma familia');
    }

    if (candidate.SUBFAMILIA && origProduct.SUBFAMILIA && 
        candidate.SUBFAMILIA === origProduct.SUBFAMILIA) {
        score += 40;
        reasons.push('Misma subfamilia');
    }

    if (candidate.GRUPO && origProduct.GRUPO && 
        candidate.GRUPO === origProduct.GRUPO) {
        score += 15;
        reasons.push('Mismo grupo');
    }

    if (candidate.MARCA && origProduct.MARCA && 
        candidate.MARCA === origProduct.MARCA) {
        score += 10;
        reasons.push('Misma marca');
    }
    
    // ========================================
    // LEVEL 2: Technical fields matching
    // ========================================
    if (candidate.TIPO && origProduct.TIPO && 
        candidate.TIPO === origProduct.TIPO) {
        score += 12;
        reasons.push('Mismo tipo');
    }

    if (candidate.FORMATO && origProduct.FORMATO && 
        candidate.FORMATO === origProduct.FORMATO) {
        score += 8;
    }

    if (candidate.PRESENTACION && origProduct.PRESENTACION && 
        candidate.PRESENTACION === origProduct.PRESENTACION) {
        score += 5;
    }

    // ========================================
    // BONUS: Same main ingredient
    // ========================================
    // Bug fix: la variable origHasCandidateIngredient no existia, lanzaba
    // ReferenceError y los productos con mainIngredient devolvian [].
    // Evitamos doble-conteo si LEVEL 3 (linea ~3579) ya bonifico
    // ingrediente principal compatible.
    const alreadyScoredMainIngredient = origEssence.isProcessed &&
        origEssence.mainIngredient === candEssence.mainIngredient;
    if (origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient &&
        !alreadyScoredMainIngredient) {
        score += 20;
        reasons.push(`Mismo ingrediente base: ${candEssence.mainIngredient}`);
    }
    
    // ========================================
    // BONUS: Product type compatibility
    // ========================================
    if (origEssence.isProcessed === candEssence.isProcessed) {
        score += 10;
        if (origEssence.isProcessed) {
            reasons.push('Ambos son productos elaborados');
        } else {
            reasons.push('Ambos son productos frescos/crudos');
        }
    }

    const compatible = score > -30;
    return { score, reasons, level: 'advanced', compatible };
}

/**
 * Finds products similar to the given one using intelligent 3-level matching.
 * Level 1 (Basic): Family and Subfamily priority
 * Level 2 (Intermediate): Compare Attributes and Format
 * Level 3 (Advanced): Understand semantic intent (raw vs elaborated)
 */
async function getSimilarProducts(productCode) {
    const code = (productCode || '').trim();
    if (!code) return [];

    const cacheKey = `pedidos:similar_v3:${code}`;
    
    try {
        // 1. Get original product attributes
        const sqlOriginal = `
            SELECT TRIM(CODIGOFAMILIA) AS FAMILIA,
                   TRIM(CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(CODIGOMARCA) AS MARCA,
                   TRIM(COALESCE(CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(CODIGOTIPO, '')) AS TIPO,
                   TRIM(DESCRIPCIONARTICULO) AS DESCRIPTION
            FROM ${comercialErpTable('ART')} WHERE TRIM(CODIGOARTICULO) = ?
        `;
        const origRows = await queryWithParams(sqlOriginal, [code]);
        if (!origRows || origRows.length === 0) return [];
        const orig = origRows[0];

        // 2. Fetch candidates from the SAME FAMILY that have stock
        const sqlCandidates = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM ${comercialErpTable('ART')} B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM ${comercialErpTable('ARO')}
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
                JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARA')} T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
        `;
        let rows = await cachedQuery(
            (s) => queryWithParams(s, [orig.FAMILIA, code]),
            sqlCandidates, cacheKey, TTL.SHORT
        );

        // 2b. FALLBACK: If no candidates in same family, expand to subfamilia across all families
        if ((!rows || rows.length === 0) && orig.SUBFAMILIA) {
            const sqlFallback = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM ${comercialErpTable('ART')} B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM ${comercialErpTable('ARO')}
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
                JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARA')} T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOSUBFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
            FETCH FIRST 30 ROWS ONLY
            `;
            const fallbackKey = `pedidos:similar_v3_fallback:${code}`;
            rows = await cachedQuery(
                (s) => queryWithParams(s, [orig.SUBFAMILIA, code]),
                sqlFallback, fallbackKey, TTL.SHORT
            );
            logger.info(`[PEDIDOS] getSimilarProducts fallback: subfamilia=${orig.SUBFAMILIA}, found ${(rows || []).length} candidates`);
        }

        // 3. Apply intelligent 3-level scoring
        const scored = [];
        
        for (const r of rows) {
            const candidate = {
                NAME: r.NAME,
                DESCRIPTION: r.NAME, // Use name as description for keyword analysis
                FAMILIA: r.FAMILIA,
                SUBFAMILIA: r.SUBFAMILIA,
                GRUPO: r.GRUPO,
                MARCA: r.MARCA,
                FORMATO: r.FORMATO,
                PRESENTACION: r.PRESENTACION,
                TIPO: r.TIPO
            };
            
            const origProduct = {
                NAME: orig.DESCRIPTION,
                DESCRIPTION: orig.DESCRIPTION,
                FAMILIA: orig.FAMILIA,
                SUBFAMILIA: orig.SUBFAMILIA,
                GRUPO: orig.GRUPO,
                MARCA: orig.MARCA,
                FORMATO: orig.FORMATO,
                PRESENTACION: orig.PRESENTACION,
                TIPO: orig.TIPO
            };
            
            const { score, reasons, compatible } = calculateSemanticScore(origProduct, candidate);

            // Improved threshold: accept products with score > -30 or same family
            const sameFamily = candidate.FAMILIA === origProduct.FAMILIA;
            const sameSubfamily = candidate.SUBFAMILIA && origProduct.SUBFAMILIA &&
                                  candidate.SUBFAMILIA === origProduct.SUBFAMILIA;
            
            // Always include if same subfamily, otherwise check score
            if (sameSubfamily || sameFamily || score > -30) {
                scored.push({
                    code: (r.CODE || '').trim(),
                    name: (r.NAME || '').trim(),
                    brand: (r.MARCA || '').trim(),
                    family: (r.FAMILIA || '').trim(),
                    subfamily: (r.SUBFAMILIA || '').trim(),
                    stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
                    stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
                    precio: parseFloat(r.PRECIO) || 0,
                    similarityScore: Math.max(0, score),
                    matchReasons: reasons.length > 0 ? reasons : (sameSubfamily ? ['Misma subfamilia'] : ['Misma familia'])
                });
            }
        }
        
        // 4. Sort and limit to top 10
        scored.sort((a, b) => b.similarityScore - a.similarityScore || b.stockEnvases - a.stockEnvases);
        return scored.slice(0, 10);
    } catch (error) {
        logger.error(`[PEDIDOS] getSimilarProducts error for ${code}: ${error.message}`);
        return [];
    }
}
module.exports = {
    getComplementaryProducts,
    analyzeProductEssence,
    calculateSemanticScore,
    getSimilarProducts,
};
