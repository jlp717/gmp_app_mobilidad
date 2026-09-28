// similarity-essence.js — split de similarity.js: analisis de esencia + score semantico (puro, sin DB).
// Codigo movido verbatim.

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

module.exports = {
    analyzeProductEssence,
    calculateSemanticScore,
};
