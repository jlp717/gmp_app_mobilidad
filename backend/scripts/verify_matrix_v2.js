const axios = require('axios');

const BASE_URL = 'http://localhost:3334/api'; // Or whatever port it runs on (3001 or 3334)
// Checked server.js: PORT = process.env.PORT || 3334;
// Node process running on 3001 in terminal? "npx ngrok http 3001".
// Let's try 3001 first, or check the terminal output.
// The terminal says: "node server.js... running for 37m"
// server.js: app.listen(PORT...)
// I'll try 3334 which is default in file, but if env is set...
// Wait, the terminal command 'npx ngrok http 3001' implies the user thinks it's 3001. 
// I will try 3001.

const PORT = 3001;
const API = `http://localhost:${PORT}/api`;

// We need a valid token. Since we stripped auth in previous steps or user has token...
// Wait, "security: TOKEN AUTH ENFORCED". 
// I need a token. I can login first.

async function verify() {
    try {
        console.log('🔐 Logging in...');
        // Login with a known user (Javier)
        const loginRes = await axios.post(`${API}/auth/login`, {
            username: 'JAVIER',
            password: '123'
        });

        const token = loginRes.data.token;
        console.log('✅ Login successful. Token obtained.');

        const headers = { Authorization: `Bearer ${token}` };

        // 1. Verify /families
        console.log('\nTesting /families...');
        const famRes = await axios.get(`${API}/families?limit=5`, { headers });
        console.log(`✅ Families found: ${famRes.data.length}`);
        if (famRes.data.length > 0) console.log('Sample:', famRes.data[0]);

        // 2. Verify /matrix-data with Multi-Year
        console.log('\nTesting /dashboard/matrix-data (Multi-Year)...');
        const multiYearRes = await axios.get(`${API}/dashboard/matrix-data`, {
            params: { years: '2024,2025', groupBy: 'vendor' },
            headers
        });
        const rows = multiYearRes.data.rows;
        console.log(`✅ Rows returned: ${rows.length}`);
        if (rows.length > 0) {
            console.log('Sample Row:', rows[0]);
            // Check if data is aggregated? 
            // We can't easily verify exact numbers, but success 200 is good.
        }

        // 3. Verify Family Grouping
        console.log('\nTesting /dashboard/matrix-data (Group by Vendor, Family)...');
        const famGroupRes = await axios.get(`${API}/dashboard/matrix-data`, {
            params: { years: '2024', groupBy: 'vendor,family' },
            headers
        });
        const famRows = famGroupRes.data.rows;
        console.log(`✅ Family Group Rows: ${famRows.length}`);
        if (famRows.length > 0) {
            console.log('Sample Row (Check ID_2/NAME_2 for Family):');
            console.log(famRows[0]);
            // Check if NAME_2 looks like a family (not a product)
        }

        // 4. Verify Family Filtering
        if (famRes.data.length > 0) {
            const testFam = famRes.data[0].code;
            console.log(`\nTesting Family Filter (Family Code: ${testFam})...`);
            const filterRes = await axios.get(`${API}/dashboard/matrix-data`, {
                params: { years: '2024', familyCodes: testFam, groupBy: 'product' },
                headers
            });
            console.log(`✅ Filtered Rows: ${filterRes.data.rows.length}`);
            // We expect products belonging to this family
        }

    } catch (error) {
        console.error('❌ Error:', error.response ? error.response.data : error.message);
    }
}

verify();
