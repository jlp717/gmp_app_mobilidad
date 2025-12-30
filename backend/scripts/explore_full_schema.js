/**
 * COMPREHENSIVE DB2 DATABASE SCHEMA EXPLORATION
 * Finds all tables and columns for comerciales, clients, sales, and routes
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function exploreFullSchema() {
    let connection;
    const report = {
        timestamp: new Date().toISOString(),
        tables: {},
        searchResults: {}
    };

    try {
        console.log('🔌 Connecting to DB2...');
        connection = await odbc.connect(DB_CONFIG);
        console.log('✅ Connected!\n');

        // 1. USUARIOS / APPUSUARIOS - for login
        console.log('='.repeat(60));
        console.log('1. EXPLORING APPUSUARIOS (Login/User table)');
        console.log('='.repeat(60));
        try {
            const users = await connection.query(`
        SELECT * FROM DSEDAC.APPUSUARIOS
        FETCH FIRST 10 ROWS ONLY
      `);
            if (users.length > 0) {
                report.tables['DSEDAC.APPUSUARIOS'] = {
                    columns: Object.keys(users[0]),
                    sampleData: users.slice(0, 3),
                    rowCount: users.length
                };
                console.log('Columns:', Object.keys(users[0]).join(', '));
                console.log('Sample:', JSON.stringify(users[0], null, 2));
            }
        } catch (e) { console.log('Error:', e.message); }

        // 2. EMPLEADOS / COMERCIALES tables
        console.log('\n' + '='.repeat(60));
        console.log('2. SEARCHING FOR EMPLOYEE/COMERCIAL TABLES');
        console.log('='.repeat(60));

        const employeeTables = ['EMP', 'COM', 'VEN', 'VENDEDOR', 'COMERCIAL', 'EMPLEADO', 'TRB'];
        for (const prefix of employeeTables) {
            try {
                const tables = await connection.query(`
          SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
          WHERE TABLE_SCHEMA = 'DSEDAC' 
          AND TABLE_NAME LIKE '${prefix}%'
          FETCH FIRST 20 ROWS ONLY
        `);
                if (tables.length > 0) {
                    console.log(`\nTables matching ${prefix}*:`, tables.map(t => t.TABLE_NAME).join(', '));
                    // Explore first matching table
                    for (const t of tables.slice(0, 3)) {
                        try {
                            const data = await connection.query(`
                SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 3 ROWS ONLY
              `);
                            if (data.length > 0) {
                                report.tables[`DSEDAC.${t.TABLE_NAME}`] = {
                                    columns: Object.keys(data[0]),
                                    sampleData: data.slice(0, 2)
                                };
                                console.log(`  ${t.TABLE_NAME} columns:`, Object.keys(data[0]).join(', '));
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore query errors */ }
        }

        // 3. CLIENT tables
        console.log('\n' + '='.repeat(60));
        console.log('3. SEARCHING FOR CLIENT TABLES');
        console.log('='.repeat(60));

        const clientPrefixes = ['CLI', 'CUE', 'TER'];
        for (const prefix of clientPrefixes) {
            try {
                const tables = await connection.query(`
          SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
          WHERE TABLE_SCHEMA = 'DSEDAC' 
          AND TABLE_NAME LIKE '${prefix}%'
          FETCH FIRST 20 ROWS ONLY
        `);
                if (tables.length > 0) {
                    console.log(`\nTables matching ${prefix}*:`, tables.map(t => t.TABLE_NAME).join(', '));
                    for (const t of tables.slice(0, 3)) {
                        try {
                            const data = await connection.query(`
                SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 3 ROWS ONLY
              `);
                            if (data.length > 0) {
                                report.tables[`DSEDAC.${t.TABLE_NAME}`] = {
                                    columns: Object.keys(data[0]),
                                    sampleData: data.slice(0, 2)
                                };
                                console.log(`  ${t.TABLE_NAME} columns:`, Object.keys(data[0]).join(', '));
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // 4. SALES / VENTAS tables
        console.log('\n' + '='.repeat(60));
        console.log('4. SEARCHING FOR SALES TABLES');
        console.log('='.repeat(60));

        const salesPrefixes = ['VEN', 'ALB', 'FAC', 'PED', 'CAB', 'LIN'];
        for (const prefix of salesPrefixes) {
            try {
                const tables = await connection.query(`
          SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
          WHERE TABLE_SCHEMA = 'DSEDAC' 
          AND TABLE_NAME LIKE '${prefix}%'
          FETCH FIRST 20 ROWS ONLY
        `);
                if (tables.length > 0) {
                    console.log(`\nTables matching ${prefix}*:`, tables.map(t => t.TABLE_NAME).join(', '));
                    for (const t of tables.slice(0, 3)) {
                        try {
                            const data = await connection.query(`
                SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 3 ROWS ONLY
              `);
                            if (data.length > 0) {
                                report.tables[`DSEDAC.${t.TABLE_NAME}`] = {
                                    columns: Object.keys(data[0]),
                                    sampleData: data.slice(0, 2)
                                };
                                console.log(`  ${t.TABLE_NAME} columns:`, Object.keys(data[0]).join(', '));
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // 5. ROUTES / RUTERO tables
        console.log('\n' + '='.repeat(60));
        console.log('5. SEARCHING FOR ROUTE TABLES');
        console.log('='.repeat(60));

        const routePrefixes = ['RUT', 'ROU', 'VIS', 'AGE'];
        for (const prefix of routePrefixes) {
            try {
                const tables = await connection.query(`
          SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
          WHERE TABLE_SCHEMA = 'DSEDAC' 
          AND TABLE_NAME LIKE '${prefix}%'
          FETCH FIRST 20 ROWS ONLY
        `);
                if (tables.length > 0) {
                    console.log(`\nTables matching ${prefix}*:`, tables.map(t => t.TABLE_NAME).join(', '));
                    for (const t of tables.slice(0, 3)) {
                        try {
                            const data = await connection.query(`
                SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 3 ROWS ONLY
              `);
                            if (data.length > 0) {
                                report.tables[`DSEDAC.${t.TABLE_NAME}`] = {
                                    columns: Object.keys(data[0]),
                                    sampleData: data.slice(0, 2)
                                };
                                console.log(`  ${t.TABLE_NAME} columns:`, Object.keys(data[0]).join(', '));
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // 6. Try key known tables directly
        console.log('\n' + '='.repeat(60));
        console.log('6. EXPLORING LIKELY KEY TABLES DIRECTLY');
        console.log('='.repeat(60));

        const keyTables = [
            'DSEDAC.CVC',  // Likely cabezas de venta comercial
            'DSEDAC.LVC',  // Likely lineas de venta comercial
            'DSEDAC.TAR',  // Tarifas
            'DSEDAC.ART',  // Articulos
            'DSEDAC.CLI',  // Clientes
            'DSEDAC.TER',  // Terceros
            'DSEDAC.RUT',  // Rutas
            'DSEDAC.RUTAS',
            'DSEDAC.VED',  // Vendedores
            'DSEDAC.VEN',  // Ventas
            'DSEDAC.CAB',  // Cabeceras
            'DSEDAC.LIN',  // Lineas
            'DSEDAC.ALB',  // Albaranes
            'DSEDAC.FAC',  // Facturas
        ];

        for (const tableName of keyTables) {
            try {
                const data = await connection.query(`
          SELECT * FROM ${tableName} FETCH FIRST 3 ROWS ONLY
        `);
                if (data.length > 0) {
                    report.tables[tableName] = {
                        columns: Object.keys(data[0]),
                        sampleData: data.slice(0, 2)
                    };
                    console.log(`\n✅ ${tableName}:`);
                    console.log('   Columns:', Object.keys(data[0]).join(', '));
                    console.log('   Sample:', JSON.stringify(data[0], null, 2).substring(0, 500));
                }
            } catch (e) {
                console.log(`❌ ${tableName}: Not accessible`);
            }
        }

        // 7. Get more details on APPUSUARIOS for login validation
        console.log('\n' + '='.repeat(60));
        console.log('7. APPUSUARIOS DETAILED - FOR LOGIN');
        console.log('='.repeat(60));

        try {
            const users = await connection.query(`
        SELECT * FROM DSEDAC.APPUSUARIOS
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('\nFull user data for login:');
            users.forEach((u, i) => {
                console.log(`\nUser ${i + 1}:`, JSON.stringify(u, null, 2));
            });
            report.loginTable = {
                tableName: 'DSEDAC.APPUSUARIOS',
                columns: Object.keys(users[0]),
                users: users
            };
        } catch (e) { console.log('Error:', e.message); }

        // 8. Look for NIF field (for login with last 4 of NIF)
        console.log('\n' + '='.repeat(60));
        console.log('8. SEARCHING FOR NIF FIELD IN ANY TABLE');
        console.log('='.repeat(60));

        try {
            const nifCols = await connection.query(`
        SELECT TABLE_NAME, COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' 
        AND (COLUMN_NAME LIKE '%NIF%' OR COLUMN_NAME = 'DNI' OR COLUMN_NAME LIKE '%DOC%')
        FETCH FIRST 30 ROWS ONLY
      `);
            console.log('Tables with NIF/DNI columns:', JSON.stringify(nifCols, null, 2));
            report.nifColumns = nifCols;
        } catch (e) { console.log('Error:', e.message); }

        // Save report
        fs.writeFileSync(
            './schema_exploration_result.json',
            JSON.stringify(report, null, 2)
        );
        console.log('\n\n✅ Report saved to schema_exploration_result.json');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (connection) {
            await connection.close();
            console.log('🔌 Connection closed.');
        }
    }
}

exploreFullSchema();
