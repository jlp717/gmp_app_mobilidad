require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const bcrypt = require('bcryptjs');

// Configuration
const USERS_TO_CREATE = [
    { username: 'MARILOLA', name: 'Marilola', role: 'JEFE_VENTAS' },
    { username: 'MARTIN', name: 'Martin', role: 'JEFE_VENTAS' },
    { username: 'ALBERTO', name: 'Alberto', role: 'JEFE_VENTAS' }
];
const DEFAULT_PASS = '9322';

async function createSalesManagers() {
    try {
        console.log('🚀 Starting User Creation Process (Sales Managers)...');

        // 1. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(DEFAULT_PASS, salt);
        console.log(`🔐 Password hashed for '${DEFAULT_PASS}'`);

        // 2. Process Each User
        for (const user of USERS_TO_CREATE) {
            console.log(`\n👤 Processing user: ${user.username}...`);

            // Check if exists
            const existing = await query(`
                SELECT ID FROM JAVIER.USERS 
                WHERE UPPER(USERNAME) = '${user.username}'
            `, false);

            if (existing && existing.length > 0) {
                console.log(`⚠️ User ${user.username} already exists (ID: ${existing[0].ID}). Updating role/password...`);
                await query(`
                    UPDATE JAVIER.USERS 
                    SET PASSWORD = '${hashedPassword}', 
                        ROLE = '${user.role}',
                        ACTIVO = 1
                    WHERE ID = ${existing[0].ID}
                `);
                console.log(`✅ Updated ${user.username}`);
            } else {
                // Determine new ID
                const maxIdRows = await query(`SELECT MAX(ID) as MAXID FROM JAVIER.USERS`, false);
                const nextId = (maxIdRows[0].MAXID || 0) + 1;

                // Insert
                // Assuming columns: ID, USERNAME, PASSWORD, ROLE, ACTIVO, NAME... check previously viewed file to match schema
                // view_file of create_user_diego_v3.js will confirm schema. 
                // I'll wait for view_file result to be 100% sure of columns.
                // But I'm writing this tool call in parallel? No, I must wait. 
                // Wait, I am currently IN the thought block BEFORE the tool actions.
                // I will use `view_file` as the first step, then `write_to_file` in the next turn.
            }
        }
    } catch (e) {
        console.error('❌ Error:', e);
    }
}

// I cannot write the file yet because I don't know the exact columns from `create_user_diego_v3.js`.
// I will submit `view_file` only.
