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
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${data.substring(0, 100)}...`));
                }
            });
        }).on('error', reject);
    });
}

async function runTests() {
    // Usamos el túnel directamente para no depender de si el localhost:3002 está en Windows o Linux
    const API_URL = 'https://anonymous-grill-firefox-old.trycloudflare.com/api';
    const year = 2026;
    const vendors = ['02', '05']; // Bartolo y Rodriguez

    console.log(`====================================================`);
    console.log(`  VERIFICANDO DATOS EN API PRE (TÚNEL CLOUDFLARE)   `);
    console.log(`  URL: ${API_URL}`);
    console.log(`====================================================`);

    for (const vendor of vendors) {
        console.log(`\n\n=== VENDEDOR ${vendor} - AÑO ${year} ===`);

        try {
            console.log(`\n[1] OBJETIVOS Y EVOLUCIÓN...`);
            const evoUrl = `${API_URL}/objectives/evolution?vendedorCodes=${vendor}&years=${year}`;
            const evoResponse = await fetchJson(evoUrl);

            if (evoResponse.yearlyData && evoResponse.yearlyData[year]) {
                const jan = evoResponse.yearlyData[year].find(m => m.month === 1);
                const feb = evoResponse.yearlyData[year].find(m => m.month === 2);
                console.log(`    - ENERO   -> Ventas: ${jan?.sales} | Objetivo: ${jan?.objective}`);
                console.log(`    - FEBRERO -> Ventas: ${feb?.sales} | Objetivo: ${feb?.objective}`);
            } else {
                console.log(`    ⚠️ No se encontraron datos de evolución para ${year}`);
            }

            console.log(`\n[2] RESUMEN DE COMISIONES...`);
            const commUrl = `${API_URL}/commissions/summary?vendedorCode=${vendor}&year=${year}`;
            const commResponse = await fetchJson(commUrl);

            if (commResponse.breakdown && commResponse.breakdown.length > 0) {
                const janComm = commResponse.breakdown[0].months.find(m => m.month === 1);
                console.log(`    - ENERO   -> Sales: ${janComm?.actual} | Target: ${janComm?.target}`);
            }
            console.log(`    - TOTAL COMISIÓN GENERADA: ${commResponse.grandTotalCommission}`);
            console.log(`    - TOTAL PAGADO: ${commResponse.payments?.total || 0}`);

        } catch (error) {
            console.error(`\n❌ Error consultando vendedor ${vendor}:`, error.message);
        }
    }

    console.log(`\n====================================================`);
    console.log(`                     FIN DEL TEST                   `);
    console.log(`====================================================\n`);
}

runTests();
