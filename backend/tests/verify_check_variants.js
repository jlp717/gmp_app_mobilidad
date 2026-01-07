const axios = require('axios');

const API_URL = 'http://localhost:3001/api/auth/login';

async function test(username, password, label) {
    try {
        console.log(`\nTesting: ${label} [${username} / ${password}]`);
        const res = await axios.post(API_URL, { username, password });
        console.log(`✅ Success: ${res.status}`);
        if (res.data.user) {
            console.log(`   User: ${res.data.user.name} | Code: ${res.data.user.code}`);
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ Failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            console.log(`❌ Error: ${error.message}`);
        }
    }
}

async function run() {
    // 1. Login by NAME (GOYO) - Should work (finding by Name)
    await test('GOYO', '9584', 'Login by INVALID NAME (just to check)');
    // Wait, Goyo is actually "GREGORIO...". "GOYO" is likely the CODIGOUSUARIO!
    // Let's test with "GREGORIO" (Name part)

    // 2. Login by CODE (01 or GOYO if GOYO is the code)
    // "01" is the vendor code. 
    // The previous logic found "GOYO" because CODIGOUSUARIO='GOYO'.

    // Let's test finding by exact Vendor Code '01' if mapped.
    // Actually, does '01' exist in APPUSUARIOS? No, usually 'GOYO' is in APPUSUARIOS.

    // The user wants to type "01". 
    // IF '01' is NOT in APPUSUARIOS, my query won't find it.
    // Query: SELECT ... FROM APPUSUARIOS WHERE CODIGOUSUARIO='01' OR NOMBRE='01'.

    // If '01' isn't in APPUSUARIOS, searching "01" will FAIL.
    // I need to check if 01 exists in APPUSUARIOS.

    await test('01', '9584', 'Login by Vendor Code 01');
    await test('GOYO', '9584', 'Login by UserCode GOYO');
}

run();
