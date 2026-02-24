const https = require('https');
const http = require('http');

function fetchJson(url) {
    const lib = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
        lib.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: data });
                }
            });
        }).on('error', reject);
    });
}

async function runTests() {
    const API_URL = 'https://anonymous-grill-firefox-old.trycloudflare.com/api';
    const year = 2026;
    const vendor = '02';

    console.log(`====================================================`);
    console.log(`  DEBUGGING API PRE (TÚNEL CLOUDFLARE)   `);
    console.log(`  URL: ${API_URL}`);
    console.log(`====================================================`);

    try {
        console.log(`\n[1] TEST: /objectives/evolution...`);
        const evoUrl = `${API_URL}/objectives/evolution?vendedorCodes=${vendor}&years=${year}`;
        const evoResponse = await fetchJson(evoUrl);

        if (evoResponse.statusCode !== 200 || evoResponse.data.error) {
            console.error(`❌ ERROR en Evolution:`, JSON.stringify(evoResponse, null, 2));
        } else {
            console.log(`✅ Evolution OK. Resp:`, Object.keys(evoResponse.data));
        }

        console.log(`\n[2] TEST: /commissions/summary...`);
        const commUrl = `${API_URL}/commissions/summary?vendedorCode=${vendor}&year=${year}`;
        const commResponse = await fetchJson(commUrl);

        if (commResponse.statusCode !== 200 || commResponse.data.error) {
            console.error(`❌ ERROR en Commissions:`, JSON.stringify(commResponse, null, 2));
        } else {
            console.log(`✅ Commissions OK. Total:`, commResponse.data.grandTotalCommission);
        }

    } catch (error) {
        console.error(`\n❌ Error de red:`, error.message);
    }
}

runTests();
