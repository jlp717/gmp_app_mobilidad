const http = require('http');

function fetchApi(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function test() {
    console.log("🔍 Fetching API for Vendedor 33 - Miercoles...");
    try {
        const originalUrl = 'http://localhost:3334/api/rutero/day?vendedorCode=33&day=miercoles&ignoreOverrides=true';
        const originalRes = await fetchApi(originalUrl);
        console.log(`✅ [ORIGINAL AS400] Total Clients returned: ${originalRes.clients?.length || 0}`);

        const customUrl = 'http://localhost:3334/api/rutero/day?vendedorCode=33&day=miercoles&ignoreOverrides=false';
        const customRes = await fetchApi(customUrl);
        console.log(`✅ [CUSTOM ORDEN] Total Clients returned: ${customRes.clients?.length || 0}`);

    } catch (e) {
        console.error("❌ Error fetching API:", e.message);
    }
}

test();
