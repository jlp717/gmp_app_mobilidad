/**
 * test_signature_flow.js
 * 
 * Script de diagnóstico y prueba del flujo completo de firmas:
 *   1. Explora CACFIRMAS (columnas reales, datos por año)
 *   2. Audita DELIVERY_STATUS (firmas existentes, archivos en disco)
 *   3. Audita filesystem (uploads/photos/ y subdirectorios)
 *   4. Simula el flujo completo: guardar firma → leer firma (cascada)
 *   5. Explora CACCL1 campos DIAFIRMA/MESFIRMA/ANOFIRMA/HORAFIRMA
 *   6. Limpia los datos de prueba
 * 
 * Ejecución: node backend/scripts/test_signature_flow.js
 */

const path = require('path');
const fs = require('fs');

// DB2 connection
const dbConfigPath = path.join(__dirname, '../config/db.js');
const { query } = require(dbConfigPath);

// Directories (same as routes use)
const uploadsDir = path.join(__dirname, '../../uploads');
const photosDir = path.join(__dirname, '../../uploads/photos');

// Test data constants
const TEST_ALB_ID = '9999-T-0-999999'; // Impossible real albaran
const TEST_FIRMA_RELATIVE_PATH = '_TEST/FIRMA_TEST_FLOW.png';

// A tiny valid 1x1 red PNG in base64 (89 bytes decoded)
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const SEP = '═'.repeat(70);
const SEP2 = '─'.repeat(70);

