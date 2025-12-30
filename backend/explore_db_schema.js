/**
 * Database Exploration Script - Deep Analysis
 * 
 * PURPOSE: Explore all schemas and tables to find:
 * - Unit price fields (PVP, precio unitario)
 * - Discount fields (descuento, % descuento)
 * - Quantity/units fields (unidades, kg, cantidad)
 * - Client-specific pricing
 * 
 * IMPORTANT: DO NOT RUN THIS SCRIPT. It's for manual inspection.
 * Copy individual queries to your SQL client.
 */

const EXPLORATION_QUERIES = {

    // ============================================================================
    // STEP 1: List all schemas and tables
    // ============================================================================

    "1_List_Schemas": `
    SELECT DISTINCT TABSCHEMA as SCHEMA_NAME
    FROM SYSCAT.TABLES
    WHERE TABSCHEMA NOT LIKE 'SYS%'
    ORDER BY TABSCHEMA
  `,

    "2_List_Tables_in_DSEDAC": `
    SELECT TABNAME, TYPE, CARD, REMARKS
    FROM SYSCAT.TABLES
    WHERE TABSCHEMA = 'DSEDAC'
    ORDER BY TABNAME
  `,

    // ============================================================================
    // STEP 2: Explore LAC (Line Items / Sales Lines) - Main transaction table
    // ============================================================================

    "3_LAC_All_Columns": `
    SELECT COLNAME, TYPENAME, LENGTH, SCALE, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'LAC'
    ORDER BY COLNO
  `,

    "4_LAC_Sample_Data": `
    SELECT *
    FROM DSEDAC.LAC
    FETCH FIRST 10 ROWS ONLY
  `,

    "5_LAC_Search_Price_Fields": `
    SELECT COLNAME, TYPENAME, LENGTH, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'LAC'
      AND (
        UPPER(COLNAME) LIKE '%PRECIO%'
        OR UPPER(COLNAME) LIKE '%IMPORTE%'
        OR UPPER(COLNAME) LIKE '%PVP%'
        OR UPPER(COLNAME) LIKE '%DESCUENTO%'
        OR UPPER(COLNAME) LIKE '%DTO%'
        OR UPPER(COLNAME) LIKE '%UNIT%'
        OR UPPER(COLNAME) LIKE '%CANT%'
        OR UPPER(COLNAME) LIKE '%KG%'
        OR UPPER(COLNAME) LIKE '%TARIF%'
        OR UPPER(COLNAME) LIKE '%BASE%'
      )
    ORDER BY COLNAME
  `,

    // ============================================================================
    // STEP 3: Explore ART (Articles/Products) table
    // ============================================================================

    "6_ART_All_Columns": `
    SELECT COLNAME, TYPENAME, LENGTH, SCALE, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'ART'
    ORDER BY COLNO
  `,

    "7_ART_Search_Price_Fields": `
    SELECT COLNAME, TYPENAME, LENGTH, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'ART'
      AND (
        UPPER(COLNAME) LIKE '%PRECIO%'
        OR UPPER(COLNAME) LIKE '%PVP%'
        OR UPPER(COLNAME) LIKE '%TARIFA%'
        OR UPPER(COLNAME) LIKE '%COSTE%'
        OR UPPER(COLNAME) LIKE '%UNIDAD%'
      )
    ORDER BY COLNAME
  `,

    "8_ART_Sample_With_Prices": `
    SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, 
           CODIGOFAMILIA, CODIGOSUBFAMILIA
           -- Add more columns once you know their names from query 6
    FROM DSEDAC.ART
    FETCH FIRST 10 ROWS ONLY
  `,

    // ============================================================================
    // STEP 4: Look for Client-Specific Pricing Tables
    // ============================================================================

    "9_Find_Discount_Tables": `
    SELECT TABNAME, REMARKS
    FROM SYSCAT.TABLES
    WHERE TABSCHEMA = 'DSEDAC'
      AND (
        UPPER(TABNAME) LIKE '%DESC%'
        OR UPPER(TABNAME) LIKE '%DTO%'
        OR UPPER(TABNAME) LIKE '%PREC%'
        OR UPPER(TABNAME) LIKE '%TARIF%'
        OR UPPER(TABNAME) LIKE '%COND%'
        OR UPPER(TABNAME) LIKE '%BONIF%'
        OR UPPER(TABNAME) LIKE '%PROM%'
        OR UPPER(TABNAME) LIKE '%ESP%'
      )
    ORDER BY TABNAME
  `,

    // ============================================================================
    // STEP 5: CLI (Clients) - Check for discount/pricing fields
    // ============================================================================

    "10_CLI_All_Columns": `
    SELECT COLNAME, TYPENAME, LENGTH, SCALE, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'CLI'
    ORDER BY COLNO
  `,

    "11_CLI_Search_Discount_Fields": `
    SELECT COLNAME, TYPENAME, LENGTH, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'CLI'
      AND (
        UPPER(COLNAME) LIKE '%DESC%'
        OR UPPER(COLNAME) LIKE '%DTO%'
        OR UPPER(COLNAME) LIKE '%TARIF%'
        OR UPPER(COLNAME) LIKE '%PREC%'
        OR UPPER(COLNAME) LIKE '%TIPO%'
        OR UPPER(COLNAME) LIKE '%COND%'
        OR UPPER(COLNAME) LIKE '%GRUP%'
      )
    ORDER BY COLNAME
  `,

    // ============================================================================
    // STEP 6: Explore potential pricing/discount junction tables
    // ============================================================================

    "12_All_Tables_With_Columns": `
    SELECT T.TABNAME, T.CARD as ROW_COUNT,
           (SELECT COUNT(*) FROM SYSCAT.COLUMNS C WHERE C.TABSCHEMA = T.TABSCHEMA AND C.TABNAME = T.TABNAME) as COL_COUNT
    FROM SYSCAT.TABLES T
    WHERE T.TABSCHEMA = 'DSEDAC'
      AND T.TYPE = 'T'
    ORDER BY T.TABNAME
  `,

    // ============================================================================
    // STEP 7: LAC detailed analysis with actual values
    // ============================================================================

    "13_LAC_Detailed_Sample": `
    SELECT 
      CODIGOARTICULO,
      CODIGOCLIENTEALBARAN,
      IMPORTEVENTA,
      IMPORTECOSTO,
      CANTIDADUNIDADES,
      -- Calculate unit price
      CASE WHEN CANTIDADUNIDADES > 0 THEN IMPORTEVENTA / CANTIDADUNIDADES ELSE 0 END as PRECIO_UNITARIO_CALCULADO,
      CASE WHEN CANTIDADUNIDADES > 0 THEN IMPORTECOSTO / CANTIDADUNIDADES ELSE 0 END as COSTE_UNITARIO_CALCULADO
      -- Add other columns once identified
    FROM DSEDAC.LAC
    WHERE CANTIDADUNIDADES > 0
    FETCH FIRST 20 ROWS ONLY
  `,

    // ============================================================================
    // STEP 8: Check if there's a TARIFAS (Price List) table
    // ============================================================================

    "14_Find_TARIFAS_Tables": `
    SELECT TABSCHEMA, TABNAME, CARD, REMARKS
    FROM SYSCAT.TABLES
    WHERE TABSCHEMA NOT LIKE 'SYS%'
      AND (
        UPPER(TABNAME) LIKE '%TARIF%'
        OR UPPER(TABNAME) LIKE '%LIST%'
        OR UPPER(TABNAME) LIKE '%PRECIO%'
      )
    ORDER BY TABSCHEMA, TABNAME
  `,

    // ============================================================================
    // STEP 9: Explore DSEMOVIL schema if exists
    // ============================================================================

    "15_DSEMOVIL_Tables": `
    SELECT TABNAME, TYPE, CARD, REMARKS
    FROM SYSCAT.TABLES
    WHERE TABSCHEMA = 'DSEMOVIL'
    ORDER BY TABNAME
  `,

    "16_DSEMOVIL_Search_Price_Tables": `
    SELECT T.TABNAME, T.CARD
    FROM SYSCAT.TABLES T
    WHERE T.TABSCHEMA = 'DSEMOVIL'
      AND (
        UPPER(T.TABNAME) LIKE '%PREC%'
        OR UPPER(T.TABNAME) LIKE '%TARIF%'
        OR UPPER(T.TABNAME) LIKE '%DESC%'
        OR UPPER(T.TABNAME) LIKE '%DTO%'
        OR UPPER(T.TABNAME) LIKE '%ART%'
      )
    ORDER BY T.TABNAME
  `,

    // ============================================================================
    // STEP 10: Look at specific transaction to understand pricing
    // ============================================================================

    "17_Single_Transaction_Analysis": `
    -- Pick one client and one product to analyze pricing
    SELECT 
      L.CODIGOARTICULO,
      L.CODIGOCLIENTEALBARAN,
      L.ANODOCUMENTO,
      L.MESDOCUMENTO,
      L.IMPORTEVENTA,
      L.IMPORTECOSTO,
      L.CANTIDADUNIDADES,
      A.DESCRIPCIONARTICULO,
      -- Calculate unit price
      CASE WHEN L.CANTIDADUNIDADES > 0 
           THEN L.IMPORTEVENTA / L.CANTIDADUNIDADES 
           ELSE 0 END as PRECIO_UNITARIO
    FROM DSEDAC.LAC L
    LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
    WHERE L.CODIGOCLIENTEALBARAN = '4300010080'
      AND L.ANODOCUMENTO = 2025
    ORDER BY L.MESDOCUMENTO, A.DESCRIPCIONARTICULO
    FETCH FIRST 50 ROWS ONLY
  `,

    // ============================================================================
    // STEP 11: Check for DESCUENTO columns in LAC
    // ============================================================================

    "18_All_LAC_Columns_Full": `
    SELECT COLNO, COLNAME, TYPENAME, LENGTH, SCALE, NULLS, DEFAULT, REMARKS
    FROM SYSCAT.COLUMNS
    WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'LAC'
    ORDER BY COLNO
  `
};

// Export for reference
console.log("=".repeat(80));
console.log("DATABASE EXPLORATION SCRIPT");
console.log("=".repeat(80));
console.log("\nIMPORTANT: DO NOT RUN THIS SCRIPT DIRECTLY.");
console.log("Copy individual queries to your SQL client (e.g., DBeaver, SQL Squirrel).\n");
console.log("QUERIES TO RUN:");
console.log("-".repeat(80));

Object.keys(EXPLORATION_QUERIES).forEach((key, index) => {
    console.log(`\n${index + 1}. ${key}:`);
    console.log(`   ${EXPLORATION_QUERIES[key].trim().split('\n')[0]}...`);
});

console.log("\n" + "=".repeat(80));
console.log("After identifying the relevant columns, update server.js to include:");
console.log("- IMPORTEBRUTO or PRECIOBASE (base price before discount)");
console.log("- DESCUENTO or PORCENTAJEDESCUENTO (discount amount/percentage)");
console.log("- UNIDADESKG or similar (units in KG if applicable)");
console.log("=".repeat(80));

module.exports = EXPLORATION_QUERIES;