async function main() {
    console.log(SEP);
    console.log('  TEST SIGNATURE FLOW — Diagnóstico completo');
    console.log(SEP);
    console.log(`  Timestamp: ${new Date().toISOString()}`);
    console.log(`  uploads dir: ${uploadsDir}`);
    console.log(`  photos dir:  ${photosDir}`);
    console.log();

    // ═══════════════════════════════════════════════════════════════
    // SECTION 1: CACFIRMAS — Explorar datos reales
    // ═══════════════════════════════════════════════════════════════
    console.log(SEP);
    console.log('  1. CACFIRMAS — Datos por año (EJERCICIOALBARAN)');
    console.log(SEP);

    try {
        // 1a. Count rows per year
        const yearCounts = await query(`
            SELECT EJERCICIOALBARAN as ANO, COUNT(*) as TOTAL,
                   SUM(CASE WHEN FIRMABASE64 IS NOT NULL AND LENGTH(FIRMABASE64) > 10 THEN 1 ELSE 0 END) as CON_IMAGEN,
                   SUM(CASE WHEN TRIM(FIRMANOMBRE) <> '' AND FIRMANOMBRE IS NOT NULL THEN 1 ELSE 0 END) as CON_NOMBRE,
                   SUM(CASE WHEN TRIM(FIRMADNI) <> '' AND FIRMADNI IS NOT NULL THEN 1 ELSE 0 END) as CON_DNI
            FROM DSEDAC.CACFIRMAS
            GROUP BY EJERCICIOALBARAN
            ORDER BY EJERCICIOALBARAN DESC
        `, false);
        console.log(`  Filas por año:`);
        yearCounts.forEach(r => {
            console.log(`    ${r.ANO}: ${r.TOTAL} total | ${r.CON_IMAGEN} con imagen | ${r.CON_NOMBRE} con nombre | ${r.CON_DNI} con DNI`);
        });

        // 1b. Sample recent rows (if any exist for 2024+)
        const recentSample = await query(`
            SELECT EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
                   TRIM(FIRMANOMBRE) as FIRMANOMBRE, TRIM(FIRMADNI) as FIRMADNI,
                   DIA, MES, ANO, HORA,
                   LENGTH(FIRMABASE64) as FIRMA_LEN,
                   TRIM(CODIGOVENDEDOR) as VENDEDOR
            FROM DSEDAC.CACFIRMAS
            WHERE EJERCICIOALBARAN >= 2024
            ORDER BY EJERCICIOALBARAN DESC, MES DESC, DIA DESC
            FETCH FIRST 10 ROWS ONLY
        `, false);
        if (recentSample.length > 0) {
            console.log(`\n  Muestra reciente (2024+): ${recentSample.length} filas`);
            recentSample.forEach(r => {
                console.log(`    Alb ${r.EJERCICIOALBARAN}-${(r.SERIEALBARAN||'').trim()}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN} | Fecha: ${r.DIA}/${r.MES}/${r.ANO} ${r.HORA} | Vendedor: ${r.VENDEDOR} | Nombre: "${r.FIRMANOMBRE}" | DNI: "${r.FIRMADNI}" | Imagen: ${r.FIRMA_LEN || 0} bytes`);
            });
        } else {
            console.log(`\n  ⚠️  NO hay filas en CACFIRMAS para 2024+`);
        }

        // 1c. Total count
        const totalCount = await query(`SELECT COUNT(*) as T FROM DSEDAC.CACFIRMAS`, false);
        console.log(`\n  Total CACFIRMAS: ${totalCount[0]?.T || 0} filas`);

    } catch (e) {
        console.log(`  ❌ Error CACFIRMAS: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 2: DELIVERY_STATUS — Auditoría completa
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  2. DELIVERY_STATUS — Auditoría de firmas guardadas');
    console.log(SEP);

    try {
        const dsRows = await query(`
            SELECT ID, STATUS, TRIM(FIRMA_PATH) as FIRMA_PATH, REPARTIDOR_ID, 
                   UPDATED_AT, LATITUD, LONGITUD,
                   LENGTH(TRIM(OBSERVACIONES)) as OBS_LEN
            FROM JAVIER.DELIVERY_STATUS
            ORDER BY UPDATED_AT DESC
            FETCH FIRST 50 ROWS ONLY
        `, false);

        console.log(`  Total filas: ${dsRows.length}`);
        console.log(SEP2);

        let filesFound = 0;
        let filesMissing = 0;
        let noFirma = 0;

        dsRows.forEach((r, i) => {
            const firmaPath = (r.FIRMA_PATH || '').trim();
            let fileStatus = '';

            if (!firmaPath || firmaPath === '') {
                fileStatus = '📭 SIN FIRMA';
                noFirma++;
            } else {
                // Check if file exists at expected locations
                const paths = [
                    path.join(uploadsDir, firmaPath),
                    path.join(photosDir, firmaPath),
                    path.join(photosDir, path.basename(firmaPath)) // flat in photos/
                ];
                const found = paths.find(p => fs.existsSync(p));
                if (found) {
                    const stats = fs.statSync(found);
                    fileStatus = `✅ EXISTE (${stats.size} bytes) → ${found}`;
                    filesFound++;
                } else {
                    fileStatus = `❌ NO EXISTE → buscado en: ${paths.join(' | ')}`;
                    filesMissing++;
                }
            }

            console.log(`  [${i + 1}] ${r.ID} | ${r.STATUS} | Rep: ${r.REPARTIDOR_ID} | ${r.UPDATED_AT}`);
            console.log(`       FIRMA_PATH: "${firmaPath}"`);
            console.log(`       Archivo: ${fileStatus}`);
        });

        console.log(SEP2);
        console.log(`  Resumen: ${filesFound} archivos encontrados | ${filesMissing} faltan | ${noFirma} sin firma`);

    } catch (e) {
        console.log(`  ❌ Error DELIVERY_STATUS: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 3: Filesystem — Archivos de firma en disco
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  3. Filesystem — Archivos en uploads/photos/');
    console.log(SEP);

    try {
        function listFilesRecursive(dir, prefix = '') {
            const entries = [];
            if (!fs.existsSync(dir)) {
                console.log(`  ⚠️  Directorio no existe: ${dir}`);
                return entries;
            }
            const items = fs.readdirSync(dir, { withFileTypes: true });
            items.forEach(item => {
                const fullPath = path.join(dir, item.name);
                const relPath = prefix ? `${prefix}/${item.name}` : item.name;
                if (item.isDirectory()) {
                    entries.push(...listFilesRecursive(fullPath, relPath));
                } else {
                    const stats = fs.statSync(fullPath);
                    entries.push({ name: relPath, size: stats.size, modified: stats.mtime });
                }
            });
            return entries;
        }

        const allFiles = listFilesRecursive(photosDir);
        console.log(`  Total archivos en ${photosDir}: ${allFiles.length}`);
        console.log(SEP2);

        // Group by directory
        const byDir = {};
        allFiles.forEach(f => {
            const dir = path.dirname(f.name);
            if (!byDir[dir]) byDir[dir] = [];
            byDir[dir].push(f);
        });

        Object.keys(byDir).sort().forEach(dir => {
            const files = byDir[dir];
            console.log(`\n  📁 ${dir === '.' ? '(raíz)' : dir}/ — ${files.length} archivo(s)`);
            files.forEach(f => {
                const isSig = f.name.toLowerCase().includes('firma') || f.name.toLowerCase().includes('sig');
                const icon = isSig ? '🖊️' : '📄';
                console.log(`    ${icon} ${f.name} (${f.size} bytes) — ${f.modified.toISOString().slice(0, 19)}`);
            });
        });
    } catch (e) {
        console.log(`  ❌ Error filesystem: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 4: CACCL1 — Campos de firma del ERP
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  4. CACCL1 — Campos DIAFIRMA/MESFIRMA/ANOFIRMA/HORAFIRMA');
    console.log(SEP);

    try {
        // 4a. Count rows with firma data per year
        const cl1Years = await query(`
            SELECT ANOFIRMA, COUNT(*) as TOTAL,
                   SUM(CASE WHEN ANOFIRMA > 0 THEN 1 ELSE 0 END) as CON_FECHA
            FROM DSEDAC.CACCL1
            WHERE ANOFIRMA > 0
            GROUP BY ANOFIRMA
            ORDER BY ANOFIRMA DESC
            FETCH FIRST 10 ROWS ONLY
        `, false);
        if (cl1Years.length > 0) {
            console.log(`  Filas con firma (ANOFIRMA > 0) por año:`);
            cl1Years.forEach(r => {
                console.log(`    ${r.ANOFIRMA}: ${r.TOTAL} filas`);
            });
        } else {
            console.log(`  ⚠️  NO hay filas con ANOFIRMA > 0`);
        }

        // 4b. Sample recent
        const cl1Sample = await query(`
            SELECT ANOFIRMA, MESFIRMA, DIAFIRMA, HORAFIRMA,
                   TRIM(CODIGOVENDEDOR) as VENDEDOR,
                   TRIM(CODIGOCLIENTE) as CLIENTE,
                   EJERCICIO, SERIE, TERMINAL, NUMERO
            FROM DSEDAC.CACCL1
            WHERE ANOFIRMA >= 2024
            ORDER BY ANOFIRMA DESC, MESFIRMA DESC, DIAFIRMA DESC
            FETCH FIRST 10 ROWS ONLY
        `, false);
        if (cl1Sample.length > 0) {
            console.log(`\n  Muestra reciente (ANOFIRMA >= 2024): ${cl1Sample.length}`);
            cl1Sample.forEach(r => {
                console.log(`    Alb ${r.EJERCICIO}-${(r.SERIE||'').trim()}-${r.TERMINAL}-${r.NUMERO} | FirmaFecha: ${r.DIAFIRMA}/${r.MESFIRMA}/${r.ANOFIRMA} ${r.HORAFIRMA} | Vend: ${r.VENDEDOR} | Cli: ${r.CLIENTE}`);
            });
        } else {
            console.log(`\n  ⚠️  NO hay firmas en CACCL1 para 2024+`);
        }
    } catch (e) {
        console.log(`  ❌ Error CACCL1: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 5: CLIENT_SIGNERS — Firmantes guardados
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  5. CLIENT_SIGNERS — Firmantes registrados');
    console.log(SEP);

    try {
        const signers = await query(`
            SELECT TRIM(CODIGOCLIENTE) as CLI, TRIM(DNI) as DNI, TRIM(NOMBRE) as NOMBRE,
                   LAST_USED, USAGE_COUNT
            FROM JAVIER.CLIENT_SIGNERS
            ORDER BY LAST_USED DESC
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log(`  Total firmantes: ${signers.length}`);
        signers.forEach(r => {
            console.log(`    CLI ${r.CLI} | DNI: ${r.DNI} | Nombre: ${r.NOMBRE} | Últ. uso: ${r.LAST_USED} | Veces: ${r.USAGE_COUNT}`);
        });
    } catch (e) {
        console.log(`  ❌ Error CLIENT_SIGNERS: ${e.message}`);
        if (e.message.includes('SQL0204')) {
            console.log(`  ℹ️  Tabla no existe aún — se crea al usar la app por primera vez`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 6: REPARTIDOR_FIRMAS — Tabla directa de firmas
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  6. REPARTIDOR_FIRMAS — Firmas almacenadas en BD');
    console.log(SEP);

    try {
        const rfCount = await query(`SELECT COUNT(*) as T FROM JAVIER.REPARTIDOR_FIRMAS`, false);
        console.log(`  Total filas: ${rfCount[0]?.T || 0}`);

        if ((rfCount[0]?.T || 0) > 0) {
            const rfSample = await query(`
                SELECT ENTREGA_ID, FIRMANTE_NOMBRE, FIRMANTE_DNI, FECHA_FIRMA,
                       LENGTH(FIRMA_BASE64) as FIRMA_LEN
                FROM JAVIER.REPARTIDOR_FIRMAS
                ORDER BY FECHA_FIRMA DESC
                FETCH FIRST 10 ROWS ONLY
            `, false);
            rfSample.forEach(r => {
                console.log(`    Entrega: ${r.ENTREGA_ID} | Firmante: ${r.FIRMANTE_NOMBRE} | DNI: ${r.FIRMANTE_DNI} | Fecha: ${r.FECHA_FIRMA} | Img: ${r.FIRMA_LEN} bytes`);
            });
        } else {
            console.log(`  ⚠️  Tabla vacía — el flujo principal no usa esta tabla`);
            console.log(`  ℹ️  El flujo real guarda en: DELIVERY_STATUS.FIRMA_PATH + archivo PNG`);
        }
    } catch (e) {
        console.log(`  ❌ Error REPARTIDOR_FIRMAS: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 7: SIMULATION — Flujo completo de firma
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  7. SIMULACIÓN — Flujo completo guardar → leer firma');
    console.log(SEP);

    let testCleanup = { file: null, deliveryStatus: false };

    try {
        // ── PASO 1: Crear archivo de firma de prueba ──
        console.log('\n  PASO 1: Guardar archivo de firma en disco');
        const testDir = path.join(photosDir, '_TEST');
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        const testFilePath = path.join(photosDir, TEST_FIRMA_RELATIVE_PATH);
        const imgBuffer = Buffer.from(TEST_PNG_BASE64, 'base64');
        fs.writeFileSync(testFilePath, imgBuffer);
        testCleanup.file = testFilePath;

        if (fs.existsSync(testFilePath)) {
            const stats = fs.statSync(testFilePath);
            console.log(`    ✅ Archivo creado: ${testFilePath} (${stats.size} bytes)`);
        } else {
            throw new Error('Archivo no se creó');
        }

        // ── PASO 2: Insertar en DELIVERY_STATUS ──
        console.log('\n  PASO 2: Insertar en DELIVERY_STATUS');
        // Clean up any existing test row first
        await query(`DELETE FROM JAVIER.DELIVERY_STATUS WHERE ID = '${TEST_ALB_ID}'`, false);

        await query(`
            INSERT INTO JAVIER.DELIVERY_STATUS 
            (ID, STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, UPDATED_AT)
            VALUES ('${TEST_ALB_ID}', 'ENTREGADO', 'TEST SIGNATURE FLOW', '${TEST_FIRMA_RELATIVE_PATH}', 0, 0, 'TEST', CURRENT TIMESTAMP)
        `, false);
        testCleanup.deliveryStatus = true;
        console.log(`    ✅ Insertado DELIVERY_STATUS: ID='${TEST_ALB_ID}', FIRMA_PATH='${TEST_FIRMA_RELATIVE_PATH}'`);

        // Verify insertion
        const verifyInsert = await query(`SELECT ID, STATUS, FIRMA_PATH, REPARTIDOR_ID FROM JAVIER.DELIVERY_STATUS WHERE ID = '${TEST_ALB_ID}'`, false);
        if (verifyInsert.length > 0) {
            console.log(`    ✅ Verificado: ${JSON.stringify(verifyInsert[0])}`);
        } else {
            throw new Error('Insert no se verificó');
        }

        // ── PASO 3: Simular la cascada de lectura (como /history/signature) ──
        console.log('\n  PASO 3: Simular cascada de lectura');

        // Step 3a: Check DELIVERY_STATUS
        console.log('    3a. DELIVERY_STATUS → FIRMA_PATH...');
        const dsCheck = await query(`SELECT FIRMA_PATH FROM JAVIER.DELIVERY_STATUS WHERE ID = '${TEST_ALB_ID}'`, false);
        const firmaPath = dsCheck.length > 0 ? (dsCheck[0].FIRMA_PATH || '').trim() : null;
        console.log(`        FIRMA_PATH = "${firmaPath}"`);

        // Step 3b: REPARTIDOR_FIRMAS (should find nothing for test ID)
        console.log('    3b. REPARTIDOR_FIRMAS → (no debería encontrar nada)...');
        let firmaBase64 = null;
        try {
            // Parse albaran ID parts (9999-T-0-999999)
            const parts = TEST_ALB_ID.split('-');
            const rfCheck = await query(`
                SELECT RF.FIRMA_BASE64
                FROM JAVIER.REPARTIDOR_FIRMAS RF
                INNER JOIN JAVIER.REPARTIDOR_ENTREGAS RE ON RE.ID = RF.ENTREGA_ID
                WHERE RE.NUMERO_ALBARAN = ${parts[3]}
                  AND RE.EJERCICIO_ALBARAN = ${parts[0]}
                  AND TRIM(RE.SERIE_ALBARAN) = '${parts[1]}'
                FETCH FIRST 1 ROW ONLY
            `, false);
            console.log(`        Resultado: ${rfCheck.length} filas (esperado: 0)`);
        } catch (e) {
            console.log(`        Error (esperado si REPARTIDOR_ENTREGAS no existe): ${e.message.substring(0, 80)}`);
        }

        // Step 3c: Read file from disk (this is the real test!)
        console.log('    3c. Lectura de archivo desde FIRMA_PATH...');
        if (firmaPath) {
            const basePaths = [
                path.join(__dirname, '../../uploads'),
                path.join(__dirname, '../../uploads/photos')
            ];
            let foundFile = false;
            for (const basePath of basePaths) {
                const fullPath = path.join(basePath, firmaPath);
                console.log(`        Probando: ${fullPath}`);
                if (fs.existsSync(fullPath)) {
                    const fileBuffer = fs.readFileSync(fullPath);
                    firmaBase64 = fileBuffer.toString('base64');
                    console.log(`        ✅ ENCONTRADO! ${fileBuffer.length} bytes → base64 ${firmaBase64.length} chars`);
                    foundFile = true;
                    break;
                } else {
                    console.log(`        ❌ No existe`);
                }
            }
            if (!foundFile) {
                console.log(`        ❌ ARCHIVO NO ENCONTRADO EN NINGUNA RUTA`);
            }
        }

        // Step 3d: Compare base64
        console.log('\n    3d. Verificación de integridad...');
        if (firmaBase64) {
            const matches = firmaBase64 === TEST_PNG_BASE64;
            console.log(`        Base64 original:   ${TEST_PNG_BASE64.substring(0, 40)}...`);
            console.log(`        Base64 recuperado: ${firmaBase64.substring(0, 40)}...`);
            console.log(`        ${matches ? '✅ MATCH PERFECTO — La firma se guardó y se leyó correctamente' : '⚠️ NO MATCH — Los datos son diferentes'}`);
        } else {
            console.log(`        ❌ No se pudo recuperar la firma como base64`);
        }

        // ── RESULTADO FINAL ──
        console.log('\n' + SEP2);
        if (firmaBase64) {
            console.log('  🎉 RESULTADO: FLUJO COMPLETO OK');
            console.log('     Guardar firma (archivo) → INSERT DELIVERY_STATUS → Leer cascada → base64 ✅');
        } else {
            console.log('  ❌ RESULTADO: FLUJO FALLIDO');
            console.log('     El archivo se guardó pero no se pudo recuperar a través de la cascada');
        }

    } catch (e) {
        console.log(`  ❌ Error en simulación: ${e.message}`);
        console.log(`     Stack: ${e.stack}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 8: Cleanup
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  8. LIMPIEZA — Eliminando datos de prueba');
    console.log(SEP);

    try {
        // Delete test file
        if (testCleanup.file && fs.existsSync(testCleanup.file)) {
            fs.unlinkSync(testCleanup.file);
            console.log(`  ✅ Archivo eliminado: ${testCleanup.file}`);
        }
        // Remove test directory if empty
        const testDir = path.join(photosDir, '_TEST');
        if (fs.existsSync(testDir)) {
            const remaining = fs.readdirSync(testDir);
            if (remaining.length === 0) {
                fs.rmdirSync(testDir);
                console.log(`  ✅ Directorio _TEST eliminado`);
            }
        }

        // Delete test DELIVERY_STATUS row
        if (testCleanup.deliveryStatus) {
            await query(`DELETE FROM JAVIER.DELIVERY_STATUS WHERE ID = '${TEST_ALB_ID}'`, false);
            console.log(`  ✅ DELIVERY_STATUS test row eliminada`);
        }
    } catch (e) {
        console.log(`  ⚠️ Error en limpieza: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 9: Resumen y diagnóstico
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + SEP);
    console.log('  9. RESUMEN — Estado del sistema de firmas');
    console.log(SEP);
    console.log(`
  Flujo principal (app móvil):
    1. Flutter captura firma → base64 PNG
    2. POST /entregas/uploads/signature → guarda archivo en uploads/photos/YYYY/MM/
    3. POST /entregas/update → INSERT DELIVERY_STATUS con FIRMA_PATH (ruta relativa)
    4. GET /repartidor/history/signature → cascada:
       a) DELIVERY_STATUS.FIRMA_PATH
       b) REPARTIDOR_FIRMAS (tabla vacía — no se usa)
       c) Leer archivo desde FIRMA_PATH → base64
       d) CACFIRMAS (legado ERP — solo 2022/2023)

  Tablas clave:
    - DELIVERY_STATUS (JAVIER): Almacena FIRMA_PATH (ruta relativa al archivo)
    - REPARTIDOR_FIRMAS (JAVIER): Diseñada para base64 directo, pero VACÍA
    - CACFIRMAS (DSEDAC): Legado, solo años 2022-2023
    - CLIENT_SIGNERS (JAVIER): Datos del firmante (DNI, nombre)

  Archivos:
    - Ubicación: uploads/photos/YYYY/MM/FIRMA_*.png
    - También: uploads/photos/sig-*.png (formato antiguo)
`);

    console.log(SEP);
    console.log('  Script finalizado.');
    console.log(SEP);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
